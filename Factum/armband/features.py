"""Feature extraction, versioned.

The original 15 features (RMS, MAV, waveform length, zero crossings,
slope sign changes — per channel) are the classic sEMG set: cheap,
transparent, and a sensible starting point. Real data then showed
exactly where they fall short.

The everyday-movement recording sat at +13.5 dB above rest, *identical*
in amplitude to a real attempt, and defeated every amplitude threshold
tried. What differed was the shape: the spectrum, and how energy was
distributed across the three electrodes. Almost none of that is in the
original set — RMS and MAV are pure amplitude, and the three channels
are described independently with nothing capturing their ratio.

So v2 adds what the data says matters:

* **Spectral shape per channel** — median and mean frequency, and power
  in three bands. Muscle activation and motion artefact occupy
  different parts of the spectrum: artefact is low-frequency, real
  sEMG lives at 20-150 Hz. Amplitude cannot tell them apart; frequency
  can.
* **Cross-channel ratios** — the channel signature, directly. This is
  the thing that visibly separated "curl pointer finger" from "moving
  the arm like a mouse" in the first session, and the model previously
  had to infer it from three independent amplitudes.

Versioning matters
------------------
A model is only meaningful with the feature set it was trained on, so
each version has a stable id, and every saved model records which one
it used. Loading a model built on v1 keeps computing v1 features
forever. No silent re-interpretation of old data — that is exactly the
kind of quiet drift that makes historical records untrustworthy.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np

WINDOW_S = 0.25

# ------------------------------------------------------------------ v1

V1_KINDS = ("rms", "mav", "wl", "zc", "ssc")
V1_NAMES: Tuple[str, ...] = tuple(
    f"ch{ch+1}_{kind}" for ch in range(3) for kind in V1_KINDS
)

# ------------------------------------------------------------------ v2

# Bands chosen from the spectrum measured on 2026-08-08: rest energy sat
# at 20-50 Hz and 70-150 Hz, with the peak at 85.8 Hz. Motion artefact
# concentrates below ~20 Hz, which is why that gets its own band.
V2_BANDS = ((5.0, 20.0), (20.0, 60.0), (60.0, 150.0))
V2_PER_CHANNEL = V1_KINDS + ("mdf", "mnf", "bp_low", "bp_mid", "bp_high")
V2_CROSS = ("ratio_12", "ratio_13", "ratio_23", "dominance", "spread", "total_rms")
V2_NAMES: Tuple[str, ...] = tuple(
    [f"ch{ch+1}_{kind}" for ch in range(3) for kind in V2_PER_CHANNEL]
    + [f"x_{name}" for name in V2_CROSS]
)

FEATURE_SETS: Dict[str, Tuple[str, ...]] = {"v1": V1_NAMES, "v2": V2_NAMES}
# Default reverted to v1 on 2026-08-13. Under correct grouped LORO
# (leave-one-cued-repetition-out) v2's 21 extra features no longer
# beat v1 and appear to overfit — v1 was 20.0% recall @ 1% FA vs
# arm-wave, v2 was 10.7%. See STATUS.md "The honest position" and
# WORKLOG.md entry of the same date. v2 stays available for
# experiments; models still record which set they used, so older
# v2-trained models continue to run unchanged.
DEFAULT_VERSION = "v1"


def names(version: str = DEFAULT_VERSION) -> Tuple[str, ...]:
    return FEATURE_SETS.get(version, V2_NAMES)


def size(version: str = DEFAULT_VERSION) -> int:
    return len(names(version))


def _ac(block: np.ndarray) -> np.ndarray:
    return block - block.mean(axis=1, keepdims=True)


# When more than this fraction of a window is censored, spectral
# features (median freq / mean freq / band-power ratios) become
# unreliable — clipping introduces broadband harmonics that distort
# the spectrum. The feature is still computed, but downstream code
# should treat it as suspect. See STATUS.md 6.
CENSORSHIP_SPECTRAL_LIMIT = 0.05


def _time_domain(x: np.ndarray, mask: Optional[np.ndarray] = None
                 ) -> List[float]:
    """Time-domain features, censorship-aware where it matters.

    RMS and MAV are amplitude-sensitive and are computed on
    uncensored samples only when a mask is supplied — a clipped
    sample at ±1 pushes RMS up spuriously. Both are then LOWER
    BOUNDS on the true value: the censored samples' true magnitude
    was at least |1| but we don't know by how much.

    Zero crossings and slope-sign changes are largely robust to
    amplitude censoring — a clipped peak still crosses zero on the
    way in and out. Waveform length is degraded (censored plateaus
    contribute zero diff) but usable.
    """
    if mask is None:
        x_amp = x
    else:
        # Compute rms/mav on uncensored samples only. If the window is
        # entirely censored (all-clip) we return 1.0 as the lower bound.
        keep = ~mask
        x_amp = x[keep] if keep.any() else np.ones(1)
    diff = np.diff(x)
    return [
        float(np.sqrt(np.mean(x_amp * x_amp))),               # rms
        float(np.mean(np.abs(x_amp))),                        # mav
        float(np.sum(np.abs(diff))),                          # waveform length
        float(np.sum(np.diff(np.signbit(x)) != 0)),           # zero crossings
        float(np.sum(np.diff(np.signbit(diff)) != 0)),        # slope sign changes
    ]


def _spectral(x: np.ndarray, fs: int) -> List[float]:
    """Median frequency, mean frequency, and power in three bands.

    Median frequency is the standard sEMG fatigue and quality measure:
    it falls as muscle fatigues and sits in a different place entirely
    for motion artefact. Band powers are normalised so they describe
    spectral *shape* rather than loudness — amplitude is already covered
    by RMS, and duplicating it would just let a loud artefact dominate.
    """
    n = x.size
    if n < 16:
        return [0.0, 0.0, 0.0, 0.0, 0.0]
    spectrum = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    freqs = np.fft.rfftfreq(n, 1.0 / max(fs, 1))
    total = float(spectrum[1:].sum())
    if total <= 0:
        return [0.0, 0.0, 0.0, 0.0, 0.0]

    cumulative = np.cumsum(spectrum[1:])
    half = np.searchsorted(cumulative, cumulative[-1] / 2.0)
    mdf = float(freqs[1:][min(half, len(freqs) - 2)])
    mnf = float((freqs[1:] * spectrum[1:]).sum() / total)

    bands = []
    for lo, hi in V2_BANDS:
        selected = (freqs >= lo) & (freqs < hi)
        bands.append(float(spectrum[selected].sum() / total) if selected.any() else 0.0)
    return [mdf, mnf] + bands


def vector(block: np.ndarray, fs: int = 1000,
           version: str = DEFAULT_VERSION,
           clip_mask: Optional[np.ndarray] = None) -> np.ndarray:
    """Feature vector for one (3, N) window.

    `clip_mask` is an optional (3, N) boolean where True marks
    censored samples. When supplied, RMS/MAV are computed on
    uncensored samples only (see `_time_domain`) — treated as lower
    bounds on the true amplitude, not as pretend-real numbers. The
    caller is responsible for flagging the window as censored via
    a per-window censorship fraction (see `windows_with_mask`).
    """
    if version == "v1":
        out = np.zeros(len(V1_NAMES), dtype=np.float64)
        ac = _ac(block)
        for ch in range(3):
            x = ac[ch]
            if x.size >= 3:
                m = clip_mask[ch] if clip_mask is not None else None
                out[ch * 5:(ch + 1) * 5] = _time_domain(x, m)
        return out

    out = np.zeros(len(V2_NAMES), dtype=np.float64)
    ac = _ac(block)
    per = len(V2_PER_CHANNEL)
    rms = np.zeros(3)
    for ch in range(3):
        x = ac[ch]
        if x.size < 3:
            continue
        m = clip_mask[ch] if clip_mask is not None else None
        time_domain = _time_domain(x, m)
        rms[ch] = time_domain[0]
        out[ch * per:ch * per + 5] = time_domain
        out[ch * per + 5:(ch + 1) * per] = _spectral(x, fs)

    # Cross-channel shape. Logged so that a doubling reads the same
    # whether the pair is quiet or loud, and clipped so a near-silent
    # channel cannot produce a huge ratio out of numerical noise.
    base = 3 * per
    eps = 1e-9
    out[base + 0] = float(np.clip(np.log10((rms[0] + eps) / (rms[1] + eps)), -3, 3))
    out[base + 1] = float(np.clip(np.log10((rms[0] + eps) / (rms[2] + eps)), -3, 3))
    out[base + 2] = float(np.clip(np.log10((rms[1] + eps) / (rms[2] + eps)), -3, 3))
    total = float(rms.sum())
    if total > 0:
        share = rms / total
        out[base + 3] = float(share.max())                    # dominance
        # Spread: how evenly the energy is distributed, via normalised
        # entropy. A movement concentrated on one electrode is far
        # easier to separate than one smeared across all three.
        with np.errstate(divide="ignore", invalid="ignore"):
            entropy = -np.nansum(np.where(share > 0, share * np.log(share), 0.0))
        out[base + 4] = float(entropy / np.log(3))
    out[base + 5] = total
    return out


def windows(samples: np.ndarray, fs: int, win_s: float = WINDOW_S,
            hop_s: float = WINDOW_S / 2,
            version: str = DEFAULT_VERSION,
            clip_mask: Optional[np.ndarray] = None
            ) -> Tuple[np.ndarray, np.ndarray]:
    """Sliding-window features. Returns (vectors (M, D), start times (M,)).

    If `clip_mask` is supplied it must match `samples.shape`; each
    window's slice is passed into `vector()` so amplitude features
    honour censorship. Use `windows_with_mask` when you also need
    per-window censorship fractions.
    """
    width = max(int(win_s * fs), 16)
    hop = max(int(hop_s * fs), 1)
    n = samples.shape[1]
    dim = size(version)
    if n == 0:
        return np.zeros((0, dim)), np.zeros(0)
    if n < width:
        m = clip_mask if clip_mask is not None else None
        return vector(samples, fs, version, m)[None, :], np.zeros(1)
    starts = list(range(0, n - width + 1, hop))
    out = np.zeros((len(starts), dim), dtype=np.float64)
    for i, s in enumerate(starts):
        m = clip_mask[:, s:s + width] if clip_mask is not None else None
        out[i] = vector(samples[:, s:s + width], fs, version, m)
    return out, np.asarray(starts, dtype=np.float64) / fs


def windows_with_mask(samples: np.ndarray, mask: np.ndarray, fs: int,
                      win_s: float = WINDOW_S,
                      hop_s: float = WINDOW_S / 2,
                      version: str = DEFAULT_VERSION
                      ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Like `windows`, but also returns per-window censorship fractions.

    Returns (vectors (M, D), start_times (M,), censorship (M,)).
    `censorship[i]` = fraction of the (3, win) block that was censored
    — a scalar in [0, 1] the caller can use for sample-weighting at
    training time or as a confidence-threshold input at detect time.
    """
    F, starts = windows(samples, fs, win_s, hop_s, version, mask)
    width = max(int(win_s * fs), 16)
    hop = max(int(hop_s * fs), 1)
    n = samples.shape[1]
    if n < width:
        cens = np.array([float(mask.mean()) if mask.size else 0.0])
        return F, starts, cens
    cens = np.array([float(mask[:, s:s + width].mean())
                     for s in range(0, n - width + 1, hop)])
    return F, starts, cens


if __name__ == "__main__":
    fs = 840
    rng = np.random.default_rng(0)
    n = int(WINDOW_S * fs)

    for version in ("v1", "v2"):
        print(f"{version}: {size(version)} features")
    print()

    def synth(channels, low_freq=False):
        t = np.arange(n) / fs
        out = np.zeros((3, n))
        for ch, gain in enumerate(channels):
            if low_freq:      # motion artefact: slow, large
                out[ch] = gain * np.sin(2 * np.pi * 6 * t) + rng.normal(0, 0.01, n)
            else:             # muscle: broadband around 85 Hz
                out[ch] = gain * rng.normal(0, 1, n)
                out[ch] += gain * 0.6 * np.sin(2 * np.pi * 85 * t)
        return out

    attempt = synth((1.0, 0.3, 0.1))
    artefact = synth((1.0, 0.3, 0.1), low_freq=True)

    print("Two signals with the SAME channel gains — one muscle-like,")
    print("one a slow motion artefact. Can each feature set tell them apart?")
    print()
    for version in ("v1", "v2"):
        a = vector(attempt, fs, version)
        b = vector(artefact, fs, version)
        scale = np.where(np.abs(a) + np.abs(b) > 0, np.abs(a) + np.abs(b), 1.0)
        separation = float(np.mean(np.abs(a - b) / scale))
        print(f"  {version}: mean normalised difference {separation:.3f}")
        top = np.argsort(-np.abs(a - b) / scale)[:4]
        print(f"      most different: "
              f"{', '.join(names(version)[i] for i in top)}")
    print("\n(v2 should separate them more, because the difference is "
          "spectral and v1 has no spectral features at all.)")
