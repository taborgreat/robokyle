"""Per-person, per-arm auto-calibration of the signal thresholds.

Every threshold in this project used to be a constant reasoned out in
advance. The first real session showed why that does not work: one of
them (`separable_d_prime = 1.5`) was below the *noise floor* of the
measure it gated, because two recordings of the same resting arm
minutes apart separate at d'=1.73 from drift alone. A fixed number
cannot know that. It depends on the person, the electrode placement,
the skin, the room, and the day.

So the app measures it instead. Give this module a session's own rest
recordings — plus, if they exist, an everyday-movement recording and
some real attempts — and it derives the thresholds from that person's
actual signal, writes them into the profile, and everything downstream
uses them.

What gets derived
-----------------
* **Noise floor** — what "nothing happening" looks like on this arm
  today: envelope mean, sd, p99, and peak.
* **Onset threshold** — found by search, not by formula. Raise k until
  the rest recording itself produces ZERO detected attempts, then add
  margin. This is the definition of the threshold we actually want:
  "high enough that resting never trips it."
* **d' noise floor** — rest against rest. Two recordings of the same
  state should be indistinguishable; whatever d' they actually score
  is the floor below which no separability claim means anything. The
  "distinct" bar is set above it, never below.
* **Trigger threshold** — how far an attempt must sit from ordinary
  movement before it is safe to fire on, plus the **hold time** needed
  to get the false-positive rate under target.

Calibration is written to `<arm>/calibration.json` and re-run whenever
a session closes, so it tracks drift instead of going stale.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from config import CONFIG

CALIBRATION_SCHEMA = "armband/calibration/1"

# How the search is bounded. k is "how many rest-sds above rest-mean".
K_MIN, K_MAX, K_STEP = 1.0, 20.0, 0.5
K_MARGIN = 1.0          # added once a clean k is found
FALLBACK_K = 4.0

# Target for the trigger: at most this chance of a spurious fire per
# decision. A missed click is an annoyance; a phantom click is not.
TARGET_FALSE_FIRE = 0.001


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def noise_floor(rest_samples: Sequence[np.ndarray], fs: int) -> Dict[str, Any]:
    """What "nothing happening" looks like, across every rest recording."""
    from analysis import envelope

    envs, per_channel = [], []
    for samples in rest_samples:
        if samples is None or samples.shape[1] == 0:
            continue
        env = envelope(samples, fs)
        envs.append(env.mean(axis=0))
        ac = samples - samples.mean(axis=1, keepdims=True)
        per_channel.append(np.sqrt(np.mean(ac ** 2, axis=1)))
    if not envs:
        return {"available": False}

    combined = np.concatenate(envs)
    ch = np.vstack(per_channel).mean(axis=0)
    return {
        "available":   True,
        "n_recordings": len(envs),
        "env_mean":    round(float(combined.mean()), 6),
        "env_sd":      round(float(combined.std()), 6),
        "env_p99":     round(float(np.percentile(combined, 99)), 6),
        "env_max":     round(float(combined.max()), 6),
        "channel_rms": [round(float(v), 6) for v in ch],
    }


def find_onset_k(rest_samples: Sequence[np.ndarray], fs: int,
                 rest: Dict[str, Any]) -> Dict[str, Any]:
    """Lowest k at which rest produces no attempts — plus margin.

    Searched rather than computed. The question "what threshold does
    this arm need" has an exact empirical answer: the one its own
    resting signal cannot cross.
    """
    from analysis import find_reps

    usable = [s for s in rest_samples if s is not None and s.shape[1] > 0]
    if not usable or not rest.get("available"):
        return {"k": FALLBACK_K, "method": "fallback — no rest recording",
                "false_reps_at_k": None}

    k = K_MIN
    while k <= K_MAX:
        false_reps = sum(len(find_reps(s, fs, rest, k=k)) for s in usable)
        if false_reps == 0:
            chosen = min(k + K_MARGIN, K_MAX)
            return {
                "k": round(chosen, 2),
                "clean_at_k": round(k, 2),
                "margin": K_MARGIN,
                "method": "searched — lowest k with zero attempts detected "
                          "in rest, plus margin",
                "false_reps_at_k": 0,
            }
        k += K_STEP
    return {"k": K_MAX, "method": "rest never went quiet — check contact",
            "false_reps_at_k": None, "warning": True}


def d_prime_floor(rest_samples: Sequence[np.ndarray], fs: int) -> Dict[str, Any]:
    """How far apart two recordings of the SAME state land.

    This is the number that exposed the original 1.5 threshold as
    meaningless. Anything at or below this floor is drift, not a
    difference between movements.
    """
    from analysis import feature_windows, separability

    usable = [s for s in rest_samples if s is not None and s.shape[1] > 0]
    if len(usable) < 2:
        return {"available": False,
                "note": "needs two rest recordings in the session to measure; "
                        "record rest twice and this calibrates itself"}
    scores: List[float] = []
    for i in range(len(usable)):
        for j in range(i + 1, len(usable)):
            va, _ = feature_windows(usable[i], fs)
            vb, _ = feature_windows(usable[j], fs)
            d = separability(va, vb).get("d_prime")
            if d is not None:
                scores.append(d)
    if not scores:
        return {"available": False, "note": "could not measure"}
    floor = float(np.max(scores))
    return {
        "available": True,
        "floor": round(floor, 3),
        "pairs": len(scores),
        "distinct_threshold": round(max(floor * 1.4, floor + 0.7), 3),
        "note": "two recordings of the same resting arm should be "
                "indistinguishable; whatever they score is the floor below "
                "which no separability claim is meaningful",
    }


def trigger_settings(attempt_clouds: Dict[str, np.ndarray],
                     distractor_clouds: Dict[str, np.ndarray],
                     distinct_threshold: float) -> Dict[str, Any]:
    """How safe is each movement as a trigger, and what hold time it needs.

    A single 250 ms decision at d'=2.0 is wrong about 16% of the time —
    hopeless for a mouse click. Requiring N consecutive agreeing windows
    drives that down roughly geometrically, so the useful output here is
    not just "is it separable" but "how long must it be held".
    """
    from analysis import separability

    if not attempt_clouds:
        return {"available": False, "note": "no movement probes yet"}
    if not distractor_clouds:
        return {
            "available": False,
            "note": "no everyday-movement recording. Without one there is no "
                    "way to measure the false-fire rate — record the "
                    "'Everyday movement (NO attempt)' protocol.",
        }

    window_s = 0.25
    results = []
    for name, attempt in attempt_clouds.items():
        best: Optional[Dict[str, Any]] = None
        for dname, distractor in distractor_clouds.items():
            sep = separability(attempt, distractor)
            d = sep.get("d_prime")
            if d is None:
                continue
            # Worst case across all distractors is what matters.
            if best is None or d < best["d_prime"]:
                best = {"d_prime": d, "vs": dname,
                        "window_error": sep.get("expected_error", 1.0)}
        if best is None:
            continue

        err = max(best["window_error"], 1e-6)
        holds = 1
        while holds < 12 and err ** holds > TARGET_FALSE_FIRE:
            holds += 1
        results.append({
            "probe":            name,
            "d_prime_vs_movement": round(best["d_prime"], 3),
            "compared_against":    best["vs"],
            "window_error":        round(err, 4),
            "hold_windows":        holds,
            "hold_time_s":         round(holds * window_s, 2),
            "projected_false_fire": round(err ** holds, 6),
            "safe":                best["d_prime"] >= distinct_threshold,
        })
    results.sort(key=lambda r: -r["d_prime_vs_movement"])
    return {"available": True, "target_false_fire": TARGET_FALSE_FIRE,
            "window_s": window_s, "candidates": results}


# ============================================================== driver


def calibrate_session(session, fs_default: int = 1000) -> Dict[str, Any]:
    """Derive every threshold from one session's own recordings."""
    from analysis import feature_windows, find_reps, rest_stats
    from probe_store import load_probe

    rest_arrays: List[np.ndarray] = []
    attempts: Dict[str, np.ndarray] = {}
    distractors: Dict[str, np.ndarray] = {}
    fs = fs_default

    for entry in session.active_probes():
        path = session.probe_path(entry.get("file", ""))
        if not os.path.exists(path):
            continue
        try:
            samples, meta = load_probe(path)
        except Exception:
            continue
        if samples.shape[1] == 0:
            continue
        fs = meta.sample_rate_hz or fs
        kind = meta.kind or entry.get("kind", "probe")
        if kind in ("rest", "baseline"):
            rest_arrays.append(samples)
        elif kind == "distractor":
            vecs, _ = feature_windows(samples, fs)
            if vecs.shape[0] >= 2:
                distractors[meta.probe or entry["file"]] = vecs
        else:
            cues = entry.get("cues") or []
            vecs, times = feature_windows(samples, fs)
            if cues and vecs.shape[0]:
                keep = np.zeros(vecs.shape[0], dtype=bool)
                for a, b in cues:
                    keep |= (times >= a - 0.25) & (times <= b)
                if keep.any():
                    vecs = vecs[keep]
            if vecs.shape[0] >= 2:
                attempts[meta.probe or entry["file"]] = vecs

    floor = noise_floor(rest_arrays, fs)
    rest = rest_stats(rest_arrays[0], fs) if rest_arrays else {"available": False}
    if len(rest_arrays) > 1:
        # Use every rest recording for the stats, not just the first.
        rest = rest_stats(np.concatenate(rest_arrays, axis=1), fs)

    onset = find_onset_k(rest_arrays, fs, rest)
    dfloor = d_prime_floor(rest_arrays, fs)
    distinct = (dfloor.get("distinct_threshold")
                if dfloor.get("available") else float(CONFIG.get("separable_d_prime")))
    trigger = trigger_settings(attempts, distractors, distinct)

    return {
        "schema":       CALIBRATION_SCHEMA,
        "generated":    _now(),
        "source_session": session.stamp,
        "profile":      session.profile,
        "arm":          session.arm,
        "sample_rate_hz": fs,
        "noise_floor":  floor,
        "onset":        onset,
        "onset_threshold_value": (
            round(floor["env_mean"] + onset["k"] * floor["env_sd"], 6)
            if floor.get("available") else None),
        "d_prime_floor": dfloor,
        "separable_d_prime": round(float(distinct), 3),
        "trigger":      trigger,
        "n_rest":       len(rest_arrays),
        "n_attempts":   len(attempts),
        "n_distractors": len(distractors),
    }


def calibration_path(profile, arm: str) -> str:
    return os.path.join(profile.arm_dir(arm), "calibration.json")


def save(profile, arm: str, calibration: Dict[str, Any]) -> str:
    path = calibration_path(profile, arm)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(calibration, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return path


def load(profile, arm: str) -> Dict[str, Any]:
    path = calibration_path(profile, arm)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def active_thresholds(profile, arm: str) -> Dict[str, Any]:
    """Calibrated values where they exist, config defaults where they don't."""
    cal = load(profile, arm) if profile is not None else {}
    return {
        "onset_threshold_k": (cal.get("onset", {}).get("k")
                              or float(CONFIG.get("onset_threshold_k"))),
        "separable_d_prime": (cal.get("separable_d_prime")
                              or float(CONFIG.get("separable_d_prime"))),
        "calibrated":        bool(cal),
        "generated":         cal.get("generated", ""),
        "source_session":    cal.get("source_session", ""),
    }


def summary_lines(cal: Dict[str, Any]) -> List[str]:
    """Human-readable rendering, for the Tuning panel and REPORT.md."""
    if not cal:
        return ["Not calibrated yet — record a rest probe and close a session."]
    L: List[str] = []
    floor = cal.get("noise_floor", {})
    if floor.get("available"):
        L.append(f"Noise floor (from {floor['n_recordings']} rest recording"
                 f"{'s' if floor['n_recordings'] != 1 else ''}): "
                 f"mean {floor['env_mean']:.4f}, sd {floor['env_sd']:.4f}, "
                 f"peak {floor['env_max']:.4f}")
        L.append(f"Per-channel rest RMS: "
                 + ", ".join(f"ch{i+1} {v:.4f}"
                             for i, v in enumerate(floor.get("channel_rms", []))))
    onset = cal.get("onset", {})
    L.append(f"Onset threshold: k={onset.get('k')} "
             f"(value {cal.get('onset_threshold_value')}) — {onset.get('method','')}")
    if onset.get("warning"):
        L.append("  WARNING: rest never went quiet. Check band contact and "
                 "that the arm is supported before trusting anything else.")
    dfloor = cal.get("d_prime_floor", {})
    if dfloor.get("available"):
        L.append(f"Separability noise floor: d'={dfloor['floor']} measured "
                 f"between two rest recordings. Anything below that is drift, "
                 f"so 'distinct' is set at {cal.get('separable_d_prime')}.")
    else:
        L.append(f"Separability noise floor: not measured — "
                 f"{dfloor.get('note', 'record rest twice')}")
    trig = cal.get("trigger", {})
    if trig.get("available"):
        L.append("")
        L.append("Trigger candidates (vs everyday movement):")
        for c in trig["candidates"]:
            verdict = "SAFE" if c["safe"] else "NOT SAFE"
            L.append(f"  [{verdict}] {c['probe']}: d'={c['d_prime_vs_movement']}, "
                     f"hold {c['hold_time_s']}s to reach "
                     f"{c['projected_false_fire']*100:.3f}% false-fire")
    else:
        L.append(f"Trigger tuning: {trig.get('note', 'not available')}")
    return L


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from profiles import ProfileStore

    store = ProfileStore()
    target = sys.argv[1] if len(sys.argv) > 1 else None
    names = [target] if target else store.list_profiles()
    for name in names:
        try:
            profile = store.load(name)
        except Exception as exc:
            print(f"{name}: {exc}")
            continue
        for arm in ("left", "right"):
            sessions = [s for s in profile.sessions(arm) if s.active_probes()]
            if not sessions:
                continue
            latest = sessions[-1]
            cal = calibrate_session(latest)
            path = save(profile, arm, cal)
            print(f"\n=== {name} / {arm} / {latest.stamp} ===")
            for line in summary_lines(cal):
                print("  " + line)
            print(f"  -> {os.path.relpath(path)}")
