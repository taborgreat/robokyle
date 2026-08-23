"""Where a detected signal goes — behind one interface, with interlocks.

The output target is pluggable by design, because the destination is
going to change: local mouse clicks on this PC now, Bluetooth HID to
Kyle's iPhone later (iOS will not let a third-party app inject input,
but it accepts a Bluetooth keyboard as a Switch Control source). None
of the detection code should ever know or care which is attached.

Safety
------
This module can move the mouse of a machine someone is relying on, so
every sink is built to fail closed:

* **Dry run is the default.** A newly constructed router does nothing
  but count and log. Real output requires an explicit `arm()`.
* **Arming expires.** An armed router disarms itself after a timeout,
  so a session that gets abandoned mid-test cannot leave the mouse
  under the band's control indefinitely.
* **A refractory period is enforced here too**, not only in the
  detector — a bug upstream must not be able to produce a click storm.
* **Everything is logged**, fired or suppressed, with the reason.

The rule throughout: it is always better to miss a click than to emit
one nobody asked for.
"""

from __future__ import annotations

import ctypes
import datetime as dt
import sys
import threading
import time
from typing import Any, Callable, Dict, List, Optional

DEFAULT_ARM_TIMEOUT_S = 300.0     # 5 minutes, then it disarms itself
MIN_INTERVAL_S = 0.35             # hard floor between real outputs


def _now() -> str:
    return dt.datetime.now().strftime("%H:%M:%S")


class OutputSink:
    """One destination for a detected signal."""

    key = "base"
    name = "Base sink"
    description = ""
    is_real = False               # True if it affects the outside world

    def fire(self, label: str) -> bool:
        raise NotImplementedError

    def available(self) -> bool:
        return True


class DryRunSink(OutputSink):
    """Counts and reports, touches nothing. The default, deliberately."""

    key = "dry_run"
    name = "Dry run (no clicking)"
    description = ("Detects and reports but never touches the mouse. Use this "
                   "for everything except a deliberate live test.")
    is_real = False

    def fire(self, label: str) -> bool:
        return True


class MouseClickSink(OutputSink):
    """A real left click, via the Win32 SendInput API.

    ctypes rather than a dependency: pynput and friends pull in a lot of
    surface area for what is one struct and one call, and this has to
    keep working on a machine we cannot easily debug remotely.
    """

    key = "mouse_click"
    name = "Left mouse click"
    description = "Sends a real left click to Windows. Affects whatever is "\
                  "under the cursor."
    is_real = True

    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004

    def available(self) -> bool:
        return sys.platform == "win32"

    def fire(self, label: str) -> bool:
        if not self.available():
            return False
        try:
            user32 = ctypes.windll.user32               # type: ignore[attr-defined]
            user32.mouse_event(self.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.01)
            user32.mouse_event(self.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            return True
        except Exception:
            return False


class KeyPressSink(OutputSink):
    """A single keystroke — the path to iOS Switch Control.

    iOS accepts a Bluetooth keyboard as a switch input, so once this PC
    presents itself as a BT HID keyboard, "press space" becomes "advance
    the scanner". Locally it is a normal key press, which makes it
    testable long before any Bluetooth work happens.
    """

    key = "keypress"
    name = "Key press (space)"
    description = "Sends a spacebar press — the same event iOS Switch "\
                  "Control accepts from a Bluetooth keyboard."
    is_real = True

    VK_SPACE = 0x20
    KEYEVENTF_KEYUP = 0x0002

    def available(self) -> bool:
        return sys.platform == "win32"

    def fire(self, label: str) -> bool:
        if not self.available():
            return False
        try:
            user32 = ctypes.windll.user32               # type: ignore[attr-defined]
            user32.keybd_event(self.VK_SPACE, 0, 0, 0)
            time.sleep(0.01)
            user32.keybd_event(self.VK_SPACE, 0, self.KEYEVENTF_KEYUP, 0)
            return True
        except Exception:
            return False


class BluetoothHIDSink(OutputSink):
    """Placeholder for the iPhone path. Declared so the seam exists."""

    key = "bt_hid"
    name = "Bluetooth HID to phone (not built)"
    description = ("Presents this PC to the iPhone as a Bluetooth keyboard, "
                   "so one reliable contraction drives Switch Control. "
                   "Requires a BT HID peripheral stack — not built yet.")
    is_real = True

    def available(self) -> bool:
        return False

    def fire(self, label: str) -> bool:
        return False


SINKS: Dict[str, OutputSink] = {
    s.key: s for s in (DryRunSink(), MouseClickSink(), KeyPressSink(),
                       BluetoothHIDSink())
}


class OutputRouter:
    """Holds the arming state, the interlocks, and the log."""

    def __init__(self, sink_key: str = "dry_run",
                 arm_timeout_s: float = DEFAULT_ARM_TIMEOUT_S,
                 min_interval_s: float = MIN_INTERVAL_S,
                 on_event: Optional[Callable[[Dict[str, Any]], None]] = None) -> None:
        self._lock = threading.Lock()
        self.sink = SINKS.get(sink_key, SINKS["dry_run"])
        self.arm_timeout_s = arm_timeout_s
        self.min_interval_s = min_interval_s
        self.on_event = on_event

        self._armed_until = 0.0
        self._last_fire_ts = 0.0
        self.fired = 0
        self.suppressed = 0
        self.log: List[Dict[str, Any]] = []

    # ------------------------------------------------------------- arming

    @property
    def armed(self) -> bool:
        return time.time() < self._armed_until

    def arm(self, seconds: Optional[float] = None) -> float:
        with self._lock:
            self._armed_until = time.time() + (seconds or self.arm_timeout_s)
        self._record("armed", f"output ARMED -> {self.sink.name}")
        return self._armed_until

    def disarm(self, reason: str = "disarmed by operator") -> None:
        with self._lock:
            self._armed_until = 0.0
        self._record("disarmed", reason)

    def arm_remaining(self) -> float:
        return max(self._armed_until - time.time(), 0.0)

    def set_sink(self, key: str) -> None:
        """Changing the destination always disarms — no silent redirection."""
        with self._lock:
            self.sink = SINKS.get(key, SINKS["dry_run"])
            self._armed_until = 0.0
        self._record("sink", f"output set to {self.sink.name} (disarmed)")

    # ------------------------------------------------------------- firing

    def emit(self, label: str, confidence: float = 0.0) -> Dict[str, Any]:
        """Deliver a detection. Returns what happened and why."""
        now = time.time()
        if now - self._last_fire_ts < self.min_interval_s:
            self.suppressed += 1
            return self._record("suppressed", f"'{label}' within refractory "
                                              f"({self.min_interval_s}s)",
                                label=label, confidence=confidence)

        if not self.sink.is_real:
            self._last_fire_ts = now
            self.fired += 1
            return self._record("dry_run", f"'{label}' would have fired "
                                           f"{self.sink.name}",
                                label=label, confidence=confidence)

        if not self.armed:
            self.suppressed += 1
            return self._record("blocked", f"'{label}' detected but output is "
                                           f"NOT ARMED",
                                label=label, confidence=confidence)

        if not self.sink.available():
            self.suppressed += 1
            return self._record("unavailable",
                                f"{self.sink.name} is not available here",
                                label=label, confidence=confidence)

        ok = self.sink.fire(label)
        self._last_fire_ts = now
        if ok:
            self.fired += 1
            return self._record("fired", f"'{label}' -> {self.sink.name}",
                                label=label, confidence=confidence)
        self.suppressed += 1
        return self._record("failed", f"'{label}' -> {self.sink.name} FAILED",
                            label=label, confidence=confidence)

    # -------------------------------------------------------------- log

    def _record(self, kind: str, message: str, label: str = "",
                confidence: float = 0.0) -> Dict[str, Any]:
        event = {"ts": time.time(), "time": _now(), "kind": kind,
                 "message": message, "label": label,
                 "confidence": round(float(confidence), 3)}
        self.log.append(event)
        del self.log[:-200]
        if self.on_event is not None:
            try:
                self.on_event(event)
            except Exception:
                pass
        return event

    def stats(self) -> Dict[str, Any]:
        return {
            "sink": self.sink.name,
            "is_real": self.sink.is_real,
            "armed": self.armed,
            "arm_remaining_s": round(self.arm_remaining(), 1),
            "fired": self.fired,
            "suppressed": self.suppressed,
        }


if __name__ == "__main__":
    print("available sinks:")
    for key, sink in SINKS.items():
        print(f"  {key:12} {sink.name:34} real={str(sink.is_real):5} "
              f"available={sink.available()}")

    def settle():
        """Wait out the refractory so each branch is genuinely exercised."""
        time.sleep(MIN_INTERVAL_S + 0.05)

    failures = []

    def check(label, event, expected_kind):
        ok = event["kind"] == expected_kind
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}: {event['message']}")
        if not ok:
            failures.append(f"{label}: expected {expected_kind}, got {event['kind']}")

    print("\n-- dry run is the default and touches nothing --")
    router = OutputRouter()
    check("first detection", router.emit("curl index", 0.99), "dry_run")
    check("immediate repeat is suppressed",
          router.emit("curl index", 0.99), "suppressed")

    print("\n-- a real sink refuses to fire until armed --")
    router.set_sink("mouse_click")
    settle()
    check("unarmed real sink is BLOCKED",
          router.emit("curl index", 0.99), "blocked")

    print("\n-- arming expires by itself --")
    router.arm(0.5)
    print(f"  armed: {router.armed} ({router.arm_remaining():.1f}s left)")
    time.sleep(0.7)
    print(f"  after 0.7s -> armed: {router.armed}")
    if router.armed:
        failures.append("arming did not expire")
    settle()
    check("expired arming BLOCKS", router.emit("curl index", 0.99), "blocked")

    print("\n-- changing the sink always disarms --")
    router.arm(60)
    router.set_sink("keypress")
    print(f"  armed after switching sink: {router.armed}")
    if router.armed:
        failures.append("changing sink left the router armed")
    settle()
    check("still blocked after switch", router.emit("curl index", 0.99), "blocked")

    print("\nstats:", router.stats())
    print("\nNOTE: no real click or keystroke was ever emitted — every real "
          "sink was blocked by an interlock, which is the point.")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print("  -", f)
        raise SystemExit(1)
    print("\nALL INTERLOCKS HELD")
