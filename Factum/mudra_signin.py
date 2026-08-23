"""Sign in to Mudra's cloud and report what this account is entitled to.

Run this yourself — it asks for your Mudra password, and the password is
never echoed, never logged, and never stored by this script. The SDK
writes its own session tokens to ~/.mudra_sdk/auth_storage.json, exactly
as it would if you had signed in through any Mudra application.

    .venv\\Scripts\\python.exe mudra_signin.py

Why this exists: raw SNC and IMU are gated behind a "RawData" licence.
Mudra Link has Studio access and can stream raw signal; whether that
same entitlement reaches the SDK for a third-party application is a
different question, and guessing at it wastes a support round-trip.
`GET /me` answers it from Mudra's own records.
"""

from __future__ import annotations

import getpass
import json
import re
import sys

sys.path.insert(0, r"C:\Users\user\mudra-project\armband")


def redact(obj):
    """Never print a token, however deeply nested."""
    if isinstance(obj, dict):
        return {k: ("<redacted>"
                    if re.search(r"token|password|secret|jwt", k, re.I)
                    else redact(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    if isinstance(obj, str) and obj.startswith("eyJ"):
        return "<redacted jwt>"
    return obj


def main() -> int:
    from mudra_sdk.cloud.mudra_server_client import MudraServerClient

    email = input("Mudra account email: ").strip()
    if not email:
        print("No email given.")
        return 2
    password = getpass.getpass("Mudra password (not shown): ")
    if not password:
        print("No password given.")
        return 2

    client = MudraServerClient()

    print("\nSigning in…")
    try:
        client.sign_in_api_call({"email": email, "password": password})
    except Exception as exc:
        print(f"  Sign-in failed: {exc}")
        print("  If this says the account is not activated, check the "
              "verification email. If it says invalid credentials, the "
              "password may differ from your Mudra Link login.")
        return 1
    print("  Signed in. Tokens stored in ~/.mudra_sdk/auth_storage.json")

    print("\nAsking what this account is entitled to…")
    for label, payload in (("application=SDK", {"application": "SDK"}),
                           ("no application filter", None)):
        print(f"\n--- GET /me  ({label})")
        try:
            info = client.get_user_info_api_call(payload)
            text = json.dumps(redact(info), indent=2)
            print(text[:3000])
            flat = json.dumps(info).lower() if info else ""
            for word in ("rawdata", "raw_data", "license", "licence",
                         "permission", "studio"):
                if word in flat:
                    print(f"\n  >>> mentions '{word}' — read the block above")
        except Exception as exc:
            print(f"  {type(exc).__name__}: {exc}")

    print("\nDone. Paste the output back into the session (tokens are "
          "already redacted).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
