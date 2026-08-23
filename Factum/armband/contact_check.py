"""Contact-quality check for the Mudra Band's three SNC electrodes.

Computes per-channel DC offset, AC RMS, % of samples clipped at ±1.0,
and the pairwise inter-channel correlation. Renders a pass/fail
verdict with actionable remediation hints.

Rationale for the pass/fail thresholds:
- Correlation > 0.9 between any two channels means the three sensors
  are picking up almost identical signal. On a live sEMG rig that
  means the differential inputs are floating and every electrode sees
  common-mode noise (mains hum, cable pickup). No sEMG information.
- More than 2% of samples clipped means the input is being pinned to
  the rails, which destroys feature quality even when correlation is
  low.
- DC offset > 0.5 on a nominally ±1 signal means one channel is not
  seeing a clean AC path — usually a dry electrode.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np


CORR_FAIL = 0.90
CORR_WARN = 0.70
CLIP_FAIL_PCT = 2.0
CLIP_WARN_PCT = 0.5
DC_WARN = 0.30
DC_FAIL = 0.50
RMS_DEAD = 0.005     # RMS below this = no signal at all
RMS_LOW = 0.02       # RMS below this = weak contact


@dataclass
class ContactMetrics:
    n_samples: int = 0
    dc_offset: np.ndarray = field(default_factory=lambda: np.zeros(3))
    ac_rms: np.ndarray = field(default_factory=lambda: np.zeros(3))
    clipped_pct: np.ndarray = field(default_factory=lambda: np.zeros(3))
    corr: np.ndarray = field(default_factory=lambda: np.zeros((3, 3)))
    max_pair_corr: float = 0.0
    max_pair: Tuple[int, int] = (0, 1)


@dataclass
class ContactVerdict:
    passed: bool
    severity: str            # "pass", "warn", or "fail"
    headline: str
    issues: List[str] = field(default_factory=list)
    hints: List[str] = field(default_factory=list)
    metrics: Optional[ContactMetrics] = None


def compute_metrics(window: np.ndarray) -> ContactMetrics:
    """Window is shape (3, N), float samples in [-1, 1]."""
    if window.ndim != 2 or window.shape[0] != 3:
        raise ValueError(f"expected (3, N) window, got {window.shape}")
    n = window.shape[1]
    m = ContactMetrics(n_samples=n)
    if n == 0:
        return m
    m.dc_offset = window.mean(axis=1).astype(np.float32)
    ac = window - m.dc_offset[:, None]
    m.ac_rms = np.sqrt(np.mean(ac * ac, axis=1)).astype(np.float32)
    m.clipped_pct = (np.mean(np.abs(window) >= 0.999, axis=1) * 100.0).astype(np.float32)

    if n >= 32:
        # Use AC-coupled correlation so DC differences don't hide common mode.
        stds = ac.std(axis=1)
        stds_safe = np.where(stds < 1e-6, 1.0, stds)
        normalized = ac / stds_safe[:, None]
        m.corr = (normalized @ normalized.T / n).astype(np.float32)
    else:
        m.corr = np.eye(3, dtype=np.float32)

    pairs = [(0, 1), (0, 2), (1, 2)]
    max_c = 0.0
    max_pair = (0, 1)
    for i, j in pairs:
        c = abs(float(m.corr[i, j]))
        if c > max_c:
            max_c = c
            max_pair = (i, j)
    m.max_pair_corr = max_c
    m.max_pair = max_pair
    return m


def evaluate(metrics: ContactMetrics) -> ContactVerdict:
    issues: List[str] = []
    hints: List[str] = []
    severity = "pass"

    if metrics.n_samples < 500:
        return ContactVerdict(
            passed=False,
            severity="fail",
            headline="Not enough samples yet — waiting for data.",
            issues=[f"Only {metrics.n_samples} samples in the window."],
            hints=[
                "Confirm Mudra Companion is running and the band is paired.",
                "The status panel should show a battery percentage and 'Mudra connected'.",
            ],
            metrics=metrics,
        )

    # -- inter-channel correlation ------------------------------------
    c = metrics.max_pair_corr
    ch_a, ch_b = metrics.max_pair
    if c >= CORR_FAIL:
        severity = "fail"
        issues.append(
            f"Channels {ch_a+1} and {ch_b+1} are {c*100:.0f}% correlated — "
            f"common-mode noise, no useful sEMG."
        )
        hints += [
            "Unplug the laptop from its charger (mains hum is the usual cause).",
            "Tighten the band so all three electrodes press firmly on skin.",
            "Wipe the residual limb and inside of the band with a damp cloth.",
            "Rotate the band 30-60° around the limb; the three electrodes may all be sitting over the same tissue.",
        ]
    elif c >= CORR_WARN:
        if severity != "fail":
            severity = "warn"
        issues.append(
            f"Channels {ch_a+1} and {ch_b+1} are {c*100:.0f}% correlated — "
            f"borderline. Some common-mode noise present."
        )
        hints.append(
            "Try a small band rotation. Aim to get pair correlations below 0.6."
        )

    # -- clipping -----------------------------------------------------
    for ch, pct in enumerate(metrics.clipped_pct):
        if pct >= CLIP_FAIL_PCT:
            severity = "fail"
            issues.append(f"Channel {ch+1} clipped on {pct:.1f}% of samples.")
        elif pct >= CLIP_WARN_PCT:
            if severity != "fail":
                severity = "warn"
            issues.append(f"Channel {ch+1} clipped on {pct:.1f}% of samples.")
    if any(p >= CLIP_WARN_PCT for p in metrics.clipped_pct):
        hints.append(
            "Clipping means the input is being pinned to ±1.0 — usually a strong 50/60 Hz interference component. Unplug the charger first."
        )

    # -- DC offset ----------------------------------------------------
    for ch, dc in enumerate(metrics.dc_offset):
        adc = abs(float(dc))
        if adc >= DC_FAIL:
            severity = "fail"
            issues.append(f"Channel {ch+1} DC offset is {dc:+.2f} — floating electrode.")
        elif adc >= DC_WARN:
            if severity != "fail":
                severity = "warn"
            issues.append(f"Channel {ch+1} DC offset is {dc:+.2f}.")
    if any(abs(float(dc)) >= DC_WARN for dc in metrics.dc_offset):
        hints.append(
            "High DC on one channel usually means that electrode isn't touching skin. Reseat the band; slide it 1-2 cm along the forearm."
        )

    # -- RMS liveness -------------------------------------------------
    for ch, rms in enumerate(metrics.ac_rms):
        if float(rms) < RMS_DEAD:
            if severity != "fail":
                severity = "warn"
            issues.append(f"Channel {ch+1} RMS is nearly zero — no signal.")
    if all(float(r) < RMS_LOW for r in metrics.ac_rms):
        hints.append(
            "All three channels are very quiet. Ask him to make a strong contraction (whatever movement he can produce) while watching the meters. If they stay flat, band position needs to move."
        )

    # -- headline -----------------------------------------------------
    if severity == "pass":
        headline = "Contact PASS — signal looks clean. Safe to proceed."
    elif severity == "warn":
        headline = "Contact WARN — usable but not ideal. Improve if you can."
    else:
        headline = "Contact FAIL — do not train the classifier yet."

    passed = severity == "pass"
    return ContactVerdict(
        passed=passed,
        severity=severity,
        headline=headline,
        issues=issues,
        hints=hints if hints else ["Nothing to change — contact looks good."],
        metrics=metrics,
    )


def format_report(verdict: ContactVerdict) -> str:
    m = verdict.metrics
    lines = [verdict.headline, ""]
    if m is not None and m.n_samples > 0:
        lines.append(f"Samples analysed:  {m.n_samples}")
        lines.append(
            "DC offset:         "
            + "  ".join(f"ch{ch+1}={v:+.3f}" for ch, v in enumerate(m.dc_offset))
        )
        lines.append(
            "AC RMS:            "
            + "  ".join(f"ch{ch+1}={v:.4f}" for ch, v in enumerate(m.ac_rms))
        )
        lines.append(
            "Clipped %:         "
            + "  ".join(f"ch{ch+1}={v:.2f}%" for ch, v in enumerate(m.clipped_pct))
        )
        lines.append(
            f"Correlations:      1↔2={m.corr[0,1]:+.2f}  "
            f"1↔3={m.corr[0,2]:+.2f}  2↔3={m.corr[1,2]:+.2f}"
        )
        lines.append("")
    if verdict.issues:
        lines.append("Issues:")
        for it in verdict.issues:
            lines.append(f"  • {it}")
        lines.append("")
    lines.append("What to try:")
    for h in verdict.hints:
        lines.append(f"  • {h}")
    return "\n".join(lines)


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    rng = np.random.default_rng(42)

    print("=== simulated good signal ===")
    good = rng.normal(0, 0.15, size=(3, 3000)).astype(np.float32)
    good[0] += rng.normal(0, 0.08, size=3000)  # add channel-unique noise
    good[1] += rng.normal(0, 0.08, size=3000)
    good[2] += rng.normal(0, 0.08, size=3000)
    print(format_report(evaluate(compute_metrics(good))))

    print()
    print("=== simulated common-mode ===")
    common = rng.normal(0, 0.2, size=3000).astype(np.float32)
    bad = np.stack([common, common + rng.normal(0, 0.005, 3000),
                    common + rng.normal(0, 0.005, 3000)])
    print(format_report(evaluate(compute_metrics(bad))))

    print()
    print("=== simulated clipping ===")
    clip = np.clip(rng.normal(0, 2.0, size=(3, 3000)), -1, 1).astype(np.float32)
    print(format_report(evaluate(compute_metrics(clip))))
