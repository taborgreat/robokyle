"""App-level configuration for Factum.

Design principle (2026-08-07): anything the app can decide for itself,
it decides. Config exists so a value CAN be overridden, not so anyone
has to set it. Every key here has a working default; a missing or
corrupt config.json is not an error, it just means defaults.

Stored at `armband/config.json`. Human-readable JSON, like everything
else in this project. Env vars win over the file, so a one-off run can
point somewhere else without editing anything:

    FACTUM_WS_URL=ws://192.168.1.50:8766/events run.bat

WebSocket hosts
---------------
Two different programs can serve the Mudra stream on port 8766:

  * **Mudra Companion** — the standalone PC bridge. Serves `/events`.
  * **Mudra Link desktop → Studio tab** — newer; also listens on 8766.

Factum does not care which one is up. It walks `ws_candidates` in
order on every reconnect and sticks with whichever yields data, so
having both installed (or swapping between them) needs no config
change at all.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

ARMBAND_ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(ARMBAND_ROOT, "config.json")

# Candidate WebSocket endpoints, tried in order. Both Companion and the
# Link Studio tab bind 127.0.0.1:8766; they differ only in path, and
# some builds accept either, so we try both paths against both hosts.
DEFAULT_WS_CANDIDATES: List[str] = [
    "ws://127.0.0.1:8766/events",   # Mudra Companion (primary)
    "ws://127.0.0.1:8766",          # Mudra Link Studio tab / bare Companion
    "ws://localhost:8766/events",
    "ws://localhost:8766",
]

DEFAULTS: Dict[str, Any] = {
    # -- connection
    "transport":            "websocket",
    # auto | ble | websocket. See transport.py.
    #
    # websocket, NOT ble, as of 2026-08-10 — and this is a licensing
    # decision rather than a technical one. Direct BLE connects, reads
    # firmware and serial, and enumerates every service, then fails to
    # subscribe to the raw-signal characteristic with GATT error 5.
    # Mudra's documentation is explicit: raw SNC needs a "RawData"
    # licence. Mudra Link holds one; we do not. Until that is obtained,
    # the WebSocket path is the one that produces data, so it is the
    # one that ships.
    "last_band_address":    "",     # BLE address of the band this machine
                                    # uses. A band bonded to Windows often
                                    # stops advertising, and the SDK only
                                    # recognises bands by advertised NAME —
                                    # so without a remembered address a
                                    # paired band is invisible to scanning.
    "ws_candidates":        list(DEFAULT_WS_CANDIDATES),
    "ws_url":               "",     # set to pin one endpoint; "" = try all

    # -- UI
    "advanced":             False,  # Advanced panels off by default
    "walkthrough_open":     True,   # pre-flight steps expanded on the
                                    # session screen. On by default: the
                                    # person who needs it does not know
                                    # there is something to click.
    "window_geometry":      "1200x820",
    "splash_seconds":       2.0,    # title screen on launch; 0 disables

    # -- session behaviour (all automatic; exposed only for override)
    "probe_duration_s":     30,
    "rest_duration_s":      30,
    "countdown_s":          3,     # doubles as the "get ready" phase

    # -- guided protocol: how the app cues each attempt
    "protocol_reps":       20,     # cued attempts per probe (bumped from 5 → 20
                                   # on 2026-08-13: user directive, more reps is
                                   # the biggest lever on recall)
    "protocol_hold_s":      2.0,   # how long to hold each attempt
    "protocol_relax_s":     3.0,   # stillness between attempts — this gap
                                   # is what separates one attempt from
                                   # the next, so do not shrink it lightly
    "fatigue_reminder_min": 20,     # nag for a break after this long
    "auto_analyse_on_close": True,
    "auto_prompt_rest":     True,   # rest probe at the start of a session
    "auto_opinion":         True,   # ask the assistant about each recording
                                    # as soon as it finishes. Costs a few
                                    # seconds and needs a backend; when
                                    # neither is available it stays silent
                                    # rather than complaining.

    # -- analysis thresholds
    #
    # CALIBRATED 2026-08-08 against real signal (right wrist, session
    # 2026-08-08_2046) rather than reasoned from first principles.
    # Reference measurements from that session's rest recording:
    #     rest envelope   mean 0.0725   sd 0.0149   max 0.1159
    #     cued attempt    envelope p90 0.59, peak 0.87
    #
    "fallback_sample_rate_hz": 840,
    # MEASURED, not documented. Mudra's docs say ~1000 Hz; the Link
    # Studio stream actually delivers 830–840 Hz (batch size x frame
    # rate, averaged over each recording). Every probe CSV stamps its
    # own measured rate, so this only applies when the rate could not
    # be measured at all — a stuttering stream at the instant recording
    # starts. It used to fall back to 1000, which is 19% high and would
    # silently skew every frequency feature (median/mean frequency, the
    # three band powers) by that much, permanently, in a file that
    # claims to be self-describing. A wrong number written confidently
    # into an archive meant to last a decade is worse than a coarse one.

    "onset_threshold_k":    4.0,
    # onset = rest mean + k x rest sd. A sweep of k=2..12 on real data
    # found 5/5 cued attempts and ZERO false reps in rest at every value,
    # so the operating window is wide. k=4 (threshold 0.132) sits just
    # above the rest recording's own peak of 0.116, taking the headroom
    # without giving up any real attempts.

    "rep_min_duration_s":   0.30,   # shorter bursts are noise, not reps
    "rep_gap_s":            0.25,   # quiet gap that separates two reps

    "separable_d_prime":    2.5,
    # Was 1.5, which was too low and would have called noise a finding.
    # Two recordings of the SAME state (rest vs rest-2, minutes apart)
    # separate at d'=1.73 purely from drift — so 1.73 is roughly the
    # noise floor for this measure, and anything below it is meaningless.
    # 2.5 puts a real margin above that floor.

    "trigger_d_prime":      3.0,
    # A stricter bar for "safe to use as a trigger", judged against an
    # everyday-movement recording. Being distinguishable in principle is
    # not the same as being safe to fire a mouse click on: at d'=2.0 the
    # per-window error is ~16%, which is unusable without a hold time.

    # Which generation of measured thresholds this file was written
    # against. See CALIBRATION_REVISION below.
    "calibration_revision": 0,

    "consistency_good":     0.70,
    # Confirmed by real data: a cued, deliberate attempt scored 0.845,
    # while ordinary unrepeatable arm movement scored 0.42. 0.70 sits
    # cleanly between the two.
}

_ENV_OVERRIDES = {
    "ws_url":     "FACTUM_WS_URL",
    "advanced":   "FACTUM_ADVANCED",
}


# ------------------------------------------------- retiring stale science
#
# The analysis thresholds are not preferences. They encode what the
# signal was measured to do, and when a measurement proves one of them
# wrong the corrected value MUST reach every machine — including one
# whose config.json still holds the number from before the measurement.
#
# Without this, saving any unrelated setting freezes the old thresholds
# forever, silently. It had already happened: `separable_d_prime` sat at
# 1.5 on disk long after real data showed two recordings of the SAME
# resting state separate at d'=1.73 from drift alone. Every "these are
# distinguishable" verdict below that floor was noise reported as a
# finding — the exact failure this whole app exists to avoid.
#
# So: bump CALIBRATION_REVISION whenever a value below changes on
# evidence. Saved copies of those keys from an older revision are
# discarded on load and the measured value takes over. A deliberate
# local override survives by re-saving after the upgrade.
CALIBRATION_REVISION = 2

CALIBRATED_KEYS = (
    "onset_threshold_k",
    "rep_min_duration_s",
    "rep_gap_s",
    "separable_d_prime",
    "trigger_d_prime",
    "consistency_good",
    "fallback_sample_rate_hz",
)


class Config:
    """Dict-backed config with attribute-ish access and lazy persistence."""

    def __init__(self, path: str = CONFIG_PATH) -> None:
        self.path = path
        self._data: Dict[str, Any] = dict(DEFAULTS)
        self.load()

    # ------------------------------------------------------------ load/save

    def load(self) -> None:
        self.retired: Dict[str, Any] = {}
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    stored = json.load(f)
                if isinstance(stored, dict):
                    stale = (int(stored.get("calibration_revision", 0))
                             < CALIBRATION_REVISION)
                    # Only accept keys we know — a stale key from an old
                    # build must not shadow a new default.
                    for k, v in stored.items():
                        if k not in DEFAULTS:
                            continue
                        if stale and k in CALIBRATED_KEYS and v != DEFAULTS[k]:
                            # Measured value wins over a saved older one.
                            self.retired[k] = v
                            continue
                        self._data[k] = v
            except Exception:
                # Corrupt config is not fatal. Defaults are always valid.
                pass
        self._data["calibration_revision"] = CALIBRATION_REVISION
        if self.retired:
            self.save()
        self._apply_env()

    def _apply_env(self) -> None:
        for key, env in _ENV_OVERRIDES.items():
            raw = os.environ.get(env)
            if raw is None or raw == "":
                continue
            default = DEFAULTS[key]
            if isinstance(default, bool):
                self._data[key] = raw.strip().lower() in ("1", "true", "yes", "on")
            elif isinstance(default, int) and not isinstance(default, bool):
                try:
                    self._data[key] = int(raw)
                except ValueError:
                    pass
            else:
                self._data[key] = raw

    def save(self) -> None:
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2, sort_keys=True)
        except Exception:
            pass  # Never let a config write failure take the app down.

    # --------------------------------------------------------------- access

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, DEFAULTS.get(key, default))

    def set(self, key: str, value: Any, persist: bool = True) -> None:
        self._data[key] = value
        if persist:
            self.save()

    def __getitem__(self, key: str) -> Any:
        return self.get(key)

    def as_dict(self) -> Dict[str, Any]:
        return dict(self._data)

    # ---------------------------------------------------------- convenience

    def ws_candidates(self) -> List[str]:
        """Endpoints to try, in order. A pinned `ws_url` wins outright."""
        pinned = (self.get("ws_url") or "").strip()
        if pinned:
            return [pinned]
        cands = self.get("ws_candidates") or []
        out: List[str] = []
        for c in cands:
            if isinstance(c, str) and c.strip() and c.strip() not in out:
                out.append(c.strip())
        return out or list(DEFAULT_WS_CANDIDATES)


# Module-level singleton — the app has exactly one config.
CONFIG = Config()


if __name__ == "__main__":
    c = Config()
    print(f"config path : {c.path}")
    print(f"exists      : {os.path.exists(c.path)}")
    print(f"candidates  : {c.ws_candidates()}")
    print(f"advanced    : {c.get('advanced')}")
    print(f"probe dur   : {c.get('probe_duration_s')}s")
    print("full config :")
    print(json.dumps(c.as_dict(), indent=2, sort_keys=True))
