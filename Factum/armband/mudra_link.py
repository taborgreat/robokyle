"""Find and launch the Mudra Link desktop app from inside Factum.

Mudra Link is what pairs the band and — in recent builds — serves the
WebSocket from its **Studio** tab. Getting to it quickly matters: when
the signal is dead in a rehab room, hunting through the Start menu is
time taken from someone who tires.

Mudra Link ships from the Microsoft Store as an MSIX package, so there
is no plain .exe path to run. Three ways in, tried in order:

1. `explorer.exe shell:AppsFolder\\<PFN>!<AppId>` — the canonical way
   to start a packaged app. Going through explorer matters: it starts
   Link in its own AppContainer with a normal parent, rather than as a
   child of this Python process.
2. The **app execution alias** Windows installs at
   `%LOCALAPPDATA%\\Microsoft\\WindowsApps\\mudralink.exe`.
3. If neither exists, Link is not installed — open the download page.

On this machine (2026-08-08):
    PackageFamilyName  WearableDevicesLTD.645800CC05867_rw7dn8myrekwg
    AppId              mudralink
    Alias              %LOCALAPPDATA%\\Microsoft\\WindowsApps\\mudralink.exe

None of that is hardcoded as a requirement — the package is looked up
by name at runtime, so a Store update that changes the version (or the
family name) is handled without a code change.

**Do not use this to launch Mudra Companion.** Companion crashes with
an access violation in PyQt6's sip binding when Link spawns it; that is
a separate, documented failure (STATUS.md, outage 2026-08-07 phase 1).
This module only ever starts Link itself.
"""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Optional, Tuple

# Publisher-stable prefix. The trailing hash changes between Store
# listings, so match on the prefix rather than the full name.
PACKAGE_PREFIX = "WearableDevicesLTD"
APP_ID = "mudralink"
ALIAS_NAME = "mudralink.exe"

# Where to send someone who does not have it installed.
DOWNLOAD_URL = "https://apps.microsoft.com/search?query=mudra+link"
VENDOR_URL = "https://www.wearabledevices.co.il/downloads"

_CREATE_NO_WINDOW = 0x08000000


def _run(args, **kwargs) -> subprocess.CompletedProcess:
    """Run without flashing a console window."""
    flags = _CREATE_NO_WINDOW if sys.platform == "win32" else 0
    return subprocess.run(args, capture_output=True, text=True, timeout=20,
                          creationflags=flags, **kwargs)


def alias_path() -> Optional[str]:
    """Path to the Store app execution alias, if Windows created one."""
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return None
    path = os.path.join(local, "Microsoft", "WindowsApps", ALIAS_NAME)
    return path if os.path.exists(path) else None


def package_family_name() -> Optional[str]:
    """Look up the installed package's family name via PowerShell.

    Returns None if Link is not installed, or if the lookup fails for
    any reason — a failed lookup must degrade to "offer the download",
    never to an exception in the UI thread.
    """
    if sys.platform != "win32":
        return None
    script = (
        f"$p = Get-AppxPackage | Where-Object {{ $_.Name -like '{PACKAGE_PREFIX}*' }} "
        f"| Select-Object -First 1; if ($p) {{ $p.PackageFamilyName }}"
    )
    try:
        result = _run(["powershell", "-NoProfile", "-NonInteractive",
                       "-ExecutionPolicy", "Bypass", "-Command", script])
    except (OSError, subprocess.SubprocessError):
        return None
    name = (result.stdout or "").strip().splitlines()
    return name[0].strip() if name and name[0].strip() else None


def is_installed() -> bool:
    return alias_path() is not None or package_family_name() is not None


def find() -> Tuple[bool, str]:
    """(installed, human-readable description of how we would launch it)."""
    pfn = package_family_name()
    if pfn:
        return True, f"Store app {pfn}!{APP_ID}"
    alias = alias_path()
    if alias:
        return True, f"execution alias {alias}"
    return False, "not installed"


def launch() -> Tuple[bool, str]:
    """Start Mudra Link. Returns (started, message for the user)."""
    if sys.platform != "win32":
        return False, "Mudra Link is a Windows app."

    pfn = package_family_name()
    if pfn:
        target = f"shell:AppsFolder\\{pfn}!{APP_ID}"
        try:
            # explorer.exe returns immediately and reports success via
            # the window appearing, not via its exit code — so we do not
            # check returncode here.
            subprocess.Popen(["explorer.exe", target],
                             creationflags=_CREATE_NO_WINDOW)
            return True, ("Opening Mudra Link. Pair the band, then open its "
                          "Studio tab — Factum picks up the signal on its own.")
        except OSError as exc:
            last_error = str(exc)
        else:
            last_error = ""
    else:
        last_error = ""

    alias = alias_path()
    if alias:
        try:
            subprocess.Popen([alias], creationflags=_CREATE_NO_WINDOW)
            return True, ("Opening Mudra Link. Pair the band, then open its "
                          "Studio tab — Factum picks up the signal on its own.")
        except OSError as exc:
            last_error = str(exc)

    if last_error:
        return False, f"Could not start Mudra Link: {last_error}"
    return False, "not_installed"


def open_download_page() -> bool:
    """Send the user somewhere they can actually get it."""
    import webbrowser
    for url in (DOWNLOAD_URL, VENDOR_URL):
        try:
            if webbrowser.open(url):
                return True
        except Exception:
            continue
    return False


if __name__ == "__main__":
    installed, how = find()
    print(f"installed : {installed}")
    print(f"launch via: {how}")
    print(f"alias     : {alias_path()}")
    print(f"family    : {package_family_name()}")
    if "--launch" in sys.argv:
        ok, message = launch()
        print(f"launch    : {ok} — {message}")
        if message == "not_installed":
            print("opening download page:", open_download_page())
