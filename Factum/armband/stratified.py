"""Stratified performance reports.

Item 3.4 of the censored-data architecture. Averaging accuracy across
clean and censored windows, or across still and moving windows, hides
the failure modes we most care about — a model can look great on
average while collapsing whenever there is motion or clipping. Report
each stratum separately.

Consumed by analysis.py and by the offline replay in detector.py.
Kept in its own module so it can also be called from ad-hoc audit
scripts (see audit_clipping.py) without pulling the big analysis
graph.
"""

from __future__ import annotations

from typing import Dict, List, Sequence

import numpy as np

# Motion score bin boundaries — chosen from the diagnostic in
# STATUS.md: trigger median 0.051, mouse median 0.080, arm-wave
# median 0.294. "still" ≤ 0.10 covers rest + normal finger use;
# "moving" > 0.20 covers arm-wave; the middle band is ambiguous
# reaching / typing and gets reported separately.
MOTION_BINS = [(0.0, 0.10, "still"),
               (0.10, 0.20, "some"),
               (0.20, float("inf"), "moving")]

# Censorship strata: fraction of a window's samples clipped at rail.
CENSORSHIP_BINS = [(0.0, 0.01, "clean"),
                   (0.01, 0.05, "mild"),
                   (0.05, 1.01, "heavy")]


def _bin_label(value: float, bins: List) -> str:
    for lo, hi, name in bins:
        if lo <= value < hi:
            return name
    return bins[-1][2]


def stratified_accuracy(y_true: Sequence, y_pred: Sequence,
                        censorship: Sequence[float],
                        motion: Sequence[float]) -> Dict[str, dict]:
    """Per-stratum {n, accuracy, per-class recall} across two grids.

    Returns a dict keyed by "(motion, censorship)" where each value is
    a small report suitable for pretty-printing in REPORT.md. Absent
    strata are omitted rather than reported as 100% accuracy on 0
    samples, which would be misleading.
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    censorship = np.asarray(censorship, dtype=float)
    motion = np.asarray(motion, dtype=float)

    out: Dict[str, dict] = {}
    labels = sorted(set(y_true.tolist()))
    for m_lo, m_hi, m_name in MOTION_BINS:
        for c_lo, c_hi, c_name in CENSORSHIP_BINS:
            m = ((motion >= m_lo) & (motion < m_hi)
                 & (censorship >= c_lo) & (censorship < c_hi))
            n = int(m.sum())
            if n == 0:
                continue
            acc = float((y_true[m] == y_pred[m]).mean())
            per_class = {}
            for lab in labels:
                lab_mask = m & (y_true == lab)
                if lab_mask.any():
                    per_class[str(lab)] = round(float(
                        (y_pred[lab_mask] == lab).mean()), 4)
            out[f"motion={m_name}/censor={c_name}"] = {
                "n": n,
                "acc": round(acc, 4),
                "per_class_recall": per_class,
            }
    return out


def stratified_report_lines(strat: Dict[str, dict]) -> List[str]:
    """Turn the dict from stratified_accuracy into human-readable lines."""
    lines = ["## Stratified performance",
             "",
             "| stratum | n | overall acc | per-class recall |",
             "|---------|---|-------------|------------------|"]
    for key, v in strat.items():
        pc = "; ".join(f"{k}={val:.3f}" for k, val in v["per_class_recall"].items())
        lines.append(f"| {key} | {v['n']} | {v['acc']:.3f} | {pc} |")
    return lines


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    n = 400
    y_true = np.array(["trigger"] * 150 + ["distractor"] * 250)
    y_pred = y_true.copy()
    # Simulate the failure mode: bad on moving windows
    motion = rng.uniform(0, 0.4, size=n)
    censorship = rng.beta(2, 40, size=n)
    for i in range(n):
        if motion[i] > 0.2 and rng.random() < 0.5:
            y_pred[i] = "distractor" if y_true[i] == "trigger" else "trigger"
    strat = stratified_accuracy(y_true, y_pred, censorship, motion)
    for line in stratified_report_lines(strat):
        print(line)
