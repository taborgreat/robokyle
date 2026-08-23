"""Which way does Factum reach the band? Chosen once, here.

Two transports exist, with the same interface:

  **ble**        `mudra_ble.MudraBleClient` — the official Mudra SDK over
                 Bluetooth, straight to the band. No Mudra Link, no
                 Companion. This is the default, because depending on
                 another company's desktop app to stay open, in the
                 right mode, with an unchanged protocol, is not a
                 foundation for something a person relies on to use a
                 computer.

  **websocket**  `mudra_client.MudraClient` — the original path, a
                 client of the server Mudra Link or Companion runs. Kept
                 because it is the known-good route, it is proven with
                 real recordings, and it is the fallback if the band's
                 licence turns out to block raw signal over direct BLE.

`auto` (the default) tries BLE and falls back on its own.

The choice is deliberately visible in the Band tab rather than buried:
when something is wrong, "which transport am I even on?" is the first
question worth answering, and a person in a rehab room should be able
to switch to the one that works without editing a config file.
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Tuple

from config import CONFIG

BLE = "ble"
WEBSOCKET = "websocket"
AUTO = "auto"

CHOICES = (AUTO, BLE, WEBSOCKET)

LABELS = {
    AUTO:       "Automatic (Bluetooth, falling back to Mudra Link)",
    BLE:        "Bluetooth — direct to the band, no Mudra Link",
    WEBSOCKET:  "Mudra Link / Companion (WebSocket)",
}

DESCRIPTIONS = {
    AUTO: "Tries Bluetooth first. If the SDK is missing or the band "
          "refuses raw signal, falls back to Mudra Link by itself.",
    BLE: "Factum talks to the band itself over Bluetooth using the "
         "official Mudra SDK. Nothing else needs to be running — but "
         "close Mudra Link and the phone app, because a band only "
         "holds one connection at a time.",
    WEBSOCKET: "Factum connects to the server inside Mudra Link's Studio "
               "tab (or the Companion). Link must be open with the band "
               "connected and in the mode that releases raw signal.",
}


def preference() -> str:
    value = str(CONFIG.get("transport") or AUTO).strip().lower()
    return value if value in CHOICES else AUTO


def set_preference(value: str) -> None:
    if value in CHOICES:
        CONFIG.set("transport", value)


def ble_ready() -> Tuple[bool, str]:
    """Can the Bluetooth path run at all on this machine?"""
    try:
        import mudra_ble
    except Exception as exc:
        return False, f"Bluetooth transport unavailable: {exc}"
    return mudra_ble.sdk_available()


def create(on_log: Optional[Callable[[str], None]] = None,
           forced: str = "") -> Tuple[Any, str, str]:
    """Build the client for the chosen transport.

    Returns (client, transport_actually_used, explanation). Never
    raises: a machine with no Bluetooth and no Link still has to boot
    into a usable app that explains itself.
    """
    want = (forced or preference()).strip().lower()
    if want not in CHOICES:
        want = AUTO

    if want in (BLE, AUTO):
        ok, message = ble_ready()
        if ok:
            import mudra_ble
            return (mudra_ble.MudraBleClient(on_log=on_log), BLE, message)
        if want == BLE:
            # Asked for BLE explicitly and it cannot run. Fall back
            # anyway — refusing to start would strand the session — but
            # say so plainly rather than silently switching.
            from mudra_client import MudraClient
            return (MudraClient(signals=("snc", "imu_acc")), WEBSOCKET,
                    f"{message}  Falling back to Mudra Link.")
        # AUTO: quiet fallback is fine, it is what automatic means.
        from mudra_client import MudraClient
        return (MudraClient(signals=("snc", "imu_acc")), WEBSOCKET, message)

    from mudra_client import MudraClient
    return (MudraClient(signals=("snc", "imu_acc")), WEBSOCKET, DESCRIPTIONS[WEBSOCKET])


if __name__ == "__main__":
    print("preference :", preference())
    ok, message = ble_ready()
    print("ble ready  :", ok, "-", message)
    for choice in CHOICES:
        client, used, why = create(forced=choice)
        print(f"\nforced={choice:10} -> {used}")
        print(f"   {why}")
        print(f"   class: {type(client).__name__}")
    print("\nOK")
