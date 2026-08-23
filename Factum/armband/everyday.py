"""Everyday-use mode — the app running for real, not for a session.

Calibration mode is the full window with tabs. Everyday mode is what
Kyle actually lives with: it launches itself at login, brings up the
Mudra host if it isn't running, loads the last profile and model, and
shows one small always-on-top panel saying what it is doing.

Three constraints shape all of it:

* **He cannot start it.** Someone who cannot operate a mouse or
  keyboard cannot double-click an icon, so the app has to already be
  running. Hence `--run` plus a Startup shortcut.
* **He cannot read a log.** State has to be legible at a glance from
  across a room — colour and size, not text in a status bar.
* **It must never fire by accident.** Everyday mode still starts
  disarmed. Autostart is convenience; arming stays deliberate.

`--run` is the entry point: `run.bat --run`, or the shortcut this
module installs.
"""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any, Dict, Optional, Tuple

STARTUP_SHORTCUT = "Factum.lnk"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def startup_dir() -> str:
    return os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows",
                        "Start Menu", "Programs", "Startup")


def shortcut_path() -> str:
    return os.path.join(startup_dir(), STARTUP_SHORTCUT)


def is_installed() -> bool:
    return os.path.exists(shortcut_path())


def launcher_target() -> Tuple[str, str, str]:
    """(target, arguments, working directory) for the shortcut.

    Points at `pythonw.exe` rather than `python.exe` so nothing flashes
    a console window at login, and at the project's own venv so a
    stale user-site install cannot shadow a bundled library — the
    failure that cost a day in August.
    """
    pythonw = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "pythonw.exe")
    app = os.path.join(PROJECT_ROOT, "armband", "app.py")
    return pythonw, f'"{app}" --run', PROJECT_ROOT


def install_startup() -> Dict[str, Any]:
    """Create the Startup shortcut. Returns a result dict; never raises."""
    if sys.platform != "win32":
        return {"ok": False, "message": "Startup shortcuts are Windows-only."}
    target, arguments, workdir = launcher_target()
    if not os.path.exists(target):
        return {"ok": False,
                "message": f"Cannot find the venv Python at {target}. "
                           f"Create the venv first."}
    directory = startup_dir()
    if not os.path.isdir(directory):
        return {"ok": False, "message": f"No Startup folder at {directory}."}

    # WScript.Shell via PowerShell — no extra dependency, and the same
    # COM object Explorer itself uses to write .lnk files.
    script = (
        "$s = (New-Object -ComObject WScript.Shell)."
        f"CreateShortcut('{shortcut_path()}'); "
        f"$s.TargetPath = '{target}'; "
        f"$s.Arguments = '{arguments}'; "
        f"$s.WorkingDirectory = '{workdir}'; "
        "$s.Description = 'Factum - Mudra band signal detection'; "
        "$s.Save()"
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True, text=True, timeout=30,
            creationflags=0x08000000 if sys.platform == "win32" else 0)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "message": f"Could not run PowerShell: {exc}"}
    if not os.path.exists(shortcut_path()):
        return {"ok": False,
                "message": f"Shortcut was not created. {result.stderr.strip()}"}
    return {"ok": True, "path": shortcut_path(),
            "message": "Factum will now start automatically at login, in "
                       "everyday mode. It still starts disarmed — arming "
                       "output stays a deliberate action."}


def remove_startup() -> Dict[str, Any]:
    path = shortcut_path()
    if not os.path.exists(path):
        return {"ok": True, "message": "Was not installed."}
    try:
        os.remove(path)
    except OSError as exc:
        return {"ok": False, "message": f"Could not remove it: {exc}"}
    return {"ok": True, "message": "Factum will no longer start at login."}


# ======================================================== host self-healing


def host_running() -> bool:
    """Is anything serving the Mudra WebSocket port?"""
    import socket

    for host, port in (("127.0.0.1", 8766), ("localhost", 8766)):
        try:
            with socket.create_connection((host, port), timeout=0.4):
                return True
        except OSError:
            continue
    return False


def ensure_host() -> Dict[str, Any]:
    """Bring up a Mudra host if none is listening.

    Tries Mudra Link first — it is the one the operator prefers, and
    its Studio tab serves the same API. Companion is the fallback, and
    is launched **directly**: spawning it from Mudra Link crashes it
    with an access violation in PyQt6's sip binding (2026-08-07).
    """
    if host_running():
        return {"ok": True, "action": "none",
                "message": "A Mudra host is already serving port 8766."}

    import mudra_link
    started, message = mudra_link.launch()
    if started:
        return {"ok": True, "action": "launched_link", "message": message}

    companion = r"C:\Users\user\MudraCompanion\MudraCompanion.exe"
    if os.path.exists(companion):
        try:
            subprocess.Popen([companion], cwd=os.path.dirname(companion),
                             creationflags=0x08000000)
            return {"ok": True, "action": "launched_companion",
                    "message": "Started Mudra Companion (Link was unavailable)."}
        except OSError as exc:
            return {"ok": False, "action": "failed",
                    "message": f"Could not start Companion: {exc}"}
    return {"ok": False, "action": "failed",
            "message": message if message != "not_installed" else
                       "No Mudra host is installed."}


def status_summary(client, profile, detector) -> Dict[str, Any]:
    """One-glance state for the mini panel."""
    from mudra_client import STATE_LIVE

    state = client.signal_state()
    if state != STATE_LIVE:
        return {"level": "waiting", "headline": "Waiting for the band",
                "detail": client.state_message()}
    if profile is None:
        return {"level": "waiting", "headline": "No profile",
                "detail": "Open Factum and choose a profile."}
    if detector is None or not detector.ready:
        return {"level": "waiting", "headline": "No trained model",
                "detail": f"Open Factum and train a model for "
                          f"{profile.name}/{profile.active_arm}."}
    snapshot = detector.snapshot()
    if snapshot["is_signal"] and snapshot["above_threshold"]:
        return {"level": "signal", "headline": snapshot["label"],
                "detail": f"holding {snapshot['consecutive']}/"
                          f"{snapshot['hold_windows']}"}
    if snapshot["label"] == "movement":
        return {"level": "movement", "headline": "Moving",
                "detail": "ordinary movement — not a trigger"}
    return {"level": "ready", "headline": "Ready",
            "detail": f"{snapshot['fires']} detections this run"}


if __name__ == "__main__":
    print(f"project root   : {PROJECT_ROOT}")
    target, arguments, workdir = launcher_target()
    print(f"launcher       : {target}")
    print(f"arguments      : {arguments}")
    print(f"venv present   : {os.path.exists(target)}")
    print(f"startup folder : {startup_dir()}")
    print(f"folder exists  : {os.path.isdir(startup_dir())}")
    print(f"installed      : {is_installed()}")
    print(f"host listening : {host_running()}")
    if "--install" in sys.argv:
        print("install        :", install_startup())
    if "--remove" in sys.argv:
        print("remove         :", remove_startup())
