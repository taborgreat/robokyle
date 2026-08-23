"""Automatic analysis of a field session. No clicks required.

Runs when a session closes and writes three files into the session
folder:

    analysis.json        machine-readable: every number, nothing lost
    REPORT.md            readable without the app, by someone who is
                         not the person who recorded it
    ANALYSIS_PROMPT.md   a ready-made prompt summarising this session,
                         for handing to a Claude session cold

What it computes, and why
-------------------------
The goal is not the strongest signal. It is the smallest set of
movements Kyle can produce *the same way every time, without tiring*.
So the ranking is deliberately weighted toward consistency and low
effort, and a strong-but-variable movement scores below a weak-but-
identical one. A movement that looks different every time is unusable
however big it is; a movement that exhausts him will not survive daily
use however good its numbers look.

Per probe:
  * **Signal-to-baseline ratio** per channel, against this session's own
    rest probe. Baseline drifts with placement, skin and fatigue, so a
    ratio against another day's rest is meaningless.
  * **Onset latency** — how long after the cue the signal actually rises.
  * **Rise sharpness** — 10-90% rise time of the first burst. A crisp
    onset is easier for a classifier to trigger on.
  * **Repetitions** — the recording is split into bursts of activity.
  * **Within-probe consistency** — how alike those repetitions are, as
    the mean pairwise cosine similarity of their feature vectors.
  * **Channel signature** — which of the three electrodes carry it.

Across probes:
  * **Pairwise separability** — d' along the best linear boundary
    between two probes' feature clouds (the same kind of boundary an
    LDA will later draw). Two strong probes that look identical are one
    input, not two.

Across sessions:
  * The same probe name recorded on another day is compared to today —
    cosine similarity of the mean feature vector, plus the d' between
    the two days. Low d' across days means the movement repeats; high
    d' means today's placement or his execution has drifted.

Features come from `features.py` and are versioned. They are what the
classifier will use, so nothing here flatters a model that cannot be
built later. The set grew from 15 to 36 on 2026-08-08 after real data
showed the original amplitude-only features could not distinguish a
deliberate attempt from ordinary arm movement — both sat at +13.5 dB
above rest. Spectral shape and cross-channel ratios can, and measurably
did: held-out accuracy 70.0% -> 73.2%, signal recall 65.5% -> 71.7%.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

import features as feat
import probe_quality
from config import CONFIG
from probe_store import load_probe
from session import Session

ANALYSIS_SCHEMA = "armband/analysis/1"

CHANNEL_LABELS = ("ch1 (ulnar)", "ch2 (median)", "ch3 (radial)")
# Feature extraction lives in features.py, versioned, so a saved model
# always gets the feature set it was trained on. Analysis uses the
# current default — its numbers describe today's signal, not a model.
FEATURE_KINDS = feat.V1_KINDS
FEATURE_NAMES: Tuple[str, ...] = feat.names(feat.DEFAULT_VERSION)

WINDOW_S = 0.25          # feature window — long enough for a stable RMS
HOP_S = 0.125            # 50% overlap
ENVELOPE_WIN_S = 0.05    # activity envelope resolution

# Plain-English definitions, reused in REPORT.md, CLAUDE.md and the
# analysis prompt so every reader gets the same explanation.
METRIC_GLOSSARY: List[Tuple[str, str]] = [
    ("snr_vs_rest",
     "How much louder the channel is than this session's rest recording, "
     "in dB. 0 dB means indistinguishable from rest. Above ~6 dB is a "
     "signal you can see; above ~12 dB is comfortable."),
    ("onset_latency_s",
     "Seconds from the start of the recording to the first burst of "
     "activity. Only meaningful when he was cued to start immediately."),
    ("rise_time_s",
     "How long the first burst took to go from 10% to 90% of its peak. "
     "Shorter is a crisper onset and easier to trigger on."),
    ("reps",
     "Bursts of activity found in the recording — one per attempt at the "
     "movement."),
    ("consistency",
     "How alike the repetitions are, 0-1, computed as 1/(1 + mean "
     "coefficient of variation of the feature vector across "
     "repetitions). 1.0 means identical every time. This is the number "
     "that matters most: a movement he cannot repeat identically is "
     "unusable no matter how strong it is. Above 0.70 is good, below "
     "0.50 is a problem."),
    ("channel_signature",
     "Share of the movement's energy carried by each electrode. A "
     "movement concentrated on one channel is easier to separate than "
     "one spread evenly across all three."),
    ("usability",
     "Overall 0-1 score, weighted heavily toward whether the movement "
     "repeats reliably. Effort and fatigue are recorded but carry "
     "little weight: a tiring movement that gives a good, repeatable "
     "result is worth keeping. See 'How usability is scored'."),
    ("d_prime",
     "Separability between two probes along the best linear boundary. "
     "Below 1.0 the classifier will confuse them; above 1.5 they are "
     "usably distinct; above 3.0 they are unmistakable."),
]

# Effort and fatigue are recorded and reported, but they are TIE-BREAKERS,
# not disqualifiers. Revised 2026-08-08 on the user's instruction: "less
# concerned with how a move fatigues you — getting a good result even if
# tiring is not worth throwing out." An earlier version deducted up to
# 0.30 for fatigue, which was enough to bury a movement that worked.
# Reliability now dominates; tiring is a note attached to a good result,
# not a reason to lose it.
EFFORT_SCORE = {"easy": 1.0, "moderate": 0.75, "strenuous": 0.5, "": 0.75}
FATIGUE_PENALTY = {"none": 0.0, "some": 0.02, "high": 0.05, "": 0.01}


# ============================================================== primitives


def _ac(samples: np.ndarray) -> np.ndarray:
    """Remove the DC offset per channel — electrode DC is not signal."""
    if samples.size == 0:
        return samples
    return samples - samples.mean(axis=1, keepdims=True)


def envelope(samples: np.ndarray, fs: int,
             win_s: float = ENVELOPE_WIN_S) -> np.ndarray:
    """Per-channel RMS envelope, shape (3, M). One value per window."""
    if samples.shape[1] == 0:
        return np.zeros((3, 0), dtype=np.float32)
    win = max(int(win_s * fs), 1)
    n_win = samples.shape[1] // win
    if n_win == 0:
        return np.sqrt(np.mean(_ac(samples) ** 2, axis=1, keepdims=True))
    trimmed = _ac(samples)[:, : n_win * win].reshape(3, n_win, win)
    return np.sqrt(np.mean(trimmed ** 2, axis=2))


def feature_vector(block: np.ndarray, fs: int = 1000) -> np.ndarray:
    """One window's features, in the current default feature set."""
    return feat.vector(block, fs, feat.DEFAULT_VERSION)


def feature_windows(samples: np.ndarray, fs: int,
                    win_s: float = WINDOW_S,
                    hop_s: float = HOP_S) -> Tuple[np.ndarray, np.ndarray]:
    """Sliding-window features. Returns (vectors (M, D), start times (M,))."""
    return feat.windows(samples, fs, win_s, hop_s, feat.DEFAULT_VERSION)


# ================================================================== rest


def rest_stats(samples: np.ndarray, fs: int) -> Dict[str, Any]:
    """Baseline description: what 'nothing happening' looks like today."""
    env = envelope(samples, fs)
    if env.shape[1] == 0:
        return {"available": False}
    per_ch_mean = env.mean(axis=1)
    per_ch_sd = env.std(axis=1)
    ac = _ac(samples)
    return {
        "available":       True,
        "n_samples":       int(samples.shape[1]),
        "duration_s":      round(samples.shape[1] / fs, 3),
        "env_mean":        [round(float(v), 6) for v in per_ch_mean],
        "env_sd":          [round(float(v), 6) for v in per_ch_sd],
        "rms":             [round(float(v), 6) for v in np.sqrt(np.mean(ac ** 2, axis=1))],
        "dc_offset":       [round(float(v), 6) for v in samples.mean(axis=1)],
        "clip_fraction":   [round(float(v), 6)
                            for v in np.mean(np.abs(samples) >= 0.999, axis=1)],
        "combined_mean":   round(float(per_ch_mean.mean()), 6),
        "combined_sd":     round(float(per_ch_sd.mean()), 6),
    }


def _empty_rest() -> Dict[str, Any]:
    return {"available": False}


# ============================================================ segmentation


def find_reps(samples: np.ndarray, fs: int, rest: Dict[str, Any],
              k: Optional[float] = None,
              min_duration_s: Optional[float] = None,
              gap_s: Optional[float] = None) -> List[Tuple[float, float]]:
    """Split a recording into bursts of activity — one per attempt.

    Threshold is baseline mean + k × baseline sd where a rest probe
    exists, and otherwise a self-referential threshold from the quietest
    part of this recording. Bursts shorter than `min_duration_s` are
    noise; bursts separated by less than `gap_s` are one burst.
    """
    k = CONFIG.get("onset_threshold_k") if k is None else k
    min_duration_s = (CONFIG.get("rep_min_duration_s")
                      if min_duration_s is None else min_duration_s)
    gap_s = CONFIG.get("rep_gap_s") if gap_s is None else gap_s

    env = envelope(samples, fs)
    if env.shape[1] == 0:
        return []
    combined = env.mean(axis=0)
    win_s = ENVELOPE_WIN_S

    if rest.get("available"):
        base = float(np.mean(rest["env_mean"]))
        sd = float(np.mean(rest["env_sd"])) or (base * 0.25 + 1e-9)
    else:
        # No rest probe: use this recording's own quiet 25% as the floor.
        quiet = np.sort(combined)[: max(len(combined) // 4, 1)]
        base = float(quiet.mean())
        sd = float(quiet.std()) or (base * 0.25 + 1e-9)
    threshold = base + k * sd

    active = combined >= threshold
    if not active.any():
        return []

    # Contiguous runs, then merge across short gaps.
    runs: List[List[int]] = []
    start = None
    for i, on in enumerate(active):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append([start, i])
            start = None
    if start is not None:
        runs.append([start, len(active)])

    merged: List[List[int]] = []
    gap_win = max(int(gap_s / win_s), 1)
    for run in runs:
        if merged and run[0] - merged[-1][1] <= gap_win:
            merged[-1][1] = run[1]
        else:
            merged.append(run)

    min_win = max(int(min_duration_s / win_s), 1)
    return [(round(a * win_s, 3), round(b * win_s, 3))
            for a, b in merged if (b - a) >= min_win]


# =============================================================== per probe


def probe_metrics(samples: np.ndarray, fs: int,
                  rest: Optional[Dict[str, Any]] = None,
                  kind: str = "probe",
                  cues: Optional[Sequence[Sequence[float]]] = None) -> Dict[str, Any]:
    """Everything we can say about one recording on its own.

    `cues` is the schedule of attempt windows the app displayed during
    recording, when a guided protocol was used. Where it exists it is
    ground truth and beats detection outright — we know when the person
    was told to move, so there is no need to infer it. Detection still
    runs alongside, because the disagreement is the interesting part:
    a cued window with no detected activity is an attempt that produced
    no signal, which is a finding about him, not about the software.
    """
    rest = rest or _empty_rest()
    n = int(samples.shape[1])
    out: Dict[str, Any] = {
        "n_samples":  n,
        "duration_s": round(n / fs, 3) if fs else 0.0,
        "kind":       kind,
    }
    if n == 0:
        out["usable"] = False
        out["note"] = "empty recording"
        return out

    ac = _ac(samples)
    rms = np.sqrt(np.mean(ac ** 2, axis=1))
    out["rms"] = [round(float(v), 6) for v in rms]
    out["peak"] = [round(float(v), 6) for v in np.max(np.abs(ac), axis=1)]
    out["dc_offset"] = [round(float(v), 6) for v in samples.mean(axis=1)]
    out["clip_fraction"] = [round(float(v), 6)
                            for v in np.mean(np.abs(samples) >= 0.999, axis=1)]

    # Cross-channel correlation: all three moving together means the
    # electrodes are seeing one thing, not three.
    if n > 8:
        with np.errstate(invalid="ignore", divide="ignore"):
            corr = np.corrcoef(ac)
        corr = np.nan_to_num(corr)
        out["correlations"] = {
            "ch1_ch2": round(float(corr[0, 1]), 4),
            "ch1_ch3": round(float(corr[0, 2]), 4),
            "ch2_ch3": round(float(corr[1, 2]), 4),
        }

    # Signal-to-baseline, per channel.
    if rest.get("available"):
        rest_rms = np.asarray(rest["rms"], dtype=float)
        ratio = rms / np.maximum(rest_rms, 1e-9)
        out["snr_vs_rest"] = [round(float(v), 3) for v in ratio]
        out["snr_vs_rest_db"] = [round(float(20 * math.log10(max(v, 1e-9))), 2)
                                 for v in ratio]
        out["best_channel"] = int(np.argmax(ratio))
        out["best_channel_db"] = out["snr_vs_rest_db"][out["best_channel"]]
    else:
        out["snr_vs_rest"] = None
        out["snr_vs_rest_db"] = None
        out["best_channel"] = int(np.argmax(rms))
        out["best_channel_db"] = None

    # Channel signature — share of AC energy above baseline.
    if rest.get("available"):
        excess = np.maximum(rms - np.asarray(rest["rms"], dtype=float), 0.0)
    else:
        excess = rms
    total = float(excess.sum())
    out["channel_signature"] = (
        [round(float(v / total), 3) for v in excess] if total > 0
        else [0.0, 0.0, 0.0]
    )

    if kind in ("rest", "baseline"):
        out["usable"] = True
        return out

    # -- repetitions
    detected = find_reps(samples, fs, rest)
    out["n_reps_detected"] = len(detected)

    cue_windows = [(float(a), float(b)) for a, b in (cues or [])
                   if b > a and a < n / fs]
    if cue_windows:
        # Cued windows win. Report how many of them actually produced
        # activity — that ratio is the honest measure of whether he can
        # produce the movement on demand.
        landed = sum(1 for a, b in cue_windows
                     if any(da < b and db > a for da, db in detected))
        out["cued"] = True
        out["n_reps_cued"] = len(cue_windows)
        out["n_reps_with_signal"] = landed
        out["cue_hit_rate"] = round(landed / len(cue_windows), 3)
        if landed < len(cue_windows):
            out["cue_note"] = (
                f"{len(cue_windows) - landed} of {len(cue_windows)} cued "
                f"attempts produced no detectable signal")
        reps = cue_windows
    else:
        out["cued"] = False
        reps = detected

    out["reps"] = [{"start_s": round(a, 3), "end_s": round(b, 3),
                    "duration_s": round(b - a, 3)} for a, b in reps]
    out["n_reps"] = len(reps)

    if reps:
        out["onset_latency_s"] = reps[0][0]
        out["rise_time_s"] = _rise_time(samples, fs, reps[0])
        out["duty_fraction"] = round(
            sum(b - a for a, b in reps) / max(n / fs, 1e-9), 3)
    else:
        out["onset_latency_s"] = None
        out["rise_time_s"] = None
        out["duty_fraction"] = 0.0

    # -- within-probe consistency across repetitions
    rep_vectors = []
    for a, b in reps:
        seg = samples[:, int(a * fs): int(b * fs)]
        if seg.shape[1] >= max(int(0.05 * fs), 8):
            rep_vectors.append(feature_vector(seg, fs))
    if len(rep_vectors) >= 2:
        mat = np.vstack(rep_vectors)
        consistency, cv = _consistency(mat)
        out["consistency"] = round(consistency, 4)
        out["feature_cv"] = round(cv, 4)
    else:
        out["consistency"] = None
        out["feature_cv"] = None
        out["consistency_note"] = (
            "fewer than 2 repetitions detected — cannot judge repeatability; "
            "record this probe again with several distinct attempts"
        )

    # -- feature cloud over the active parts, for separability
    vecs, times = feature_windows(samples, fs)
    if reps and vecs.shape[0]:
        keep = np.zeros(vecs.shape[0], dtype=bool)
        for a, b in reps:
            keep |= (times >= a - WINDOW_S) & (times <= b)
        active = vecs[keep] if keep.any() else vecs
    else:
        active = vecs
    out["_features"] = active            # stripped before writing JSON
    out["n_feature_windows"] = int(active.shape[0])
    out["feature_mean"] = [round(float(v), 6) for v in active.mean(axis=0)] \
        if active.shape[0] else None

    out["usable"] = bool(reps) and out.get("consistency") is not None
    return out


def _rise_time(samples: np.ndarray, fs: int,
               rep: Tuple[float, float]) -> Optional[float]:
    """10-90% rise time of the burst envelope. Crisper onset = lower."""
    seg = samples[:, int(rep[0] * fs): int(rep[1] * fs)]
    if seg.shape[1] < int(0.05 * fs) or seg.shape[1] == 0:
        return None
    env = envelope(seg, fs, win_s=0.01).mean(axis=0)
    if env.size < 3:
        return None
    peak = float(env.max())
    if peak <= 0:
        return None
    lo, hi = 0.1 * peak, 0.9 * peak
    above_lo = np.argmax(env >= lo)
    above_hi = np.argmax(env >= hi)
    if above_hi <= above_lo:
        return None
    return round(float((above_hi - above_lo) * 0.01), 3)


def _consistency(mat: np.ndarray) -> Tuple[float, float]:
    """How alike are the repetitions? Returns (consistency 0-1, mean CV).

    Each row is one repetition's feature vector. We measure spread with
    the coefficient of variation per feature — std across repetitions
    over the mean — because CV is scale-free, and these features differ
    in scale by orders of magnitude (waveform length dwarfs RMS).

        consistency = 1 / (1 + mean CV)

    so identical repetitions give 1.0, a mean CV of 0.43 gives 0.70
    (the "good" line), and a CV of 1.0 — a feature that varies as much
    as its own average — gives 0.50.

    Note what NOT to do here: centring the rows first (z-scoring across
    repetitions) makes every probe score the same, because n points
    around their own centroid always have mean pairwise cosine
    -1/(n-1) regardless of how alike they were. That measures the
    number of repetitions, not their similarity.
    """
    if mat.shape[0] < 2:
        return 1.0, 0.0
    mean = mat.mean(axis=0)
    sd = mat.std(axis=0, ddof=1)
    # Ignore features that are ~zero for this probe: their CV is noise
    # amplified by a near-zero denominator, not information.
    scale = np.abs(mean)
    floor = max(float(scale.max()) * 1e-3, 1e-12)
    keep = scale > floor
    if not keep.any():
        return 1.0, 0.0
    cv = sd[keep] / scale[keep]
    mean_cv = float(np.mean(cv))
    return float(np.clip(1.0 / (1.0 + mean_cv), 0.0, 1.0)), mean_cv


# =========================================================== separability


def separability(a: np.ndarray, b: np.ndarray) -> Dict[str, Any]:
    """d' between two feature clouds along the best linear boundary.

    This is a regularised Fisher discriminant — the same kind of
    boundary the LDA classifier will draw later, so the number here is
    an honest preview of whether the classifier can tell these apart,
    not an optimistic one.
    """
    if a is None or b is None or a.shape[0] < 2 or b.shape[0] < 2:
        return {"d_prime": None, "note": "not enough feature windows"}

    mu_a, mu_b = a.mean(axis=0), b.mean(axis=0)
    diff = mu_a - mu_b
    cov = ((a - mu_a).T @ (a - mu_a) + (b - mu_b).T @ (b - mu_b)) / \
          max(a.shape[0] + b.shape[0] - 2, 1)
    # Shrinkage keeps this stable with few windows and 15 dimensions.
    lam = 0.1 * float(np.trace(cov)) / cov.shape[0] + 1e-12
    reg = cov + lam * np.eye(cov.shape[0])
    try:
        w = np.linalg.solve(reg, diff)
    except np.linalg.LinAlgError:
        return {"d_prime": None, "note": "degenerate covariance"}
    if not np.isfinite(w).all() or np.allclose(w, 0):
        return {"d_prime": None, "note": "degenerate projection"}

    pa, pb = a @ w, b @ w
    pooled = math.sqrt((pa.var(ddof=1) + pb.var(ddof=1)) / 2.0)
    if pooled <= 0:
        return {"d_prime": None, "note": "zero within-class variance"}
    d = abs(float(pa.mean() - pb.mean())) / pooled

    # Expected confusion if a classifier put the boundary midway.
    error = 0.5 * math.erfc(d / (2 * math.sqrt(2)))
    cos = float(np.dot(mu_a, mu_b) /
                (np.linalg.norm(mu_a) * np.linalg.norm(mu_b) + 1e-12))
    top = np.argsort(-np.abs(w * diff))[:3]
    return {
        "d_prime":            round(d, 3),
        "expected_error":     round(error, 4),
        "mean_cosine":        round(cos, 4),
        "distinct":           d >= float(CONFIG.get("separable_d_prime")),
        "top_features":       [FEATURE_NAMES[i] for i in top],
    }


# ============================================================== scoring


def usability_score(metrics: Dict[str, Any], effort: str, fatigue: str,
                    confidence: int) -> Dict[str, Any]:
    """0-1, weighted the way the project actually values things.

    Consistency dominates, effort is next, raw strength is worth least.
    A movement that tires him is penalised outright — it will not
    survive daily use however good the rest of its numbers are.
    """
    consistency = metrics.get("consistency")
    consistency_term = 0.0 if consistency is None else float(consistency)
    effort_term = EFFORT_SCORE.get((effort or "").lower(), 0.6)

    db = metrics.get("best_channel_db")
    if db is None:
        strength_term = 0.0
    else:
        strength_term = float(np.clip(db / 12.0, 0.0, 1.0))  # 12 dB = full marks

    conf_term = (float(confidence) / 5.0) if confidence else 0.0

    score = (0.45 * consistency_term +
             0.25 * strength_term +
             0.20 * conf_term +
             0.10 * effort_term)
    score -= FATIGUE_PENALTY.get((fatigue or "").lower(), 0.01)
    score = float(np.clip(score, 0.0, 1.0))

    return {
        "usability":   round(score, 3),
        "components": {
            "consistency": round(consistency_term, 3),
            "effort":      round(effort_term, 3),
            "strength":    round(strength_term, 3),
            "confidence":  round(conf_term, 3),
            "fatigue_penalty": FATIGUE_PENALTY.get((fatigue or "").lower(), 0.05),
        },
    }


SCORING_EXPLANATION = (
    "usability = 0.45 x consistency + 0.25 x strength + 0.20 x his "
    "confidence + 0.10 x effort, minus a small fatigue tie-breaker "
    "(none 0, some 0.02, high 0.05). Consistency is weighted highest on "
    "purpose: a movement he cannot repeat identically is unusable no "
    "matter how strong it is. Effort and fatigue are recorded and "
    "reported but deliberately carry little weight — a movement that "
    "produces a good, repeatable result is worth keeping even if it is "
    "tiring, and should not be scored out of contention for it."
)


# ========================================================= session driver


def analyse_session(session: Session,
                    history: Optional[Sequence[Session]] = None,
                    write_files: bool = True) -> Dict[str, Any]:
    """Analyse one session end to end. Called automatically on close."""
    history = list(history or [])
    entries = session.active_probes()
    info = session.info()
    fs_default = int(CONFIG.get("fallback_sample_rate_hz"))

    # ---- rest probe first; everything else is relative to it
    rest_entry = session.rest_probe()
    rest: Dict[str, Any] = _empty_rest()
    if rest_entry:
        samples, meta = _load(session, rest_entry)
        if samples is not None:
            rest = rest_stats(samples, meta.sample_rate_hz or fs_default)
            rest["file"] = rest_entry.get("file")

    results: List[Dict[str, Any]] = []
    clouds: Dict[str, np.ndarray] = {}

    for entry in entries:
        samples, meta = _load(session, entry)
        if samples is None:
            results.append({
                "file": entry.get("file"), "probe": entry.get("probe"),
                "error": "could not read file",
            })
            continue
        fs = meta.sample_rate_hz or fs_default
        m = probe_metrics(samples, fs, rest,
                          kind=meta.kind or entry.get("kind", "probe"),
                          cues=entry.get("cues"))
        features = m.pop("_features", None)
        scored = usability_score(m, meta.effort, meta.fatigue, meta.his_confidence)
        m.update(scored)

        row = {
            "file":           entry.get("file"),
            "index":          entry.get("index"),
            "probe":          meta.probe or entry.get("probe", ""),
            "kind":           meta.kind or entry.get("kind", "probe"),
            "started":        meta.started,
            "effort":         meta.effort,
            "fatigue":        meta.fatigue,
            "his_confidence": meta.his_confidence,
            "placement":      meta.placement,
            "notes":          meta.notes,
            "status":         meta.status,
            "metrics":        m,
        }
        # Was this recording any good? Decided from the recording, not
        # from anyone's memory of the room. Recomputed every analysis so
        # sessions recorded before the check existed get one too, and so
        # a probe's context flags update as its siblings arrive.
        siblings = [e for e in entries
                    if (e.get("probe") or "").strip().lower()
                    == (row["probe"] or "").strip().lower()
                    and e.get("file") != row["file"]]
        row["sample_rate_hz"] = fs
        row["sample_rate_source"] = meta.sample_rate_source
        row["quality"] = probe_quality.assess_probe(
            samples, fs, m,
            {"metrics": m, "sample_rate_source": meta.sample_rate_source},
            row["kind"], rest, siblings)
        m["quality"] = row["quality"]

        results.append(row)
        # Distractors DO belong in the feature clouds: "can we tell an
        # attempt from ordinary movement" is the false-positive question,
        # and it is answered by the same pairwise separability maths.
        if features is not None and features.shape[0] >= 2 and \
                row["kind"] not in ("rest", "baseline"):
            clouds[row["file"]] = features
        # Metrics live in the manifest too, so probes.json alone answers
        # "what is in this session".
        session.update_probe(row["file"], metrics=m,
                             quality=row["quality"])

    # ---- pairwise separability
    pairs: List[Dict[str, Any]] = []
    files = list(clouds.keys())
    for i in range(len(files)):
        for j in range(i + 1, len(files)):
            fa, fb = files[i], files[j]
            sep = separability(clouds[fa], clouds[fb])
            sep.update({
                "a_file": fa, "b_file": fb,
                "a": _probe_name(results, fa), "b": _probe_name(results, fb),
            })
            pairs.append(sep)
    pairs.sort(key=lambda p: (p.get("d_prime") is None, p.get("d_prime") or 0.0))

    # ---- across-session repeatability by probe name
    repeatability = _compare_history(results, clouds, history)

    analysis = {
        "schema":        ANALYSIS_SCHEMA,
        "generated":     dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "profile":       session.profile or info.get("profile", ""),
        "arm":           session.arm or info.get("arm", ""),
        "session":       session.stamp,
        "session_info":  info,
        "rest":          rest,
        "probes":        results,
        "separability":  pairs,
        "repeatability": repeatability,
        "ranking":       _ranking(results),
        "recommendations": _recommendations(results, pairs, rest, repeatability),
        "scoring":       SCORING_EXPLANATION,
        "glossary":      {k: v for k, v in METRIC_GLOSSARY},
    }

    if write_files:
        from probe_store import save_metrics_json
        save_metrics_json(session.analysis_json, analysis)
        _write_text(session.report_md, render_report(analysis, session))
        _write_text(session.prompt_md, render_prompt(analysis, session))
    return analysis


def _load(session: Session, entry: Dict[str, Any]):
    path = session.probe_path(entry.get("file", ""))
    if not entry.get("file") or not os.path.exists(path):
        return None, None
    try:
        return load_probe(path)
    except Exception:
        return None, None


def _probe_name(results: List[Dict[str, Any]], filename: str) -> str:
    for r in results:
        if r.get("file") == filename:
            return r.get("probe", filename)
    return filename


def _ranking(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Distractors are negative examples, not candidate inputs — they
    # belong in the separability table but never in the ranking.
    rows = [r for r in results
            if r.get("kind") not in ("rest", "baseline", "distractor")
            and "metrics" in r]
    rows.sort(key=lambda r: r["metrics"].get("usability", 0.0), reverse=True)
    return [{
        "probe":       r["probe"],
        "file":        r["file"],
        "usability":   r["metrics"].get("usability"),
        "consistency": r["metrics"].get("consistency"),
        "best_channel_db": r["metrics"].get("best_channel_db"),
        "effort":      r.get("effort"),
        "fatigue":     r.get("fatigue"),
        "n_reps":      r["metrics"].get("n_reps"),
    } for r in rows]


def _compare_history(results: List[Dict[str, Any]],
                     clouds: Dict[str, np.ndarray],
                     history: Sequence[Session]) -> List[Dict[str, Any]]:
    """Same probe name, other days: has it drifted?"""
    out: List[Dict[str, Any]] = []
    if not history:
        return out

    # Index previous sessions' probes by lowercase name.
    previous: Dict[str, List[Tuple[Session, Dict[str, Any]]]] = {}
    for sess in history:
        for entry in sess.active_probes():
            if entry.get("kind") in ("rest", "baseline"):
                continue
            name = (entry.get("probe") or "").strip().lower()
            if name:
                previous.setdefault(name, []).append((sess, entry))

    for row in results:
        if row.get("kind") in ("rest", "baseline") or "metrics" not in row:
            continue
        name = (row.get("probe") or "").strip().lower()
        prior = previous.get(name)
        if not prior:
            continue
        today = clouds.get(row["file"])
        comparisons = []
        for sess, entry in prior[-3:]:          # last three occurrences
            samples, meta = _load(sess, entry)
            if samples is None:
                continue
            fs = meta.sample_rate_hz or int(CONFIG.get("fallback_sample_rate_hz"))
            past_rest = _empty_rest()
            rest_entry = sess.rest_probe()
            if rest_entry:
                rs, rm = _load(sess, rest_entry)
                if rs is not None:
                    past_rest = rest_stats(rs, rm.sample_rate_hz or fs)
            past_m = probe_metrics(samples, fs, past_rest)
            past_features = past_m.pop("_features", None)
            comp: Dict[str, Any] = {
                "session":          sess.stamp,
                "then_consistency": past_m.get("consistency"),
                "now_consistency":  row["metrics"].get("consistency"),
                "then_db":          past_m.get("best_channel_db"),
                "now_db":           row["metrics"].get("best_channel_db"),
            }
            if today is not None and past_features is not None:
                drift = separability(today, past_features)
                comp["drift_d_prime"] = drift.get("d_prime")
                comp["repeats"] = (
                    None if drift.get("d_prime") is None
                    else drift["d_prime"] < float(CONFIG.get("separable_d_prime"))
                )
            comparisons.append(comp)
        if comparisons:
            out.append({"probe": row["probe"], "file": row["file"],
                        "compared_with": comparisons})
    return out


def _recommendations(results: List[Dict[str, Any]],
                     pairs: List[Dict[str, Any]],
                     rest: Dict[str, Any],
                     repeatability: List[Dict[str, Any]]) -> List[str]:
    """What to try next, in plain language. Ranked, specific, actionable."""
    recs: List[str] = []
    probes = [r for r in results if r.get("kind") not in ("rest", "baseline")
              and "metrics" in r]

    if not rest.get("available"):
        recs.append(
            "No rest probe in this session, so every signal-to-baseline "
            "number is missing. Record 'rest' first thing next session — "
            "the app prompts for it automatically."
        )
    elif max(rest.get("clip_fraction", [0])) > 0.01:
        recs.append(
            "The rest recording is clipping at the rails, which means the "
            "baseline itself is unusable. Check band tightness and "
            "electrode contact before recording anything else."
        )

    if not probes:
        recs.append("No movement probes recorded — only rest. Nothing to compare.")
        return recs

    # Separability against ordinary movement decides false positives, so
    # it gets called out before probe-vs-probe confusion.
    distractors = {r["file"] for r in results if r.get("kind") == "distractor"}
    if not distractors:
        recs.append(
            "No 'everyday movement' recording in this session. Without one "
            "there is no way to tell whether a detector would fire on "
            "ordinary arm movement — which is exactly what a false positive "
            "is. Record one next session: same length, arm moving normally, "
            "no trigger attempt at any point."
        )
    for p in pairs:
        d = p.get("d_prime")
        if d is None:
            continue
        against_noise = (p["a_file"] in distractors) != (p["b_file"] in distractors)
        if against_noise:
            movement = p["b"] if p["a_file"] in distractors else p["a"]
            if d < 1.5:
                recs.append(
                    f"'{movement}' is NOT reliably distinguishable from "
                    f"ordinary arm movement (d'={d:.2f}, expected false-fire "
                    f"rate {p.get('expected_error', 0)*100:.0f}%). As a "
                    f"trigger it would fire on everyday activity. Needs a "
                    f"more distinct movement, or a higher threshold plus a "
                    f"hold time."
                )
            else:
                recs.append(
                    f"'{movement}' separates cleanly from ordinary movement "
                    f"(d'={d:.2f}) — a promising trigger candidate."
                )
        elif d < 1.0:
            recs.append(
                f"'{p['a']}' and '{p['b']}' are not separable (d'={d:.2f}, "
                f"expected confusion {p.get('expected_error', 0)*100:.0f}%). "
                f"Treat them as ONE input, or change one of them into a "
                f"clearly different movement."
            )

    # Inconsistent but strong.
    for r in probes:
        m = r["metrics"]
        c = m.get("consistency")
        if c is not None and c < 0.5 and (m.get("best_channel_db") or 0) > 6:
            recs.append(
                f"'{r['probe']}' is strong but he cannot repeat it "
                f"(consistency {c:.2f}). Worth re-recording with a clearer "
                f"cue before writing it off — an inconsistent movement is "
                f"unusable as it stands."
            )
        if m.get("n_reps", 0) < 2:
            recs.append(
                f"'{r['probe']}' shows fewer than two clear attempts, so "
                f"repeatability could not be judged. Re-record it with "
                f"several distinct attempts separated by a clear rest."
            )
        if (r.get("fatigue") or "") == "high" and (m.get("usability") or 0) >= 0.55:
            recs.append(
                f"'{r['probe']}' works but is tiring. Keep it — a good "
                f"result is worth having. Worth checking whether a "
                f"lower-effort movement separates as well, and worth "
                f"watching whether it holds up over a longer session."
            )

    # Drift.
    for rep in repeatability:
        for comp in rep.get("compared_with", []):
            if comp.get("repeats") is False:
                recs.append(
                    f"'{rep['probe']}' looks different from {comp['session']} "
                    f"(drift d'={comp.get('drift_d_prime')}). Check the "
                    f"placement notes for that session before trusting a "
                    f"model trained across both."
                )

    # The good news, last, so it does not bury the problems.
    ranked = _ranking(results)
    if ranked and (ranked[0].get("usability") or 0) >= 0.6:
        best = ranked[0]
        recs.append(
            f"Best candidate so far: '{best['probe']}' "
            f"(usability {best['usability']:.2f}, consistency "
            f"{best['consistency'] if best['consistency'] is not None else 'n/a'}, "
            f"effort {best['effort'] or 'unrated'}). Record it again next "
            f"session to confirm it repeats across days."
        )
    if not recs:
        recs.append("Nothing stands out as broken. Record more probes to "
                    "build up the comparison set.")
    return recs


# =========================================================== rendered docs


def render_report(analysis: Dict[str, Any], session: Session) -> str:
    """REPORT.md — readable without the app, by someone who is not us."""
    L: List[str] = []
    info = analysis.get("session_info", {})
    probes = [p for p in analysis["probes"]
              if p.get("kind") not in ("rest", "baseline")]

    L.append(f"# Session report — {analysis['profile']} / "
             f"{analysis['arm']} / {analysis['session']}")
    L.append("")
    L.append(f"Generated {analysis['generated']} by Factum. "
             f"This file is meant to be readable on its own: you do not "
             f"need the app, and you do not need to have been there.")
    L.append("")

    # -- what we recorded
    L.append("## What we recorded")
    L.append("")
    L.append(f"- **Date**: {info.get('date', analysis['session'][:10])}")
    if info.get("location"):
        L.append(f"- **Location**: {info['location']}")
    if info.get("present"):
        L.append(f"- **Present**: {info['present']}")
    L.append(f"- **Arm**: {analysis['arm']}")
    if info.get("battery_pct") is not None:
        charger = "on charger" if info.get("on_charger") else "on battery"
        L.append(f"- **Band battery**: {info['battery_pct']}% ({charger})")
    L.append(f"- **Started**: {info.get('started', '—')}"
             + (f"   **Ended**: {info['ended']}" if info.get("ended") else ""))
    L.append(f"- **Probes**: {len(probes)} movement"
             f"{'s' if len(probes) != 1 else ''}"
             f"{', plus a rest recording' if analysis['rest'].get('available') else ', NO rest recording'}")
    if info.get("notes"):
        L.append(f"- **Notes**: {info['notes']}")
    L.append("")

    # -- how much of this to believe
    #
    # This goes near the top on purpose. Every number below it is only
    # worth what the recordings behind it are worth, and a reader who
    # meets the usability table first will have formed an opinion by
    # the time they reach a caveat at the bottom.
    L.append("## How much to trust this session")
    L.append("")
    flagged = [p for p in analysis["probes"]
               if (p.get("quality") or {}).get("verdict") in ("suspect", "unusable")]
    if not flagged:
        L.append("Every recording passed the automatic checks — no clipping, "
                 "no dead channels, no attempt that produced nothing, nothing "
                 "out of line with its own repeats. The numbers below rest on "
                 "clean data.")
    else:
        unusable = [p for p in flagged
                    if p["quality"]["verdict"] == "unusable"]
        L.append(f"{len(flagged)} of {len(analysis['probes'])} recordings were "
                 f"flagged automatically"
                 + (f", {len(unusable)} of them badly enough that any "
                    f"conclusion resting on them should be treated as "
                    f"provisional" if unusable else "") + ".")
        L.append("")
        L.append("Nothing was discarded. Every flagged recording is still "
                 "analysed and still appears below; the flag says what to "
                 "distrust, not what to ignore.")
        L.append("")
        for p in flagged:
            q = p["quality"]
            L.append(f"- **{p['probe']}** — {q['verdict']} "
                     f"({q['score']:.2f}): {q['headline']}")
            for flag in q.get("flags", []):
                L.append(f"  - {flag['message']}  →  {flag['fix']}")
    L.append("")

    # -- headline
    ranking = analysis.get("ranking", [])
    L.append("## What looked good")
    L.append("")
    good = [r for r in ranking if (r.get("usability") or 0) >= 0.55]
    if good:
        for r in good:
            L.append(f"- **{r['probe']}** — usability {r['usability']:.2f}, "
                     f"consistency {_fmt(r['consistency'])}, "
                     f"{_fmt_db(r['best_channel_db'])} above rest, "
                     f"effort {r['effort'] or 'unrated'}, "
                     f"{r['n_reps']} repetition{'s' if r['n_reps'] != 1 else ''}")
    else:
        L.append("- Nothing cleared the bar this session.")
    L.append("")

    L.append("## What looked bad")
    L.append("")
    bad = [r for r in ranking if (r.get("usability") or 0) < 0.55]
    if bad:
        for r in bad:
            reason = []
            if r.get("consistency") is None:
                reason.append("not enough repetitions to judge")
            elif r["consistency"] < 0.5:
                reason.append(f"inconsistent ({r['consistency']:.2f})")
            if r.get("best_channel_db") is not None and r["best_channel_db"] < 6:
                reason.append(f"barely above rest ({r['best_channel_db']:.1f} dB)")
            if r.get("fatigue") == "high":
                reason.append("tiring")
            if r.get("effort") == "strenuous":
                reason.append("strenuous")
            L.append(f"- **{r['probe']}** — usability {r['usability']:.2f}"
                     + (f" ({', '.join(reason)})" if reason else ""))
    else:
        L.append("- Nothing to flag.")
    L.append("")

    # -- probe table
    L.append("## Every probe")
    L.append("")
    L.append("| # | Probe | Reps | Consistency | vs rest | Effort | Fatigue | His conf. | Usability | Recording |")
    L.append("|---|-------|------|-------------|---------|--------|---------|-----------|-----------|-----------|")
    for p in analysis["probes"]:
        m = p.get("metrics", {})
        verdict = (p.get("quality") or {}).get("verdict", "—")
        if p.get("kind") in ("rest", "baseline"):
            L.append(f"| {p.get('index', '')} | {p['probe']} (rest) | — | — | — | "
                     f"— | — | — | — | {verdict} |")
            continue
        L.append(
            f"| {p.get('index', '')} | {p['probe']} | {m.get('n_reps', '—')} | "
            f"{_fmt(m.get('consistency'))} | {_fmt_db(m.get('best_channel_db'))} | "
            f"{p.get('effort') or '—'} | {p.get('fatigue') or '—'} | "
            f"{p.get('his_confidence') or '—'} | {_fmt(m.get('usability'))} | "
            f"{verdict} |"
        )
    L.append("")

    # -- notes per probe
    noted = [p for p in analysis["probes"] if p.get("notes")]
    if noted:
        L.append("### Notes taken at the time")
        L.append("")
        for p in noted:
            L.append(f"- **{p['probe']}** — {p['notes']}")
        L.append("")

    # -- separability
    L.append("## Can these be told apart?")
    L.append("")
    L.append("d' below 1.0 means a classifier will confuse them; above 1.5 "
             "they are usably distinct; above 3.0 unmistakable.")
    L.append("")
    pairs = analysis.get("separability", [])
    if pairs:
        L.append("| Probe A | Probe B | d' | Expected confusion | Verdict |")
        L.append("|---------|---------|----|--------------------|---------|")
        for p in pairs:
            d = p.get("d_prime")
            if d is None:
                L.append(f"| {p['a']} | {p['b']} | — | — | {p.get('note', 'n/a')} |")
                continue
            verdict = ("distinct" if d >= 1.5 else
                       "borderline" if d >= 1.0 else "SAME INPUT")
            L.append(f"| {p['a']} | {p['b']} | {d:.2f} | "
                     f"{p.get('expected_error', 0)*100:.0f}% | {verdict} |")
    else:
        L.append("Not enough probes to compare.")
    L.append("")

    # -- change since last time
    L.append("## What changed since last time")
    L.append("")
    rep = analysis.get("repeatability", [])
    if rep:
        for r in rep:
            L.append(f"- **{r['probe']}**")
            for c in r["compared_with"]:
                verdict = ("repeats" if c.get("repeats") else
                           "DRIFTED" if c.get("repeats") is False else "unclear")
                L.append(
                    f"  - vs {c['session']}: {verdict}"
                    f" — consistency {_fmt(c.get('then_consistency'))} then, "
                    f"{_fmt(c.get('now_consistency'))} now; "
                    f"{_fmt_db(c.get('then_db'))} then, "
                    f"{_fmt_db(c.get('now_db'))} now"
                    + (f"; drift d'={c['drift_d_prime']}"
                       if c.get("drift_d_prime") is not None else "")
                )
    else:
        L.append("No earlier session recorded these probe names — this is the "
                 "baseline they will be compared against next time.")
    L.append("")

    # -- what to try next
    L.append("## What to try next")
    L.append("")
    for r in analysis.get("recommendations", []):
        L.append(f"- {r}")
    L.append("")

    # -- rest
    L.append("## Baseline (rest) recording")
    L.append("")
    rest = analysis["rest"]
    if rest.get("available"):
        L.append(f"- Duration: {rest['duration_s']}s")
        for i, label in enumerate(CHANNEL_LABELS):
            L.append(f"- {label}: RMS {rest['rms'][i]:.5f}, "
                     f"DC offset {rest['dc_offset'][i]:+.4f}, "
                     f"clipping {rest['clip_fraction'][i]*100:.1f}%")
    else:
        L.append("**No rest recording in this session.** Signal-to-baseline "
                 "numbers are unavailable, and comparisons with other "
                 "sessions are weaker as a result.")
    L.append("")

    L.append("## How usability is scored")
    L.append("")
    L.append(analysis.get("scoring", SCORING_EXPLANATION))
    L.append("")
    L.append("## What the numbers mean")
    L.append("")
    for name, meaning in METRIC_GLOSSARY:
        L.append(f"- **{name}** — {meaning}")
    L.append("")
    L.append("---")
    L.append("")
    L.append(f"Raw data: `probes/` (CSV, one file per probe, self-describing "
             f"header). Machine-readable version of this report: "
             f"`analysis.json`. Manifest: `probes.json`.")
    return "\n".join(L) + "\n"


def render_prompt(analysis: Dict[str, Any], session: Session) -> str:
    """ANALYSIS_PROMPT.md — hand this to a Claude session cold."""
    probes = [p for p in analysis["probes"]
              if p.get("kind") not in ("rest", "baseline")]
    L: List[str] = []
    L.append(f"# Analysis prompt — {analysis['profile']} / {analysis['arm']} / "
             f"{analysis['session']}")
    L.append("")
    L.append("Paste everything below into a Claude conversation, or point a "
             "Claude Code session at this folder and ask it to read this file.")
    L.append("")
    L.append("---")
    L.append("")
    L.append("## Context")
    L.append("")
    L.append(
        "I am working with Kyle, a bilateral upper-limb amputee. The two "
        "sides are NOT alike. **Left**: amputated about an inch above the "
        "wrist bone, so the wrist bone is gone — a long transradial residual "
        "limb with nearly the whole forearm, and therefore the finger and "
        "wrist muscle bellies, intact. This is the working arm and the only "
        "one a forearm band fits. **Right**: amputated at the elbow — no "
        "forearm at all, so only upper-arm muscle (biceps, triceps) is "
        "available, carrying no finger content. Do not assume the right arm "
        "can produce anything resembling the left."
    )
    L.append("")
    L.append(
        "We record surface nerve/muscle signals from the residual limb with "
        "a Mudra Band (3 electrodes: ch1 ulnar, ch2 median, ch3 radial, "
        "~840 Hz measured). The movements he attempts are phantom/attempted "
        "movements, not executed ones — there is no hand to move. There is "
        "no fixed movement list: we are discovering which signals he can "
        "produce at all."
    )
    L.append("")
    L.append(
        "The goal is the SMALLEST set of reliably separable signals, not the "
        "largest. Consistency and low effort beat raw signal strength: a weak "
        "movement performed identically every time is more useful than a "
        "strong one that varies, and a movement that tires him will not "
        "survive daily use."
    )
    L.append("")
    L.append("## This session")
    L.append("")
    info = analysis.get("session_info", {})
    L.append(f"- Date: {info.get('date', analysis['session'][:10])}"
             + (f", {info['location']}" if info.get("location") else ""))
    L.append(f"- Arm: {analysis['arm']}")
    L.append(f"- Rest recording: "
             f"{'yes' if analysis['rest'].get('available') else 'NO — baseline missing'}")
    L.append(f"- Movement probes: {len(probes)}")
    if info.get("notes"):
        L.append(f"- Session notes: {info['notes']}")
    L.append("")

    L.append("## Probe data")
    L.append("")
    for p in probes:
        m = p.get("metrics", {})
        L.append(f"**{p['probe']}**")
        L.append(f"- repetitions: {m.get('n_reps', 'n/a')}, "
                 f"consistency: {_fmt(m.get('consistency'))}, "
                 f"usability: {_fmt(m.get('usability'))}")
        L.append(f"- strongest channel: "
                 f"{CHANNEL_LABELS[m['best_channel']] if m.get('best_channel') is not None else 'n/a'}"
                 f" at {_fmt_db(m.get('best_channel_db'))} above rest")
        L.append(f"- channel signature (share of energy): "
                 f"{m.get('channel_signature')}")
        L.append(f"- onset latency: {_fmt_s(m.get('onset_latency_s'))}, "
                 f"rise time: {_fmt_s(m.get('rise_time_s'))}")
        L.append(f"- his ratings: effort {p.get('effort') or 'unrated'}, "
                 f"fatigue {p.get('fatigue') or 'unrated'}, "
                 f"confidence {p.get('his_confidence') or 'unrated'}/5")
        if p.get("notes"):
            L.append(f"- notes at the time: {p['notes']}")
        L.append("")

    L.append("## Pairwise separability (d')")
    L.append("")
    pairs = analysis.get("separability", [])
    if pairs:
        for p in pairs:
            d = p.get("d_prime")
            L.append(f"- {p['a']} vs {p['b']}: "
                     + (f"d'={d:.2f}, expected confusion "
                        f"{p.get('expected_error', 0)*100:.0f}%"
                        if d is not None else p.get("note", "n/a")))
    else:
        L.append("- not enough probes to compare")
    L.append("")

    if analysis.get("repeatability"):
        L.append("## Compared with earlier sessions")
        L.append("")
        for r in analysis["repeatability"]:
            for c in r["compared_with"]:
                L.append(f"- {r['probe']} vs {c['session']}: "
                         f"drift d'={c.get('drift_d_prime', 'n/a')}, "
                         f"consistency {_fmt(c.get('then_consistency'))} → "
                         f"{_fmt(c.get('now_consistency'))}")
        L.append("")

    L.append("## What I want from you")
    L.append("")
    L.append("1. What do these numbers mean in plain language?")
    L.append("2. Which probes should be promoted into a training set, and "
             "which should be dropped — and why?")
    L.append("3. Which pairs will get confused by a classifier?")
    L.append("4. What specific thing should we try in the next session, "
             "ranked, most valuable first?")
    L.append("5. Anything in the placement or the baseline that looks wrong?")
    L.append("")
    L.append("Do not ask for the raw sample arrays — the CSVs are large and "
             "the summaries above are what matters. If you need something "
             "specific from them, say which probe and which number.")
    return "\n".join(L) + "\n"


def _fmt(v: Any) -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):.2f}"
    except (TypeError, ValueError):
        return str(v)


def _fmt_db(v: Any) -> str:
    if v is None:
        return "—"
    return f"{float(v):+.1f} dB"


def _fmt_s(v: Any) -> str:
    if v is None:
        return "—"
    return f"{float(v):.2f}s"


def _write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import shutil
    import tempfile

    from probe_store import ProbeMeta, ProbeWriter

    root = os.path.join(tempfile.gettempdir(), "armband-analysis-selftest")
    if os.path.exists(root):
        shutil.rmtree(root)
    sessions_dir = os.path.join(root, "kyle", "right", "sessions")
    fs = 1000
    rng = np.random.default_rng(7)

    def synth(kind: str, n_reps: int = 4, amp: float = 0.25,
              channels=(1.0, 0.3, 0.1), jitter: float = 0.0,
              seconds: int = 20) -> np.ndarray:
        """Rest noise plus n_reps bursts weighted across channels."""
        n = seconds * fs
        sig = rng.normal(0, 0.01, size=(3, n))
        if kind == "rest":
            return sig.astype(np.float32)
        for r in range(n_reps):
            start = int((1.5 + r * 4.0) * fs)
            dur = int(1.5 * fs)
            if start + dur > n:
                break
            env = np.hanning(dur)
            for ch in range(3):
                gain = channels[ch] * (1.0 + rng.normal(0, jitter))
                sig[ch, start:start + dur] += (
                    amp * gain * env * rng.normal(0, 1, size=dur))
        return sig.astype(np.float32)

    # -- a previous session, so history comparison has something to chew on
    old = Session.create(sessions_dir, profile="kyle", arm="right",
                         stamp="2026-08-01_1000", location="rehab room 2")
    for name, kind, sig in (
        ("rest", "rest", synth("rest")),
        ("curl ring finger", "probe", synth("probe", channels=(1.0, 0.3, 0.1))),
    ):
        path = old.new_probe_path(name)
        w = ProbeWriter(path, ProbeMeta(probe=name, profile="kyle", arm="right",
                                        session=old.stamp, kind=kind))
        w.append(sig)
        old.record_probe(w.close(effort="moderate", fatigue="none",
                                 his_confidence=4), path)
    old.close()

    # -- today
    s = Session.create(sessions_dir, profile="kyle", arm="right",
                       location="rehab room 2", present="Kyle + helper",
                       battery_pct=79, on_charger=False)
    plan = [
        ("rest", "rest", synth("rest"), "easy", "none", 5, ""),
        ("curl ring finger", "probe",
         synth("probe", channels=(1.0, 0.3, 0.1)),
         "easy", "none", 4, 'felt distinct to him, said it was "the easy one"'),
        ("spread fingers", "probe",
         synth("probe", channels=(0.2, 0.4, 1.0)),
         "moderate", "some", 4, "clear but slower to start"),
        ("the twitchy one", "probe",
         synth("probe", channels=(1.0, 0.32, 0.11), jitter=0.9),
         "strenuous", "high", 2, "he could not tell if he repeated it"),
    ]
    for name, kind, sig, effort, fatigue, conf, note in plan:
        path = s.new_probe_path(name)
        w = ProbeWriter(path, ProbeMeta(probe=name, profile="kyle", arm="right",
                                        session=s.stamp, kind=kind,
                                        placement="3 fingers below elbow, mark A"))
        for i in range(0, sig.shape[1], 500):      # streamed, as in the app
            w.append(sig[:, i:i + 500])
        s.record_probe(w.close(effort=effort, fatigue=fatigue,
                               his_confidence=conf, notes=note), path)
    s.append_note("he tired noticeably after the third probe")
    s.close()

    result = analyse_session(s, history=[old])

    print("=== ranking ===")
    for r in result["ranking"]:
        print(f"  {r['usability']:.2f}  {r['probe']:<20} "
              f"consistency={_fmt(r['consistency'])} "
              f"db={_fmt_db(r['best_channel_db'])} reps={r['n_reps']}")
    print("\n=== separability ===")
    for p in result["separability"]:
        print(f"  {p['a']:<20} vs {p['b']:<20} d'={_fmt(p.get('d_prime'))}")
    print("\n=== repeatability ===")
    for r in result["repeatability"]:
        for c in r["compared_with"]:
            print(f"  {r['probe']:<20} vs {c['session']}: "
                  f"drift d'={c.get('drift_d_prime')} repeats={c.get('repeats')}")
    print("\n=== recommendations ===")
    for r in result["recommendations"]:
        print("  -", r)
    print("\nwrote:")
    for p in (s.analysis_json, s.report_md, s.prompt_md):
        print(f"  {os.path.basename(p)}  {os.path.getsize(p):,} bytes")
    print("OK")
