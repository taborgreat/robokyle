"""Direct BLE transport — Factum talks to the band itself.

Until now Factum was a guest in someone else's process: a WebSocket
client to a server that Mudra Link or Companion happened to be running.
If Link was closed, in the wrong mode, or changed its protocol, Factum
was dead — and the thing it exists to do was hostage to an app whose
gestures its user cannot perform.

This module removes that dependency. It uses the **official Mudra
Python SDK** (`mudra_sdk`, Wearable Devices) which talks to the band
over BLE via `bleak` and a native `MudraSDK.dll`. No Link. No Companion.

Interface parity
----------------
Every public method here mirrors `mudra_client.MudraClient`, so `app.py`
neither knows nor cares which transport is live:

    start/stop, wait_connected, snapshot, tail, latest_rms, clear,
    frames_per_second, samples_per_second, band_connected,
    receiving_data, signal_state, state_message, troubleshooting_causes,
    known_good_sequence

Plus what only direct BLE can offer: `scan()`, `connect()`,
`disconnect()`, per-feature toggles, licence state, and the firmware
targets that let the band drive the OS cursor by itself.

Threading
---------
The SDK is asyncio; tkinter is not. So an event loop runs on a daemon
thread and coroutines are posted to it with
`asyncio.run_coroutine_threadsafe`. Every callback from the SDK arrives
on that thread, so the sample buffer is lock-protected exactly as the
WebSocket client's is, and nothing here touches a tkinter widget.

Why the two data types matter
-----------------------------
`FirmwareDataType` values are INDEPENDENT enable flags, not the mutually
exclusive modes the Companion WebSocket docs implied:

    snc         = 0     raw signal — what Factum classifies into a click
    navigation  = 5     IMU pointer — the cursor Kyle already can use

and `FirmwareTarget.navigation_to_hid` makes the band act as a standard
HID mouse, moving the cursor with no code and no latency on any host.
So the target configuration is:

    navigation_to_hid  ON   cursor works natively
    snc                ON   raw signal streams here for the click
    gesture_to_hid     OFF  kills Mudra's finger-conductance click,
                            which Kyle cannot produce anyway

Licence
-------
`LicenseInfo` carries a `raw_lock` that very likely gates raw SNC, and
enforcement lives in the firmware rather than in this Python. If the
band refuses raw data over direct BLE, `licence_blocks_raw()` says so
and the app falls back to the WebSocket transport rather than pretending
to work.
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

import numpy as np

from config import CONFIG

# How long to let the ordinary scan run before falling back to a direct
# probe of the last known address. Long enough that a band which IS
# advertising is found the normal way first.
SCAN_BEFORE_DIRECT_S = 6.0

# The state vocabulary is shared with the WebSocket client so the UI has
# exactly one set of states to reason about.
from mudra_client import (
    STATE_ALREADY_IN_USE,
    STATE_CONNECTING,
    STATE_LIVE,
    STATE_NO_BAND,
    STATE_NO_SNC,
    STATE_NO_WS,
)

CHANNELS = 3
DEFAULT_BUFFER_SECONDS = 60.0
NOMINAL_FS = 840

# How long after connecting we forgive silence before calling it a fault.
GRACE_SECONDS = 4.0

# Bluetooth is not the network, so the ordering of likely causes differs
# from the WebSocket client's — no router, no port, no rival process
# holding a socket. It is adapter, range, pairing and battery.
_CAUSES_NO_ADAPTER = [
    ("Bluetooth is off, or the adapter is missing",
     "Turn Bluetooth on in Windows Settings. Factum talks to the band "
     "directly now — there is no Mudra Link in the middle to blame."),
]


def sdk_available() -> Tuple[bool, str]:
    """Is the official SDK importable and is its native library loadable?

    Returns (ok, message). Checked before anything else so a missing
    dependency reads as a plain sentence rather than a stack trace in
    the middle of a session.
    """
    try:
        import mudra_sdk  # noqa: F401
        from mudra_sdk import Mudra
    except Exception as exc:
        return False, (f"The Mudra SDK is not installed ({exc}). "
                       f"Install it with:  pip install mudra-sdk")
    try:
        if Mudra().get_native_library() is None:
            return False, ("The Mudra SDK is installed but its native "
                           "library did not load. On Windows this needs "
                           "the 64-bit build.")
    except Exception as exc:
        return False, f"The Mudra SDK failed to initialise: {exc}"
    return True, "Mudra SDK ready."


SNC_CHARACTERISTIC_UUID = "0000fff4-0000-1000-8000-00805f9b34fb"
IMU_CHARACTERISTIC_UUID = "0000fff5-0000-1000-8000-00805f9b34fb"

# Characteristics the licence gates, by what they carry.
LOCKED_CHARACTERISTICS = {
    SNC_CHARACTERISTIC_UUID: "Raw signal (SNC)",
    IMU_CHARACTERISTIC_UUID: "IMU",
}

_SDK_PATCHED = False


def _is_auth_error(exc: Exception) -> bool:
    """Is this BLE's "you are not licensed for this" refusal?

    GATT error 5 is Insufficient Authentication. Bleak surfaces it as a
    tuple on Windows and as text elsewhere, so match on both rather than
    on one platform's shape.
    """
    if isinstance(getattr(exc, "args", None), tuple) and exc.args:
        if exc.args[0] == 5:
            return True
    text = str(exc).lower()
    return "insufficient authentication" in text or "error: 5" in text


def _char_name(char_uuid: Any) -> str:
    return LOCKED_CHARACTERISTICS.get(str(char_uuid).lower(),
                                      str(char_uuid))


def _patch_sdk_init_ordering(log=None) -> None:
    """Stop one locked characteristic from killing the whole connection.

    `BleService.init_ble_services` subscribes to every characteristic in
    turn and does this on any failure:

        except Exception as e:
            print(f"Failed to subscribe/read {char.uuid}: {e}")
            return False        # <- aborts the ENTIRE initialisation

    The caller then disconnects. On an unlicensed band the raw-signal
    characteristic refuses subscription with GATT error 5, so the SDK
    tears the connection down — and the licence handshake that would
    have unlocked it (security number -> Mudra's cloud -> set_license)
    never gets the chance to run. It needs the licence to subscribe, and
    it destroys the connection that would obtain the licence.

    This makes that one subscription non-fatal, and nothing else. The
    band's licence check is untouched: raw data still does not flow
    until Mudra's own cloud issues a token and the firmware accepts it.
    All this buys is a connection that survives long enough for that
    exchange to happen. `retry_snc_subscription()` then asks again once
    it has.
    """
    global _SDK_PATCHED
    if _SDK_PATCHED:
        return
    try:
        from mudra_sdk.service import ble_service as ble_mod
    except Exception:
        return

    original = ble_mod.BleService.init_ble_services

    async def patched(self, device, services):
        client = getattr(device, "client", None)
        if client is None or not hasattr(client, "start_notify"):
            return await original(self, device, services)

        real_start_notify = client.start_notify

        async def tolerant_start_notify(char_uuid, callback, **kwargs):
            try:
                return await real_start_notify(char_uuid, callback, **kwargs)
            except Exception as exc:
                # Any characteristic the licence gates, not just SNC.
                # The first version of this tolerated only the raw-signal
                # characteristic and the connection still died — because
                # the IMU characteristic (fff5) is locked in exactly the
                # same way, and aborted initialisation two lines later.
                # The general rule is the right one: while the handshake
                # has not run, EVERY authentication refusal is expected
                # and none of them should be fatal.
                if _is_auth_error(exc):
                    if log:
                        log(f"{_char_name(char_uuid)} is locked pending a "
                            f"licence. Keeping the connection open.")
                    return None
                raise

        client.start_notify = tolerant_start_notify
        try:
            return await original(self, device, services)
        finally:
            client.start_notify = real_start_notify

    ble_mod.BleService.init_ble_services = patched
    _SDK_PATCHED = True
    if log:
        log("Patched SDK so a locked characteristic cannot abort the "
            "connection.")


class DiscoveredBand:
    """One band seen while scanning, in terms the UI can show."""

    def __init__(self, device: Any) -> None:
        self.device = device
        self.address = getattr(getattr(device, "ble_device", device),
                               "address", "") or ""
        self.name = (getattr(getattr(device, "ble_device", device), "name", "")
                     or "Mudra Band")
        self.rssi = getattr(getattr(device, "ble_device", device), "rssi", None)
        self.first_seen = time.time()

    def label(self) -> str:
        bits = [self.name]
        if self.rssi is not None:
            bits.append(f"{self.rssi} dBm")
        bits.append(self.address)
        return "   ·   ".join(b for b in bits if b)


class MudraBleClient:
    """Interface-compatible replacement for MudraClient, over direct BLE."""

    def __init__(self, buffer_seconds: float = DEFAULT_BUFFER_SECONDS,
                 on_log: Optional[Callable[[str], None]] = None,
                 auto_connect: bool = True) -> None:
        self.transport = "ble"
        self._on_log = on_log
        self.auto_connect = auto_connect

        maxlen = int(buffer_seconds * NOMINAL_FS)
        self._lock = threading.Lock()
        self._buf: List[Deque[float]] = [deque(maxlen=maxlen)
                                         for _ in range(CHANNELS)]

        # Counters, mirroring the WebSocket client so the diagnostics
        # panel needs no special cases.
        self.frames_received = 0
        self.samples_received = 0
        self._frame_times: Deque[Tuple[float, int]] = deque(maxlen=400)
        self.last_frame_at: float = 0.0
        self.connected_at: float = 0.0
        self.last_error: str = ""

        # Device metadata, same shape the WebSocket status message used.
        self.device: Dict[str, Any] = {}
        self.licence: Dict[str, Any] = {}
        self.reported_frequency: float = 0.0
        self.navigation_events = 0
        self.last_navigation_at: float = 0.0

        self.discovered: Dict[str, DiscoveredBand] = {}
        self.on_discovered: Optional[Callable[[], None]] = None
        self.on_state_changed: Optional[Callable[[], None]] = None
        self.on_navigation: Optional[Callable[[int, int], None]] = None

        self._mudra = None
        self._device = None            # the connected MudraDevice
        self._connecting = False
        self._scanning = False
        self._features: Dict[str, bool] = {}

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._stopping = False

    # ------------------------------------------------------------- logging

    def _log(self, msg: str) -> None:
        if self._on_log:
            try:
                self._on_log(msg)
            except Exception:
                pass

    def _notify(self) -> None:
        if self.on_state_changed:
            try:
                self.on_state_changed()
            except Exception:
                pass

    # ------------------------------------------------------- loop plumbing

    def start(self) -> None:
        """Spin up the event loop thread and begin scanning."""
        ok, message = sdk_available()
        if not ok:
            self.last_error = message
            self._log(message)
            return
        if self._thread and self._thread.is_alive():
            return
        self._stopping = False
        self._thread = threading.Thread(target=self._run_loop, daemon=True,
                                        name="mudra-ble")
        self._thread.start()
        # Wait briefly for the loop so an immediate submit() does not race.
        for _ in range(50):
            if self._loop is not None:
                break
            time.sleep(0.02)
        self.submit(self._boot())

    def stop(self) -> None:
        self._stopping = True
        loop = self._loop
        if loop is not None and loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self._shutdown(), loop)
                time.sleep(0.3)
            except Exception:
                pass
            loop.call_soon_threadsafe(loop.stop)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        self._loop = None

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        try:
            loop.run_forever()
        finally:
            try:
                loop.close()
            except Exception:
                pass

    def submit(self, coro) -> Optional[Any]:
        """Post a coroutine to the loop thread. Never raises at the caller."""
        loop = self._loop
        if loop is None or not loop.is_running():
            self._log("BLE loop is not running; command dropped.")
            return None
        future = asyncio.run_coroutine_threadsafe(coro, loop)

        def _done(f) -> None:
            exc = f.exception()
            if exc is not None:
                self.last_error = str(exc)
                self._log(f"BLE command failed: {exc}")
            self._notify()

        future.add_done_callback(_done)
        return future

    # ------------------------------------------------------------ lifecycle

    async def _boot(self) -> None:
        from mudra_sdk import Mudra

        _patch_sdk_init_ordering(self._log)
        self._mudra = Mudra()
        self._mudra.set_delegate(_Delegate(self))
        self._log("Mudra SDK initialised — scanning for bands.")
        await self._start_scan()

    async def retry_snc_subscription(self) -> Dict[str, Any]:
        """Subscribe to the raw-signal characteristic after licensing.

        The SDK only ever subscribes during service discovery, which
        happens before the licence handshake can complete — so once a
        licence IS applied there is nothing that goes back and tries
        again. This does.
        """
        device = self._device
        if device is None:
            return {"ok": False, "message": "No band connected."}
        client = getattr(getattr(device, "ble_device", device), "client", None)
        client = client or getattr(device, "client", None)
        if client is None:
            return {"ok": False, "message": "No BLE client on the device."}
        try:
            from mudra_sdk.models.enums import MudraCharacteristicUUID
            uuid = MudraCharacteristicUUID.SNC_CHARACTERISTIC.value
        except Exception:
            uuid = SNC_CHARACTERISTIC_UUID
        try:
            await client.start_notify(
                uuid,
                lambda _sender, data: device.handle_snc(bytes(data)))
        except Exception as exc:
            return {"ok": False,
                    "message": f"Still refused ({exc}). The licence has not "
                               f"been applied to this band."}
        self._log("Raw signal subscription accepted.")
        return {"ok": True, "message": "Raw signal is now subscribed."}

    async def _shutdown(self) -> None:
        try:
            if self._device is not None:
                await self._device.disconnect()
        except Exception:
            pass
        try:
            if self._mudra is not None:
                await self._mudra.stop_scan()
        except Exception:
            pass

    async def _start_scan(self) -> None:
        if self._mudra is None or self._scanning:
            return
        self._scanning = True
        self._notify()
        try:
            await self._mudra.scan()
        except Exception as exc:
            self._scanning = False
            self.last_error = str(exc)
            self._log(f"Scan failed: {exc}")
            self._notify()
            return
        # The SDK only recognises a band whose advertised NAME contains
        # "Mudra". A band already bonded to Windows often advertises
        # nothing at all, so scanning alone can never find it. Remember
        # the address that worked last time and check for it directly.
        asyncio.create_task(self._probe_known_address())

    async def _probe_known_address(self) -> None:
        """Look for a previously-paired band that is not advertising."""
        address = str(CONFIG.get("last_band_address") or "").strip()
        if not address or self.band_connected():
            return
        await asyncio.sleep(SCAN_BEFORE_DIRECT_S)
        if self.band_connected() or self.discovered:
            return
        try:
            from bleak import BleakScanner
            found = await BleakScanner.find_device_by_address(address,
                                                              timeout=8.0)
        except Exception as exc:
            self._log(f"Direct address probe failed: {exc}")
            return
        if found is None:
            self._log(f"The band paired to this machine ({address}) is not "
                      f"responding. It is powered off, asleep, or connected "
                      f"to a phone.")
            return
        self._log(f"Found the paired band at {address} without advertising.")
        # Hand it to the SDK rather than stashing the raw bleak device:
        # `Mudra.on_device_discovered` wraps it in a MudraDevice (the only
        # object that knows the Mudra handshake) and calls our delegate,
        # so this path ends up identical to an ordinary discovery.
        try:
            self._mudra.on_device_discovered(found)
        except Exception as exc:
            self._log(f"Could not adopt the paired band: {exc}")

    async def _stop_scan(self) -> None:
        if self._mudra is None:
            return
        try:
            await self._mudra.stop_scan()
        finally:
            self._scanning = False
            self._notify()

    def scan(self) -> None:
        self.submit(self._start_scan())

    def stop_scan(self) -> None:
        self.submit(self._stop_scan())

    def connect(self, address: str) -> None:
        band = self.discovered.get(address)
        if band is None:
            self._log(f"No band discovered at {address}.")
            return
        self.submit(self._connect(band.device))

    async def _connect(self, device: Any) -> None:
        self._connecting = True
        self._notify()
        try:
            await self._stop_scan()
            await self._ensure_bonded(device)
            await device.connect()
        except Exception as exc:
            self._connecting = False
            self.last_error = str(exc)
            self._log(f"Connect failed: {exc}")
            self._notify()

    async def _ensure_bonded(self, device: Any) -> None:
        """Deliberately does nothing. Kept as the record of a wrong turn.

        Subscribing to the SNC characteristic (0000fff4) over direct BLE
        fails with GATT error 5, "Insufficient Authentication", so the
        obvious reading was that the link merely needed bonding. An
        earlier version of this method opened its own BleakClient,
        called pair(), and closed it before handing the device to the
        SDK.

        That made things worse, and the failure was instructive: closing
        that client dropped the link, the band powered its LED down and
        went idle, and the SDK's own connect then died part-way through
        service discovery with "Not connected". Pairing on a connection
        you are about to throw away is not pairing for the connection
        that matters.

        It was also treating the wrong cause. Mudra's own documentation
        is explicit that raw SNC access carries a licence requirement
        ("Requirements: License - RawData"), which is what `raw_lock` in
        LicenseInfo reports and what the `waiting_for_security_number`
        state machine exists to satisfy. No amount of bonding substitutes
        for a licence the firmware is waiting on.

        If a licence is obtained and GATT error 5 persists, pair on the
        SDK's OWN client rather than a separate one — see
        `ble_service.py`, the try/except around `start_notify`.
        """
        return

    def disconnect(self) -> None:
        if self._device is not None:
            self.submit(self._device.disconnect())

    def force_reconnect(self) -> None:
        """Drop the link and start looking again.

        Same contract as the WebSocket client's, so the Repair button in
        the UI does not care which transport is live.
        """
        self._log("Repairing: dropping the band link and rescanning.")
        self.discovered.clear()
        if self._device is not None:
            self.submit(self._device.disconnect())
        else:
            self.submit(self._start_scan())

    # ------------------------------------------- what happens once connected

    async def _on_connected(self, device: Any) -> None:
        """Configure the band the way this project needs it."""
        self._device = device
        self._connecting = False
        self.connected_at = time.time()
        self._log("Band connected. Enabling raw signal.")
        # Remember which band this machine actually uses, so a future
        # launch can find it even when it is bonded to Windows and no
        # longer advertising.
        address = getattr(getattr(device, "ble_device", device), "address", "")
        if address:
            try:
                CONFIG.set("last_band_address", address)
            except Exception:
                pass

        # Raw SNC is the whole point — enable it first so a licence
        # refusal surfaces immediately rather than after other setup.
        await self.set_feature("snc", True)

        # Battery and charge state are free and the UI shows them.
        try:
            await device.set_on_battery_level_changed(self._on_battery)
            await device.set_on_charging_state_changed(self._on_charging)
        except Exception as exc:
            self._log(f"Could not subscribe to battery: {exc}")

        try:
            await device.request_for_license_status()
        except Exception:
            pass

        self._refresh_device_info()
        self._notify()

    # ---------------------------------------------------------- the feature

    # Maps our stable names onto the SDK's setter methods. Kept as a
    # table rather than a chain of ifs so the Band tab can render the
    # toggles straight from it.
    FEATURES = {
        "snc":        ("set_on_snc_ready",        "Raw signal (SNC)"),
        "navigation": ("set_on_navigation_axis_ready", "Pointer (IMU navigation)"),
        "imu_acc":    ("set_on_imu_acc_ready",    "IMU accelerometer"),
        "imu_gyro":   ("set_on_imu_gyro_ready",   "IMU gyroscope"),
        "gesture":    ("set_on_gesture_ready",    "Mudra's own gestures"),
        "button":     ("set_on_button_changed",   "Air-mouse button"),
    }

    async def set_feature(self, name: str, enable: bool) -> None:
        """Enable or disable one data type. These are independent flags."""
        device = self._device
        if device is None or name not in self.FEATURES:
            return
        setter_name, _label = self.FEATURES[name]
        setter = getattr(device, setter_name, None)
        if setter is None:
            self._log(f"SDK has no {setter_name}")
            return
        handler = {
            "snc":        self._on_snc,
            "navigation": self._on_navigation_axis,
            "imu_acc":    self._on_imu_acc,
            "imu_gyro":   self._on_imu_gyro,
            "gesture":    self._on_gesture,
            "button":     self._on_button,
        }.get(name)
        await setter(handler if enable else None)
        self._features[name] = enable
        self._log(f"{self.FEATURES[name][1]}: {'on' if enable else 'off'}")
        self._notify()

    def toggle_feature(self, name: str, enable: bool) -> None:
        self.submit(self.set_feature(name, enable))

    def feature_enabled(self, name: str) -> bool:
        return bool(self._features.get(name))

    async def set_target(self, target_name: str, active: bool) -> None:
        """Firmware routing: does the band drive the OS directly?

        `navigation_to_hid` is the one that matters — with it on, the
        band is a standard HID mouse and the cursor works on any host
        with no code at all, which is exactly what Kyle needs while
        Factum supplies the click from SNC.
        """
        from mudra_sdk.models.enums import FirmwareTarget

        device = self._device
        if device is None:
            return
        target = getattr(FirmwareTarget, target_name, None)
        if target is None:
            self._log(f"Unknown firmware target {target_name}")
            return
        await device.set_firmware_target(target, active)
        self._features[f"target:{target_name}"] = active
        self._log(f"{target_name}: {'on' if active else 'off'}")
        self._notify()

    def toggle_target(self, target_name: str, active: bool) -> None:
        self.submit(self.set_target(target_name, active))

    def target_active(self, target_name: str) -> bool:
        return bool(self._features.get(f"target:{target_name}"))

    async def apply_factum_defaults(self) -> None:
        """The configuration this project actually wants.

        Cursor from the band's own HID pointer; raw signal to us for the
        click; Mudra's finger-conductance gestures switched off at the
        firmware, because they are the thing the user cannot perform.
        """
        await self.set_feature("snc", True)
        await self.set_target("navigation_to_hid", True)
        await self.set_target("gesture_to_hid", False)
        self._log("Applied Factum defaults: HID cursor on, raw signal on, "
                  "Mudra gestures off.")

    def use_factum_defaults(self) -> None:
        self.submit(self.apply_factum_defaults())

    # ------------------------------------------------------------ callbacks

    def _on_snc(self, timestamp: int, data: List[float], frequency: int,
                frequency_std: float, rms: List[float]) -> None:
        """Raw signal from the native layer. Runs on the loop thread."""
        if not data:
            return
        n = len(data) // CHANNELS
        if n <= 0:
            return
        # The native layer hands back one flat list per batch. Three
        # channels, interleaved — reshape rather than assume a stride.
        try:
            block = np.asarray(data, dtype=np.float32)[: n * CHANNELS]
            block = block.reshape(n, CHANNELS).T
        except Exception:
            return

        now = time.time()
        with self._lock:
            for ch in range(CHANNELS):
                self._buf[ch].extend(block[ch].tolist())
            self.frames_received += 1
            self.samples_received += n
            self._frame_times.append((now, n))
            self.last_frame_at = now
            if frequency:
                self.reported_frequency = float(frequency)

    def _on_navigation_axis(self, delta_x: int, delta_y: int) -> None:
        # Counted, not just forwarded: "did pointer data arrive at all
        # while raw signal was also flowing" is the question the whole
        # input design hangs on, and it needs a number.
        self.navigation_events += 1
        self.last_navigation_at = time.time()
        if self.on_navigation:
            try:
                self.on_navigation(delta_x, delta_y)
            except Exception:
                pass

    def _on_imu_acc(self, *_a) -> None:
        pass

    def _on_imu_gyro(self, *_a) -> None:
        pass

    def _on_gesture(self, gesture_type) -> None:
        self._log(f"Mudra gesture fired: {gesture_type}")

    def _on_button(self, button) -> None:
        self._log(f"Air-mouse button: {button}")

    def _on_battery(self, level: int) -> None:
        self.device["battery_pct"] = level
        self._notify()

    def _on_charging(self, is_charging: bool) -> None:
        self.device["on_charger"] = bool(is_charging)
        self._notify()

    def _refresh_device_info(self) -> None:
        device = self._device
        if device is None:
            return
        for key, getter in (("battery_pct", "get_battery_level"),
                            ("firmware", "get_firmware_version"),
                            ("serial", "get_serial_number"),
                            ("on_charger", "get_is_charging")):
            try:
                value = getattr(device, getter)()
                if value is not None:
                    self.device[key] = value
            except Exception:
                pass
        try:
            hand = device.get_hand_type()
            if hand is not None:
                self.device["hand"] = getattr(hand, "name", str(hand))
        except Exception:
            pass
        try:
            sample = device.get_sample_type()
            if sample is not None:
                self.device["sample_type"] = getattr(sample, "name", str(sample))
        except Exception:
            pass
        self.device["state"] = "connected"

    def note_licence(self, info: Any) -> None:
        self.licence = {
            "system_lock": bool(getattr(info, "system_lock", False)),
            "feature_lock": bool(getattr(info, "feature_lock", False)),
            "raw_lock": bool(getattr(info, "raw_lock", False)),
            "seen_at": time.time(),
        }
        self._log(f"Licence: system={self.licence['system_lock']} "
                  f"feature={self.licence['feature_lock']} "
                  f"raw={self.licence['raw_lock']}")
        self._notify()

    # The licence handshake, which the Python SDK ships but never calls.
    #
    # Mudra's docs state raw SNC needs a "RawData" licence. The flow is:
    # the band emits a security number, that goes to Mudra's cloud, the
    # cloud returns a signed token, and the token goes back to the band
    # via set_license(). `mudra_sdk.cloud.mudra_server_client` has
    # `send_security_number_api_call` for the middle step — and nothing
    # in the SDK calls it. So the wiring is left here, ready, behind an
    # explicit call rather than running on its own: it talks to a
    # third-party cloud and that should never be a side effect of
    # plugging in a band.
    async def redeem_licence(self) -> Dict[str, Any]:
        """Exchange the band's security number for a licence token."""
        device = self._device
        if device is None:
            return {"ok": False, "message": "No band connected."}
        try:
            from mudra_sdk.cloud.mudra_server_client import MudraServerClient
        except Exception as exc:
            return {"ok": False,
                    "message": f"SDK cloud client unavailable: {exc}"}

        security_number = getattr(device, "_security_number", None)
        if security_number is None:
            try:
                await device.get_security_number()
                await asyncio.sleep(2.0)
                security_number = getattr(device, "_security_number", None)
            except Exception as exc:
                return {"ok": False,
                        "message": f"Could not read the security number: {exc}"}
        if security_number is None:
            return {"ok": False,
                    "message": "The band did not report a security number."}

        try:
            token = MudraServerClient().send_security_number_api_call(
                int(security_number))
        except Exception as exc:
            return {"ok": False, "message": f"Licence request failed: {exc}"}
        if not token:
            return {"ok": False,
                    "message": "Mudra's server returned no token. The account "
                               "this machine is signed into probably has no "
                               "RawData licence."}
        try:
            await device.set_license(token)
        except Exception as exc:
            return {"ok": False, "message": f"Band rejected the licence: {exc}"}
        self._log("Licence token accepted by the band.")
        return {"ok": True, "message": "Licence applied. Re-enable raw signal."}

    def licence_blocks_raw(self) -> bool:
        """Raw signal locked AND nothing arriving — the real failure case.

        A set `raw_lock` on its own is not proof: the flag's meaning is
        the firmware's business and frames are the ground truth. Only
        claim the licence is the problem when data is genuinely absent.
        """
        if not self.licence.get("raw_lock"):
            return False
        return self.frames_received == 0 and self._past_grace()

    # --------------------------------------------------------- buffer reads

    def snapshot(self, seconds: float) -> np.ndarray:
        return self.tail(int(seconds * max(self.samples_per_second(), 1.0)))

    def tail(self, n: int) -> np.ndarray:
        if n <= 0:
            return np.zeros((CHANNELS, 0), dtype=np.float32)
        with self._lock:
            available = min(n, len(self._buf[0]))
            if available <= 0:
                return np.zeros((CHANNELS, 0), dtype=np.float32)
            out = np.empty((CHANNELS, available), dtype=np.float32)
            for ch in range(CHANNELS):
                buf = self._buf[ch]
                start = len(buf) - available
                for i, idx in enumerate(range(start, len(buf))):
                    out[ch, i] = buf[idx]
        return out

    def latest_rms(self, seconds: float) -> np.ndarray:
        block = self.snapshot(seconds)
        if block.shape[1] == 0:
            return np.zeros(CHANNELS, dtype=np.float32)
        ac = block - block.mean(axis=1, keepdims=True)
        return np.sqrt(np.mean(ac * ac, axis=1))

    def clear(self) -> None:
        with self._lock:
            for buf in self._buf:
                buf.clear()

    # ------------------------------------------------------------ telemetry

    def frames_per_second(self, window_seconds: float = 1.0) -> float:
        now = time.time()
        with self._lock:
            recent = [t for t, _n in self._frame_times
                      if now - t <= window_seconds]
        return len(recent) / window_seconds if recent else 0.0

    def samples_per_second(self, window_seconds: float = 1.0) -> float:
        """Measured from arrivals; the firmware's own figure is a fallback.

        The native layer reports a `frequency` per batch, which is more
        authoritative than counting arrivals — but it is only as fresh
        as the last batch, so a measured value wins while data flows.
        """
        now = time.time()
        with self._lock:
            recent = [(t, n) for t, n in self._frame_times
                      if now - t <= window_seconds]
            reported = self.reported_frequency
        if recent:
            total = sum(n for _t, n in recent)
            if total > 0:
                return total / window_seconds
        return reported

    def wait_connected(self, timeout: float = 3.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.band_connected():
                return True
            time.sleep(0.05)
        return self.band_connected()

    def band_connected(self) -> bool:
        return self._device is not None

    def receiving_data(self) -> bool:
        return (time.time() - self.last_frame_at) < 2.0 if self.last_frame_at else False

    def _past_grace(self) -> bool:
        if not self.connected_at:
            return False
        return (time.time() - self.connected_at) > GRACE_SECONDS

    def signal_state(self) -> str:
        # Frames are ground truth: if data is arriving, we are live no
        # matter what any metadata claims. Same rule as the WebSocket
        # client, and it exists because device metadata lied.
        if self.receiving_data():
            return STATE_LIVE
        if self._loop is None or not (self._thread and self._thread.is_alive()):
            return STATE_NO_WS
        if not self.band_connected():
            return STATE_CONNECTING if self._connecting else STATE_NO_BAND
        if not self._past_grace():
            return STATE_CONNECTING
        if self.licence_blocks_raw():
            return STATE_ALREADY_IN_USE
        return STATE_NO_SNC

    def state_message(self) -> str:
        state = self.signal_state()
        if state == STATE_LIVE:
            return (f"Live over Bluetooth — {self.samples_per_second():.0f} "
                    f"samples/s, no Mudra Link needed.")
        if state == STATE_NO_WS:
            return self.last_error or ("Bluetooth transport is not running.")
        if state == STATE_NO_BAND:
            if self._scanning:
                return ("Scanning for the band. Make sure it is on and not "
                        "already connected to another app or phone.")
            return "No band connected. Open the Band tab and pair one."
        if state == STATE_CONNECTING:
            return "Connecting to the band…"
        if state == STATE_ALREADY_IN_USE:
            return ("The band is refusing raw signal — its licence has the "
                    "raw lock set. Factum needs a licence from Wearable "
                    "Devices for direct access, or can fall back to Mudra "
                    "Link.")
        return ("Connected, but no raw signal is arriving. The band may be "
                "in a mode that keeps its data, or another app may hold it.")

    def troubleshooting_causes(self) -> List[Tuple[str, str]]:
        state = self.signal_state()
        causes: List[Tuple[str, str]] = []
        if state == STATE_ALREADY_IN_USE:
            causes.append((
                "The band's licence blocks raw signal over direct BLE",
                "Its `raw_lock` flag is set, and enforcement is in the "
                "firmware. Switch Factum to the Mudra Link transport in "
                "the Band tab — Link holds a licence — or ask Wearable "
                "Devices for one."))
        causes += [
            ("The band is connected to something else",
             "A band holds one BLE link at a time. Close Mudra Link, the "
             "Companion, and the phone app, then scan again."),
            ("Bluetooth is off, or the band is out of range",
             "Check Bluetooth in Windows Settings and bring the band "
             "within a metre or two of the machine."),
            ("The band is asleep or flat",
             "Charge it and wake it. Battery shows in the Band tab once "
             "it connects."),
            ("The band is in a mode that keeps its own data",
             "Set it to the mode that releases raw signal from the Band "
             "tab, rather than through Mudra Link."),
        ]
        return causes

    def known_good_sequence(self) -> List[str]:
        return [
            "Close Mudra Link, Mudra Companion, and the phone app — the "
            "band only talks to one host at a time.",
            "Turn Bluetooth on and put the band within a metre.",
            "Open the Band tab in Factum and press Scan.",
            "Select the band and press Connect.",
            "Check the licence line: if the raw lock is set, raw signal "
            "will not come over direct BLE.",
            "Press 'Use Factum defaults' to turn the HID cursor on, raw "
            "signal on, and Mudra's own gestures off.",
        ]


class _Delegate:
    """Bridges SDK callbacks back into the client.

    A separate object rather than making the client itself the delegate:
    the SDK's `MudraDelegate` is an ABC with abstract methods, and
    inheriting it would make the client's public surface a mix of two
    unrelated contracts.
    """

    def __init__(self, client: MudraBleClient) -> None:
        self.client = client

    def on_device_discovered(self, device: Any) -> None:
        band = DiscoveredBand(device)
        if not band.address:
            return
        first = band.address not in self.client.discovered
        self.client.discovered[band.address] = band
        if first:
            self.client._log(f"Found {band.label()}")
        if self.client.on_discovered:
            try:
                self.client.on_discovered()
            except Exception:
                pass
        # One band, one obvious choice — connect to the first one seen
        # so the common case needs no clicks at all.
        if first and self.client.auto_connect and not self.client.band_connected():
            self.client.submit(self.client._connect(device))

    def on_mudra_device_connecting(self, device: Any) -> None:
        self.client._connecting = True
        self.client._notify()

    def on_mudra_device_connected(self, device: Any) -> None:
        self.client.submit(self.client._on_connected(device))

    def on_mudra_device_disconnecting(self, device: Any) -> None:
        self.client._log("Band disconnecting…")

    def on_mudra_device_disconnected(self, device: Any) -> None:
        self.client._device = None
        self.client._features.clear()
        self.client.device["state"] = "disconnected"
        self.client._log("Band disconnected.")
        self.client._notify()
        # Go back to looking for it, so walking out of range and back
        # recovers without anyone pressing anything.
        if not self.client._stopping:
            self.client.submit(self.client._start_scan())

    def on_mudra_device_connection_failed(self, device: Any, error: str) -> None:
        self.client._connecting = False
        self.client.last_error = str(error)
        self.client._log(f"Connection failed: {error}")
        self.client._notify()

    def on_bluetooth_state_changed(self, state: bool) -> None:
        self.client._log(f"Bluetooth {'on' if state else 'off'}")
        self.client._notify()

    def on_license_info_received(self, device_address: str, info: Any) -> None:
        self.client.note_licence(info)

    def __getattr__(self, name: str):
        # The SDK's delegate contract is wide and grows between versions.
        # Anything not handled above is accepted and ignored rather than
        # raising in the middle of a BLE callback.
        def _ignore(*_a, **_k):
            return None
        return _ignore


if __name__ == "__main__":
    import sys

    ok, message = sdk_available()
    print(message)
    if not ok:
        raise SystemExit(1)

    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
    client = MudraBleClient(on_log=lambda m: print("  ", m))
    print("\nInterface parity with mudra_client.MudraClient:")
    import mudra_client
    required = [n for n in dir(mudra_client.MudraClient)
                if not n.startswith("_") and callable(
                    getattr(mudra_client.MudraClient, n))]
    missing = [n for n in required if not hasattr(client, n)]
    for name in required:
        print(f"   {'ok ' if hasattr(client, name) else 'MISSING'} {name}")
    if missing:
        print(f"\nMISSING: {missing}")
        raise SystemExit(1)
    print("\nAll methods present.")

    if seconds <= 0:
        print("\nPass a number of seconds to actually scan and connect, e.g.")
        print("    python mudra_ble.py 20")
        raise SystemExit(0)

    client.start()
    deadline = time.time() + seconds
    while time.time() < deadline:
        time.sleep(1.0)
        print(f"  state={client.signal_state():12} "
              f"frames={client.frames_received:6} "
              f"sps={client.samples_per_second():7.1f} "
              f"battery={client.device.get('battery_pct')}")
    print("\n" + client.state_message())
    if client.licence:
        print("licence:", client.licence)
    client.stop()
    print("OK")
