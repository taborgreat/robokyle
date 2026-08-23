"""Getting the assistant connected, without editing environment variables.

The assistant is optional, but "optional" should not mean "only if you
already know how to set an env var". This module makes connecting a
button: install the package, sign in through a browser, or paste a key.

An honest note about Claude subscriptions
-----------------------------------------
A Claude Pro/Max subscription (claude.ai and the Claude desktop app) and
Anthropic **API** access are different products with separate billing.
The desktop app has no local endpoint another program can borrow, so
there is nothing to "connect to" there — the assistant talks to the
API, and that is what has to be authorised.

Two ways to authorise it:

* **Sign in (`ant auth login`)** — opens a browser, stores a profile
  under `~/.config/anthropic/`. Every Anthropic SDK finds that profile
  on its own, so nothing else needs configuring. Preferred: no secret
  is written into this project, and the stored token is short-lived.
* **API key** — from console.anthropic.com. Stored as a persistent
  *user* environment variable via `setx`. Simpler, and it works
  offline of any browser flow, but the key sits in the user
  environment in plain text.

Whichever is used, the SDK resolves credentials in a fixed order:
`ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → a stored login profile.
A leftover key therefore **shadows** a fresh browser login — the most
common way this ends up confusing, so `describe()` reports which one is
actually winning rather than just whether something exists.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional

CONSOLE_URL = "https://console.anthropic.com/settings/keys"
CLI_INSTALL_URL = "https://platform.claude.com/docs/en/api/sdks/cli"

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENV_PYTHON = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe")

_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
_NEW_CONSOLE = 0x00000010 if sys.platform == "win32" else 0


def _run(args: List[str], timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True,
                          timeout=timeout, creationflags=_NO_WINDOW)


# ============================================================ what we have


def package_installed() -> bool:
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


CLI_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "ant")
CLI_RELEASES_API = ("https://api.github.com/repos/anthropics/anthropic-cli"
                    "/releases/latest")


def ant_path() -> Optional[str]:
    """Find the CLI without depending on PATH.

    PATH is the unreliable part: a process inherits its environment at
    launch, so installing the CLI while the app is running leaves the
    app unable to see it until a restart. Checking the install
    locations directly means the Sign in button works the moment the
    download finishes.
    """
    found = shutil.which("ant")
    if found:
        return found
    candidates = [
        os.path.join(CLI_DIR, "ant.exe"),
        os.path.join(CLI_DIR, "ant"),
        os.path.join(os.environ.get("USERPROFILE", ""), "go", "bin", "ant.exe"),
        "/usr/local/bin/ant",
        os.path.join(os.environ.get("HOME", ""), ".local", "bin", "ant"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def ant_logged_in() -> Dict[str, Any]:
    """Ask the CLI whether a profile is active. Never raises."""
    executable = ant_path()
    if not executable:
        return {"installed": False, "logged_in": False, "detail": ""}
    try:
        result = _run([executable, "auth", "status"], timeout=20)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"installed": True, "logged_in": False, "detail": str(exc)}
    text = (result.stdout or "") + (result.stderr or "")
    lowered = text.lower()
    # The CLI's wording varies by version, so match on the ideas rather
    # than one exact phrase, and treat "no credentials" as decisive.
    logged_out = any(s in lowered for s in
                     ("not logged in", "no active", "no credential",
                      "not authenticated", "no profile"))
    logged_in = (not logged_out) and any(s in lowered for s in
                                         ("profile", "logged in", "active",
                                          "oauth", "api key"))
    return {"installed": True, "logged_in": logged_in,
            "detail": text.strip()[:400]}


def describe() -> Dict[str, Any]:
    """Full connection state, including which credential actually wins."""
    has_package = package_installed()
    env_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    env_token = bool(os.environ.get("ANTHROPIC_AUTH_TOKEN"))
    cli = ant_logged_in()

    if env_key:
        source = "ANTHROPIC_API_KEY (environment)"
    elif env_token:
        source = "ANTHROPIC_AUTH_TOKEN (environment)"
    elif cli["logged_in"]:
        source = "signed-in profile (ant auth login)"
    else:
        source = None

    ready = has_package and source is not None
    steps: List[str] = []
    if not has_package:
        steps.append("install the anthropic package")
    if source is None:
        steps.append("sign in, or add an API key")

    # Flag the shadowing case explicitly — it is the failure that looks
    # like "I logged in and it still doesn't work".
    warning = ""
    if env_key and cli["logged_in"]:
        warning = ("An API key in the environment takes precedence over "
                   "your signed-in profile. Remove the key if you meant to "
                   "use the login.")

    return {
        "ready":            ready,
        "package":          has_package,
        "credential_source": source,
        "cli_installed":    cli["installed"],
        "cli_logged_in":    cli["logged_in"],
        "cli_detail":       cli["detail"],
        "env_key":          env_key,
        "steps":            steps,
        "warning":          warning,
        "summary":          _summary(ready, has_package, source),
    }


def _summary(ready: bool, has_package: bool, source: Optional[str]) -> str:
    if ready:
        return f"Connected — using {source}."
    if not has_package and source is None:
        return ("Not connected. Two things are needed: the anthropic "
                "package, and either a sign-in or an API key.")
    if not has_package:
        return "Credentials found, but the anthropic package is not installed."
    return "Package installed, but no credentials yet — sign in or add a key."


# ================================================================= actions


def install_package() -> Dict[str, Any]:
    """pip install anthropic into the project venv (not system Python)."""
    python = VENV_PYTHON if os.path.exists(VENV_PYTHON) else sys.executable
    try:
        result = _run([python, "-m", "pip", "install", "--upgrade",
                       "anthropic"], timeout=300)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "message": f"Could not run pip: {exc}"}
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip()[-600:]
        return {"ok": False, "message": f"pip failed:\n\n{tail}"}
    return {"ok": True,
            "message": "Installed. Restart Factum so the new package is "
                       "picked up, then the assistant will be available."}


def _asset_name_for_platform() -> Optional[str]:
    """Which release asset matches this machine."""
    import platform

    machine = platform.machine().lower()
    if sys.platform == "win32":
        if machine in ("arm64", "aarch64"):
            return "windows_arm64.zip"
        if machine in ("x86", "i386", "i686"):
            return "windows_386.zip"
        return "windows_amd64.zip"
    if sys.platform == "darwin":
        return "macos_arm64.zip" if machine in ("arm64", "aarch64") else \
               "macos_amd64.zip"
    if machine in ("arm64", "aarch64"):
        return "linux_arm64.tar.gz"
    return "linux_amd64.tar.gz"


def install_cli(progress=None) -> Dict[str, Any]:
    """Download, verify and install the Anthropic CLI. No dependencies.

    Uses only the standard library so this cannot itself fail for want
    of a package. The download is **checksum-verified against the
    release's own manifest before anything is extracted** — this
    fetches an executable over the network and then runs it, so
    confirming it arrived intact is not optional.
    """
    import hashlib
    import json as _json
    import tarfile
    import tempfile
    import urllib.request
    import zipfile

    def say(message: str) -> None:
        if progress is not None:
            try:
                progress(message)
            except Exception:
                pass

    suffix = _asset_name_for_platform()
    if suffix is None:
        return {"ok": False, "message": "Unsupported platform."}

    try:
        say("Looking up the latest release…")
        request = urllib.request.Request(
            CLI_RELEASES_API, headers={"User-Agent": "factum"})
        with urllib.request.urlopen(request, timeout=30) as response:
            release = _json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return {"ok": False,
                "message": f"Could not reach GitHub to find the CLI: {exc}"}

    version = str(release.get("tag_name", "")).lstrip("v")
    assets = {a["name"]: a["browser_download_url"]
              for a in release.get("assets", [])}
    archive_name = next((n for n in assets if n.endswith(suffix)), None)
    checksum_name = next((n for n in assets if n.endswith("checksums.txt")), None)
    if not archive_name:
        return {"ok": False,
                "message": f"No release asset for this platform ({suffix})."}

    tmp = tempfile.mkdtemp(prefix="ant-install-")
    archive = os.path.join(tmp, archive_name)
    try:
        say(f"Downloading {archive_name} ({version})…")
        urllib.request.urlretrieve(assets[archive_name], archive)
    except Exception as exc:
        return {"ok": False, "message": f"Download failed: {exc}"}

    # Verify before extracting — see the docstring.
    if checksum_name:
        try:
            say("Verifying the download…")
            with urllib.request.urlopen(assets[checksum_name], timeout=30) as f:
                manifest = f.read().decode("utf-8", "replace")
            expected = None
            for line in manifest.splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[-1].lstrip("*") == archive_name:
                    expected = parts[0].lower()
                    break
            if expected:
                digest = hashlib.sha256()
                with open(archive, "rb") as f:
                    for block in iter(lambda: f.read(1 << 20), b""):
                        digest.update(block)
                actual = digest.hexdigest().lower()
                if actual != expected:
                    return {"ok": False,
                            "message": "Checksum mismatch — the download did "
                                       "not match the published hash, so it "
                                       "was NOT installed.\n\n"
                                       f"expected {expected}\nactual   {actual}"}
            else:
                return {"ok": False,
                        "message": "No checksum published for this asset; "
                                   "refusing to install unverified."}
        except Exception as exc:
            return {"ok": False, "message": f"Could not verify download: {exc}"}
    else:
        return {"ok": False,
                "message": "The release published no checksum manifest; "
                           "refusing to install unverified."}

    try:
        say("Installing…")
        os.makedirs(CLI_DIR, exist_ok=True)
        if archive.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(CLI_DIR)
        else:
            with tarfile.open(archive) as t:
                t.extractall(CLI_DIR)
    except Exception as exc:
        return {"ok": False, "message": f"Could not unpack it: {exc}"}

    executable = ant_path()
    if not executable:
        return {"ok": False,
                "message": f"Unpacked to {CLI_DIR} but no `ant` executable "
                           f"was found inside."}
    if not sys.platform == "win32":
        try:
            os.chmod(executable, 0o755)
        except OSError:
            pass

    # Persist on PATH for future sessions...
    path_note = ""
    if sys.platform == "win32":
        script = (
            "$d = [Environment]::GetEnvironmentVariable('Path','User'); "
            f"if (($d -split ';') -notcontains '{CLI_DIR}') {{ "
            f"[Environment]::SetEnvironmentVariable('Path', "
            f"$d.TrimEnd(';') + ';' + '{CLI_DIR}', 'User') }}"
        )
        try:
            _run(["powershell", "-NoProfile", "-NonInteractive",
                  "-ExecutionPolicy", "Bypass", "-Command", script], timeout=30)
        except (OSError, subprocess.SubprocessError) as exc:
            path_note = f" (could not update PATH: {exc})"
    # ...and for THIS process, so Sign in works immediately without a
    # restart. ant_path() also checks the install directory directly,
    # so this is belt and braces.
    os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + CLI_DIR

    return {"ok": True, "path": executable, "version": version,
            "message": f"Anthropic CLI {version} installed and verified.\n\n"
                       f"{executable}\n\nYou can sign in now — no restart "
                       f"needed." + path_note}


def start_login() -> Dict[str, Any]:
    """Launch `ant auth login` in a visible console so the browser flow works.

    Deliberately not captured: the CLI prints a URL and waits for the
    callback, so it needs a real console the user can see and, on a
    remote box, read a code out of.
    """
    executable = ant_path()
    if not executable:
        return {"ok": False, "reason": "cli_missing",
                "message": "The Anthropic CLI (`ant`) is not installed. It is "
                           "what provides the browser sign-in. Press "
                           "\"Install CLI\" to fetch it automatically, or use "
                           "an API key instead."}
    try:
        # Full path, not the bare name: PATH in this process may predate
        # the CLI being installed.
        subprocess.Popen([executable, "auth", "login"],
                         creationflags=_NEW_CONSOLE)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "reason": "launch_failed",
                "message": f"Could not start the sign-in: {exc}"}
    return {"ok": True,
            "message": "A console window has opened and should take you to a "
                       "browser. Finish signing in there, then come back and "
                       "press Check again."}


def set_api_key(key: str) -> Dict[str, Any]:
    """Persist an API key as a user environment variable, and use it now."""
    key = (key or "").strip()
    if not key:
        return {"ok": False, "message": "No key given."}
    if not key.startswith("sk-ant-"):
        return {"ok": False,
                "message": "That does not look like an Anthropic API key — "
                           "they start with `sk-ant-`. Copy it from "
                           f"{CONSOLE_URL}."}
    if sys.platform == "win32":
        try:
            result = _run(["setx", "ANTHROPIC_API_KEY", key], timeout=30)
        except (OSError, subprocess.SubprocessError) as exc:
            return {"ok": False, "message": f"Could not store the key: {exc}"}
        if result.returncode != 0:
            return {"ok": False,
                    "message": (result.stderr or result.stdout or "").strip()}
    # Apply to this process too, so it works without a restart.
    os.environ["ANTHROPIC_API_KEY"] = key
    return {"ok": True,
            "message": "Key saved for your Windows user account and active "
                       "immediately. Note it is stored in plain text in your "
                       "user environment — signing in with `ant auth login` "
                       "avoids that if you would rather."}


def clear_api_key() -> Dict[str, Any]:
    os.environ.pop("ANTHROPIC_API_KEY", None)
    if sys.platform == "win32":
        try:
            # An empty value still occupies the slot and shadows a
            # profile, so delete the entry outright.
            _run(["reg", "delete", "HKCU\\Environment", "/F",
                  "/V", "ANTHROPIC_API_KEY"], timeout=30)
        except (OSError, subprocess.SubprocessError):
            pass
    return {"ok": True,
            "message": "API key removed. A signed-in profile, if you have "
                       "one, will now be used instead."}


def test_connection(model: str = "claude-opus-5") -> Dict[str, Any]:
    """Make one tiny real request and report exactly what happened.

    This is the only way to answer "does my credential actually work
    for this?" — entitlement depends on the account, and guessing from
    the credential's shape is how people end up debugging the wrong
    thing. A few tokens is a cheap definitive answer.

    Written to distinguish the failure modes that look alike from the
    outside: a bad credential, a valid credential without API access,
    an empty balance, and a plain network problem all present as "it
    didn't work" unless you read the status code.
    """
    if not package_installed():
        return {"ok": False, "reason": "package",
                "message": "The anthropic package is not installed yet."}

    import anthropic

    try:
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=model,
            max_tokens=16,
            messages=[{"role": "user", "content": "Reply with the word OK."}],
        )
    except anthropic.AuthenticationError as exc:
        return {"ok": False, "reason": "auth",
                "message": "The credential was rejected (401). If you just "
                           "signed in, check the sign-in actually completed. "
                           "If you have an API key saved, it may be shadowing "
                           "the login — remove it and try again.",
                "detail": str(exc)[:300]}
    except anthropic.PermissionDeniedError as exc:
        return {"ok": False, "reason": "no_api_access",
                "message": "The credential is valid but is not permitted to "
                           "use this API (403). This is what a Claude "
                           "subscription without API access looks like: the "
                           "sign-in works, the API call does not. An API key "
                           "from console.anthropic.com is the way through.",
                "detail": str(exc)[:300]}
    except anthropic.NotFoundError as exc:
        return {"ok": False, "reason": "model",
                "message": f"The account cannot reach `{model}` (404). Try a "
                           f"different model in config.json.",
                "detail": str(exc)[:300]}
    except anthropic.RateLimitError as exc:
        return {"ok": True, "reason": "rate_limited",
                "message": "Rate limited — but that means the credential was "
                           "accepted. It works; just try again shortly.",
                "detail": str(exc)[:200]}
    except anthropic.APIConnectionError as exc:
        return {"ok": False, "reason": "offline",
                "message": "Could not reach the API. Check the network — this "
                           "is the only part of Factum that needs one.",
                "detail": str(exc)[:200]}
    except anthropic.APIStatusError as exc:
        billing = "credit" in str(exc).lower() or "billing" in str(exc).lower()
        return {"ok": False,
                "reason": "billing" if billing else "api_error",
                "message": (f"The credential works, but the account has no "
                            f"API credit ({exc.status_code}). API usage is "
                            f"billed separately from a Claude subscription."
                            if billing else
                            f"API error {exc.status_code}: {exc.message}"),
                "detail": str(exc)[:300]}
    except Exception as exc:
        return {"ok": False, "reason": "failed", "message": str(exc)[:300]}

    text = "".join(b.text for b in response.content
                   if getattr(b, "type", None) == "text").strip()
    state = describe()
    return {
        "ok": True, "reason": "ok",
        "message": f"Working. Authenticated via {state['credential_source']}, "
                   f"replied with \"{text[:40]}\" using {response.model}.",
        "model": response.model,
        "source": state["credential_source"],
    }


def open_console() -> bool:
    import webbrowser
    try:
        return webbrowser.open(CONSOLE_URL)
    except Exception:
        return False


if __name__ == "__main__":
    state = describe()
    print(f"ready            : {state['ready']}")
    print(f"summary          : {state['summary']}")
    print(f"anthropic package: {state['package']}")
    print(f"credential source: {state['credential_source']}")
    print(f"ant CLI present  : {state['cli_installed']}")
    print(f"ant logged in    : {state['cli_logged_in']}")
    if state["cli_detail"]:
        print(f"ant status says  : {state['cli_detail'].splitlines()[:2]}")
    if state["warning"]:
        print(f"WARNING          : {state['warning']}")
    if state["steps"]:
        print(f"to connect       : {', then '.join(state['steps'])}")
    print()
    print("key validation    :", set_api_key("not-a-key")["message"][:70])
