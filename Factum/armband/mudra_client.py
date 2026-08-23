"""Mudra WebSocket client with SNC ring buffer.

Talks to whichever Mudra host is serving port 8766 — the standalone
**Mudra Companion** bridge, or the **Studio** tab in the Mudra Link
desktop app. It walks a list of candidate endpoints on each reconnect
and settles on whichever one yields data, so neither the user nor the
config has to know which program is running.

The client:
  - Auto-connects and auto-reconnects with backoff. No human clicks.
  - Rotates through `config.ws_candidates()` until one produces frames.
  - Subscribes to `snc` on open and periodically re-subscribes.
  - Tracks a lock-protected ring buffer of the latest samples per channel.
  - Reports a coarse `signal_state()` that the UI uses to show the RIGHT
    message: no host / no band / subscribed-but-silent.
  - Logs any unknown message type instead of silently dropping it.

Why "band in ACTIVE mode" matters: the Mudra band's ACTIVE mode runs
Mudra's own gesture engine and consumes the sensor data locally, so SNC
does NOT stream. STANDBY mode is what we need. When SNC is subscribed
but no frames arrive for a few seconds, we surface that as its own state
so the UI can tell the helper what to do.

Why the network hint comes first in that state: on 2026-08-07 SNC was
dead for hours because **Xfinity Advanced Security was blocking Mudra's
traffic at the router**. Every local diagnostic was green — the control
channel answered, battery updated, the Windows firewall had Allow
rules. Router-level security is the one cause this app cannot detect
for itself, so it is the first thing the UI suggests.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from typing import Callable, Deque, Dict, Iterable, List, Optional, Tuple

import numpy as np
import websocket

from config import CONFIG


DEFAULT_URL = "ws://127.0.0.1:8766/events"
FALLBACK_URL = "ws://127.0.0.1:8766"

# Message types the client is aware of. Anything else goes to `unknown_types`
# so we can spot Companion protocol changes early instead of silently dropping.
KNOWN_TYPES = {
    "snc",
    "status",
    "error",
    "gesture",
    "gestures",              # plural variant used in one Companion build
    "button",
    "pressure",
    "imu_acc",
    "imu_gyro",
    "navigation",
    "nav_direction",
    "battery",
    "device",
    "connection_status",     # unsolicited on connect (this Companion build)
    "subscriptions",         # initial subscription-state dump
    "docs",                  # full protocol docs pushed on connect
    "subscription_status",   # response to subscribe/unsubscribe
    "device_info",           # response to get_device_info — same shape as
                             # status.data.device, but delivered flat
}


# Coarse states the UI cares about.
STATE_NO_WS = "no_ws"                    # WebSocket not open
STATE_NO_BAND = "no_band"                # WS open but band not paired
STATE_CONNECTING = "connecting"          # Band paired, sub just sent, grace period
STATE_NO_SNC = "no_snc"                  # Band paired, subscribed, no frames past grace
STATE_LIVE = "live"                      # Frames arriving
STATE_ALREADY_IN_USE = "already_in_use"  # Another client owns the slot


class MudraClient:
    def __init__(
        self,
        url: Optional[str] = None,
        buffer_seconds: float = 5.0,
        expected_hz: int = 1000,
        # Subscribe to imu_acc alongside snc by default (as of
        # 2026-08-14). The IMU is an independent motion measure with
        # zero muscle content — the cleanest way to know the arm is
        # moving. See STATUS.md and censored-data architecture note
        # in WORKLOG.
        signals: Iterable[str] = ("snc", "imu_acc"),
        no_frames_grace_seconds: float = 3.0,
        status_poll_seconds: float = 2.0,
        urls: Optional[Iterable[str]] = None,
    ) -> None:
        # Endpoint resolution, most specific first:
        #   explicit urls= list > explicit url= > config candidates.
        if urls is not None:
            self.urls: List[str] = [u for u in urls if u]
        elif url:
            self.urls = [url]
        else:
            self.urls = CONFIG.ws_candidates()
        if not self.urls:
            self.urls = [DEFAULT_URL, FALLBACK_URL]
        self.url = self.urls[0]
        self.expected_hz = expected_hz
        self.buffer_len = int(buffer_seconds * expected_hz)
        self.signals = list(signals)
        self.no_frames_grace = no_frames_grace_seconds
        self.status_poll_seconds = status_poll_seconds

        self._buffers: List[Deque[float]] = [
            deque(maxlen=self.buffer_len) for _ in range(3)
        ]
        # IMU accelerometer buffers — x, y, z axes at IMU rate. Buffer
        # length matches SNC in seconds; IMU rate is typically ~100 Hz
        # so this stays modest. Used by the motion score.
        imu_buf_len = max(int(buffer_seconds * 200), 400)
        self._imu_buffers: List[Deque[float]] = [
            deque(maxlen=imu_buf_len) for _ in range(3)
        ]
        self.imu_frames_received: int = 0
        self.imu_samples_received: int = 0
        self.imu_last_frame_ts: float = 0.0
        self._lock = threading.Lock()

        self._ws: Optional[websocket.WebSocketApp] = None
        self._thread: Optional[threading.Thread] = None
        self._poll_thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._connected = threading.Event()

        # Timing / counters
        self.frames_received: int = 0
        self.samples_received: int = 0
        self.last_frequency: int = 0
        self.last_frame_ts: float = 0.0
        self.subscribed_at: float = 0.0
        self.first_frame_at: float = 0.0
        self._frame_ts_window: Deque[float] = deque(maxlen=200)  # last N frames

        # Empirical ground-truth capture: first N SNC frames verbatim,
        # so we can prove actual shape / batch / range without a probe.
        self.snc_diag_target: int = 10
        self.snc_diag_frames: List[dict] = []
        self.snc_diag_raw: List[str] = []
        self.snc_diag_report: Optional[str] = None

        # DC-offset drift per channel over time. If one channel's DC
        # walks while the others hold steady, that's a specific
        # electrode losing contact — the Log tab surfaces this.
        # Rolling (wall_ts, [dc_ch1, dc_ch2, dc_ch3]) samples.
        self.dc_drift: Deque[Tuple[float, List[float]]] = deque(maxlen=1800)  # ~1h @ 2s
        self._last_dc_sample_ts: float = 0.0
        self.dc_sample_interval_s: float = 2.0

        # Diagnostics
        self.last_error: Optional[str] = None
        self.status: dict = {}
        # Accumulated device info, merged from `status` and `device_info`.
        # Kept separate from `status` so a poll that returns all-nulls
        # (which this host does whenever the band is detached) cannot
        # wipe out what we already learned.
        self.device: dict = {}
        self.device_changed_ts: float = 0.0
        self.last_poll_ts: float = 0.0
        self.server_signals: List[str] = []        # from connection_status
        self.server_subscriptions: dict = {}        # last known sub state
        self.unknown_types: Dict[str, int] = {}     # type -> count
        self.log: Deque[Tuple[float, str]] = deque(maxlen=200)
        self.active_url: str = self.url
        self.reconnect_index: int = 0

        # Optional callbacks
        self.on_signal: Optional[Callable[[str, dict], None]] = None

    # ------------------------------------------------------------ logging

    def _log(self, msg: str) -> None:
        self.log.append((time.time(), msg))

    # ------------------------------------------------------------ lifecycle

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run_forever, daemon=True)
        self._thread.start()
        self._poll_thread = threading.Thread(target=self._poll_status_loop, daemon=True)
        self._poll_thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass
        for t in (self._thread, self._poll_thread):
            if t is not None:
                t.join(timeout=2.0)

    def wait_connected(self, timeout: float = 3.0) -> bool:
        return self._connected.wait(timeout)

    # ---------------------------------------------------------------- reads

    def snapshot(self, seconds: float) -> np.ndarray:
        """Return the most recent `seconds` of samples as shape (3, N)."""
        return self.tail(int(seconds * self.expected_hz))

    def imu_snapshot(self, seconds: float) -> np.ndarray:
        """Most recent `seconds` of IMU accelerometer samples, shape (3, N).

        Independent of SNC — the IMU has zero muscle content, so a
        motion score built from IMU magnitude tells us the arm was
        moving without any contamination from the muscle signal we
        actually want to classify. Assumes ~200 Hz IMU rate; if the
        real rate is lower, N is smaller — that's fine, downstream
        code checks length.
        """
        n = max(1, int(seconds * 200))
        with self._lock:
            arrays = []
            for buf in self._imu_buffers:
                take = min(n, len(buf))
                if take == 0:
                    arrays.append(np.empty(0, dtype=np.float32))
                    continue
                arrays.append(
                    np.fromiter(
                        (buf[i] for i in range(len(buf) - take, len(buf))),
                        dtype=np.float32,
                        count=take,
                    )
                )
        m = min((a.shape[0] for a in arrays), default=0)
        if m == 0:
            return np.empty((3, 0), dtype=np.float32)
        return np.stack([a[-m:] for a in arrays])

    def motion_score(self, seconds: float = 0.25) -> float:
        """Scalar 'is the arm moving' score in [0, ~1+], per contract:
            score = normalised IMU magnitude standard-deviation.

        We prefer the IMU because it has zero muscle content. Callers
        may combine this with a sub-20 Hz SNC power fraction (see
        `analysis.motion_from_snc`) — the two should agree when both
        are trustworthy and disagree tells us to trust the IMU.
        """
        imu = self.imu_snapshot(seconds)
        if imu.shape[1] < 4:
            return 0.0
        magnitude = np.sqrt(np.sum(imu * imu, axis=0))
        # Normalise: raw accel magnitudes ~= 1 g at rest on this device.
        # We care about DEVIATION from steady, not absolute magnitude.
        return float(magnitude.std())

    def tail(self, n: int) -> np.ndarray:
        """The most recent `n` samples per channel, shape (3, N).

        Recording drains the buffer with this: track `samples_received`
        between polls and take exactly the delta, so nothing is written
        twice and nothing is missed as long as polls are more frequent
        than the buffer is long.
        """
        if n <= 0:
            return np.empty((3, 0), dtype=np.float32)
        with self._lock:
            arrays = []
            for buf in self._buffers:
                take = min(n, len(buf))
                if take == 0:
                    arrays.append(np.empty(0, dtype=np.float32))
                    continue
                arrays.append(
                    np.fromiter(
                        (buf[i] for i in range(len(buf) - take, len(buf))),
                        dtype=np.float32,
                        count=take,
                    )
                )
        m = min((a.shape[0] for a in arrays), default=0)
        if m == 0:
            return np.empty((3, 0), dtype=np.float32)
        return np.stack([a[-m:] for a in arrays])

    def _build_snc_diag_report(self) -> str:
        """Plain-text table summarising the first N raw SNC frames."""
        frames = self.snc_diag_frames
        lines: List[str] = []
        lines.append("=" * 68)
        lines.append("SNC EMPIRICAL VERIFICATION  (first %d frames)" % len(frames))
        lines.append("=" * 68)

        # Raw first frame (truncated).
        if self.snc_diag_raw:
            lines.append("RAW FIRST FRAME (truncated):")
            lines.append(self.snc_diag_raw[0])
            lines.append("")

        # Per-frame table.
        lines.append(
            "%3s %11s %10s %6s %6s %6s %6s %14s"
            % ("#", "wall_dt_ms", "outer", "ch1_n", "ch2_n", "ch3_n", "freq", "msg_ts")
        )
        t0 = frames[0]["wall_ts"]
        for i, f in enumerate(frames):
            outer = f"{f['outer_type']}({f['outer_len']})"
            lines.append(
                "%3d %11.1f %10s %6s %6s %6s %6s %14s"
                % (
                    i,
                    (f["wall_ts"] - t0) * 1000.0,
                    outer,
                    str(f["ch_shapes"][0]),
                    str(f["ch_shapes"][1]),
                    str(f["ch_shapes"][2]),
                    str(f["frequency"]),
                    str(f["msg_ts"]),
                )
            )
        lines.append("")

        # Value-range table across captured frames only.
        mins = [float("inf")] * 3
        maxs = [float("-inf")] * 3
        sums = [0.0] * 3
        counts = [0] * 3
        for f in frames:
            # Re-scan raw payloads for numeric ranges. We didn't keep the
            # values themselves to keep memory tight; use a lightweight
            # snapshot from the ring buffer instead.
            pass
        with self._lock:
            for ch in range(3):
                if not self._buffers[ch]:
                    continue
                arr = np.fromiter(self._buffers[ch], dtype=np.float32,
                                  count=len(self._buffers[ch]))
                mins[ch] = float(arr.min())
                maxs[ch] = float(arr.max())
                sums[ch] = float(arr.sum())
                counts[ch] = int(arr.size)

        lines.append("VALUE RANGE (from ring buffer, up to 5s):")
        lines.append("%3s %8s %10s %10s %10s" % ("ch", "n", "min", "max", "mean"))
        for ch in range(3):
            if counts[ch] == 0:
                lines.append("%3d %8s %10s %10s %10s" % (ch + 1, "-", "-", "-", "-"))
                continue
            mean = sums[ch] / counts[ch]
            lines.append(
                "%3d %8d %10.5f %10.5f %10.5f"
                % (ch + 1, counts[ch], mins[ch], maxs[ch], mean)
            )
        lines.append("")

        # Timing summary.
        if len(frames) >= 2:
            span = frames[-1]["wall_ts"] - frames[0]["wall_ts"]
            frame_rate = (len(frames) - 1) / span if span > 0 else 0.0
            total_samples_ch1 = sum(
                (f["ch_shapes"][0] if isinstance(f["ch_shapes"][0], int) else 1)
                for f in frames
            )
            sample_rate = total_samples_ch1 / span if span > 0 else 0.0
            avg_batch = total_samples_ch1 / len(frames)
            lines.append("TIMING:")
            lines.append("  frames captured             : %d" % len(frames))
            lines.append("  wall time span              : %.3f s" % span)
            lines.append("  frame arrival rate          : %.2f frames/s" % frame_rate)
            lines.append("  effective sample rate (ch1) : %.1f samples/s" % sample_rate)
            lines.append("  avg samples per frame (ch1) : %.2f" % avg_batch)
            if frames[-1]["frequency"] is not None:
                lines.append("  reported 'frequency' field  : %s" % frames[-1]["frequency"])

        lines.append("=" * 68)
        return "\n".join(lines)

    def latest_rms(self, seconds: float) -> np.ndarray:
        snap = self.snapshot(seconds)
        if snap.shape[1] == 0:
            return np.zeros(3, dtype=np.float32)
        ac = snap - snap.mean(axis=1, keepdims=True)
        return np.sqrt(np.mean(ac * ac, axis=1)).astype(np.float32)

    def clear(self) -> None:
        with self._lock:
            for buf in self._buffers:
                buf.clear()

    # ---------------------------------------------------------- FPS + state

    def frames_per_second(self, window_seconds: float = 1.0) -> float:
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            recent = [t for t in self._frame_ts_window if t >= cutoff]
        if len(recent) < 2:
            return 0.0
        span = recent[-1] - recent[0]
        if span <= 0:
            return 0.0
        return (len(recent) - 1) / span

    def samples_per_second(self, window_seconds: float = 1.0) -> float:
        # Empirical: this Companion build's `frequency` field is NOT the
        # sample rate (measured value: 21, while actual sample rate is
        # ~1000 Hz with 18-sample batches at ~53 frames/s). Derive from
        # observed batch size × observed frame rate instead.
        fps = self.frames_per_second(window_seconds)
        if fps <= 0 or self.frames_received == 0:
            return 0.0
        # Rolling batch-size estimate from total counters — accurate once
        # we've received enough frames.
        avg_batch = self.samples_received / max(self.frames_received, 1)
        return fps * avg_batch

    def _merge_device(self, device: Optional[dict]) -> None:
        """Fold a device dict into `self.device`, keeping known values.

        Both `status` and `device_info` carry the same fields, and this
        host sends `null` for every field while the band is detached.
        A null must not erase a value we already have — but a change in
        `state` must always land, or the UI would never notice the band
        going away.
        """
        if not isinstance(device, dict):
            return
        previous_state = self.device.get("state")
        for key, value in device.items():
            if value is None and key != "state":
                continue
            self.device[key] = value
        if device.get("state") is None and "state" in device:
            self.device["state"] = None
        new_state = self.device.get("state")
        if new_state != previous_state:
            self.device_changed_ts = time.time()
            self._log(f"band state: {previous_state} -> {new_state}")
            if new_state == "connected":
                # Re-subscribe immediately rather than waiting for the
                # next poll tick — the helper is standing there.
                for sig in self.signals:
                    self._send({"command": "subscribe", "signal": sig})
                self.subscribed_at = time.time()

    def band_connected(self) -> bool:
        """Is a band actually attached to the host?

        `state` is authoritative on this build — it reads "connected" or
        "disconnected". The identity fields are a fallback for builds
        that do not send `state`, and any one of them is enough: an
        earlier version demanded BOTH firmware and serial_number, which
        reported "no band" against a host that supplied only a name.
        """
        dev = self.device or ((self.status or {}).get("device") or {})
        state = (dev.get("state") or "").strip().lower()
        if state:
            return state == "connected"
        return bool(dev.get("firmware") or dev.get("serial_number")
                    or dev.get("name") or dev.get("address"))

    def receiving_data(self) -> bool:
        return (self.frames_received > 0
                and (time.time() - self.last_frame_ts) <= self.no_frames_grace)

    def signal_state(self) -> str:
        if self.last_error == "client_already_connected":
            return STATE_ALREADY_IN_USE
        if not self._connected.is_set():
            return STATE_NO_WS
        # Data beats metadata. If frames are arriving we are live, whatever
        # the host claims about the device — a host that streams SNC while
        # reporting `state: disconnected` must not leave the app showing
        # "no band" and refusing to record.
        if self.receiving_data():
            return STATE_LIVE
        if not self.band_connected():
            return STATE_NO_BAND
        now = time.time()
        if self.frames_received == 0:
            # Grace period between subscribe and first frame — normal.
            since_sub = now - self.subscribed_at if self.subscribed_at else 0.0
            if since_sub <= self.no_frames_grace:
                return STATE_CONNECTING
            return STATE_NO_SNC
        return STATE_NO_SNC

    def state_message(self) -> str:
        state = self.signal_state()
        if state == STATE_ALREADY_IN_USE:
            return (
                "Mudra Companion is already talking to another client "
                "(another tab or app). Close it, then this app will reconnect."
            )
        if state == STATE_NO_WS:
            return (
                "No Mudra host is serving the signal. Open Mudra Link "
                "(button above), then open its Studio tab — the server "
                "only runs while Studio is open. Mudra Companion also "
                "works if you prefer it."
            )
        if state == STATE_NO_BAND:
            hand = (self.device.get("hand") or "").strip()
            return (
                "Connected to the Mudra host, but it reports no band "
                "attached"
                + (f" (slot: {hand} hand)" if hand else "")
                + ". Pair the band — this app is checking every second and "
                  "will pick it up on its own. No restart needed."
            )
        if state == STATE_CONNECTING:
            return "Subscribed, waiting for the first SNC frame…"
        if state == STATE_NO_SNC:
            return (
                "Band is paired but no data is flowing. Most likely cause: "
                "router-level security software (e.g. Xfinity Advanced "
                "Security) silently blocking Mudra traffic — test by "
                "tethering to a phone hotspot. Next likely: the band is in "
                "ACTIVE mode instead of STANDBY. See the Log tab for the "
                "full checklist."
            )
        if state == STATE_LIVE:
            return "Live SNC data flowing."
        return "Unknown state."

    # --------------------------------------------------- troubleshooting

    def troubleshooting_causes(self) -> List[Tuple[str, str]]:
        """Ranked (cause, what to do) pairs for a paired-but-silent band.

        Ordered by what has actually caused this in the field, not by
        what is easiest to check. Router-level security is first because
        it cost us hours on 2026-08-07 and is the ONE cause that leaves
        every local diagnostic looking healthy: the control channel
        answers, battery updates, the Windows firewall shows Allow
        rules, port 8766 has a listener — and no data ever arrives.
        """
        return [
            (
                "Router-level security software blocking Mudra traffic",
                "Xfinity Advanced Security is the known culprit — it blocks "
                "silently and nothing on this PC reports it. Test: tether "
                "this PC to a phone hotspot and watch this panel. If data "
                "starts flowing, turn Advanced Security off in the Xfinity "
                "app (WiFi → View WiFi equipment → Advanced Security) or "
                "allow-list this PC. Same applies to Eero Secure, ISP "
                "parental controls, a router VPN, or a DNS filter.",
            ),
            (
                "Band is in ACTIVE mode, not STANDBY",
                "ACTIVE runs Mudra's own gesture engine and consumes the "
                "sensor data locally, so no SNC is released. Put the band "
                "in STANDBY.",
            ),
            (
                "Another client already owns the stream",
                "Only one client gets the signal. Close any other Mudra "
                "app or browser tab talking to port 8766, then wait — this "
                "app reconnects on its own.",
            ),
            (
                "The Mudra host needs a clean restart",
                "Quit Mudra Companion fully (check the system tray), "
                "reopen it, pair the band, then let this app reconnect. "
                "Launch Companion directly from "
                "C:\\Users\\user\\MudraCompanion\\MudraCompanion.exe — "
                "never via Mudra Link, which crashes it.",
            ),
            (
                "Bluetooth pairing has dropped",
                "Check Windows Settings → Bluetooth & devices. The band "
                "should show as Connected. Power-cycle the band if not.",
            ),
        ]

    def known_good_sequence(self) -> List[str]:
        return [
            "Check router-level security FIRST — Xfinity Advanced Security "
            "blocks Mudra traffic silently. Phone hotspot is the 2-minute test.",
            "Quit Mudra Companion completely (right-click tray icon → Quit).",
            "Close the Mudra Link app on your phone.",
            "Reopen Mudra Companion on the PC (directly, never via Mudra Link) "
            "— or open the Studio tab in Mudra Link desktop instead.",
            "Pair the band (battery + firmware should show).",
            "Put the band in STANDBY mode.",
            "Confirm the host says the server is LIVE.",
            "Launch this app first — before any other Mudra client.",
        ]

    # ------------------------------------------------------------- internal

    def _poll_status_loop(self) -> None:
        """Keep asking the host what changed. Never require a restart.

        The band can be paired, unpaired, put into STANDBY or woken up
        at any moment, and the host does not push those transitions —
        it only answers when asked. So we ask continuously, and we ask
        FASTER while something is wrong: sitting on a 2-second poll is
        fine when data is flowing, but when the helper is standing
        there waiting for the band to come up, that same 2 seconds
        feels like the app has hung.
        """
        while not self._stop.is_set():
            if self._connected.is_set() and self._ws is not None:
                self._send({"command": "get_status"})
                # get_status carries device info on this build, but
                # get_device_info is the documented source and some
                # builds only populate it there. Ask for both; whichever
                # answers wins, and _merge_device keeps the fuller one.
                self._send({"command": "get_device_info"})
                # Nudge subscribe in case the band just entered STANDBY,
                # or connected after we first subscribed.
                for sig in self.signals:
                    self._send({"command": "subscribe", "signal": sig})
                self.last_poll_ts = time.time()
                self._sample_dc_drift()
                self._watchdog()
            self._stop.wait(self._poll_interval())

    # How long a subscribed-but-silent socket is tolerated before it is
    # treated as dead. Long enough to survive a normal gap, short enough
    # that a person waiting does not conclude the app has hung.
    STALE_SECONDS = 6.0

    def _watchdog(self) -> None:
        """Force a reconnect when the socket is open but has gone quiet.

        This is the bug that made the band look like it only streamed in
        ACTIVE mode. Changing band mode makes the host restart its feed;
        our TCP socket stays open but stops delivering, so
        `run_forever()` never returns and the reconnect loop never runs.
        Factum then sits "connected" with zero frames indefinitely, and
        the only cure was killing the app — which is exactly the
        restart-by-hand the user should never have to do.

        Closing the socket ourselves is what lets the existing
        reconnect-with-backoff do its job. It also releases the host's
        single client slot, which is what `client_already_connected`
        was really complaining about.
        """
        if not self._connected.is_set() or self._ws is None:
            return
        if not self.subscribed_at:
            return
        since_subscribe = time.time() - self.subscribed_at
        if since_subscribe < self.STALE_SECONDS:
            return
        last = self.last_frame_ts or self.subscribed_at
        if (time.time() - last) < self.STALE_SECONDS:
            return
        self._log(f"no frames for {self.STALE_SECONDS:.0f}s while subscribed "
                  f"— dropping the socket so it can reconnect")
        self.force_reconnect()

    def force_reconnect(self) -> None:
        """Tear the socket down now. The reconnect loop rebuilds it.

        Safe to call from the UI thread: closing the WebSocketApp makes
        `run_forever()` return on its own thread, and everything else
        follows the normal reconnect path.
        """
        self.reconnect_index = 0
        self.subscribed_at = 0.0
        ws = self._ws
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
        self._connected.clear()

    def _poll_interval(self) -> float:
        """Poll hard while waiting, ease off once data is flowing."""
        if self.signal_state() == STATE_LIVE:
            return self.status_poll_seconds
        return min(self.status_poll_seconds, 1.0)

    def _sample_dc_drift(self) -> None:
        snap = self.snapshot(1.0)
        if snap.shape[1] < 64:
            return
        dc = snap.mean(axis=1).astype(float).tolist()
        now = time.time()
        self.dc_drift.append((now, dc))
        self._last_dc_sample_ts = now

    def _run_forever(self) -> None:
        # Walk every configured candidate. Whichever one produces frames
        # is the one we stay on — we only advance the index when a
        # connection ends without having delivered anything new.
        urls_to_try = list(self.urls)

        backoff = [1.0, 2.0, 5.0, 10.0]
        url_i = 0

        while not self._stop.is_set():
            active_url = urls_to_try[url_i % len(urls_to_try)]
            self.active_url = active_url
            self.last_error = None
            frames_before = self.frames_received

            self._log(f"connect: {active_url}")

            try:
                self._ws = websocket.WebSocketApp(
                    active_url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                self._ws.run_forever(ping_interval=0, ping_timeout=None)
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                self._log(f"ws exception: {self.last_error}")

            self._connected.clear()

            if self._stop.is_set():
                return

            # If we never received data on this URL, try the next candidate.
            if self.frames_received == frames_before and len(urls_to_try) > 1:
                url_i += 1
                if url_i % len(urls_to_try) == 0:
                    self._log("tried every endpoint with no data — "
                              "check router-level security (see Log tab)")

            if self.last_error == "client_already_connected":
                # Keep polling — the user might close the other client. Slower.
                self._log("already_in_use — slow retry")
                self._stop.wait(5.0)
                # Reset the error so we can try again cleanly.
                self.last_error = None
                continue

            delay = backoff[min(self.reconnect_index, len(backoff) - 1)]
            self.reconnect_index = min(self.reconnect_index + 1, len(backoff) - 1)
            self._log(f"reconnect in {delay:.0f}s")
            self._stop.wait(delay)

    def _on_open(self, _ws) -> None:
        self._connected.set()
        self.reconnect_index = 0
        self._log("ws open")
        self._send({"command": "get_status"})
        for sig in self.signals:
            self._send({"command": "subscribe", "signal": sig})
        self.subscribed_at = time.time()

    def _on_message(self, _ws, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            self._log("bad json")
            return
        t = msg.get("type")
        data = msg.get("data") or {}

        if t == "snc":
            values = data.get("values")
            freq = data.get("frequency")
            if isinstance(freq, int):
                self.last_frequency = freq
            if not values or len(values) < 3:
                return
            now = time.time()

            # Normalise: some Companion builds may send a scalar per channel
            # instead of an array. Coerce to a list either way so downstream
            # code is uniform. Empirical fact — logged in snc_diag_report.
            normalized = []
            for ch_val in values[:3]:
                if isinstance(ch_val, list):
                    normalized.append(ch_val)
                else:
                    normalized.append([ch_val])

            with self._lock:
                for ch, samples in enumerate(normalized):
                    self._buffers[ch].extend(samples)
                self.samples_received += len(normalized[0])
                self.frames_received += 1
                self.last_frame_ts = now
                self._frame_ts_window.append(now)
                if self.first_frame_at == 0.0:
                    self.first_frame_at = now
                    self._log(f"first SNC frame at {now:.1f}")

                # Empirical diagnostic capture — first N frames verbatim.
                need_report = False
                if len(self.snc_diag_frames) < self.snc_diag_target:
                    ch_shapes = []
                    for v in values[:3]:
                        if isinstance(v, list):
                            ch_shapes.append(len(v))
                        else:
                            ch_shapes.append("scalar")
                    self.snc_diag_frames.append({
                        "wall_ts": now,
                        "msg_ts": msg.get("timestamp"),
                        "outer_type": type(values).__name__,
                        "outer_len": len(values) if isinstance(values, list) else None,
                        "ch_shapes": ch_shapes,
                        "frequency": freq,
                    })
                    self.snc_diag_raw.append(raw if len(raw) < 400 else raw[:400] + "…")
                    need_report = len(self.snc_diag_frames) == self.snc_diag_target
            # Build the report OUTSIDE the lock — _build_snc_diag_report
            # re-acquires the lock and Python's Lock is not reentrant.
            if need_report:
                self.snc_diag_report = self._build_snc_diag_report()
                self._log("SNC diagnostic report ready")
                print("\n" + self.snc_diag_report, flush=True)
            return

        if t == "imu_acc":
            # IMU accelerometer: three axes, either per-sample or
            # per-batch depending on the Companion build. Same coercion
            # pattern as SNC — always end up with a list per axis.
            values = data.get("values")
            if not values or len(values) < 3:
                return
            normalized_imu = []
            for ax_val in values[:3]:
                if isinstance(ax_val, list):
                    normalized_imu.append(ax_val)
                else:
                    normalized_imu.append([ax_val])
            with self._lock:
                for ax, samples in enumerate(normalized_imu):
                    self._imu_buffers[ax].extend(samples)
                self.imu_samples_received += len(normalized_imu[0])
                self.imu_frames_received += 1
                self.imu_last_frame_ts = time.time()
            return

        if t == "status":
            self.status = data
            self._merge_device(data.get("device"))
            # This build of Companion embeds the sub state under status.data.subscriptions.
            subs = data.get("subscriptions")
            if isinstance(subs, dict):
                self.server_subscriptions = subs
            return

        if t == "device_info":
            # Reply to get_device_info: the device dict, delivered flat.
            self._merge_device(data)
            return

        if t == "connection_status":
            # Unsolicited on connect. Extract available_signals for validation.
            usage = data.get("usage") or {}
            signals = usage.get("available_signals")
            if isinstance(signals, list):
                self.server_signals = signals
                self._log(f"server signals: {signals}")
            return

        if t == "subscriptions":
            # Unsolicited on connect. This build uses key 'gestures' (plural).
            if isinstance(data, dict):
                self.server_subscriptions = data
            return

        if t == "subscription_status":
            # Ack of subscribe/unsubscribe.
            sig = data.get("signal")
            ok = data.get("subscribed")
            if sig:
                self.server_subscriptions[sig] = bool(ok)
                self._log(f"sub ack: {sig}={ok}")
            return

        if t == "docs":
            # Full protocol docs. We don't need them; do not log every call.
            return

        if t == "error":
            err = data.get("error", "unknown_error")
            self.last_error = err
            self._log(f"server error: {err}")
            return

        # Fire the optional callback for gesture/button/pressure/etc.
        if t and self.on_signal is not None:
            try:
                self.on_signal(t, data)
            except Exception:
                pass

        if t not in KNOWN_TYPES:
            self.unknown_types[t or "<none>"] = self.unknown_types.get(t or "<none>", 0) + 1
            if self.unknown_types[t or "<none>"] == 1:
                self._log(f"unknown message type: {t!r} (raw keys={list(msg.keys())})")

    def _on_error(self, _ws, err) -> None:
        self.last_error = f"{type(err).__name__}: {err}"
        self._log(f"on_error: {self.last_error}")

    def _on_close(self, _ws, _code, _reason) -> None:
        self._connected.clear()
        self._log("ws close")

    def _send(self, obj: dict) -> None:
        if self._ws is None:
            return
        try:
            self._ws.send(json.dumps(obj))
        except Exception as exc:
            self.last_error = f"send_failed: {exc}"


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import sys

    print(f"[self-test] connecting primary={DEFAULT_URL}, fallback={FALLBACK_URL}", flush=True)
    client = MudraClient()
    client.start()
    connected = client.wait_connected(timeout=3.0)
    print(f"[self-test] wait_connected returned {connected}", flush=True)

    try:
        for i in range(40):
            time.sleep(0.5)
            state = client.signal_state()
            fps = client.frames_per_second()
            sps = client.samples_per_second()
            print(
                f"[{i:02d}] state={state:14s}  fps={fps:5.1f}  sps≈{sps:6.0f}  "
                f"frames={client.frames_received:5d}  samples={client.samples_received:7d}  "
                f"url={client.active_url}  err={client.last_error}",
                flush=True,
            )
            # Exit as soon as the empirical diag report has been printed.
            if client.snc_diag_report is not None:
                print("[self-test] diag report captured, exiting", flush=True)
                break
            if state == "no_snc" and i % 4 == 0:
                print(f"     → {client.state_message()}", flush=True)
            if client.unknown_types and i % 4 == 0:
                print(f"     unknown types: {dict(client.unknown_types)}", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        client.stop()
        sys.exit(0)
