"""Profiles — the top-level container for the armband app.

Every recording, log, measurement and model belongs to exactly one
profile. Nothing is ever written outside a profile folder.

Layout on disk — all human-readable (CSV + JSON + Markdown), no binary
except a fitted classifier `.pkl`, which is always shadowed by a JSON
metrics file beside it:

    armband/profiles/
        kyle/
            profile.json             name, type, notes, active arm, open sessions
            CLAUDE.md                explains this folder to a Claude session
            README.md                explains this folder to a human
            log.txt                  rolling append-only event log
            placement/               photos and marks for repeatable placement
            left/                    (and right/ — mirrored, independent)
                placement_notes.md
                characterization.json
                thresholds.json
                mappings.json
                model.pkl            (+ model.json for metrics)
                sessions/
                    2026-08-14_1430/     one visit — see session.py
                        session.json
                        session_notes.md
                        probes/
                        probes.json
                        analysis.json
                        REPORT.md
                        ANALYSIS_PROMPT.md

Session folders are append-only: never overwritten, never renamed.
Comparing the same movement across days is how drift in placement, skin
condition and fatigue gets detected, so the history has to stay intact.

`armband/profiles/_last_profile.txt` points at the most recently used
profile so the app can reopen it at startup without asking.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from profile_docs import write_profile_docs
from session import Session, list_sessions, unique_stamp

ARMBAND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROFILES_ROOT = os.path.join(ARMBAND_ROOT, "profiles")

LAST_POINTER = os.path.join(PROFILES_ROOT, "_last_profile.txt")

ARM_LEFT = "left"
ARM_RIGHT = "right"
ARMS = (ARM_LEFT, ARM_RIGHT)

TYPE_SUBJECT = "subject"
TYPE_DEBUG = "debug"
TYPES = (TYPE_SUBJECT, TYPE_DEBUG)

SCHEMA_VERSION = 2

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$")


def _now_iso() -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def validate_name(name: str) -> str:
    """Normalise and validate a profile name.

    Rules: lowercase, digits, dash, underscore. Starts with alphanumeric.
    1-64 chars. Case-insensitive input — normalised to lowercase.
    """
    normalized = (name or "").strip().lower()
    normalized = re.sub(r"\s+", "-", normalized)
    if not _NAME_RE.match(normalized):
        raise ValueError(
            f"invalid profile name {name!r}: use letters, digits, "
            f"dashes or underscores; 1-64 chars; start with a letter/digit"
        )
    return normalized


@dataclass
class Profile:
    """One person on the armband. Left and right are separate sub-trees.

    The profile object is a thin handle around a folder on disk. It is
    deliberately not a data holder for signal data — that lives in files
    (CSV probes, JSON metrics) so nothing is lost if the process dies.
    """

    name: str
    type: str = TYPE_SUBJECT
    notes: str = ""
    created_utc: str = ""
    active_arm: str = ARM_RIGHT
    active_session: Dict[str, str] = field(default_factory=dict)
    # ^ per-arm stamp of the currently open session, e.g.
    #   {"right": "2026-08-14_1430"}
    subject_context: str = ""       # feeds CLAUDE.md and the AI assistant
    # Per-arm anatomy and band placement, keyed by arm. Both are plain
    # dicts on disk so profile.json stays readable without the app —
    # see anatomy.Limb / anatomy.Placement for the fields.
    limbs: Dict[str, Any] = field(default_factory=dict)
    placements: Dict[str, Any] = field(default_factory=dict)
    schema_version: int = SCHEMA_VERSION

    # Not persisted.
    root: str = ""

    # ---------------------------------------------------- path helpers

    def profile_json_path(self) -> str:
        return os.path.join(self.root, "profile.json")

    def log_path(self) -> str:
        return os.path.join(self.root, "log.txt")

    def claude_md_path(self) -> str:
        return os.path.join(self.root, "CLAUDE.md")

    def readme_path(self) -> str:
        return os.path.join(self.root, "README.md")

    def placement_dir(self) -> str:
        return os.path.join(self.root, "placement")

    def arm_dir(self, arm: str) -> str:
        if arm not in ARMS:
            raise ValueError(f"arm must be one of {ARMS}, got {arm!r}")
        return os.path.join(self.root, arm)

    def sessions_dir(self, arm: str) -> str:
        return os.path.join(self.arm_dir(arm), "sessions")

    def placement_notes_path(self, arm: str) -> str:
        return os.path.join(self.arm_dir(arm), "placement_notes.md")

    def characterization_path(self, arm: str) -> str:
        return os.path.join(self.arm_dir(arm), "characterization.json")

    def thresholds_path(self, arm: str) -> str:
        return os.path.join(self.arm_dir(arm), "thresholds.json")

    def mappings_path(self, arm: str) -> str:
        return os.path.join(self.arm_dir(arm), "mappings.json")

    def model_path(self, arm: str) -> str:
        return os.path.join(self.arm_dir(arm), "model.pkl")

    def model_metrics_path(self, arm: str) -> str:
        return os.path.join(self.arm_dir(arm), "model.json")

    # -------------------------------------------------- session helpers

    def session(self, arm: str, create: bool = True, **meta: Any) -> Optional[Session]:
        """The open session on `arm`, creating one if there isn't one.

        Session creation is automatic and silent — the helper in the
        room never names or files anything.
        """
        stamp = self.active_session.get(arm)
        if stamp is None:
            if not create:
                return None
            # unique_stamp, not new_stamp: closing a session and opening
            # another within the same minute must not reuse the folder.
            stamp = unique_stamp(self.sessions_dir(arm))
            self.active_session[arm] = stamp
            self.save()
            self.log(f"session opened: {arm}/{stamp}",
                     action="session.open", arm=arm, session=stamp)
        sess = Session(os.path.join(self.sessions_dir(arm), stamp),
                       profile=self.name, arm=arm)
        if create and not sess.exists():
            sess = Session.create(self.sessions_dir(arm), self.name, arm,
                                  stamp=stamp, **meta)
        else:
            sess.ensure()
        return sess

    def open_session(self, arm: str) -> Optional[Session]:
        """The open session on `arm`, or None. Never creates."""
        return self.session(arm, create=False)

    def get_session(self, arm: str, stamp: str) -> Session:
        return Session(os.path.join(self.sessions_dir(arm), stamp),
                       profile=self.name, arm=arm)

    def sessions(self, arm: str) -> List[Session]:
        """Every session on `arm`, oldest first."""
        return [self.get_session(arm, s) for s in list_sessions(self.sessions_dir(arm))]

    def previous_sessions(self, arm: str, exclude: str = "") -> List[Session]:
        """History for cross-session comparison, most recent last."""
        return [s for s in self.sessions(arm) if s.stamp != exclude]

    def close_session(self, arm: str, analyse: bool = True) -> Optional[Session]:
        """Close the open session and (by default) analyse it.

        Analysis is automatic on purpose: nobody should have to
        remember to click it, and a session that was never analysed is
        a session whose problems get found weeks later.
        """
        stamp = self.active_session.pop(arm, None)
        if stamp is None:
            return None
        self.save()
        sess = self.get_session(arm, stamp)
        if not sess.exists():
            return None
        sess.close()
        self.log(f"session closed: {arm}/{stamp}")
        if analyse:
            # Calibrate FIRST: the analysis should use thresholds derived
            # from this session's own rest recordings, not last month's.
            try:
                import calibrate
                cal = calibrate.calibrate_session(sess)
                calibrate.save(self, arm, cal)
                self.log(f"calibrated {arm} from {stamp}: "
                         f"k={cal.get('onset', {}).get('k')}, "
                         f"distinct d'>={cal.get('separable_d_prime')}")
            except Exception as exc:
                self.log(f"calibration failed for {arm}/{stamp}: {exc}")
            try:
                from analysis import analyse_session
                analyse_session(sess, history=self.previous_sessions(arm, exclude=stamp))
                self.log(f"session analysed: {arm}/{stamp}")
            except Exception as exc:      # never let analysis lose a session
                self.log(f"analysis failed for {arm}/{stamp}: {exc}")
        # Hash everything now that the session's files are final. Done
        # last so the manifest covers the analysis output too.
        try:
            import integrity
            manifest = integrity.save_manifest(self)
            self.log(f"integrity manifest written (revision "
                     f"{integrity.load_manifest(self).get('revision')})",
                     action="integrity.manifest")
            _ = manifest
        except Exception as exc:
            self.log(f"integrity manifest failed: {exc}")
        return sess

    def reopen_session(self, arm: str, stamp: str) -> Session:
        """Mark an existing (previously-closed) session as the active one."""
        sess = self.get_session(arm, stamp)
        if not sess.exists():
            raise FileNotFoundError(f"no such session: {sess.root}")
        self.active_session[arm] = stamp
        sess.reopen()
        self.save()
        self.log(f"session reopened: {arm}/{stamp}")
        return sess

    def sessions_list(self, arm: str) -> List[str]:
        return list_sessions(self.sessions_dir(arm))

    def session_info(self, arm: str, stamp: str) -> Dict[str, Any]:
        """Structured metadata about one session on `arm`."""
        info = self.get_session(arm, stamp).summary()
        info["open"] = self.active_session.get(arm) == stamp
        return info

    def has_open_session(self, arm: str) -> bool:
        return arm in self.active_session

    def any_session_open(self) -> bool:
        return bool(self.active_session)

    # -------------------------------------------------------- text I/O

    def read_placement_notes(self, arm: str) -> str:
        p = self.placement_notes_path(arm)
        if not os.path.exists(p):
            return ""
        with open(p, "r", encoding="utf-8") as f:
            return f.read()

    def write_placement_notes(self, arm: str, text: str) -> None:
        p = self.placement_notes_path(arm)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)

    def append_placement_note(self, arm: str, note: str) -> str:
        """Append a timestamped bullet to placement_notes.md. Returns the
        full new file contents."""
        stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        existing = self.read_placement_notes(arm)
        line = f"- {stamp} — {note.strip()}"
        combined = (existing.rstrip() + "\n" + line + "\n") if existing else (line + "\n")
        self.write_placement_notes(arm, combined)
        return combined

    def latest_placement(self, arm: str) -> str:
        """Most recent placement note, for stamping into probe headers.

        Prefers the measured placement from the diagram — two numbers
        anyone can reproduce — and falls back to the free-text note for
        profiles recorded before the diagram existed.
        """
        measured = self.placement(arm)
        if measured is not None:
            return measured.describe()
        text = self.read_placement_notes(arm).strip()
        if not text:
            return ""
        last = text.splitlines()[-1].lstrip("- ").strip()
        # Strip the leading timestamp we wrote, keeping the note itself.
        parts = last.split(" — ", 1)
        return parts[1].strip() if len(parts) == 2 else last

    # ------------------------------------------------- limb and placement

    def limb(self, arm: str):
        """What is left of this arm. Drives the diagram and the warnings.

        Falls back to the default for this profile's TYPE, not to a
        blanket assumption: a debug profile is the developer's own
        intact arm, and telling them it has no forearm mid-session
        would be worse than saying nothing.
        """
        import anatomy
        record = (self.limbs or {}).get(arm)
        if record:
            return anatomy.Limb.from_dict(record, arm)
        return anatomy.default_limbs(self.type).get(arm,
                                                    anatomy.Limb(arm=arm))

    def set_limb(self, limb) -> None:
        self.limbs = dict(self.limbs or {})
        self.limbs[limb.arm] = limb.to_dict()
        self.save()

    def placement(self, arm: str):
        """Where the band was last put on this arm, as numbers."""
        import anatomy
        record = (self.placements or {}).get(arm)
        return anatomy.Placement.from_dict(record) if record else None

    def set_placement(self, placement) -> None:
        """Record the placement, and keep the human-readable trail too.

        The note goes into placement_notes.md as well as profile.json:
        the JSON is what the app reads, the markdown is what survives
        the app. Both say the same thing.
        """
        self.placements = dict(self.placements or {})
        self.placements[placement.arm] = placement.to_dict()
        self.save()
        self.append_placement_note(placement.arm, placement.describe())

    def set_notes(self, text: str) -> None:
        self.notes = text
        self.save()

    def log(self, message: str, action: str = "note", **fields: Any) -> None:
        """Append-only event log. Never raises — logging must not break a session.

        Mirrored into the structured audit trail (`audit.log`), which is
        the one a future reader will actually be able to query.
        """
        try:
            os.makedirs(self.root, exist_ok=True)
            with open(self.log_path(), "a", encoding="utf-8") as f:
                f.write(f"{_now_iso()}  {message}\n")
        except OSError:
            pass
        try:
            import integrity
            integrity.audit(self, action, message, **fields)
        except Exception:
            pass

    # --------------------------------------------------- persistence

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name":            self.name,
            "type":            self.type,
            "notes":           self.notes,
            "created_utc":     self.created_utc,
            "active_arm":      self.active_arm,
            "active_session":  self.active_session,
            "subject_context": self.subject_context,
            "limbs":           self.limbs,
            "placements":      self.placements,
            "schema_version":  self.schema_version,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any], root: str) -> "Profile":
        return cls(
            name=data.get("name", os.path.basename(root)),
            type=data.get("type", TYPE_SUBJECT),
            notes=data.get("notes", ""),
            created_utc=data.get("created_utc", ""),
            active_arm=data.get("active_arm", ARM_RIGHT),
            active_session=data.get("active_session", {}) or {},
            subject_context=data.get("subject_context", ""),
            limbs=data.get("limbs", {}) or {},
            placements=data.get("placements", {}) or {},
            schema_version=int(data.get("schema_version", 1)),
            root=root,
        )

    def save(self) -> None:
        os.makedirs(self.root, exist_ok=True)
        self.schema_version = SCHEMA_VERSION
        with open(self.profile_json_path(), "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, sort_keys=True)

    def write_docs(self) -> List[str]:
        """(Re)generate CLAUDE.md, README.md and placement/README.md."""
        return write_profile_docs(self.root, self.name, self.type,
                                  self.subject_context)

    def ensure_layout(self) -> None:
        """Create the full folder tree for this profile."""
        os.makedirs(self.root, exist_ok=True)
        for arm in ARMS:
            os.makedirs(self.sessions_dir(arm), exist_ok=True)
        os.makedirs(self.placement_dir(), exist_ok=True)
        if not os.path.exists(self.log_path()):
            with open(self.log_path(), "w", encoding="utf-8") as f:
                f.write(f"# armband log — profile '{self.name}' — created {_now_iso()}\n")
        if not self.created_utc:
            self.created_utc = _now_iso()
        self.save()
        self.write_docs()


# ================================================================== store


class ProfileStore:
    """Directory-backed collection of profiles."""

    def __init__(self, root: str = PROFILES_ROOT) -> None:
        self.root = root
        os.makedirs(self.root, exist_ok=True)

    def list_profiles(self) -> List[str]:
        if not os.path.isdir(self.root):
            return []
        names = []
        for entry in sorted(os.listdir(self.root)):
            path = os.path.join(self.root, entry)
            if not os.path.isdir(path):
                continue
            if entry.startswith("_") or entry.startswith("."):
                continue
            if os.path.exists(os.path.join(path, "profile.json")):
                names.append(entry)
        return names

    def exists(self, name: str) -> bool:
        try:
            n = validate_name(name)
        except ValueError:
            return False
        return os.path.exists(os.path.join(self.root, n, "profile.json"))

    def create(self, name: str, type: str = TYPE_SUBJECT, notes: str = "",
               subject_context: str = "") -> Profile:
        n = validate_name(name)
        if type not in TYPES:
            raise ValueError(f"type must be one of {TYPES}, got {type!r}")
        path = os.path.join(self.root, n)
        if os.path.exists(os.path.join(path, "profile.json")):
            raise FileExistsError(f"profile '{n}' already exists")
        prof = Profile(name=n, type=type, notes=notes,
                       subject_context=subject_context, root=path)
        prof.ensure_layout()
        prof.log(f"profile created (type={type})")
        return prof

    def load(self, name: str) -> Profile:
        n = validate_name(name)
        path = os.path.join(self.root, n)
        pj = os.path.join(path, "profile.json")
        if not os.path.exists(pj):
            raise FileNotFoundError(f"profile '{n}' not found at {pj}")
        with open(pj, "r", encoding="utf-8") as f:
            data = json.load(f)
        prof = Profile.from_dict(data, path)
        prof.ensure_layout()
        return prof

    def load_or_create(self, name: str, type: str = TYPE_SUBJECT) -> Profile:
        if self.exists(name):
            return self.load(name)
        return self.create(name, type=type)

    def last_used(self) -> Optional[str]:
        if not os.path.exists(LAST_POINTER):
            return None
        try:
            with open(LAST_POINTER, "r", encoding="utf-8") as f:
                name = f.read().strip()
            if self.exists(name):
                return name
        except Exception:
            pass
        return None

    def set_last_used(self, name: str) -> None:
        n = validate_name(name)
        os.makedirs(self.root, exist_ok=True)
        with open(LAST_POINTER, "w", encoding="utf-8") as f:
            f.write(n)

    def delete(self, name: str) -> None:
        """Hard-deletes a profile. Called only from an explicit UI action."""
        import shutil
        n = validate_name(name)
        path = os.path.join(self.root, n)
        if os.path.exists(path):
            shutil.rmtree(path)


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import shutil
    import tempfile

    import numpy as np

    from probe_store import ProbeMeta, ProbeWriter

    tmp_root = os.path.join(tempfile.gettempdir(), "armband-profile-selftest")
    if os.path.exists(tmp_root):
        shutil.rmtree(tmp_root)

    store = ProfileStore(root=tmp_root)
    assert store.list_profiles() == []

    p = store.create("test-kyle", type=TYPE_DEBUG, notes="self-test")
    print("created      :", p.name, "at", p.root)
    print("docs         :", [os.path.basename(x) for x in
                             [p.claude_md_path(), p.readme_path()]
                             if os.path.exists(x)])
    print("placement dir:", os.path.isdir(p.placement_dir()))

    # A session with a rest probe and one movement probe.
    sess = p.session("right", location="rehab room 2", battery_pct=81)
    print("session      :", sess.stamp)
    rng = np.random.default_rng(3)
    for name, kind in (("rest", "rest"), ("curl ring finger", "probe")):
        path = sess.new_probe_path(name)
        sig = rng.normal(0, 0.02, size=(3, 8000)).astype(np.float32)
        if kind == "probe":
            for r in range(4):
                s0 = int((1.0 + r * 1.6) * 1000)
                sig[:, s0:s0 + 800] += (
                    0.2 * np.hanning(800) * rng.normal(0, 1, size=(3, 800))
                    * np.array([[1.0], [0.3], [0.1]])).astype(np.float32)
        w = ProbeWriter(path, ProbeMeta(probe=name, profile=p.name, arm="right",
                                        session=sess.stamp, kind=kind))
        w.append(sig)
        sess.record_probe(w.close(effort="easy", fatigue="none",
                                  his_confidence=4), path)

    p.append_placement_note("right", "3 fingerwidths below elbow; label to thumb")
    print("latest place :", p.latest_placement("right"))

    closed = p.close_session("right")
    print("closed       :", closed.stamp, "open now:", p.has_open_session("right"))
    print("auto-analysed:", os.path.exists(closed.analysis_json),
          "| REPORT.md:", os.path.exists(closed.report_md),
          "| PROMPT:", os.path.exists(closed.prompt_md))
    print("session_info :", json.dumps(p.session_info("right", closed.stamp)))

    store.set_last_used(p.name)
    assert store.last_used() == p.name
    reload = store.load("test-kyle")
    print("reloaded     :", reload.name, "schema", reload.schema_version,
          "| sessions:", reload.sessions_list("right"))

    # Legacy stamp folders must still be listed.
    legacy = os.path.join(reload.sessions_dir("right"), "2026-08-06_15-32-11")
    os.makedirs(legacy, exist_ok=True)
    print("legacy stamps:", reload.sessions_list("right"))

    print("list         :", store.list_profiles())
    print("OK")
