"""Is this machine ready to record right now? Checked before, not after.

A session with Kyle is expensive. Someone drives him there, a helper
straps a band to a residual limb, and he spends twenty minutes making
attempted movements that tire him. If the disk is full, the band is on
the wrong arm, or the placement was never recorded, that is discovered
*after* the session — from a folder of recordings that cannot be
compared to anything.

So every condition that would quietly ruin a session gets checked in
one pass, before anyone sits down, and each answer says what to do
rather than what is wrong.

Three severities:

    BLOCK   recording now would produce data that cannot be used
    WARN    recording will work, but something will be missing later
    OK      nothing to do

Nothing here touches the band or writes a file beyond a temp probe of
the disk. It is safe to run repeatedly, and it is deliberately fast
enough to run every time the Session tab is opened.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

BLOCK = "block"
WARN = "warn"
OK = "ok"

# Below this, a 30-second recording is still fine but a full session is
# not. Three channels at ~840 Hz for 30 s is roughly 1 MB of CSV, so a
# twenty-probe session wants ~25 MB; 200 MB is a comfortable floor that
# still catches a genuinely full disk.
MIN_FREE_MB = 200


@dataclass
class Check:
    key: str
    severity: str
    title: str
    detail: str          # what to do about it, not what is wrong

    def as_dict(self) -> Dict[str, Any]:
        return {"key": self.key, "severity": self.severity,
                "title": self.title, "detail": self.detail}


def _signal(app_client) -> Check:
    """Is the band actually delivering samples?

    The advice differs completely by transport, and the wrong advice
    wastes a session: over Bluetooth there is no Mudra Link to restart
    and no router to blame, and over the WebSocket there is no pairing
    to do inside Factum at all.
    """
    if app_client is None:
        return Check("signal", BLOCK, "No connection to the band",
                     "Open the Band tab and connect one.")

    is_ble = getattr(app_client, "transport", "") == "ble"
    try:
        state = app_client.signal_state()
        rate = app_client.samples_per_second()
    except Exception as exc:
        return Check("signal", BLOCK, "Cannot read the signal", str(exc))

    if state != "live":
        if is_ble:
            try:
                connected = app_client.band_connected()
            except Exception:
                connected = False
            if not connected:
                return Check(
                    "signal", BLOCK, "No band connected",
                    "Open the Band tab, press Scan, then Connect. A band "
                    "holds one Bluetooth link at a time, so close Mudra "
                    "Link and the phone app first.")
            if getattr(app_client, "licence_blocks_raw", lambda: False)():
                return Check(
                    "signal", BLOCK, "The band is refusing raw signal",
                    "Its licence has the raw lock set, and that is enforced "
                    "in firmware. Switch to the Mudra Link transport in the "
                    "Band tab, or get a licence from Wearable Devices.")
            return Check(
                "signal", BLOCK, "Connected, but no raw signal",
                "Press 'Set this band up for Factum' in the Band tab — that "
                "turns raw signal on.")
        already = getattr(app_client, "last_error", "") == "client_already_connected"
        if already:
            return Check(
                "signal", BLOCK, "Something else is holding the signal",
                "Mudra Link serves ONE client at a time and it is already "
                "taken — usually a second Factum window, or one that was "
                "killed rather than closed. Close any other Factum, then "
                "press Repair in the header.")
        return Check(
            "signal", BLOCK, "No signal arriving",
            "Press Repair in the header first — changing band mode makes "
            "the host restart its feed, and the connection has to be "
            "rebuilt. If that does not help: the band should be in "
            "STANDBY, only one client may hold the stream at a time, and "
            "router-level security can block it silently.")
    if rate <= 0:
        return Check("signal", WARN, "Signal is live but the rate is unknown",
                     "Wait a few seconds before recording. The sample rate "
                     "is stamped into every file, and a guessed rate makes "
                     "frequency comparisons wrong.")
    if rate < 600:
        return Check("signal", WARN, f"Sample rate is low ({rate:.0f} Hz)",
                     "Expected 830-840 Hz. Something is dropping frames — "
                     "close other apps talking to the band and watch the "
                     "rate for a few seconds before starting.")
    return Check("signal", OK, f"Signal live at {rate:.0f} Hz",
                 "The band is streaming.")


def _profile(profile) -> Check:
    if profile is None:
        return Check("profile", BLOCK, "No profile selected",
                     "Pick or create a profile. Every recording has to "
                     "belong to someone — an unfiled recording is a "
                     "recording nobody can use later.")
    if profile.type == "debug":
        return Check("profile", WARN,
                     f"'{profile.name}' is a debug profile",
                     "Fine for testing on your own arm. If this is a real "
                     "session with Kyle, switch to his subject profile — "
                     "debug data is excluded from his record.")
    return Check("profile", OK, f"Recording into '{profile.name}'",
                 f"{profile.type} profile, {profile.active_arm} arm.")


def _limb_and_placement(profile) -> List[Check]:
    """Does the app know what arm this is, and where the band sits?"""
    if profile is None:
        return []
    arm = profile.active_arm
    limb = profile.limb(arm)
    out: List[Check] = []

    if not limb.has_forearm:
        out.append(Check(
            "limb", BLOCK, f"The {arm} limb has no forearm",
            "A forearm band cannot be placed on this side. Switch to the "
            "other arm, or — if you are deliberately recording upper-arm "
            "muscle — say so in the placement note, because the signal "
            "carries no finger content and must not be compared with "
            "forearm recordings."))
        return out

    placement = profile.placement(arm)
    if placement is None:
        out.append(Check(
            "placement", WARN, "Band position has never been recorded",
            "Open Contact & Placement and drag the band on the diagram to "
            "where it actually sits. Without it, nothing recorded today "
            "can be compared with another day — the same movement 2 cm up "
            "the arm looks like a different movement."))
    elif not limb.fits(placement.distance_mm):
        out.append(Check(
            "placement", WARN, "Saved band position does not fit this limb",
            f"It says {placement.distance_mm} mm from the elbow, but this "
            f"limb only allows {limb.band_range_mm[0]}-"
            f"{limb.band_range_mm[1]} mm. Re-set it on the diagram."))
    else:
        out.append(Check(
            "placement", OK, "Band position on record",
            placement.describe()))
    return out


def _baseline(session) -> Check:
    if session is None:
        return Check("baseline", OK, "Session starts on the first recording",
                     "Factum opens one automatically.")
    if not session.has_rest():
        return Check("baseline", WARN, "No rest recording in this session yet",
                     "Record rest first. Every movement is measured against "
                     "it, and a session without one cannot be compared with "
                     "anything, including itself.")
    return Check("baseline", OK, "Baseline recorded",
                 "Movements will be measured against it.")


def _disk(root: str) -> Check:
    try:
        free_mb = shutil.disk_usage(root).free / (1024 * 1024)
    except Exception as exc:
        return Check("disk", WARN, "Cannot check free space", str(exc))
    if free_mb < MIN_FREE_MB:
        return Check("disk", BLOCK, f"Only {free_mb:.0f} MB free",
                     f"Recording writes continuously to disk. Free up at "
                     f"least {MIN_FREE_MB} MB before starting, or a session "
                     f"will stop partway through.")
    return Check("disk", OK, f"{free_mb / 1024:.1f} GB free",
                 "Enough for a full session.")


def _writable(root: str) -> Check:
    """Prove it, do not assume it — a read-only folder fails silently."""
    try:
        os.makedirs(root, exist_ok=True)
        fd, path = tempfile.mkstemp(prefix=".factum-write-test", dir=root)
        os.close(fd)
        os.remove(path)
    except Exception as exc:
        return Check("writable", BLOCK, "Cannot write to the data folder",
                     f"{root} — {exc}. Recording would fail at the moment "
                     f"it mattered.")
    return Check("writable", OK, "Data folder is writable", root)


def _assistant() -> Check:
    try:
        import assistant
        state = assistant.status()
    except Exception as exc:
        return Check("assistant", WARN, "Assistant unavailable", str(exc))
    if state.get("available"):
        return Check("assistant", OK,
                     f"Assistant ready ({state.get('backend')})",
                     state.get("message", ""))
    return Check("assistant", WARN, "No assistant backend",
                 "Everything still works — the assistant is the only part "
                 "of Factum that needs internet. You lose the second "
                 "opinion after each recording, nothing else.")


def run(app_client=None, profile=None, session=None,
        data_root: str = "") -> Dict[str, Any]:
    """Every check, in the order they would ruin a session."""
    root = data_root or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "profiles")
    checks: List[Check] = [_signal(app_client), _profile(profile)]
    checks += _limb_and_placement(profile)
    checks += [_baseline(session), _disk(root), _writable(root), _assistant()]

    blocks = [c for c in checks if c.severity == BLOCK]
    warns = [c for c in checks if c.severity == WARN]
    if blocks:
        verdict, headline = BLOCK, blocks[0].title
    elif warns:
        verdict, headline = WARN, f"Ready, with {len(warns)} thing" \
                                  f"{'s' if len(warns) != 1 else ''} to know"
    else:
        verdict, headline = OK, "Ready to record"

    return {
        "verdict":  verdict,
        "headline": headline,
        "checks":   [c.as_dict() for c in checks],
        "blocking": [c.as_dict() for c in blocks],
        "warnings": [c.as_dict() for c in warns],
    }


def render(result: Dict[str, Any]) -> str:
    """Plain text, for the log and for a terminal run."""
    mark = {OK: "  ok  ", WARN: " warn ", BLOCK: "BLOCK "}
    lines = [f"{result['headline']}", ""]
    for c in result["checks"]:
        lines.append(f"[{mark[c['severity']]}] {c['title']}")
        if c["severity"] != OK:
            lines.append(f"           {c['detail']}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from profiles import ProfileStore

    store = ProfileStore()
    names = sys.argv[1:] or store.list_profiles()
    for name in names:
        profile = store.load(name)
        sess = profile.open_session(profile.active_arm)
        print(f"=== {name} / {profile.active_arm} "
              f"{'(open session)' if sess else '(no open session)'}")
        print(render(run(None, profile, sess)))
        print()
    print("OK")
