"""Live detection: turn a stream of samples into "he meant that".

This is the part that makes Factum do real work rather than collect
data. It runs the trained model over the incoming signal and decides,
several times a second, whether what just happened was:

    rest        — the arm doing nothing
    movement    — ordinary everyday motion
    <a signal>  — a deliberate, trained attempt

Only the third produces output, and only under conditions chosen to
make false fires rare.

Three defences, in order
------------------------
1. **Confidence threshold.** The model's own operating point, chosen
   during training against held-out data to meet a stated false-fire
   budget. Below it, nothing counts.
2. **Hold time.** N consecutive windows must agree on the same class.
   A single confident window is not a decision — motion artefacts
   produce those constantly. Requiring agreement across time is what
   drops the false-fire rate by orders of magnitude.
3. **Refractory period.** After firing, ignore everything for a beat,
   so one sustained contraction is one click and not forty.

Reading the state out
---------------------
`snapshot()` returns everything the UI needs to show what the detector
currently believes, including how close it is to firing. Showing a
progress-to-fire bar matters more than it sounds: it is the difference
between "the app is broken" and "you are nearly there, hold it".
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

import numpy as np

import features as feat
from analysis import WINDOW_S
from model import REJECT_CLASSES, LinearModel
from probe_store import clip_fraction as feat_clip_fraction
from probe_store import clip_mask as feat_clip_mask

DEFAULT_HOLD_WINDOWS = 3
DEFAULT_REFRACTORY_S = 0.75
DEFAULT_CONFIDENCE = 0.90
HOP_S = 0.10                # decide 10x/second; independent of window length

# Motion gate — a scalar motion score above this abstains from firing.
# See STATUS.md ("The honest position") — motion gating is the primary
# mechanism for false-fire control, not amplitude thresholds.
DEFAULT_MOTION_ABSTAIN = 0.25
# Motion pre-roll — blocks a fire if the MEAN motion across the last
# hold_windows samples was above this (tighter than motion_abstain).
# The instantaneous abstain catches an active moving window; pre-roll
# catches sustained low-level motion (e.g. tremor, hand adjusting) in
# the pre-fire window where no single sample would trip the instant
# gate but the arm was clearly not "settled". Set 2026-08-15 (WORKLOG
# 23:55) after live test showed rest false-fires that a wider-in-time
# gate could help with.
DEFAULT_MOTION_PREROLL_MEAN_MAX = 0.15
# Censorship gate — if too much of the window was clipped, the amplitude
# features are lower bounds only. Rather than fire off a lie, abstain.
DEFAULT_CENSORSHIP_ABSTAIN = 0.10


class Detector:
    """Streaming classifier with hold and refractory logic.

    Deliberately not threaded. It is driven from the UI's timer callback
    with whatever samples have arrived since last time, which keeps all
    state on one thread and makes the behaviour reproducible — a
    detector that fires differently depending on thread scheduling is
    not something you can debug from a log.
    """

    def __init__(self, model: Optional[LinearModel] = None,
                 sample_rate_hz: int = 1000,
                 confidence_threshold: float = DEFAULT_CONFIDENCE,
                 hold_windows: int = DEFAULT_HOLD_WINDOWS,
                 refractory_s: float = DEFAULT_REFRACTORY_S,
                 on_fire: Optional[Callable[[str, float], None]] = None,
                 motion_score_provider: Optional[Callable[[], float]] = None,
                 motion_abstain: float = DEFAULT_MOTION_ABSTAIN,
                 motion_preroll_mean_max: float = DEFAULT_MOTION_PREROLL_MEAN_MAX,
                 censorship_abstain: float = DEFAULT_CENSORSHIP_ABSTAIN,
                 on_abstain: Optional[Callable[[str, float], None]] = None
                 ) -> None:
        self.model = model
        self.sample_rate_hz = sample_rate_hz
        self.confidence_threshold = confidence_threshold
        self.hold_windows = max(1, int(hold_windows))
        self.refractory_s = refractory_s
        self.on_fire = on_fire
        # Abstention: a third valid output. When conditions are known
        # bad (motion too high, censorship too high) we decline to
        # decide rather than guessing. See STATUS.md — a device that
        # says nothing during limb movement is better than one that
        # fires wrong. Provider is injected so Detector doesn't
        # hardcode where motion comes from (live = IMU + sub-20 Hz
        # SNC; offline replay = None or an SNC-only computation).
        self.motion_score_provider = motion_score_provider
        self.motion_abstain = motion_abstain
        self.motion_preroll_mean_max = motion_preroll_mean_max
        self.censorship_abstain = censorship_abstain
        self.on_abstain = on_abstain
        self.abstained = 0
        self.preroll_blocks = 0
        self.last_abstain_ts = 0.0
        self.last_abstain_reason = ""
        # Rolling motion history for pre-roll gate. One entry per
        # _decide call, holding the motion snapshot at that decision.
        self.motion_history: Deque[float] = deque(maxlen=max(1, int(hold_windows)))

        self.window_samples = max(int(WINDOW_S * sample_rate_hz), 16)
        self.hop_samples = max(int(HOP_S * sample_rate_hz), 1)

        self._buffer: Deque[np.ndarray] = deque()
        self._buffered = 0
        self._since_hop = 0

        self.current_label = "—"
        self.current_confidence = 0.0
        self.consecutive = 0
        self.last_fire_ts = 0.0
        self.fires = 0
        self.windows_seen = 0
        self.history: Deque[Tuple[float, str, float]] = deque(maxlen=300)
        self.class_counts: Dict[str, int] = {}

        # Time measured in SAMPLES, not wall clock.
        #
        # The refractory period used time.time(). Live that is fine —
        # samples arrive in real time, so the two agree. In a replay it
        # is catastrophic: 30s of recording is fed in a fraction of a
        # second, so after the first fire the detector stays inside its
        # refractory window for the entire remaining replay and every
        # later attempt is silently discarded. `evaluate_recording` is
        # the function that validates the false-fire claim, so it was
        # under-reporting fires — flattering on false fires, damning on
        # recall, and wrong in both directions at once.
        #
        # A clock driven by samples fed reads the same in both modes.
        self._clock_s = 0.0

    # ------------------------------------------------------------ config

    def configure(self, model: Optional[LinearModel], sample_rate_hz: int,
                  confidence_threshold: float, hold_windows: int,
                  refractory_s: float) -> None:
        self.model = model
        self.sample_rate_hz = max(int(sample_rate_hz), 1)
        self.window_samples = max(int(WINDOW_S * self.sample_rate_hz), 16)
        self.hop_samples = max(int(HOP_S * self.sample_rate_hz), 1)
        self.confidence_threshold = float(confidence_threshold)
        self.hold_windows = max(1, int(hold_windows))
        self.refractory_s = float(refractory_s)
        # Resize motion history to the new hold window, preserving
        # the most recent entries (a shorter deque should keep the
        # freshest values, not the oldest).
        self.motion_history = deque(
            list(self.motion_history)[-self.hold_windows:],
            maxlen=self.hold_windows)
        self.reset()

    def reset(self) -> None:
        self._buffer.clear()
        self._buffered = 0
        self._since_hop = 0
        self._clock_s = 0.0
        self.consecutive = 0
        self.current_label = "—"
        self.current_confidence = 0.0
        self.motion_history.clear()

    @property
    def ready(self) -> bool:
        return self.model is not None

    @property
    def in_refractory(self) -> bool:
        return (self._clock_s - self.last_fire_ts) < self.refractory_s

    # ------------------------------------------------------------- input

    def feed(self, block: np.ndarray) -> List[Dict[str, Any]]:
        """Push new samples; returns any decisions made. Shape (3, N)."""
        if block is None or block.ndim != 2 or block.shape[0] != 3 or block.shape[1] == 0:
            return []
        self._buffer.append(block.astype(np.float32, copy=False))
        self._buffered += block.shape[1]
        self._since_hop += block.shape[1]
        self._clock_s += block.shape[1] / float(self.sample_rate_hz)

        # Keep only what a window needs, plus a little slack.
        limit = self.window_samples * 3
        while self._buffered - self._buffer[0].shape[1] >= limit:
            self._buffered -= self._buffer.popleft().shape[1]

        events: List[Dict[str, Any]] = []
        while (self._since_hop >= self.hop_samples
               and self._buffered >= self.window_samples):
            self._since_hop -= self.hop_samples
            event = self._decide()
            if event:
                events.append(event)
        return events

    def _window(self) -> Optional[np.ndarray]:
        if self._buffered < self.window_samples:
            return None
        joined = np.concatenate(list(self._buffer), axis=1)
        return joined[:, -self.window_samples:]

    # ---------------------------------------------------------- decision

    def _decide(self) -> Optional[Dict[str, Any]]:
        window = self._window()
        if window is None or self.model is None:
            return None

        # Censorship check — how much of the window was at the rail?
        # If too much, the amplitude features are lower-bounds only;
        # spectral features are corrupted by clipping harmonics.
        # Abstain rather than lie.
        cens = float(feat_clip_fraction(window).mean())

        # Motion check — if provided, ask the IMU (or a caller-injected
        # source) whether the arm is moving right now. Above threshold
        # → abstain regardless of what the classifier says.
        motion = 0.0
        if self.motion_score_provider is not None:
            try:
                motion = float(self.motion_score_provider())
            except Exception:
                motion = 0.0
        # Record for the pre-roll gate. Append EVERY decision (including
        # abstains), so a burst of motion that trips the instantaneous
        # gate also persists in the history that guards the next fire.
        if self.motion_score_provider is not None:
            self.motion_history.append(motion)

        abstain_reason = ""
        if cens >= self.censorship_abstain:
            abstain_reason = f"censored {100*cens:.0f}%"
        elif motion >= self.motion_abstain:
            abstain_reason = f"motion {motion:.2f}"
        if abstain_reason:
            self.consecutive = 0
            self.current_label = "abstain"
            self.current_confidence = 0.0
            self.abstained += 1
            self.last_abstain_ts = self._clock_s
            self.last_abstain_reason = abstain_reason
            if self.on_abstain is not None:
                try:
                    self.on_abstain(abstain_reason, motion)
                except Exception:
                    pass
            return {"abstain": True, "reason": abstain_reason,
                    "motion": motion, "censorship": cens,
                    "ts": self._clock_s}

        # Always compute the feature set the MODEL was trained on.
        # A model is meaningless with any other, and silently
        # feeding it the wrong one is worse than refusing to run.
        vector = feat.vector(window, self.sample_rate_hz,
                             getattr(self.model, 'feature_version',
                                     feat.DEFAULT_VERSION),
                             clip_mask=feat_clip_mask(window))
        label, confidence = self.model.predict(vector)
        self.windows_seen += 1
        self.current_label = label
        self.current_confidence = confidence
        self.history.append((self._clock_s, label, confidence))
        self.class_counts[label] = self.class_counts.get(label, 0) + 1

        is_signal = (label not in REJECT_CLASSES
                     and confidence >= self.confidence_threshold)
        if not is_signal:
            self.consecutive = 0
            return None

        # Agreement has to be with the SAME class; alternating between two
        # signals is indecision, not a held contraction.
        #
        # Count STRICTLY consecutive matches walking backwards from the
        # most recent window (which was just appended). Stop at the
        # first mismatch — a mismatch is what breaks a "held"
        # contraction. This IS the meaning of "consecutive".
        #
        # HISTORICAL BUG (fixed 2026-08-14): the previous
        # implementation fell into a `sum(1 for h in reversed(history)
        # if h[1] == label ...)` branch that summed ALL matching
        # entries across the entire 300-deep history, not just
        # consecutive ones. After any real fire, past spurious
        # matches accumulated in history — every subsequent single
        # matching window then instantly cleared hold_windows and
        # fired. "Floodgates open after first fire." See WORKLOG
        # 2026-08-14 23:xx.
        self.consecutive = 0
        for h in reversed(list(self.history)):
            if h[1] == label and h[2] >= self.confidence_threshold:
                self.consecutive += 1
            else:
                break

        if self.consecutive < self.hold_windows:
            return None
        if self.in_refractory:
            return None

        # Motion pre-roll — block the fire if MEAN motion across the
        # last hold_windows decisions was above the pre-roll ceiling
        # (tighter than motion_abstain). Catches sustained low-level
        # motion in the pre-fire window that never trips the
        # instantaneous gate.
        # Do NOT reset consecutive on a pre-roll block — a truly
        # quiet tail should allow the fire as soon as the mean drops.
        if (self.motion_score_provider is not None
                and len(self.motion_history) >= self.hold_windows):
            recent = list(self.motion_history)[-self.hold_windows:]
            mean_motion = sum(recent) / len(recent)
            if mean_motion >= self.motion_preroll_mean_max:
                self.preroll_blocks += 1
                self.last_abstain_ts = self._clock_s
                self.last_abstain_reason = (
                    f"pre-roll motion mean {mean_motion:.2f} "
                    f">= {self.motion_preroll_mean_max:.2f}")
                if self.on_abstain is not None:
                    try:
                        self.on_abstain(self.last_abstain_reason, mean_motion)
                    except Exception:
                        pass
                return None

        self.last_fire_ts = self._clock_s
        self.fires += 1
        self.consecutive = 0
        if self.on_fire is not None:
            try:
                self.on_fire(label, confidence)
            except Exception:
                pass
        return {"label": label, "confidence": confidence, "ts": self.last_fire_ts}

    # ------------------------------------------------------------ readout

    def progress_to_fire(self) -> float:
        """0-1 — how close the current contraction is to triggering."""
        if self.hold_windows <= 0:
            return 0.0
        return min(self.consecutive / self.hold_windows, 1.0)

    def snapshot(self) -> Dict[str, Any]:
        return {
            "ready":          self.ready,
            "label":          self.current_label,
            "confidence":     round(self.current_confidence, 3),
            "is_signal":      (self.current_label not in REJECT_CLASSES
                               and self.current_label != "—"),
            "above_threshold": self.current_confidence >= self.confidence_threshold,
            "consecutive":    self.consecutive,
            "hold_windows":   self.hold_windows,
            "progress":       self.progress_to_fire(),
            "in_refractory":  self.in_refractory,
            "fires":          self.fires,
            "abstained":      self.abstained,
            "abstain_rate":   (self.abstained / self.windows_seen
                               if self.windows_seen else 0.0),
            "last_abstain_reason": self.last_abstain_reason,
            "windows_seen":   self.windows_seen,
            "threshold":      self.confidence_threshold,
            "motion_abstain": self.motion_abstain,
            "motion_preroll_mean_max": self.motion_preroll_mean_max,
            "preroll_blocks": self.preroll_blocks,
            "censorship_abstain": self.censorship_abstain,
        }

    # ---------------------------------------------------------- offline

    def evaluate_recording(self, samples: np.ndarray, fs: int) -> Dict[str, Any]:
        """Replay a recording through the detector as if it were live.

        This is how the false-fire claim gets checked against reality
        rather than against a formula: replay an everyday-movement
        recording and count how many times it would have clicked. The
        answer should be zero.
        """
        if self.model is None or samples.shape[1] == 0:
            return {"available": False}
        saved = (self.consecutive, self.last_fire_ts, self.fires,
                 self.windows_seen, list(self.history))
        self.reset()
        self.fires = 0
        self.windows_seen = 0
        self.last_fire_ts = 0.0
        self._clock_s = 0.0
        self.history.clear()

        fired: List[Dict[str, Any]] = []
        chunk = max(int(0.1 * fs), 1)
        # Replay in real-time-sized chunks so the hold and refractory
        # logic sees the same shape of input it will see live.
        for i in range(0, samples.shape[1], chunk):
            for event in self.feed(samples[:, i:i + chunk]):
                event["at_s"] = round((i + chunk) / fs, 2)
                fired.append(event)
        duration = samples.shape[1] / fs
        counts = dict(self.class_counts)
        result = {
            "available":    True,
            "duration_s":   round(duration, 2),
            "windows":      self.windows_seen,
            "fires":        len(fired),
            "fires_per_minute": round(len(fired) / max(duration / 60.0, 1e-9), 2),
            "events":       fired[:40],
            "class_counts": counts,
        }
        (self.consecutive, self.last_fire_ts, self.fires,
         self.windows_seen, history) = saved
        self.history = deque(history, maxlen=300)
        return result


def from_profile(profile, arm: str, sample_rate_hz: int = 1000,
                 on_fire: Optional[Callable[[str, float], None]] = None,
                 motion_score_provider: Optional[Callable[[], float]] = None,
                 on_abstain: Optional[Callable[[str, float], None]] = None,
                 ) -> Tuple[Optional[Detector], str]:
    """Build a detector from a profile's saved model and operating point.

    Retunes the CV-derived operating point toward the LIVE reality:
    the CV assumed independent windows and a controlled rest, but
    real use has correlated windows and noisier rest — so hold time,
    refractory and confidence all get pushed up here rather than
    trusting the training-time numbers.

    `motion_score_provider` (typically `client.motion_score`) is
    wired straight into the detector's abstention gate — when the
    limb is moving, the detector says "abstain" instead of firing.

    Returns (detector, explanation). The explanation is shown to the
    operator when there is no usable model — "nothing happens and I do
    not know why" is the worst possible state for this screen.
    """
    model = LinearModel.load(profile.model_metrics_path(arm)) if profile else None
    if model is None:
        return None, ("No trained model for this arm yet. Record a rest "
                      "baseline, at least one movement, and an "
                      "everyday-movement sample, then train.")

    operating = (model.metadata or {}).get("operating_point", {}) or {}
    # Live tuning: bias every live parameter toward "harder to
    # fire" than the CV-derived training point. The CV assumes
    # independent windows; consecutive windows in live use are
    # correlated, so the projected FA rate is optimistic by
    # ~10x. Compensate here.
    cv_threshold = operating.get("confidence_threshold", DEFAULT_CONFIDENCE)
    cv_hold      = operating.get("hold_windows", DEFAULT_HOLD_WINDOWS)
    # Confidence: don't fire on borderline calls. Floor bumped
    # 0.75 → 0.80 on 2026-08-14 (WORKLOG 23:55) after live test
    # showed a rest-noise false fire clearing 0.75. Independent of
    # the motion pre-roll gate — this tightens the rest bar in the
    # SNC classifier itself, where the pre-roll cannot reach.
    threshold = max(float(cv_threshold), 0.80)
    # Hold time: the number that matters most for false-fire
    # suppression. 5 windows at 100ms hop = 500ms of sustained
    # agreement. Correlated windows notwithstanding, this materially
    # cuts spurious fires.
    hold = max(int(cv_hold), 5)
    # Refractory: one physical attempt = one click, not four.
    refractory_s = 1.5
    detector = Detector(
        model, sample_rate_hz,
        confidence_threshold=threshold,
        hold_windows=hold,
        refractory_s=refractory_s,
        on_fire=on_fire,
        motion_score_provider=motion_score_provider,
        on_abstain=on_abstain,
    )
    signals = [c for c in model.classes if c not in REJECT_CLASSES]
    gate_note = ("motion gate + censorship gate active"
                 if motion_score_provider is not None
                 else "no motion gate wired (add a provider to enable)")
    return detector, (
        f"Model trained {(model.metadata or {}).get('trained', '?')} on "
        f"{len(signals)} signal{'s' if len(signals) != 1 else ''}: "
        f"{', '.join(signals)}. Live: fires above confidence "
        f"{threshold:.2f} held for {hold} windows "
        f"({round(hold * HOP_S, 2)}s), refractory {refractory_s}s. "
        f"CV picked {cv_threshold:.2f} / {cv_hold}w — live is stricter. "
        f"{gate_note}."
    )


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from probe_store import load_probe
    from profiles import ProfileStore

    store = ProfileStore()
    for name in (sys.argv[1:] or store.list_profiles()):
        try:
            profile = store.load(name)
        except Exception:
            continue
        for arm in ("left", "right"):
            det, note = from_profile(profile, arm)
            if det is None:
                continue
            print(f"\n=== {name} / {arm} ===")
            print(f"  {note}")
            sessions = [s for s in profile.sessions(arm) if s.probes()]
            if not sessions:
                continue
            sess = sessions[-1]
            print(f"\n  Replaying every recording through the live detector:")
            for entry in sess.probes():
                path = sess.probe_path(entry["file"])
                if not os.path.exists(path):
                    continue
                samples, meta = load_probe(path)
                det.configure(det.model, meta.sample_rate_hz or 1000,
                              det.confidence_threshold, det.hold_windows,
                              det.refractory_s)
                res = det.evaluate_recording(samples, meta.sample_rate_hz or 1000)
                if not res.get("available"):
                    continue
                kind = meta.kind
                expected = ("SHOULD NOT FIRE" if kind in ("rest", "distractor")
                            else "should fire")
                verdict = ""
                if kind in ("rest", "distractor"):
                    verdict = "  <-- FALSE FIRES" if res["fires"] else "  ok"
                print(f"    {meta.probe[:38]:38} [{kind:10}] "
                      f"{res['fires']:3} fires in {res['duration_s']:5.1f}s "
                      f"({expected}){verdict}")
