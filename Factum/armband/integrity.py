"""Data integrity and audit trail — the medical-records side of Factum.

This data may be used for the rest of Kyle's life, and decisions about
what he can control will be made from it. That imposes obligations
beyond "the files are on disk":

* **Detectability of change.** Every probe gets a SHA-256 recorded in a
  manifest when it is finalised. A file that changes afterwards — disk
  corruption, a sync conflict, a well-meaning edit — is detectable
  rather than silently believed.
* **An audit trail.** Who/what did what, when, append-only, in a plain
  text file. Not for compliance theatre: for the moment in two years
  when a session's numbers look wrong and the question is what the
  software was doing that day.
* **Provenance.** Every generated file records the app version and
  schema that produced it, so a future reader can tell whether a
  number came from the code as it is now or as it was.
* **Verification you can run.** `verify_profile()` walks everything and
  reports what is missing, changed, or unreadable.

Deliberately NOT cryptographic signing. Hashes here detect accident and
drift, which is the realistic threat. Signing would imply a chain of
custody this project does not have and cannot honestly claim.

Server sync groundwork
----------------------
The manifest is also what a sync layer needs: a content hash per file,
a per-profile revision, and a clear notion of which files are finalised
(hashable) versus in-flight (a probe still being written). Nothing here
talks to a network — it just makes a future sync safe and cheap.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Tuple

APP_VERSION = "0.4.0"
INTEGRITY_SCHEMA = "armband/integrity/1"
AUDIT_SCHEMA = "armband/audit/1"

MANIFEST_NAME = "integrity.json"
AUDIT_NAME = "audit.log"

# Files whose content is expected to change as work continues; they are
# tracked but never treated as tamper when they differ.
MUTABLE = {"profile.json", "audit.log", "integrity.json", "log.txt",
           "session.json", "probes.json", "session_notes.md",
           "analysis.json", "REPORT.md", "ANALYSIS_PROMPT.md",
           "calibration.json", "model.json", "placement_notes.md",
           "CLAUDE.md", "README.md"}


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def sha256_file(path: str, chunk: int = 1 << 20) -> Optional[str]:
    """Content hash, streamed so a 30-minute recording does not need RAM."""
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as f:
            while True:
                block = f.read(chunk)
                if not block:
                    break
                digest.update(block)
        return digest.hexdigest()
    except OSError:
        return None


# ================================================================== audit


def audit(profile, action: str, detail: str = "", **fields: Any) -> None:
    """Append one line to the profile's audit log. Never raises.

    Append-only and human-readable on purpose: an audit trail that
    needs a tool to read is one nobody reads.
    """
    if profile is None:
        return
    path = os.path.join(profile.root, AUDIT_NAME)
    entry = {"ts": _now(), "action": action, "app_version": APP_VERSION}
    if detail:
        entry["detail"] = detail
    entry.update({k: v for k, v in fields.items() if v is not None})
    try:
        os.makedirs(profile.root, exist_ok=True)
        new = not os.path.exists(path)
        with open(path, "a", encoding="utf-8") as f:
            if new:
                f.write(f"# Factum audit log — profile '{profile.name}'\n"
                        f"# One JSON object per line, append-only. "
                        f"Schema {AUDIT_SCHEMA}.\n")
            f.write(json.dumps(entry, sort_keys=True) + "\n")
    except OSError:
        pass


def read_audit(profile, limit: int = 200) -> List[Dict[str, Any]]:
    path = os.path.join(profile.root, AUDIT_NAME)
    if not os.path.exists(path):
        return []
    out: List[Dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        return []
    return out[-limit:]


# =============================================================== manifest


def _walk(root: str) -> List[str]:
    found: List[str] = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in sorted(files):
            if name.endswith(".tmp"):
                continue
            found.append(os.path.relpath(os.path.join(folder, name), root))
    return sorted(found)


def build_manifest(profile) -> Dict[str, Any]:
    """Hash every file under the profile and record its size and mtime."""
    root = profile.root
    entries: Dict[str, Any] = {}
    for rel in _walk(root):
        if rel in (MANIFEST_NAME,):
            continue
        full = os.path.join(root, rel)
        try:
            stat = os.stat(full)
        except OSError:
            continue
        entries[rel.replace("\\", "/")] = {
            "sha256":   sha256_file(full),
            "bytes":    stat.st_size,
            "modified": dt.datetime.fromtimestamp(stat.st_mtime)
                          .strftime("%Y-%m-%dT%H:%M:%S"),
            "mutable":  os.path.basename(rel) in MUTABLE,
        }
    previous = load_manifest(profile)
    revision = int(previous.get("revision", 0)) + 1
    return {
        "schema":      INTEGRITY_SCHEMA,
        "app_version": APP_VERSION,
        "profile":     profile.name,
        "generated":   _now(),
        "revision":    revision,
        "n_files":     len(entries),
        "total_bytes": sum(e["bytes"] for e in entries.values()),
        "files":       entries,
        "note": "sha256 of every file at the time of writing. Probe CSVs are "
                "immutable once finalised — a changed hash on one of those "
                "means the file was altered or corrupted after recording.",
    }


def manifest_path(profile) -> str:
    return os.path.join(profile.root, MANIFEST_NAME)


def load_manifest(profile) -> Dict[str, Any]:
    path = manifest_path(profile)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_manifest(profile, manifest: Optional[Dict[str, Any]] = None) -> str:
    manifest = manifest or build_manifest(profile)
    path = manifest_path(profile)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return path


# ============================================================ verification


def verify_profile(profile) -> Dict[str, Any]:
    """Check every recorded file against the manifest. Report honestly."""
    previous = load_manifest(profile)
    if not previous:
        return {"available": False,
                "note": "no manifest yet — it is written when a session closes"}

    recorded = previous.get("files", {})
    current = {rel.replace("\\", "/") for rel in _walk(profile.root)
               if rel != MANIFEST_NAME}

    changed: List[str] = []
    missing: List[str] = []
    added: List[str] = []
    unreadable: List[str] = []

    for rel, entry in recorded.items():
        full = os.path.join(profile.root, rel)
        if not os.path.exists(full):
            missing.append(rel)
            continue
        if entry.get("mutable"):
            continue          # expected to change as work continues
        digest = sha256_file(full)
        if digest is None:
            unreadable.append(rel)
        elif digest != entry.get("sha256"):
            changed.append(rel)

    for rel in current:
        if rel not in recorded:
            added.append(rel)

    ok = not (changed or missing or unreadable)
    return {
        "available":  True,
        "ok":         ok,
        "revision":   previous.get("revision"),
        "checked":    len(recorded),
        "changed":    sorted(changed),
        "missing":    sorted(missing),
        "added":      sorted(added),
        "unreadable": sorted(unreadable),
        "summary": (
            "All recorded files match their hashes."
            if ok else
            f"{len(changed)} changed, {len(missing)} missing, "
            f"{len(unreadable)} unreadable since the last manifest."
        ),
    }


def verify_probe(session, filename: str) -> Dict[str, Any]:
    """Re-read one probe and confirm it is intact and internally consistent."""
    from probe_store import load_probe

    path = session.probe_path(filename)
    if not os.path.exists(path):
        return {"ok": False, "reason": "file is missing"}
    try:
        samples, meta = load_probe(path)
    except Exception as exc:
        return {"ok": False, "reason": f"unreadable: {exc}"}

    problems: List[str] = []
    if meta.n_samples and abs(meta.n_samples - samples.shape[1]) > 1:
        problems.append(f"header says {meta.n_samples} samples, file has "
                        f"{samples.shape[1]}")
    if meta.status != "complete":
        problems.append(f"marked {meta.status}")
    if samples.shape[1] == 0:
        problems.append("no data rows")
    if meta.sample_rate_hz <= 0:
        problems.append("no sample rate in header")
    return {
        "ok":        not problems,
        "problems":  problems,
        "n_samples": int(samples.shape[1]),
        "sha256":    sha256_file(path),
    }


def profile_summary(profile) -> Dict[str, Any]:
    """Counts that answer "how much is actually in here"."""
    n_sessions = n_probes = 0
    total_seconds = 0.0
    for arm in ("left", "right"):
        for sess in profile.sessions(arm):
            n_sessions += 1
            for entry in sess.probes():
                n_probes += 1
                total_seconds += float(entry.get("duration_s") or 0.0)
    manifest = load_manifest(profile)
    return {
        "profile":       profile.name,
        "sessions":      n_sessions,
        "probes":        n_probes,
        "recorded_minutes": round(total_seconds / 60.0, 1),
        "revision":      manifest.get("revision", 0),
        "last_verified": manifest.get("generated", "never"),
        "bytes":         manifest.get("total_bytes", 0),
    }


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import shutil
    import sys
    import tempfile

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import numpy as np

    from probe_store import ProbeMeta, ProbeWriter
    from profiles import ProfileStore, TYPE_DEBUG

    root = os.path.join(tempfile.gettempdir(), "armband-integrity-selftest")
    if os.path.exists(root):
        shutil.rmtree(root)
    store = ProfileStore(root=root)
    profile = store.create("kyle", type=TYPE_DEBUG)

    sess = profile.session("right")
    rng = np.random.default_rng(0)
    path = sess.new_probe_path("rest")
    writer = ProbeWriter(path, ProbeMeta(probe="rest", profile="kyle",
                                         arm="right", session=sess.stamp,
                                         kind="rest"))
    writer.append(rng.normal(0, 0.02, size=(3, 4000)).astype(np.float32))
    sess.record_probe(writer.close(), path)

    audit(profile, "session.open", f"right/{sess.stamp}")
    audit(profile, "probe.record", "rest", file=os.path.basename(path),
          samples=4000)
    save_manifest(profile)

    print("summary   :", json.dumps(profile_summary(profile)))
    result = verify_profile(profile)
    print("verify    :", result["summary"], f"({result['checked']} files)")
    print("probe ok  :", verify_probe(sess, os.path.basename(path))["ok"])

    print("\n-- now corrupt a finalised probe and re-verify --")
    with open(path, "a", encoding="utf-8") as f:
        f.write("0,0.1,0.1,0.1\n")
    after = verify_profile(profile)
    print("detected  :", not after["ok"], "|", after["summary"])
    print("changed   :", after["changed"])

    print("\n-- audit trail --")
    for entry in read_audit(profile):
        print("  ", json.dumps(entry, sort_keys=True))

    assert not after["ok"], "corruption went undetected"
    print("\nOK — tampering with a finalised probe is detected")
