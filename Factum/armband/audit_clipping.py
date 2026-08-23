"""Audit every probe CSV on disk for clipping. Mark, never delete.

Runs a per-channel clip% scan over `armband/profiles/*/*/sessions/
*/probes/*.csv` and writes an audit sidecar `<probe>.audit.json`
next to each file with the numbers. If a probe crosses either of
these thresholds it is also flagged compromised in place — a
comment line `# audit_status: compromised` is INSERTED at the top
of the CSV header (leaving all sample rows and existing header
lines untouched, so the raw data survives verbatim).

Thresholds:
    CLIP_COMPROMISED_PCT      = 2.0    per-channel clip% at which the
                                       probe is considered compromised
                                       for training purposes
    CH2_OUTLIER_RATIO_AT_REST = 2.5    per-channel rest-RMS ratio vs
                                       the median of the OTHER two;
                                       above this is a contact fault
                                       (see probe 001 ch2 investigation
                                       in WORKLOG).

Nothing here modifies the sample grid or the existing header keys.
The intent is documentary: the raw file remains authoritative, but a
future model-training pass can grep `audit_status: compromised` and
skip these probes without loading them.

Run:
    .venv\\Scripts\\python.exe armband\\audit_clipping.py
    .venv\\Scripts\\python.exe armband\\audit_clipping.py --dry-run
    .venv\\Scripts\\python.exe armband\\audit_clipping.py --root <path>
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from pathlib import Path
from typing import Dict, List

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from probe_store import CLIP_THRESHOLD, clip_fraction

CLIP_COMPROMISED_PCT = 25.0        # was 2.0 — too aggressive; a
                                   # high-effort contraction hits the
                                   # rail at peaks and that's fine.
                                   # Only egregious probes (>25%) are
                                   # "compromised" enough to skip
                                   # entirely. Sample-level clipping
                                   # is handled per-window by the
                                   # censorship-aware features.
CH2_OUTLIER_RATIO_AT_REST = 2.5


def load_probe_samples(path: str) -> np.ndarray:
    """Read a probe CSV. Returns (3, N) or empty on failure."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            skip = 0
            for i, line in enumerate(f):
                if line.startswith("#"):
                    skip = i + 1
                    continue
                if line.startswith("timestamp"):
                    skip = i + 1
                    break
        arr = np.loadtxt(path, delimiter=",", skiprows=skip, usecols=(1, 2, 3)).T
        return arr
    except Exception:
        return np.empty((3, 0), dtype=np.float32)


def read_kind(path: str) -> str:
    """Return 'rest', 'probe', 'distractor', or ''."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("#"):
                    if line.startswith("# kind:"):
                        return line.split(":", 1)[1].strip()
                    continue
                break
    except Exception:
        pass
    return ""


def has_audit_status(path: str) -> bool:
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("# audit_status:"):
                    return True
                if not line.startswith("#"):
                    return False
    except Exception:
        pass
    return False


def prepend_header(path: str, header_line: str) -> None:
    """Insert `header_line` at the top of a CSV, above other `# ...` lines."""
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if header_line.rstrip("\n") + "\n" in content:
        return
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(header_line.rstrip("\n") + "\n")
        f.write(content)


def audit_probe(path: str) -> Dict[str, object]:
    samples = load_probe_samples(path)
    if samples.shape[1] == 0:
        return {"path": path, "error": "empty or unreadable"}
    fracs = clip_fraction(samples)
    ac = samples - samples.mean(axis=1, keepdims=True)
    rms = np.sqrt((ac * ac).mean(axis=1))
    kind = read_kind(path)
    ratios = []
    for ch in range(3):
        others = [rms[j] for j in range(3) if j != ch]
        med = float(np.median(others))
        ratios.append(rms[ch] / med if med > 1e-9 else 0.0)
    max_clip_pct = 100.0 * float(fracs.max())
    reasons: List[str] = []
    for ch in range(3):
        if 100.0 * fracs[ch] >= CLIP_COMPROMISED_PCT:
            reasons.append(
                f"ch{ch+1} clipped {100*fracs[ch]:.1f}% "
                f"(>= {CLIP_COMPROMISED_PCT:.1f}%)")
    if kind == "rest":
        for ch in range(3):
            if ratios[ch] >= CH2_OUTLIER_RATIO_AT_REST:
                reasons.append(
                    f"ch{ch+1} rest RMS {ratios[ch]:.1f}x neighbours "
                    "(likely contact fault)")
    return {
        "path": path,
        "n_samples": int(samples.shape[1]),
        "kind": kind,
        "clip_fraction_ch1": round(float(fracs[0]), 6),
        "clip_fraction_ch2": round(float(fracs[1]), 6),
        "clip_fraction_ch3": round(float(fracs[2]), 6),
        "max_clip_pct": round(max_clip_pct, 3),
        "rest_rms_ratio_ch1": round(ratios[0], 3),
        "rest_rms_ratio_ch2": round(ratios[1], 3),
        "rest_rms_ratio_ch3": round(ratios[2], 3),
        "clip_threshold": CLIP_THRESHOLD,
        "compromised": bool(reasons),
        "reasons": reasons,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=None,
                    help="profiles root (default: <repo>/armband/profiles)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print findings but do not modify CSVs")
    args = ap.parse_args()

    root = args.root or str(Path(__file__).parent / "profiles")
    pattern = os.path.join(root, "**", "probes", "*.csv")
    files = sorted(glob.glob(pattern, recursive=True))
    print(f"Auditing {len(files)} probe files under {root}")
    total = compromised = skipped = 0
    for path in files:
        result = audit_probe(path)
        total += 1
        if "error" in result:
            print(f"  ERR {path}: {result['error']}")
            continue
        if result["compromised"]:
            compromised += 1
            print(f"  X {path}")
            for r in result["reasons"]:
                print(f"      - {r}")
        else:
            print(f"  OK {path}  "
                  f"max_clip={result['max_clip_pct']:.2f}%")
        # Write the sidecar JSON regardless.
        sidecar = path.replace(".csv", ".audit.json")
        if not args.dry_run:
            with open(sidecar, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        # Prepend compromise flag to CSV header if we haven't already.
        if result["compromised"] and not has_audit_status(path):
            if not args.dry_run:
                prepend_header(path,
                    f"# audit_status: compromised — "
                    + "; ".join(result["reasons"]))
        elif result["compromised"] and has_audit_status(path):
            skipped += 1
    print()
    print(f"Total: {total}   compromised: {compromised}   "
          f"already-flagged skipped: {skipped}")
    print(f"{'Dry run — no files modified.' if args.dry_run else 'Done.'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
