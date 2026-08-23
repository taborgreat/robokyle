"""Standalone SNC probe.

Connects to Mudra Companion on ws://127.0.0.1:8766/events, subscribes
to ONLY snc (matching Factum's exact behaviour), and reports whether
data actually flows.

Usage:
    C:\\Users\\user\\mudra-project\\.venv\\Scripts\\python.exe C:\\Users\\user\\mudra-project\\probe_snc.py [seconds]

Exit codes:
    0  SNC data received (pipeline healthy)
    1  Companion accepts the sub but no SNC frames arrive (band data
       channel dead — the exact failure signature we've been chasing)
    2  Cannot even connect to Companion (server not running / port bound
       by nothing)
    3  Band shows disconnected in device_info
"""
from __future__ import annotations

import json
import sys
import time

import websocket


URL = "ws://127.0.0.1:8766/events"


def main() -> int:
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 12

    try:
        ws = websocket.create_connection(URL, timeout=3)
    except Exception as e:
        print(f"[FAIL] cannot connect to Companion at {URL}")
        print(f"       {type(e).__name__}: {e}")
        print("       -> Companion is not running or not bound to :8766")
        return 2

    print(f"[ok  ] connected to {URL}")

    # Ask for state before subscribing
    ws.send(json.dumps({"command": "get_device_info"}))
    ws.send(json.dumps({"command": "subscribe", "signal": "snc"}))
    ws.settimeout(2)

    device = None
    counts: dict[str, int] = {}
    first_snc_at: float | None = None
    first_snc_batch: int | None = None
    total_samples_ch1 = 0

    started = time.time()
    end = started + duration
    while time.time() < end:
        try:
            raw = ws.recv()
        except Exception:
            continue
        try:
            m = json.loads(raw)
        except Exception:
            continue
        t = m.get("type")
        counts[t] = counts.get(t, 0) + 1
        if t == "device_info" and device is None:
            device = m.get("data") or {}
        if t == "snc":
            if first_snc_at is None:
                first_snc_at = round(time.time() - started, 2)
            vals = (m.get("data") or {}).get("values") or []
            if vals and isinstance(vals[0], list):
                if first_snc_batch is None:
                    first_snc_batch = len(vals[0])
                total_samples_ch1 += len(vals[0])

    ws.close()

    # ---- report ----
    print()
    print("=" * 62)
    print(f"PROBE RESULT after {duration}s")
    print("=" * 62)

    if device:
        print(f"device.state    : {device.get('state')}")
        print(f"device.name     : {device.get('name')}")
        print(f"device.firmware : {device.get('firmware')}")
        print(f"device.battery  : {device.get('battery')}")
        print(f"device.hand     : {device.get('hand')}")
    else:
        print("device_info     : (no reply)")

    print()
    print("message counts:")
    for k in sorted(counts):
        print(f"  {k:22s} {counts[k]:5d}")

    print()
    if first_snc_at is not None:
        fps = counts.get("snc", 0) / duration
        sps = total_samples_ch1 / duration
        print(f"[PASS] SNC IS FLOWING")
        print(f"       first frame at t+{first_snc_at}s")
        print(f"       batch size ch1: {first_snc_batch}")
        print(f"       frame rate    : {fps:.1f} fps")
        print(f"       sample rate   : {sps:.0f} /s")
        return 0

    if device and device.get("state") != "connected":
        print(f"[FAIL] band shows state='{device.get('state')}' — not paired to Companion")
        print("       -> Companion never opened a BLE link to the band this session.")
        return 3

    print("[FAIL] subscribed OK, band shows connected, but ZERO snc frames")
    print("       -> This is the 'control-channel-alive / data-channel-silent' signature.")
    print("       -> Companion has BLE control to the band, but the band's")
    print("          streaming characteristic never turned on. Historically the")
    print("          Mudra Link app is what enables it.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
