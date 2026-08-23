"""THE blocking question: can SNC and IMU navigation stream together?

Everything about the input design hangs on this one fact, and it has
never been measured — only inferred from a line in Mudra's docs that
groups signals into "mutually exclusive modes" and calls `snc`
"standalone".

Why it decides the architecture
-------------------------------
Kyle's cursor already works. The Mudra Band moves a pointer from its
IMU (arm angle, wrist orientation) and that needs no fingers. What does
not work is the click: every Mudra gesture is defined by finger-pad
conductance, and he has no fingertips.

So Factum only has to replace the click — PROVIDED the band can deliver
raw SNC (for the click) while Mudra's pointer mode is running (for the
cursor).

    BOTH DELIVER    Mudra drives the cursor, Factum fires the click.
                    The intended design. Build it directly.

    ONLY ONE        Factum must supply both. The IMU is in the band
                    either way, so the follow-up question is whether
                    orientation arrives on the SNC stream — if it does,
                    Factum moves the cursor itself and becomes the
                    whole input stack.

There is no "use two bands" fallback: Kyle's right limb is amputated at
the elbow, so there is exactly one forearm. See `anatomy.py`.

TWO QUESTIONS, NOT ONE
----------------------
It is easy to conflate these, and the answers can differ:

  1. SUBSCRIPTION  Within one WebSocket session, does the host let you
                   subscribe to `snc` and `navigation` together and
                   deliver both?

  2. BAND MODE     Does the pointer need the band in ACTIVE? And does
                   ACTIVE kill SNC, as the docs imply?

Getting SNC at all requires STANDBY, so a single run can only ever
answer question 1. Question 2 needs a second run with the band in
ACTIVE — which is the mode Kyle would actually be in while using the
cursor, and therefore the one that decides whether the intended design
is possible at all.

So this test is run TWICE and the results are compared.

The outcome that would be best is one that makes ACTIVE irrelevant: if
`navigation` delivers in STANDBY alongside SNC, then Factum receives
pointer data and click data on the same stream, moves the cursor
itself, and the band never needs to leave STANDBY.

How to run it
-------------
Band on, paired, Mudra Link streaming. Run it once per band mode:

    ..\\.venv\\Scripts\\python.exe coexist_test.py --mode standby
    ..\\.venv\\Scripts\\python.exe coexist_test.py --mode active

Optional third argument is the seconds per phase (default 8).

MOVE YOUR ARM AROUND for the whole run — the IMU signals only appear if
something is actually moving, and a silent `navigation` channel proves
nothing if nobody moved.

Each run subscribes to SNC alone first (a control, so a dead stream is
not mistaken for exclusivity), then adds the pointer signals, then
drops them again. Results are written per mode, and once both exist the
combined verdict is printed. It touches no profile and records no
signal data — only which message types arrived.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import CONFIG  # noqa: E402

# The pointer-mode signals, in the order worth trying. `navigation` is
# the documented pointer stream; the others are the raw inertial
# channels that would let Factum compute a pointer itself if the
# cooked one is unavailable.
POINTER_SIGNALS = ("navigation", "nav_direction", "imu_acc", "imu_gyro",
                   "button", "quaternion", "imu")

PHASE_SECONDS = 8.0


def _connect(url: str):
    import websocket
    ws = websocket.create_connection(url, timeout=5)
    ws.settimeout(0.4)
    return ws


def _drain(ws, seconds: float) -> Counter:
    """Collect message types for a fixed wall-clock window."""
    seen: Counter = Counter()
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            raw = ws.recv()
        except Exception:
            continue
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except Exception:
            seen["<unparseable>"] += 1
            continue
        if isinstance(msg, dict):
            seen[str(msg.get("type", "<no type>"))] += 1
    return seen


def _subscribe(ws, signal: str) -> None:
    ws.send(json.dumps({"command": "subscribe", "signal": signal}))


def run(seconds: float = PHASE_SECONDS, mode: str = "standby") -> Dict[str, Any]:
    urls = CONFIG.ws_candidates()
    ws = None
    used = ""
    for url in urls:
        try:
            ws = _connect(url)
            used = url
            break
        except Exception as exc:
            print(f"  {url} -> {exc}")
    if ws is None:
        return {"ok": False,
                "error": f"Could not open any endpoint: {urls}. "
                         f"Is Mudra Link running with the band connected?"}

    print(f"connected to {used}   (band reported as: {mode.upper()})\n")
    result: Dict[str, Any] = {"ok": True, "url": used, "mode": mode,
                              "phases": {}}

    # --- phase 1: SNC alone. The control.
    print(f"PHASE 1  subscribing to snc alone, {seconds:.0f}s")
    print("         (sit still, this only needs to prove SNC arrives)")
    _subscribe(ws, "snc")
    time.sleep(0.5)
    _drain(ws, 1.0)                     # discard the subscribe handshake
    phase1 = _drain(ws, seconds)
    result["phases"]["snc_alone"] = dict(phase1)
    print(f"         got: {dict(phase1)}\n")

    # --- phase 2: add every pointer signal on top.
    print(f"PHASE 2  adding {', '.join(POINTER_SIGNALS)}, {seconds:.0f}s")
    print("         *** MOVE YOUR ARM AROUND FOR THIS WHOLE PHASE ***")
    for sig in POINTER_SIGNALS:
        _subscribe(ws, sig)
        time.sleep(0.15)
    time.sleep(0.5)
    handshake = _drain(ws, 1.5)         # capture subscription_status replies
    result["phases"]["subscribe_replies"] = dict(handshake)
    phase2 = _drain(ws, seconds)
    result["phases"]["both"] = dict(phase2)
    print(f"         got: {dict(phase2)}\n")

    # --- phase 3: does SNC survive? Drop the pointer signals again.
    print(f"PHASE 3  unsubscribing pointer signals, {seconds:.0f}s")
    for sig in POINTER_SIGNALS:
        try:
            ws.send(json.dumps({"command": "unsubscribe", "signal": sig}))
            time.sleep(0.1)
        except Exception:
            pass
    _drain(ws, 1.0)
    phase3 = _drain(ws, seconds)
    result["phases"]["snc_again"] = dict(phase3)
    print(f"         got: {dict(phase3)}\n")

    try:
        ws.close()
    except Exception:
        pass

    result["verdict"] = _verdict(phase1, phase2, phase3, mode)
    return result


def _verdict(phase1: Counter, phase2: Counter, phase3: Counter,
             mode: str = "standby") -> Dict[str, Any]:
    snc1 = phase1.get("snc", 0)
    snc2 = phase2.get("snc", 0)
    pointer2 = {k: v for k, v in phase2.items()
                if k in POINTER_SIGNALS and v > 0}

    # In ACTIVE the band is expected to keep its sensor data for its own
    # gesture engine, so no SNC is the PREDICTED result rather than a
    # fault. What matters there is whether pointer data still reaches us.
    if mode == "active" and snc1 == 0:
        if pointer2:
            return {
                "answer": "ACTIVE: pointer yes, SNC no (as documented)",
                "detail": f"In ACTIVE, no SNC arrived but "
                          f"{sum(pointer2.values())} pointer frames did "
                          f"({', '.join(sorted(pointer2))}). The band keeps "
                          f"the raw signal for its own engine.",
                "next": "Factum cannot classify a click while the band is "
                        "in ACTIVE. Compare against the STANDBY run: if "
                        "pointer data ALSO arrives in STANDBY, stay in "
                        "STANDBY permanently and let Factum drive both.",
            }
        return {
            "answer": "ACTIVE: nothing reaches us",
            "detail": "In ACTIVE, neither SNC nor pointer data arrived over "
                      "the WebSocket. The band is talking to Mudra's own "
                      "stack and not to us at all.",
            "next": "ACTIVE is unusable for Factum. Everything must work "
                    "from STANDBY — check whether pointer data arrives "
                    "there.",
        }

    if snc1 == 0:
        return {
            "answer": "INCONCLUSIVE",
            "detail": "No SNC arrived even on its own, so nothing can be "
                      "concluded about coexistence. Put the band in "
                      "STANDBY (not ACTIVE — ACTIVE keeps the data for "
                      "Mudra's own gesture engine) and check router-level "
                      "security is not blocking the local stream.",
            "next": "Fix the SNC stream first, then run this again.",
        }

    if snc2 > 0 and pointer2:
        return {
            "answer": "THEY COEXIST",
            "detail": f"With both subscribed, {snc2} SNC frames AND "
                      f"{sum(pointer2.values())} pointer frames "
                      f"({', '.join(sorted(pointer2))}) arrived in the same "
                      f"window.",
            "next": "Build the intended design: Mudra drives the cursor "
                    "from its IMU, Factum classifies SNC and fires the "
                    "click. The cursor layer is unblocked.",
        }

    if snc2 > 0 and not pointer2:
        return {
            "answer": "SNC WINS — no pointer data",
            "detail": f"SNC kept flowing ({snc2} frames) but no pointer "
                      f"signal delivered anything. Either the host refuses "
                      f"them alongside SNC, or nothing moved during phase 2.",
            "next": "Re-run and make sure the arm is moving throughout "
                    "phase 2. If it is still silent, Factum must supply "
                    "the cursor itself — check whether orientation is "
                    "embedded in the SNC frames before assuming it cannot.",
        }

    if snc2 == 0 and pointer2:
        return {
            "answer": "MUTUALLY EXCLUSIVE — pointer displaced SNC",
            "detail": f"Subscribing to the pointer signals stopped SNC "
                      f"({snc1} frames before, 0 after) while "
                      f"{sum(pointer2.values())} pointer frames arrived.",
            "next": "The band cannot do both. Factum must supply the whole "
                    "input stack: read orientation from whatever the SNC "
                    "mode exposes and move the cursor via SendInput, or "
                    "time-slice the two modes.",
        }

    return {
        "answer": "BOTH STOPPED",
        "detail": f"SNC was flowing ({snc1} frames) and then everything "
                  f"stopped once the pointer signals were subscribed.",
        "next": "Subscribing to an unsupported signal probably faulted the "
                "session. Check the subscribe_replies in the report, then "
                "retry with only `navigation`.",
    }


def render(result: Dict[str, Any]) -> str:
    if not result.get("ok"):
        return f"FAILED\n{result.get('error')}"
    v = result["verdict"]
    lines = [
        "=" * 68,
        f"{result.get('mode', 'standby').upper()}: {v['answer']}",
        "=" * 68,
        "",
        v["detail"],
        "",
        f"WHAT THIS MEANS: {v['next']}",
        "",
        "Frames per phase:",
    ]
    for phase, counts in result["phases"].items():
        lines.append(f"  {phase:20} {counts or '(nothing)'}")
    return "\n".join(lines)


# --------------------------------------------------- the combined answer


def _pointer_frames(result: Dict[str, Any]) -> int:
    both = (result.get("phases") or {}).get("both") or {}
    return sum(v for k, v in both.items() if k in POINTER_SIGNALS)


def _snc_frames(result: Dict[str, Any]) -> int:
    both = (result.get("phases") or {}).get("both") or {}
    return int(both.get("snc", 0))


def compare(standby: Dict[str, Any], active: Dict[str, Any]) -> str:
    """The architectural decision, from both runs together.

    This is the output that actually matters. A single run cannot
    distinguish "the host refuses these together" from "the band was in
    the wrong mode", and guessing between those two would send the whole
    input design down the wrong path.
    """
    s_snc, s_ptr = _snc_frames(standby), _pointer_frames(standby)
    a_snc, a_ptr = _snc_frames(active), _pointer_frames(active)

    lines = ["", "=" * 68, "COMBINED VERDICT", "=" * 68, "",
             f"  STANDBY   snc={s_snc:<6} pointer={s_ptr}",
             f"  ACTIVE    snc={a_snc:<6} pointer={a_ptr}", ""]

    if s_snc > 0 and s_ptr > 0:
        lines += [
            "BEST CASE: STANDBY delivers BOTH.",
            "",
            "Stay in STANDBY permanently. Factum receives pointer data and",
            "raw signal on the same stream, moves the cursor itself, and",
            "fires its own click. ACTIVE is irrelevant — Mudra's gesture",
            "engine is never needed, which is the whole point.",
            "",
            "BUILD: cursor from the pointer stream via SendInput, click",
            "from the trained SNC model. One band, one mode, one app.",
        ]
    elif s_snc > 0 and a_ptr > 0:
        lines += [
            "SPLIT: the cursor needs ACTIVE, the click needs STANDBY.",
            "",
            "These are mutually exclusive on one band, so the intended",
            "design (Mudra cursor + Factum click) is NOT possible as-is.",
            "",
            "OPTIONS, best first:",
            "  1. Check whether orientation is embedded in the SNC frames",
            "     themselves — if it is, Factum computes the pointer and",
            "     never needs ACTIVE. Inspect a raw frame before anything",
            "     else; this is the cheapest way out.",
            "  2. Time-slice: hold STANDBY, and switch modes around a",
            "     click. Adds latency and is fragile.",
            "  3. Ask Mudra whether a combined mode exists or is planned.",
        ]
    elif s_snc > 0 and s_ptr == 0 and a_ptr == 0:
        lines += [
            "NO POINTER DATA REACHES US IN EITHER MODE.",
            "",
            "Either nothing moved during phase 2 (re-run and move the arm",
            "throughout), or the host does not expose pointer signals to",
            "third-party clients at all.",
            "",
            "If it is genuinely not exposed, the cursor must come from",
            "Mudra's own app driving the OS directly, and the click must",
            "come from Factum — which requires the two to coexist, which",
            "this says they do not. Inspect a raw SNC frame for embedded",
            "orientation before concluding anything.",
        ]
    else:
        lines += [
            "INCONCLUSIVE — SNC never arrived in STANDBY.",
            "",
            "Nothing can be concluded until the basic stream works. Band",
            "in STANDBY, and check router-level security first (see",
            "RECOVERY.md Step 0).",
        ]
    return "\n".join(lines)


# ====================================================== the direct-BLE test
#
# The WebSocket test above asks whether Mudra Link will forward two
# streams at once. This asks the better question — whether the BAND will
# produce them — with no third-party app in the middle to be the reason
# it fails. It also answers the licence question on the way past, which
# the WebSocket path cannot see at all.


def run_ble(seconds: float = 10.0) -> Dict[str, Any]:
    import mudra_ble

    ok, message = mudra_ble.sdk_available()
    if not ok:
        return {"ok": False, "error": message}

    client = mudra_ble.MudraBleClient(on_log=lambda m: print(f"   {m}"))
    result: Dict[str, Any] = {"ok": True, "mode": "ble", "phases": {}}

    print("Scanning for the band over Bluetooth…")
    print("(close Mudra Link and the phone app — one host at a time)\n")
    client.start()

    # --- wait for a connection
    deadline = time.time() + 30.0
    while time.time() < deadline and not client.band_connected():
        time.sleep(0.5)
    if not client.band_connected():
        client.stop()
        return {"ok": False,
                "error": "No band connected within 30s. Is it on, in range, "
                         "and not held by another app?"}
    print(f"\nConnected: {client.device.get('firmware', '?')} "
          f"battery {client.device.get('battery_pct', '?')}%\n")

    # --- phase 1: raw signal alone. Also the licence answer.
    print(f"PHASE 1  raw signal (SNC) only, {seconds:.0f}s — sit still")
    time.sleep(2.0)                       # let the enable land
    before = client.frames_received
    time.sleep(seconds)
    snc_alone = client.frames_received - before
    result["phases"]["snc_alone"] = {"snc": snc_alone}
    result["licence"] = dict(client.licence)
    print(f"         {snc_alone} SNC frames, "
          f"{client.samples_per_second():.0f} samples/s")
    if client.licence:
        print(f"         licence: raw_lock={client.licence.get('raw_lock')}\n")
    else:
        print("         licence: not reported\n")

    # --- phase 2: add the pointer on top
    print(f"PHASE 2  adding the IMU pointer, {seconds:.0f}s")
    print("         *** MOVE YOUR ARM AROUND FOR THIS WHOLE PHASE ***")
    client.toggle_feature("navigation", True)
    time.sleep(2.0)
    snc_before = client.frames_received
    nav_before = client.navigation_events
    time.sleep(seconds)
    snc_both = client.frames_received - snc_before
    nav_both = client.navigation_events - nav_before
    result["phases"]["both"] = {"snc": snc_both, "navigation": nav_both}
    print(f"         {snc_both} SNC frames, {nav_both} pointer events\n")

    result["verdict"] = _ble_verdict(snc_alone, snc_both, nav_both,
                                     client.licence)
    client.stop()
    return result


def _ble_verdict(snc_alone: int, snc_both: int, nav_both: int,
                 licence: Dict[str, Any]) -> Dict[str, Any]:
    if snc_alone == 0:
        if licence.get("raw_lock"):
            return {
                "answer": "RAW SIGNAL IS LICENCE-LOCKED",
                "detail": "No SNC arrived over direct BLE and the band "
                          "reports raw_lock set. The restriction is in the "
                          "firmware, not in our code.",
                "next": "Use the Mudra Link transport (it holds a licence), "
                        "and ask Wearable Devices about a licence for direct "
                        "access. Everything else in Factum is unaffected.",
            }
        return {
            "answer": "NO RAW SIGNAL, AND NOT THE LICENCE",
            "detail": "No SNC arrived, but the band does not report a raw "
                      "lock. Something else is stopping it.",
            "next": "Check the band is not in a mode that keeps its own "
                    "data, and that nothing else holds the link.",
        }

    if snc_both > 0 and nav_both > 0:
        return {
            "answer": "THEY COEXIST — build the intended design",
            "detail": f"With both enabled, {snc_both} SNC frames AND "
                      f"{nav_both} pointer events arrived in the same "
                      f"window. The band produces both at once.",
            "next": "Set navigation_to_hid so the band drives the cursor "
                    "natively, keep SNC coming here for the click, and "
                    "switch gesture_to_hid off. That is the whole "
                    "objective, and nothing about Mudra's gesture engine "
                    "is needed.",
        }

    if snc_both > 0 and nav_both == 0:
        return {
            "answer": "SNC SURVIVED, NO POINTER DATA",
            "detail": f"SNC kept flowing ({snc_both} frames) but the "
                      f"pointer produced nothing. Either the arm did not "
                      f"move during phase 2, or the pointer needs a "
                      f"firmware target set.",
            "next": "Re-run and keep the arm moving. If still silent, try "
                    "navigation_to_app before concluding the band cannot "
                    "do both.",
        }

    return {
        "answer": "ENABLING THE POINTER STOPPED SNC",
        "detail": f"SNC was flowing ({snc_alone} frames alone) and dropped "
                  f"to {snc_both} once the pointer was enabled, with "
                  f"{nav_both} pointer events.",
        "next": "They are genuinely exclusive on this firmware. Factum must "
                "supply the cursor too — check whether orientation rides "
                "along with the SNC frames before assuming otherwise.",
    }


def render_ble(result: Dict[str, Any]) -> str:
    if not result.get("ok"):
        return f"FAILED\n{result.get('error')}"
    v = result["verdict"]
    lines = ["=" * 68, f"BLE: {v['answer']}", "=" * 68, "",
             v["detail"], "", f"WHAT THIS MEANS: {v['next']}", "",
             "Counts:"]
    for phase, counts in result["phases"].items():
        lines.append(f"  {phase:12} {counts}")
    if result.get("licence"):
        lines.append(f"  licence      {result['licence']}")
    return "\n".join(lines)


def _report_path(mode: str) -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        f"coexist_result_{mode}.json")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    mode = "standby"
    if "--mode" in args:
        i = args.index("--mode")
        if i + 1 < len(args):
            mode = args[i + 1].strip().lower()
        del args[i:i + 2]
    if mode not in ("standby", "active", "ble"):
        print(f"Unknown mode {mode!r}. Use --mode ble, standby, or active.")
        raise SystemExit(2)
    seconds = float(args[0]) if args else PHASE_SECONDS

    # The BLE path needs no Mudra Link and answers the licence question
    # on the way past, so it is its own route through this script.
    if mode == "ble":
        print(__doc__.split("TWO QUESTIONS")[0])
        outcome = run_ble(seconds)
        print(render_ble(outcome))
        with open(_report_path("ble"), "w", encoding="utf-8") as f:
            json.dump(outcome, f, indent=2, sort_keys=True)
        print(f"\nwritten to {_report_path('ble')}")
        raise SystemExit(0 if outcome.get("ok") else 1)

    print(__doc__.split("TWO QUESTIONS")[0])
    print(f"*** Put the band in {mode.upper()} before continuing. ***\n")

    outcome = run(seconds, mode)
    print(render(outcome))

    with open(_report_path(mode), "w", encoding="utf-8") as f:
        json.dump(outcome, f, indent=2, sort_keys=True)
    print(f"\nwritten to {_report_path(mode)}")

    other = "active" if mode == "standby" else "standby"
    if os.path.exists(_report_path(other)):
        with open(_report_path(other), "r", encoding="utf-8") as f:
            previous = json.load(f)
        pair = {mode: outcome, other: previous}
        print(compare(pair["standby"], pair["active"]))
    else:
        print(f"\nNow run it again with the band in {other.upper()}:")
        print(f"    ..\\.venv\\Scripts\\python.exe coexist_test.py "
              f"--mode {other}")
        print("The combined verdict prints once both runs exist.")
