"""A field session — one visit, one arm, everything captured that day.

Sessions happen offline, in a rehab facility, on battery power, with a
person who tires. So:

  * One button starts a session. It timestamps itself and keeps every
    probe from that visit together. Nobody names anything.
  * Probes stream to disk as they record (see `probe_store.ProbeWriter`).
  * `probes.json` is the manifest — every probe's metadata and metrics
    in one file, so analysis never has to re-parse 30 CSVs to find out
    what is there.
  * Sessions are **append-only**. A session folder is never overwritten
    and never renamed. Historical data is how we detect drift.
  * `export_zip()` writes the whole session as one file to carry home.

On-disk layout:

    <arm>/sessions/2026-08-14_1430/
        session.json          date, location, who was present, notes,
                              battery %, charger y/n, started/ended
        session_notes.md      free-text running log (quick notes land here)
        probes/
            001_rest_1430.csv
            002_curl-ring-finger_1433.csv
        probes.json           manifest: all metadata + metrics
        analysis.json         written automatically on close
        REPORT.md             readable without the app
        ANALYSIS_PROMPT.md    ready-made prompt for a Claude session
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import zipfile
from typing import Any, Dict, List, Optional

from probe_store import ProbeMeta, probe_filename

MANIFEST_SCHEMA = "armband/probes-manifest/1"
SESSION_SCHEMA = "armband/session/2"

# Names that mean "this is the baseline", whatever the operator typed.
# Everything in a session is measured against its rest recording, so
# failing to recognise one costs the whole session its reference —
# too expensive to hinge on matching a single exact word.
REST_NAMES = frozenset({
    "rest", "baseline", "relaxed", "idle", "resting", "no movement", "nothing",
})


def is_rest_name(name: str) -> bool:
    return (name or "").strip().lower() in REST_NAMES

STAMP_FMT = "%Y-%m-%d_%H%M"
# Sessions created before 2026-08-08 used seconds: 2026-08-06_15-32-11.
# A trailing letter disambiguates two sessions started in the same
# minute: 2026-08-14_1430, then 2026-08-14_1430b.
_STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-?\d{2}(-?\d{2})?[a-z]?$")

_SUFFIXES = "bcdefghijklmnopqrstuvwxyz"


def new_stamp(when: Optional[dt.datetime] = None) -> str:
    return (when or dt.datetime.now()).strftime(STAMP_FMT)


def unique_stamp(sessions_dir: str, when: Optional[dt.datetime] = None) -> str:
    """A stamp that is not already taken in `sessions_dir`.

    Stamps are minute-resolution because that is what a human reads, so
    closing one session and starting another inside the same minute
    would otherwise land both in the same folder — silently appending
    new probes to a session that was already closed and analysed.
    Sessions are append-only; reusing a folder is data loss with extra
    steps. Collisions get a letter: `..._1430`, then `..._1430b`.
    """
    base = new_stamp(when)
    if not os.path.exists(os.path.join(sessions_dir, base)):
        return base
    for suffix in _SUFFIXES:
        candidate = base + suffix
        if not os.path.exists(os.path.join(sessions_dir, candidate)):
            return candidate
    # 26 sessions in one minute is not a real scenario, but silently
    # overwriting one would be worse than an ugly name.
    return f"{base}-{int(dt.datetime.now().timestamp())}"


def is_session_stamp(name: str) -> bool:
    return bool(_STAMP_RE.match(name))


def _now_utc() -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _now_local() -> str:
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _read_json(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


class Session:
    """Handle on one session folder. Thin — the folder is the truth."""

    def __init__(self, root: str, profile: str = "", arm: str = "") -> None:
        self.root = os.path.abspath(root)
        self.stamp = os.path.basename(self.root)
        self.profile = profile
        self.arm = arm

    # ------------------------------------------------------------- paths

    @property
    def probes_dir(self) -> str:
        return os.path.join(self.root, "probes")

    @property
    def session_json(self) -> str:
        return os.path.join(self.root, "session.json")

    @property
    def notes_md(self) -> str:
        return os.path.join(self.root, "session_notes.md")

    @property
    def probes_json(self) -> str:
        return os.path.join(self.root, "probes.json")

    @property
    def analysis_json(self) -> str:
        return os.path.join(self.root, "analysis.json")

    @property
    def report_md(self) -> str:
        return os.path.join(self.root, "REPORT.md")

    @property
    def prompt_md(self) -> str:
        return os.path.join(self.root, "ANALYSIS_PROMPT.md")

    # ------------------------------------------------------------ create

    @classmethod
    def create(cls, sessions_dir: str, profile: str, arm: str,
               stamp: Optional[str] = None, **meta: Any) -> "Session":
        stamp = stamp or unique_stamp(sessions_dir)
        sess = cls(os.path.join(sessions_dir, stamp), profile=profile, arm=arm)
        sess.ensure()
        info = sess.info()
        if not info.get("started"):
            info.update({
                "schema":      SESSION_SCHEMA,
                "profile":     profile,
                "arm":         arm,
                "session":     stamp,
                "date":        dt.datetime.now().strftime("%Y-%m-%d"),
                "started":     _now_local(),
                "started_utc": _now_utc(),
                "location":    meta.get("location", ""),
                "present":     meta.get("present", ""),
                "notes":       meta.get("notes", ""),
                "battery_pct": meta.get("battery_pct"),
                "on_charger":  meta.get("on_charger"),
            })
            sess.write_info(info)
        if not os.path.exists(sess.notes_md):
            with open(sess.notes_md, "w", encoding="utf-8") as f:
                f.write(f"# Session notes — {profile} / {arm} / {stamp}\n\n"
                        f"Running log. Quick notes taken during recording are "
                        f"appended here with a timestamp.\n\n")
        return sess

    def ensure(self) -> None:
        os.makedirs(self.probes_dir, exist_ok=True)

    def exists(self) -> bool:
        return os.path.isdir(self.root)

    # -------------------------------------------------------- session.json

    def info(self) -> Dict[str, Any]:
        data = _read_json(self.session_json, {})
        return data if isinstance(data, dict) else {}

    def write_info(self, info: Dict[str, Any]) -> None:
        _write_json(self.session_json, info)

    def update_info(self, **fields: Any) -> Dict[str, Any]:
        info = self.info()
        info.update({k: v for k, v in fields.items() if v is not None})
        self.write_info(info)
        return info

    @property
    def is_open(self) -> bool:
        return not self.info().get("ended")

    def started_at(self) -> Optional[dt.datetime]:
        raw = self.info().get("started")
        if raw:
            try:
                return dt.datetime.fromisoformat(raw)
            except ValueError:
                pass
        # Fall back to the folder stamp — it is a timestamp by construction.
        for fmt in (STAMP_FMT, "%Y-%m-%d_%H-%M-%S"):
            try:
                return dt.datetime.strptime(self.stamp, fmt)
            except ValueError:
                continue
        return None

    def elapsed_seconds(self) -> float:
        started = self.started_at()
        return (dt.datetime.now() - started).total_seconds() if started else 0.0

    def close(self, **fields: Any) -> Dict[str, Any]:
        return self.update_info(ended=_now_local(), ended_utc=_now_utc(), **fields)

    def reopen(self) -> None:
        info = self.info()
        info.pop("ended", None)
        info.pop("ended_utc", None)
        self.write_info(info)

    # ------------------------------------------------------- session notes

    def append_note(self, note: str, when: Optional[dt.datetime] = None) -> str:
        """Timestamped line in session_notes.md. Never interrupts a recording."""
        note = (note or "").strip()
        if not note:
            return ""
        when = when or dt.datetime.now()
        line = f"- **{when.strftime('%H:%M:%S')}** — {note}\n"
        os.makedirs(self.root, exist_ok=True)
        with open(self.notes_md, "a", encoding="utf-8") as f:
            f.write(line)
        return line

    def read_notes(self) -> str:
        if not os.path.exists(self.notes_md):
            return ""
        with open(self.notes_md, "r", encoding="utf-8") as f:
            return f.read()

    # ---------------------------------------------------------- manifest

    def manifest(self) -> Dict[str, Any]:
        data = _read_json(self.probes_json, None)
        if not isinstance(data, dict) or "probes" not in data:
            data = {
                "schema":  MANIFEST_SCHEMA,
                "profile": self.profile or self.info().get("profile", ""),
                "arm":     self.arm or self.info().get("arm", ""),
                "session": self.stamp,
                "probes":  [],
            }
        return data

    def probes(self) -> List[Dict[str, Any]]:
        return list(self.manifest().get("probes", []))

    def write_manifest(self, manifest: Dict[str, Any]) -> None:
        manifest["schema"] = MANIFEST_SCHEMA
        manifest["updated"] = _now_local()
        _write_json(self.probes_json, manifest)

    def next_index(self) -> int:
        """Next probe number. Derived from disk, so a crash cannot reuse one."""
        highest = 0
        for entry in self.probes():
            try:
                highest = max(highest, int(entry.get("index", 0)))
            except (TypeError, ValueError):
                pass
        if os.path.isdir(self.probes_dir):
            for name in os.listdir(self.probes_dir):
                if not name.endswith(".csv"):
                    continue
                head = name.split("_", 1)[0]
                if head.isdigit():
                    highest = max(highest, int(head))
        return highest + 1

    def new_probe_path(self, probe_name: str,
                       when: Optional[dt.datetime] = None) -> str:
        self.ensure()
        return os.path.join(
            self.probes_dir, probe_filename(self.next_index(), probe_name, when)
        )

    def record_probe(self, meta: ProbeMeta, path: str,
                     metrics: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Add or update this probe's row in the manifest."""
        filename = os.path.basename(path)
        head = filename.split("_", 1)[0]
        entry = {
            "index":          int(head) if head.isdigit() else self.next_index(),
            "file":           filename,
            "probe":          meta.probe,
            "kind":           meta.kind,
            "started":        meta.started,
            "duration_s":     round(float(meta.duration_s), 3),
            "sample_rate_hz": meta.sample_rate_hz,
            "n_samples":      meta.n_samples,
            "effort":         meta.effort,
            "fatigue":        meta.fatigue,
            "his_confidence": meta.his_confidence,
            "placement":      meta.placement,
            "notes":          meta.notes,
            "status":         meta.status,
        }
        if metrics is not None:
            entry["metrics"] = metrics

        manifest = self.manifest()
        rows = manifest.get("probes", [])
        for i, existing in enumerate(rows):
            if existing.get("file") == filename:
                existing.update(entry)
                rows[i] = existing
                break
        else:
            rows.append(entry)
        rows.sort(key=lambda r: r.get("index", 0))
        manifest["probes"] = rows
        manifest["profile"] = self.profile or manifest.get("profile", "")
        manifest["arm"] = self.arm or manifest.get("arm", "")
        self.write_manifest(manifest)
        return entry

    def set_excluded(self, filename: str, excluded: bool = True,
                     reason: str = "") -> None:
        """Mark a probe as excluded from analysis, without deleting it.

        Recordings go wrong in ways only the person in the room can
        see: the band slipped, he sneezed, he did the wrong movement,
        someone spoke halfway through. Left in, one bad recording drags
        every metric with it and there is no way to say so.

        The file is **never removed** — sessions are append-only, and a
        recording that was excluded (and why) is itself part of the
        record. Everything downstream skips it; the CSV stays on disk.
        """
        self.update_probe(filename, excluded=bool(excluded),
                          excluded_reason=reason if excluded else "")

    def active_probes(self) -> List[Dict[str, Any]]:
        """Probes that count. Use this everywhere analysis is done."""
        return [e for e in self.probes() if not e.get("excluded")]

    def excluded_probes(self) -> List[Dict[str, Any]]:
        return [e for e in self.probes() if e.get("excluded")]

    def update_probe(self, filename: str, **fields: Any) -> None:
        manifest = self.manifest()
        for entry in manifest.get("probes", []):
            if entry.get("file") == filename:
                entry.update({k: v for k, v in fields.items() if v is not None})
                break
        self.write_manifest(manifest)

    def probe_path(self, filename: str) -> str:
        return os.path.join(self.probes_dir, filename)

    def rest_probe(self) -> Optional[Dict[str, Any]]:
        """The session's rest/baseline probe — everything else is relative to it.

        Falls back to matching the probe's *name* so a recording called
        "baseline" still counts even if it was filed as a movement
        probe. The last matching one wins: re-recording rest because
        the first attempt was bad is a normal thing to do, and the
        newer one is the one that describes the arm as it is now.
        """
        matches = [e for e in self.active_probes()
                   if e.get("kind") in ("rest", "baseline")
                   or is_rest_name(e.get("probe", ""))]
        return matches[-1] if matches else None

    def has_rest(self) -> bool:
        return self.rest_probe() is not None

    # ------------------------------------------------------------- counts

    def summary(self) -> Dict[str, Any]:
        rows = self.probes()
        info = self.info()
        return {
            "stamp":     self.stamp,
            "path":      self.root,
            "started":   info.get("started", ""),
            "ended":     info.get("ended"),
            "open":      not info.get("ended"),
            "location":  info.get("location", ""),
            "n_probes":  sum(1 for r in rows if r.get("kind") not in ("rest", "baseline")),
            "n_rest":    sum(1 for r in rows if r.get("kind") in ("rest", "baseline")),
            "has_rest":  self.has_rest(),
            "analysed":  os.path.exists(self.analysis_json),
        }

    # ------------------------------------------------------------- export

    def export_zip(self, dest_dir: str) -> str:
        """Write the whole session to a single zip for analysis elsewhere."""
        os.makedirs(dest_dir, exist_ok=True)
        profile = self.profile or self.info().get("profile", "profile")
        arm = self.arm or self.info().get("arm", "arm")
        out = os.path.join(dest_dir, f"{profile}_{arm}_{self.stamp}.zip")
        base = os.path.dirname(self.root)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for folder, _dirs, files in os.walk(self.root):
                for name in sorted(files):
                    if name.endswith(".tmp"):
                        continue
                    full = os.path.join(folder, name)
                    z.write(full, os.path.relpath(full, base))
            # Carry the profile's own docs along so the zip explains itself.
            prof_root = os.path.dirname(os.path.dirname(os.path.dirname(self.root)))
            for doc in ("CLAUDE.md", "README.md", "profile.json"):
                doc_path = os.path.join(prof_root, doc)
                if os.path.exists(doc_path):
                    z.write(doc_path, os.path.join(self.stamp, "_profile", doc))
            notes = os.path.join(prof_root, arm, "placement_notes.md")
            if os.path.exists(notes):
                z.write(notes, os.path.join(self.stamp, "_profile",
                                            f"{arm}_placement_notes.md"))
        return out


def list_sessions(sessions_dir: str) -> List[str]:
    """Session stamps in a folder, oldest first. Tolerates the legacy format."""
    if not os.path.isdir(sessions_dir):
        return []
    return sorted(
        name for name in os.listdir(sessions_dir)
        if os.path.isdir(os.path.join(sessions_dir, name)) and is_session_stamp(name)
    )


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import shutil
    import tempfile

    import numpy as np
    from probe_store import ProbeWriter

    root = os.path.join(tempfile.gettempdir(), "armband-session-selftest")
    if os.path.exists(root):
        shutil.rmtree(root)
    sessions_dir = os.path.join(root, "kyle", "left", "sessions")

    s = Session.create(sessions_dir, profile="kyle", arm="left",
                       location="rehab room 2", present="Kyle + helper",
                       battery_pct=79, on_charger=False)
    print("created      :", s.stamp, "at", s.root)
    print("open         :", s.is_open, " has_rest:", s.has_rest())

    rng = np.random.default_rng(1)
    for name, kind in (("rest", "rest"), ("curl ring finger", "probe")):
        path = s.new_probe_path(name)
        meta = ProbeMeta(probe=name, profile="kyle", arm="left",
                         session=s.stamp, kind=kind)
        w = ProbeWriter(path, meta)
        for _ in range(3):
            w.append(rng.normal(0, 0.1, size=(3, 500)).astype(np.float32))
        final = w.close(effort="moderate", fatigue="some", his_confidence=4)
        s.record_probe(final, path)
        print("probe        :", os.path.basename(path), f"{final.n_samples} samples")

    s.append_note("he said the ring-finger one felt clearest")
    print("next index   :", s.next_index())
    print("has_rest     :", s.has_rest())
    print("summary      :", json.dumps(s.summary(), indent=None))

    s.close()
    print("closed       :", not s.is_open)
    z = s.export_zip(os.path.join(root, "_export"))
    print("exported     :", os.path.basename(z),
          f"({os.path.getsize(z)/1024:.0f} KB)")
    with zipfile.ZipFile(z) as zf:
        for n in zf.namelist():
            print("               ", n)
    print("listed       :", list_sessions(sessions_dir))
    print("OK")
