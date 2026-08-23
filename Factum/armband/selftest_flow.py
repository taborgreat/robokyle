"""End-to-end check of a field session, with no GUI and no band.

Simulates what actually happens in the room: open a profile, let the
app create a session, stream a rest probe and three movement probes to
disk exactly the way RecordingOverlay does (chunk by chunk, never held
in memory), rate them afterwards, drop a quick note mid-session, close
the session, and confirm the analysis wrote itself.

Also checks the two failure modes that matter: a crash mid-probe must
leave usable data behind, and a second session must be comparable
against the first.

Run:  .venv\\Scripts\\python.exe armband\\selftest_flow.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analysis import probe_metrics, rest_stats, usability_score  # noqa: E402
from probe_store import ProbeMeta, ProbeWriter, load_probe        # noqa: E402
from profiles import ProfileStore, TYPE_DEBUG                     # noqa: E402

FS = 1000
rng = np.random.default_rng(11)


def synth(kind: str, seconds: int = 20, n_reps: int = 4, amp: float = 0.25,
          channels=(1.0, 0.3, 0.1), jitter: float = 0.0) -> np.ndarray:
    n = seconds * FS
    sig = rng.normal(0, 0.01, size=(3, n))
    if kind == "rest":
        return sig.astype(np.float32)
    for r in range(n_reps):
        start = int((1.5 + r * 4.0) * FS)
        dur = int(1.5 * FS)
        if start + dur > n:
            break
        env = np.hanning(dur)
        for ch in range(3):
            gain = channels[ch] * (1.0 + rng.normal(0, jitter))
            sig[ch, start:start + dur] += amp * gain * env * rng.normal(0, 1, size=dur)
    return sig.astype(np.float32)


def stream_probe(session, profile, name, kind, sig, chunk=200):
    """Write a probe the way the app does — 200 samples at a time."""
    path = session.new_probe_path(name)
    writer = ProbeWriter(path, ProbeMeta(
        probe=name, profile=profile.name, profile_type=profile.type,
        arm=session.arm, session=session.stamp, kind=kind,
        sample_rate_hz=FS, placement=profile.latest_placement(session.arm)))
    for i in range(0, sig.shape[1], chunk):
        writer.append(sig[:, i:i + chunk])
    return path, writer


def main() -> int:
    root = os.path.join(tempfile.gettempdir(), "armband-flow-selftest")
    if os.path.exists(root):
        shutil.rmtree(root)
    store = ProfileStore(root=root)
    failures = []

    def check(label, condition, detail=""):
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}"
              + (f"  ({detail})" if detail else ""))
        if not condition:
            failures.append(label)

    print("\n=== profile ===")
    prof = store.create("kyle", type=TYPE_DEBUG, notes="flow self-test")
    check("CLAUDE.md written", os.path.exists(prof.claude_md_path()))
    check("README.md written", os.path.exists(prof.readme_path()))
    check("placement/ created", os.path.isdir(prof.placement_dir()))
    prof.append_placement_note("right", "3 fingers below elbow crease, mark A")

    print("\n=== session 1 ===")
    sess = prof.session("right", location="rehab room 2",
                        present="Kyle + helper", battery_pct=79, on_charger=False)
    check("session auto-created", sess.exists(), sess.stamp)
    check("session.json has context", sess.info().get("location") == "rehab room 2")

    plan = [
        ("rest", "rest", synth("rest"), "easy", "none", 5, ""),
        ("curl ring finger", "probe", synth("probe", channels=(1.0, 0.3, 0.1)),
         "easy", "none", 4, 'said it was "the easy one"'),
        ("spread fingers", "probe", synth("probe", channels=(0.2, 0.4, 1.0)),
         "moderate", "some", 4, "slower to start"),
        ("the twitchy one", "probe",
         synth("probe", channels=(1.0, 0.32, 0.11), jitter=0.9),
         "strenuous", "high", 2, "could not tell if he repeated it"),
    ]
    rest_ref = {"available": False}
    for name, kind, sig, effort, fatigue, conf, note in plan:
        path, writer = stream_probe(sess, prof, name, kind, sig)
        mid, mid_meta = load_probe(path)
        meta = writer.close(effort=effort, fatigue=fatigue,
                            his_confidence=conf, notes=note)
        samples, _ = load_probe(path)
        if kind == "rest":
            rest_ref = rest_stats(samples, FS)
        m = probe_metrics(samples, FS, rest_ref, kind=kind)
        m.pop("_features", None)
        m.update(usability_score(m, effort, fatigue, conf))
        sess.record_probe(meta, path, metrics=m)
        check(f"{name}: streamed + finalised",
              samples.shape[1] == sig.shape[1] and meta.status == "complete",
              f"{samples.shape[1]:,} samples, {m.get('n_reps', '-')} reps, "
              f"consistency {m.get('consistency')}")
        check(f"{name}: readable mid-recording",
              mid.shape[1] > 0 and mid_meta.status == "incomplete",
              f"{mid.shape[1]:,} rows before close")
        check(f"{name}: placement stamped into header",
              meta.placement.startswith("3 fingers"))

    check("filenames sort chronologically",
          [e["file"] for e in sess.probes()] == sorted(e["file"] for e in sess.probes()),
          ", ".join(e["file"] for e in sess.probes()))
    sess.append_note("he tired noticeably after the third probe")
    check("quick note landed in session_notes.md",
          "tired noticeably" in sess.read_notes())
    check("rest probe detected", sess.has_rest())

    print("\n=== crash mid-probe ===")
    path, writer = stream_probe(sess, prof, "interrupted", "probe",
                                synth("probe", seconds=10))
    del writer                      # process dies here — no close()
    crashed, crashed_meta = load_probe(path)
    check("crashed probe kept its data", crashed.shape[1] > 5000,
          f"{crashed.shape[1]:,} samples survived")
    check("crashed probe marked incomplete", crashed_meta.status == "incomplete")
    os.remove(path)                 # keep it out of the analysis below

    print("\n=== close + automatic analysis ===")
    closed = prof.close_session("right")
    check("analysis.json written", os.path.exists(closed.analysis_json))
    check("REPORT.md written", os.path.exists(closed.report_md))
    check("ANALYSIS_PROMPT.md written", os.path.exists(closed.prompt_md))
    check("no session left open", not prof.has_open_session("right"))

    with open(closed.analysis_json, "r", encoding="utf-8") as f:
        analysis = json.load(f)
    ranking = analysis["ranking"]
    check("ranking produced", len(ranking) == 3)
    check("consistency discriminates",
          ranking[0]["consistency"] > ranking[-1]["consistency"],
          f"best {ranking[0]['probe']} {ranking[0]['consistency']:.2f} vs "
          f"worst {ranking[-1]['probe']} {ranking[-1]['consistency']:.2f}")
    check("tiring probe ranked last", ranking[-1]["probe"] == "the twitchy one")
    lookalikes = [p for p in analysis["separability"]
                  if p.get("d_prime") is not None and p["d_prime"] < 1.5]
    check("near-identical probes flagged", len(lookalikes) >= 1,
          "; ".join(f"{p['a']} vs {p['b']} d'={p['d_prime']}" for p in lookalikes))
    check("recommendations written", len(analysis["recommendations"]) >= 2)

    with open(closed.report_md, "r", encoding="utf-8") as f:
        report = f.read()
    for heading in ("What we recorded", "What looked good", "What looked bad",
                    "Can these be told apart?", "What changed since last time",
                    "What to try next"):
        check(f"REPORT.md has '{heading}'", heading in report)

    print("\n=== session 2 (cross-session comparison) ===")
    sess2 = prof.session("right", location="rehab room 2")
    check("second session is a new folder", sess2.stamp != closed.stamp,
          f"{closed.stamp} then {sess2.stamp}")
    for name, kind, sig in (
        ("rest", "rest", synth("rest")),
        ("curl ring finger", "probe", synth("probe", channels=(1.0, 0.3, 0.1))),
    ):
        path, writer = stream_probe(sess2, prof, name, kind, sig)
        sess2.record_probe(writer.close(effort="easy", fatigue="none",
                                        his_confidence=4), path)
    closed2 = prof.close_session("right")
    with open(closed2.analysis_json, "r", encoding="utf-8") as f:
        analysis2 = json.load(f)
    check("previous session compared", len(analysis2["repeatability"]) >= 1,
          json.dumps([{c["session"]: c.get("drift_d_prime")}
                      for r in analysis2["repeatability"]
                      for c in r["compared_with"]]))
    check("first session untouched (append-only)",
          os.path.exists(closed.report_md) and os.path.isdir(closed.probes_dir))

    print("\n=== export ===")
    out = closed.export_zip(os.path.join(root, "_export"))
    check("zip written", os.path.exists(out),
          f"{os.path.basename(out)}, {os.path.getsize(out)/1024:.0f} KB")
    import zipfile
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
    check("zip carries the profile docs",
          any(n.endswith("_profile/CLAUDE.md") for n in names))
    check("zip carries the report", any(n.endswith("REPORT.md") for n in names))
    check("zip carries the raw CSVs",
          sum(1 for n in names if n.endswith(".csv")) == 4)

    print("\n" + "=" * 60)
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f_ in failures:
            print("  -", f_)
        return 1
    print("ALL CHECKS PASSED")
    print(f"artifacts under {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
