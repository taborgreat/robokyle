"""Human-readable, long-term-legible probe storage.

Every SNC recording is written as a single CSV file with a comment
header block. No binary formats. In ten years this must still open in
Excel, LibreOffice, and any text editor, and hand off cleanly when a
session folder is copied to another machine — read by someone who has
never seen this app and cannot run it.

Layout of a probe file:

    # profile: kyle
    # arm: left
    # session: 2026-08-14_1430
    # probe: curl ring finger
    # started: 2026-08-14T14:33:07
    # duration_s: 30
    # sample_rate_hz: 840
    # sample_rate_source: measured
    # effort: moderate
    # fatigue: some
    # his_confidence: 4
    # placement: 3 fingers below elbow crease, ulnar side, mark A
    # filters: none
    # notes: felt distinct to him, said it was "the easy one"
    # kind: probe
    # n_samples: 30000
    # channels: ch1=ulnar, ch2=median, ch3=radial
    # value_range: -1..+1 (raw SNC as delivered by the Mudra host)
    # timestamp: milliseconds since the start of this probe
    # schema: armband/probe/2
    timestamp,ch1,ch2,ch3
    0,0.023,-0.015,0.089
    1,0.019,-0.020,0.091

Metrics computed after the fact go to `probes.json` in the session
folder (and `analysis.json`), so the raw data stays a clean numeric
grid that never needs rewriting.

Crash safety
------------
`ProbeWriter` streams rows to disk as they arrive rather than holding a
recording in memory until the end. A session with Kyle is expensive —
he tires — so a crash must never cost us what he already gave us. A
file left behind by a crash carries `# status: incomplete` and is
otherwise a perfectly valid probe CSV.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


SCHEMA_VERSION = "armband/probe/2"
CHANNEL_NAMES = ("ulnar", "median", "radial")
COLUMNS = ("timestamp", "ch1", "ch2", "ch3")
CHANNEL_LEGEND = "ch1=ulnar, ch2=median, ch3=radial"

# Sample is "censored" (clipped at rail) if |value| >= this. Kept as
# a module constant so features/model/analysis/detector all agree.
# See STATUS.md ("The honest position") for why censorship matters.
CLIP_THRESHOLD = 0.999


def clip_mask(samples: np.ndarray, threshold: float = CLIP_THRESHOLD) -> np.ndarray:
    """Boolean mask where samples were censored at the ±1 rail.

    Same shape as `samples`. A True entry means the true value was
    AT LEAST |threshold| in magnitude; the actual value has been
    destroyed by clipping and cannot be recovered. Downstream code
    treats these as missing-with-known-bound, not as real
    measurements of ±1.0.
    """
    return np.abs(samples) >= threshold


def clip_fraction(samples: np.ndarray,
                  threshold: float = CLIP_THRESHOLD) -> np.ndarray:
    """Per-channel fraction of samples that were censored, in [0, 1]."""
    if samples.size == 0:
        return np.zeros(samples.shape[0] if samples.ndim > 1 else 3)
    return clip_mask(samples, threshold).mean(axis=-1)

# Schema history:
#   armband/probe/1 — columns were `t_ms,ulnar,median,radial`; keys were
#                     padded and used `probe_name` / `recorded_utc` /
#                     `confidence`. Still readable by load_probe().
#   armband/probe/2 — columns `timestamp,ch1,ch2,ch3`; unpadded keys;
#                     adds session / placement / filters / status.


@dataclass
class ProbeMeta:
    probe: str                            # free-text name, chosen by him
    profile: str = ""
    arm: str = "right"                    # "left" | "right"
    session: str = ""                     # session stamp, e.g. 2026-08-14_1430
    kind: str = "probe"                   # "probe" | "rest" | "baseline"
    started: str = ""                     # local ISO, no zone — human-facing
    duration_s: float = 0.0
    sample_rate_hz: int = 840
    # How that rate was arrived at: "measured" from the live stream
    # (batch size x frame rate) or "assumed" because the stream could
    # not be measured at the moment recording began. A stranger reading
    # this file in ten years must be able to tell the difference — a
    # guessed rate skews every frequency-domain feature and there is no
    # way to detect that after the fact from the samples alone.
    sample_rate_source: str = "measured"
    n_samples: int = 0
    effort: str = ""                      # easy | moderate | strenuous
    fatigue: str = ""                     # none | some | high
    his_confidence: int = 0               # 1-5, 0 = not rated
    placement: str = ""
    # Structured placement fields — per placement_contract.py. These
    # travel with every recording so a future reader can reproduce
    # the exact band position without parsing the human-readable
    # `placement` string. Absent means the recording pre-dates the
    # contract; do NOT default them to 0.
    placement_distance_mm: Optional[int] = None
    placement_rotation_deg: Optional[int] = None
    placement_convention_version: Optional[int] = None
    anatomy_source: str = ""              # MEASURED | ESTIMATED (or "")
    filters: str = "none"                 # raw by default; we never filter on write
    notes: str = ""
    status: str = "complete"              # "complete" | "incomplete"
    profile_type: str = "subject"
    recorded_utc: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    # Back-compat: older code said `probe_name` / `confidence`.
    @property
    def probe_name(self) -> str:
        return self.probe

    @property
    def confidence(self) -> int:
        return self.his_confidence


def _now_iso_utc() -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _now_iso_local() -> str:
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _clean(value: Any) -> str:
    """One-line, comment-safe rendering of a header value."""
    text = "" if value is None else str(value)
    return text.replace("\r", " ").replace("\n", " ").strip()


def header_lines(meta: ProbeMeta) -> List[str]:
    """The `#` block, in the order a human should read it."""
    if not meta.started:
        meta.started = _now_iso_local()
    if not meta.recorded_utc:
        meta.recorded_utc = _now_iso_utc()

    fields: List[Tuple[str, Any]] = [
        ("profile",        meta.profile),
        ("arm",            meta.arm),
        ("session",        meta.session),
        ("probe",          meta.probe),
        ("started",        meta.started),
        ("duration_s",     f"{meta.duration_s:.3f}"),
        ("sample_rate_hz", meta.sample_rate_hz),
        ("sample_rate_source", meta.sample_rate_source or "measured"),
    ]
    # Ratings are omitted rather than written blank — an absent key reads
    # as "not rated", an empty one reads as a bug.
    if meta.effort:         fields.append(("effort",         meta.effort))
    if meta.fatigue:        fields.append(("fatigue",        meta.fatigue))
    if meta.his_confidence: fields.append(("his_confidence", meta.his_confidence))
    if meta.placement:      fields.append(("placement",      meta.placement))
    # Structured placement fields per placement_contract.py — absent
    # means the recording pre-dates the contract, do not fake them.
    if meta.placement_distance_mm is not None:
        fields.append(("placement_distance_mm", meta.placement_distance_mm))
    if meta.placement_rotation_deg is not None:
        fields.append(("placement_rotation_deg", meta.placement_rotation_deg))
    if meta.placement_convention_version is not None:
        fields.append(("placement_convention_version",
                       meta.placement_convention_version))
    if meta.anatomy_source:
        fields.append(("anatomy_source", meta.anatomy_source))
    fields.append(("filters", meta.filters or "none"))
    if meta.notes:          fields.append(("notes",          meta.notes))

    # Provenance and self-description — everything a stranger with just
    # this file needs in order to read it correctly.
    fields.extend([
        ("kind",         meta.kind),
        ("profile_type", meta.profile_type),
        ("n_samples",    meta.n_samples),
        ("channels",     CHANNEL_LEGEND),
        ("value_range",  "-1..+1 (raw SNC as delivered by the Mudra host)"),
        ("timestamp",    "milliseconds since the start of this probe"),
        ("recorded_utc", meta.recorded_utc),
    ])
    if meta.status != "complete":
        fields.append(("status", meta.status))
    for k, v in meta.extra.items():
        if isinstance(v, (int, float, str, bool)):
            fields.append((f"extra.{k}", v))
    fields.append(("schema", SCHEMA_VERSION))

    return [f"# {k}: {_clean(v)}" for k, v in fields]


def _format_row(index: int, sample_rate_hz: int,
                a: float, b: float, c: float) -> List[Any]:
    t_ms = int(index * 1000 // max(sample_rate_hz, 1))
    return [t_ms, f"{a:.5f}", f"{b:.5f}", f"{c:.5f}"]


# ============================================================ whole-file I/O


def save_probe(path: str, samples: np.ndarray, meta: ProbeMeta) -> None:
    """Write a (3, N) sample matrix to a CSV file with header comments."""
    if samples.ndim != 2 or samples.shape[0] != 3:
        raise ValueError(f"samples must be shape (3, N); got {samples.shape}")
    n = samples.shape[1]
    if meta.n_samples == 0:
        meta.n_samples = n
    if meta.duration_s == 0.0:
        meta.duration_s = n / max(meta.sample_rate_hz, 1)

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

    buf = io.StringIO()
    for line in header_lines(meta):
        buf.write(line + "\n")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(list(COLUMNS))
    ch1, ch2, ch3 = samples[0], samples[1], samples[2]
    for i in range(n):
        writer.writerow(_format_row(i, meta.sample_rate_hz,
                                    float(ch1[i]), float(ch2[i]), float(ch3[i])))

    _atomic_write(path, buf.getvalue())


def _atomic_write(path: str, text: str) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load_probe(path: str) -> Tuple[np.ndarray, ProbeMeta]:
    """Read a probe CSV back. Returns (samples (3, N), meta).

    Reads both schema 1 and schema 2 files. Header parsing stops at the
    column row rather than at the first non-`#` line, so `#` inside the
    data (should it ever appear) cannot swallow the grid.
    """
    meta = ProbeMeta(probe="")
    header: Dict[str, str] = {}
    data_lines: List[str] = []

    with open(path, "r", encoding="utf-8", newline="") as f:
        text = f.read()

    in_header = True
    for line in text.splitlines():
        if in_header:
            if line.startswith("#"):
                key, sep, val = line.lstrip("#").partition(":")
                if sep:
                    header[key.strip()] = val.strip()
                continue
            if not line.strip():
                continue
            in_header = False  # this is the column row
        data_lines.append(line)

    def _s(*keys: str) -> str:
        for k in keys:
            if k in header:
                return header[k]
        return ""

    def _i(default: int, *keys: str) -> int:
        raw = _s(*keys)
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            return default

    def _f(default: float, *keys: str) -> float:
        raw = _s(*keys)
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    meta.probe          = _s("probe", "probe_name")
    meta.profile        = _s("profile")
    meta.profile_type   = _s("profile_type") or "subject"
    meta.arm            = _s("arm") or "right"
    meta.session        = _s("session")
    meta.kind           = _s("kind") or "probe"
    meta.started        = _s("started")
    meta.recorded_utc   = _s("recorded_utc")
    meta.sample_rate_hz = _i(840, "sample_rate_hz")
    # Files written before this field existed were all measured — the
    # assumed-rate path is newer than any recording on disk.
    meta.sample_rate_source = _s("sample_rate_source") or "measured"
    meta.duration_s     = _f(0.0, "duration_s")
    meta.n_samples      = _i(0, "n_samples")
    meta.effort         = _s("effort")
    meta.fatigue        = _s("fatigue")
    meta.his_confidence = _i(0, "his_confidence", "confidence")
    meta.placement      = _s("placement")
    meta.filters        = _s("filters") or "none"
    meta.notes          = _s("notes")
    meta.status         = _s("status") or "complete"
    for k, v in header.items():
        if k.startswith("extra."):
            meta.extra[k[len("extra."):]] = v

    rows = list(csv.reader(io.StringIO("\n".join(l for l in data_lines if l.strip()))))
    if not rows:
        return np.empty((3, 0), dtype=np.float32), meta

    data = rows[1:]  # first row is the column header, either schema
    arr = np.empty((3, len(data)), dtype=np.float32)
    n_ok = 0
    for row in data:
        if len(row) < 4:
            continue  # a torn last line from a crash — drop it, keep the rest
        try:
            arr[0, n_ok] = float(row[1])
            arr[1, n_ok] = float(row[2])
            arr[2, n_ok] = float(row[3])
        except ValueError:
            continue
        n_ok += 1
    arr = arr[:, :n_ok]
    if meta.n_samples == 0:
        meta.n_samples = n_ok
    return arr, meta


# ========================================================= streaming writer


class ProbeWriter:
    """Streams a probe to disk while it is still being recorded.

    Usage:
        w = ProbeWriter(path, meta)
        w.append(block)      # (3, N) chunk, called as often as you like
        w.close(effort="easy", notes="...")   # rewrites the final header

    Between `append` calls the file on disk is a complete, valid probe
    CSV — just marked `# status: incomplete`, with the header carrying
    whatever was known at the start. `close()` rewrites it with the true
    duration, sample count and post-recording ratings.
    """

    def __init__(self, path: str, meta: ProbeMeta, flush_every: int = 1) -> None:
        self.path = path
        self.meta = meta
        self.flush_every = max(1, flush_every)
        self.n_written = 0
        self.closed = False
        self._appends = 0
        # Running clip counts per channel — cheaper than re-reading the
        # CSV at close, and censored-sample count is now a first-class
        # header field so analysis / detector / audit all see it
        # without loading the file. See CLIP_THRESHOLD above.
        self._clipped_per_ch: List[int] = [0, 0, 0]

        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        provisional = ProbeMeta(**{**meta.__dict__})
        provisional.status = "incomplete"
        self._f = open(path, "w", encoding="utf-8", newline="")
        for line in header_lines(provisional):
            self._f.write(line + "\n")
        self._writer = csv.writer(self._f, lineterminator="\n")
        self._writer.writerow(list(COLUMNS))
        self._f.flush()
        # Keep the started timestamp the provisional header already used.
        self.meta.started = provisional.started
        self.meta.recorded_utc = provisional.recorded_utc

    # ------------------------------------------------------------ writing

    def append(self, block: np.ndarray) -> int:
        """Append a (3, N) chunk. Returns total samples written so far."""
        if self.closed or block is None:
            return self.n_written
        if block.ndim != 2 or block.shape[0] != 3 or block.shape[1] == 0:
            return self.n_written
        rate = self.meta.sample_rate_hz
        base = self.n_written
        ch1, ch2, ch3 = block[0], block[1], block[2]
        for i in range(block.shape[1]):
            self._writer.writerow(_format_row(base + i, rate,
                                              float(ch1[i]), float(ch2[i]),
                                              float(ch3[i])))
        # Running per-channel clip count — cheap, streamed.
        mask = clip_mask(block)
        for ch in range(3):
            self._clipped_per_ch[ch] += int(mask[ch].sum())
        self.n_written += block.shape[1]
        self._appends += 1
        if self._appends % self.flush_every == 0:
            self._f.flush()
        return self.n_written

    # ------------------------------------------------------------ closing

    def close(self, **meta_updates: Any) -> ProbeMeta:
        """Finalise: apply late metadata, rewrite the header, fsync."""
        if self.closed:
            return self.meta
        self._f.flush()
        self._f.close()
        self.closed = True

        for k, v in meta_updates.items():
            if v is None:
                continue
            if hasattr(self.meta, k):
                setattr(self.meta, k, v)
            else:
                self.meta.extra[k] = v

        self.meta.n_samples = self.n_written
        if not self.meta.duration_s:
            self.meta.duration_s = self.n_written / max(self.meta.sample_rate_hz, 1)
        # Per-channel clip fraction — first-class header field so any
        # downstream reader knows immediately how much of the signal
        # was censored. Format: "ch1=0.034 ch2=0.000 ch3=0.001".
        if self.n_written > 0:
            fracs = [self._clipped_per_ch[c] / self.n_written for c in range(3)]
            self.meta.extra["clip_fraction"] = " ".join(
                f"ch{c+1}={fracs[c]:.4f}" for c in range(3))
            self.meta.extra["clip_threshold"] = f"{CLIP_THRESHOLD:.3f}"
        self.meta.status = "complete"
        self._rewrite_header()
        return self.meta

    def abort(self, reason: str = "aborted") -> None:
        """Stop recording but keep what we captured, marked incomplete."""
        if self.closed:
            return
        self._f.flush()
        self._f.close()
        self.closed = True
        self.meta.n_samples = self.n_written
        self.meta.duration_s = self.n_written / max(self.meta.sample_rate_hz, 1)
        self.meta.status = "incomplete"
        self.meta.extra["abort_reason"] = reason
        self._rewrite_header()

    def _rewrite_header(self) -> None:
        """Swap the provisional header for the final one, atomically."""
        try:
            with open(self.path, "r", encoding="utf-8", newline="") as f:
                lines = f.read().splitlines()
        except OSError:
            return
        body_start = 0
        for i, line in enumerate(lines):
            if not line.startswith("#"):
                body_start = i  # the column row
                break
        body = lines[body_start:]
        out = header_lines(self.meta) + body
        _atomic_write(self.path, "\n".join(out) + "\n")


def probe_filename(index: int, probe_name: str, when: Optional[dt.datetime] = None) -> str:
    """`002_curl-ring-finger_1433.csv` — sorts chronologically, self-identifying."""
    when = when or dt.datetime.now()
    slug = "".join(
        ch if ch.isalnum() else "-"
        for ch in (probe_name or "probe").strip().lower()
    )
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-") or "probe"
    return f"{index:03d}_{slug[:48]}_{when.strftime('%H%M')}.csv"


# ------------------------------------------------------- metrics side-files

def save_metrics_json(path: str, metrics: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    _atomic_write(path, json.dumps(metrics, indent=2, sort_keys=True,
                                   default=json_default) + "\n")


def load_metrics_json(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def json_default(o: Any) -> Any:
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.integer):
        return int(o)
    raise TypeError(f"not JSON serialisable: {type(o).__name__}")


_json_default = json_default  # back-compat alias


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import tempfile

    tmp_dir = os.path.join(tempfile.gettempdir(), "armband-probe-selftest")
    os.makedirs(tmp_dir, exist_ok=True)
    rng = np.random.default_rng(0)

    # -- whole-file round trip
    signal = rng.normal(0.05, 0.10, size=(3, 250)).astype(np.float32)
    meta = ProbeMeta(
        probe="curl ring finger", profile="testkyle", profile_type="debug",
        arm="right", session="2026-08-14_1430", kind="probe",
        effort="moderate", fatigue="some", his_confidence=4,
        placement="3 fingers below elbow crease, ulnar side, mark A",
        notes='felt distinct to him, said it was "the easy one"',
    )
    p1 = os.path.join(tmp_dir, probe_filename(2, meta.probe))
    save_probe(p1, signal, meta)
    back, m2 = load_probe(p1)
    print("filename          :", os.path.basename(p1))
    print("round-trip shape  :", back.shape == signal.shape)
    print("max abs diff      :", float(np.max(np.abs(back - signal))))
    print("meta round-trip   :", m2.probe, "|", m2.effort, "|",
          m2.his_confidence, "|", m2.session)

    # -- streaming writer, including the crash case
    p2 = os.path.join(tmp_dir, probe_filename(3, "streamed"))
    w = ProbeWriter(p2, ProbeMeta(probe="streamed", profile="testkyle",
                                  arm="right", session="2026-08-14_1430"))
    for _ in range(5):
        w.append(rng.normal(0, 0.1, size=(3, 40)).astype(np.float32))
    mid, mid_meta = load_probe(p2)          # readable mid-recording
    print("mid-flight rows   :", mid.shape[1], "status:", mid_meta.status)
    w.append(rng.normal(0, 0.1, size=(3, 40)).astype(np.float32))
    final_meta = w.close(effort="easy", fatigue="none", his_confidence=5,
                         notes="closed cleanly")
    done, done_meta = load_probe(p2)
    print("final rows        :", done.shape[1], "status:", done_meta.status)
    print("final duration_s  :", f"{done_meta.duration_s:.3f}")
    print("late ratings kept :", done_meta.effort, done_meta.his_confidence)

    # -- a writer that never got closed (simulated crash)
    p3 = os.path.join(tmp_dir, probe_filename(4, "crashed"))
    w2 = ProbeWriter(p3, ProbeMeta(probe="crashed", profile="testkyle"))
    w2.append(rng.normal(0, 0.1, size=(3, 120)).astype(np.float32))
    del w2
    crashed, crashed_meta = load_probe(p3)
    print("crash-file rows   :", crashed.shape[1], "status:", crashed_meta.status)

    print("\nheader of", os.path.basename(p1))
    with open(p1, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i > 20:
                break
            print("   ", line.rstrip())
    print("OK")
