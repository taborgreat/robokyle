"""Live signal-quality monitoring — catch a bad recording before it happens.

The expensive failure in this project is not a crash. It is finishing a
session, driving home, opening REPORT.md, and discovering the band had
slipped after the third probe — twenty minutes of Kyle's energy spent on
data that cannot be used, and no way to get it back without asking him
to do it again.

So the checks that used to live in the post-hoc report run continuously
instead, against the session's own calibrated baseline, and say
something while there is still time to fix it.

What it watches
---------------
* **Clipping** — a channel pinned at the rails carries no information.
* **Flatline / dropout** — an electrode that has stopped changing has
  lost contact.
* **Baseline drift** — the resting level walking away from what this
  session calibrated against. The usual cause is the band moving, and
  it invalidates comparisons with everything recorded earlier.
* **Channel collapse** — the three electrodes converging on the same
  signal. Three channels that agree are one channel, and the whole
  approach depends on them being independent.
* **Mains interference** — 50/60 Hz creeping in, usually a charger.

Each check returns a severity and, more importantly, **what to do about
it**. A warning that does not tell the helper what to change is just
noise on a screen they will learn to ignore.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

import numpy as np

OK = "ok"
WARN = "warn"
BAD = "bad"

SEVERITY_ORDER = {OK: 0, WARN: 1, BAD: 2}

# Thresholds. Deliberately generous — a monitor that cries wolf during
# normal use gets ignored, and then it is worse than nothing.
CLIP_WARN = 0.005          # 0.5% of samples at the rails
CLIP_BAD = 0.02
FLAT_UNIQUE_RATIO = 0.02   # distinct values as a share of samples
CORR_WARN = 0.85           # pairwise correlation between channels
CORR_BAD = 0.95
DRIFT_WARN = 2.0           # multiples of the calibrated rest level
DRIFT_BAD = 4.0
HUM_WARN = 0.25            # share of power within +/-2 Hz of mains


class Issue:
    def __init__(self, key: str, severity: str, message: str, fix: str,
                 value: Optional[float] = None) -> None:
        self.key = key
        self.severity = severity
        self.message = message
        self.fix = fix
        self.value = value

    def as_dict(self) -> Dict[str, Any]:
        return {"key": self.key, "severity": self.severity,
                "message": self.message, "fix": self.fix, "value": self.value}


def _ac(samples: np.ndarray) -> np.ndarray:
    return samples - samples.mean(axis=1, keepdims=True)


def check_clipping(samples: np.ndarray) -> Optional[Issue]:
    fraction = np.mean(np.abs(samples) >= 0.999, axis=1)
    worst = int(np.argmax(fraction))
    value = float(fraction[worst])
    if value >= CLIP_BAD:
        return Issue("clipping", BAD,
                     f"ch{worst+1} is clipping on {value*100:.1f}% of samples",
                     "The signal is hitting the limits and losing information. "
                     "Loosen the band slightly and re-seat that electrode.",
                     value)
    if value >= CLIP_WARN:
        return Issue("clipping", WARN,
                     f"ch{worst+1} is clipping on {value*100:.1f}% of samples",
                     "Worth re-seating that electrode before recording more.",
                     value)
    return None


def check_flatline(samples: np.ndarray) -> Optional[Issue]:
    n = samples.shape[1]
    if n < 200:
        return None
    for ch in range(3):
        unique = len(np.unique(samples[ch]))
        if unique / n < FLAT_UNIQUE_RATIO:
            return Issue("flatline", BAD,
                         f"ch{ch+1} is barely changing ({unique} distinct "
                         f"values in {n} samples)",
                         "That electrode has probably lost skin contact. "
                         "Check it is sitting flat and the skin is not dry.",
                         float(unique) / n)
    return None


def check_channel_collapse(samples: np.ndarray) -> Optional[Issue]:
    if samples.shape[1] < 64:
        return None
    with np.errstate(invalid="ignore", divide="ignore"):
        corr = np.nan_to_num(np.corrcoef(_ac(samples)))
    pairs = [(0, 1), (0, 2), (1, 2)]
    worst_pair, worst = max(((p, abs(corr[p])) for p in pairs),
                            key=lambda item: item[1])
    if worst >= CORR_BAD:
        return Issue("collapse", BAD,
                     f"ch{worst_pair[0]+1} and ch{worst_pair[1]+1} are "
                     f"almost identical (r={worst:.2f})",
                     "Those two electrodes are seeing the same thing, so you "
                     "effectively have fewer channels. Rotate the band a "
                     "little and watch the meters separate.",
                     float(worst))
    if worst >= CORR_WARN:
        return Issue("collapse", WARN,
                     f"ch{worst_pair[0]+1} and ch{worst_pair[1]+1} track each "
                     f"other closely (r={worst:.2f})",
                     "Some independence is being lost. A small rotation of "
                     "the band usually helps.",
                     float(worst))
    return None


def check_drift(samples: np.ndarray, calibration: Dict[str, Any]) -> Optional[Issue]:
    floor = (calibration or {}).get("noise_floor", {})
    if not floor.get("available"):
        return None
    reference = floor.get("channel_rms")
    if not reference:
        return None
    current = np.sqrt(np.mean(_ac(samples) ** 2, axis=1))
    ratios = current / np.maximum(np.asarray(reference, dtype=float), 1e-9)
    # Only meaningful at rest; during a contraction the level is
    # supposed to rise. The caller decides when to run this.
    worst = int(np.argmax(ratios))
    value = float(ratios[worst])
    if value >= DRIFT_BAD:
        return Issue("drift", BAD,
                     f"ch{worst+1} baseline is {value:.1f}x what this session "
                     f"calibrated against",
                     "The band has probably moved. Re-check placement against "
                     "the placement notes, then record rest again — otherwise "
                     "everything from here cannot be compared with what came "
                     "before.",
                     value)
    if value >= DRIFT_WARN:
        return Issue("drift", WARN,
                     f"ch{worst+1} baseline has risen to {value:.1f}x the "
                     f"calibrated level",
                     "Could be the band shifting, or the arm no longer "
                     "supported. Worth checking before the next probe.",
                     value)
    return None


def check_mains(samples: np.ndarray, fs: int) -> Optional[Issue]:
    n = samples.shape[1]
    if n < 512 or fs <= 0:
        return None
    window = min(n, 4096)
    block = _ac(samples)[:, -window:]
    worst_value, worst_ch, worst_freq = 0.0, 0, 60
    for ch in range(3):
        spectrum = np.abs(np.fft.rfft(block[ch] * np.hanning(window))) ** 2
        freqs = np.fft.rfftfreq(window, 1.0 / fs)
        total = float(spectrum[1:].sum())
        if total <= 0:
            continue
        for mains in (50, 60):
            band = (freqs >= mains - 2) & (freqs <= mains + 2)
            if not band.any():
                continue
            share = float(spectrum[band].sum() / total)
            if share > worst_value:
                worst_value, worst_ch, worst_freq = share, ch, mains
    if worst_value >= HUM_WARN:
        return Issue("mains", WARN,
                     f"ch{worst_ch+1} has {worst_value*100:.0f}% of its power "
                     f"at {worst_freq} Hz — mains interference",
                     "Usually the laptop charger. Unplug it and see if this "
                     "clears; otherwise move away from power cables.",
                     worst_value)
    return None


def assess(samples: np.ndarray, fs: int,
           calibration: Optional[Dict[str, Any]] = None,
           at_rest: bool = False) -> Dict[str, Any]:
    """Run every check. Returns severity, issues, and what to do."""
    if samples is None or samples.shape[1] == 0:
        return {"severity": OK, "issues": [], "headline": "No signal yet.",
                "checked": False}

    issues: List[Issue] = []
    for check in (check_clipping(samples), check_flatline(samples),
                  check_channel_collapse(samples), check_mains(samples, fs)):
        if check is not None:
            issues.append(check)
    if at_rest and calibration:
        drift = check_drift(samples, calibration)
        if drift is not None:
            issues.append(drift)

    issues.sort(key=lambda i: -SEVERITY_ORDER[i.severity])
    severity = issues[0].severity if issues else OK
    headline = (issues[0].message if issues
                else "Signal looks good on all three channels.")
    return {
        "severity": severity,
        "issues":   [i.as_dict() for i in issues],
        "headline": headline,
        "fix":      issues[0].fix if issues else "",
        "checked":  True,
    }


class QualityMonitor:
    """Rolling assessment, so a one-off blip does not raise an alarm.

    A single bad window means nothing — someone leaned on the cable. An
    issue that persists across several seconds is real. Only the latter
    is worth interrupting anyone for.
    """

    def __init__(self, window_s: float = 6.0, min_agreement: int = 3) -> None:
        self.window_s = window_s
        self.min_agreement = min_agreement
        self.history: Deque[Tuple[float, Dict[str, Any]]] = deque(maxlen=40)
        self.last_assessed = 0.0

    def update(self, samples: np.ndarray, fs: int,
               calibration: Optional[Dict[str, Any]] = None,
               at_rest: bool = False, interval_s: float = 1.0
               ) -> Optional[Dict[str, Any]]:
        now = time.time()
        if now - self.last_assessed < interval_s:
            return self.current()
        self.last_assessed = now
        self.history.append((now, assess(samples, fs, calibration, at_rest)))
        return self.current()

    def current(self) -> Optional[Dict[str, Any]]:
        """The assessment, but only reporting issues that have persisted."""
        if not self.history:
            return None
        cutoff = time.time() - self.window_s
        recent = [a for ts, a in self.history if ts >= cutoff]
        if not recent:
            return self.history[-1][1]

        counts: Dict[str, int] = {}
        examples: Dict[str, Dict[str, Any]] = {}
        for assessment in recent:
            for issue in assessment["issues"]:
                counts[issue["key"]] = counts.get(issue["key"], 0) + 1
                examples[issue["key"]] = issue
        persistent = [examples[k] for k, n in counts.items()
                      if n >= min(self.min_agreement, len(recent))]
        persistent.sort(key=lambda i: -SEVERITY_ORDER[i["severity"]])
        severity = persistent[0]["severity"] if persistent else OK
        return {
            "severity": severity,
            "issues":   persistent,
            "headline": (persistent[0]["message"] if persistent
                         else "Signal looks good on all three channels."),
            "fix":      persistent[0]["fix"] if persistent else "",
            "checked":  True,
            "samples_of": len(recent),
        }


if __name__ == "__main__":
    fs = 840
    rng = np.random.default_rng(0)
    n = fs * 3

    def report(label, samples, **kwargs):
        result = assess(samples, fs, **kwargs)
        print(f"{label:28} [{result['severity']:4}] {result['headline']}")
        if result["fix"]:
            print(f"{'':28}        -> {result['fix']}")

    clean = rng.normal(0, 0.05, (3, n))
    clean[1] = rng.normal(0, 0.07, n)
    clean[2] = rng.normal(0, 0.06, n)
    report("healthy", clean)

    clipped = clean.copy()
    clipped[0] = np.clip(clipped[0] * 40, -1, 1)
    report("one channel clipping", clipped)

    flat = clean.copy()
    flat[2] = np.zeros(n)
    report("one channel dead", flat)

    collapsed = np.vstack([clean[0], clean[0] * 1.01, clean[0] * 0.99])
    report("all channels identical", collapsed)

    t = np.arange(n) / fs
    hum = clean.copy()
    hum[0] += 0.5 * np.sin(2 * np.pi * 60 * t)
    report("mains interference", hum)

    calibration = {"noise_floor": {"available": True,
                                   "channel_rms": [0.05, 0.07, 0.06]}}
    drifted = clean.copy() * 5
    report("baseline drift at rest", drifted,
           calibration=calibration, at_rest=True)

    print("\nrolling monitor ignores a one-off blip:")
    monitor = QualityMonitor(min_agreement=3)
    for i in range(6):
        sample = clipped if i == 2 else clean          # one bad reading only
        monitor.history.append((time.time(), assess(sample, fs)))
    print("  ->", monitor.current()["headline"])
    print("\nbut reports a persistent one:")
    monitor = QualityMonitor(min_agreement=3)
    for _ in range(6):
        monitor.history.append((time.time(), assess(clipped, fs)))
    print("  ->", monitor.current()["headline"])
