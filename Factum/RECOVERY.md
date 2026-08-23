# RECOVERY — SNC pipeline restore

> **START AT STEP 0. It is the one that has actually bitten us.**
> On 2026-08-07 SNC was dead for hours and the cause was **Xfinity
> Advanced Security blocking Mudra's traffic at the router**. Every
> local diagnostic was green the whole time. Do not spend a minute on
> the band, Bluetooth, or Companion until Step 0 is cleared.

Follow the steps IN ORDER. Stop at the first one that fixes SNC.
Every step has:
- **Do:** the concrete action
- **Probe:** the exact command that tests whether it worked
- **Success:** what the probe output must show
- **Failure:** go to next step

The probe used everywhere is `probe_snc.py` in the project root. It
mirrors Factum's subscribe pattern exactly (`subscribe snc`, nothing
else), waits 12 seconds, and reports pass/fail with actual sample
counts. Exit codes: 0 = SNC flowing, 1 = subscribed-but-silent,
2 = no Companion, 3 = band not connected.

Probe command (paste as one line — works from any shell):

```
C:\Users\user\mudra-project\.venv\Scripts\python.exe C:\Users\user\mudra-project\probe_snc.py
```

Session state to remember:
- **Router-level security blocks Mudra traffic silently.** Xfinity
  Advanced Security was the 2026-08-07 root cause. Phone hotspot is
  the two-minute test. This is Step 0 for a reason.
- Companion **must** be launched directly, NOT via Mudra Link.
- The Mudra Link desktop app now has its own **Studio** tab serving on
  port 8766, so Companion may be optional — Factum's endpoint is
  configurable and will connect to whichever host is up.
- v1.0.16 lives at `C:\Users\user\MudraCompanion\MudraCompanion.exe`.
- v1.0.15 lives at `C:\Users\user\MudraCompanion-v1.0.15\MudraCompanion.exe`.
- Full context: `STATUS.md` (state) and `BUILD.md` (design spec).

---

## Step 0 — Rule out router-level security (DO THIS FIRST)

**This is the known root cause of the 2026-08-07 outage.** Xfinity
Advanced Security silently blocked Mudra's traffic at the router. The
PC showed nothing wrong: Companion ran, the band paired, the control
channel answered `get_status` with live battery readings, the Windows
firewall had Allow rules, port 8766 had a listener, and probes
connected fine. The only symptom was that no data ever arrived.

**Recognise the signature:** control channel alive, data channel
silent, every local diagnostic green. That is what a router-level
block looks like from inside this machine — it is indistinguishable
from a band-side fault unless you test the network directly.

**Do:**
1. Turn on the phone's personal hotspot.
2. Connect this PC to the hotspot (Wi-Fi → the phone's network).
   Disconnect from home Wi-Fi.
3. Relaunch Companion:
   ```
   Get-Process | Where-Object { $_.Name -match 'mudra|companion' } | Stop-Process -Force -ErrorAction SilentlyContinue
   Start-Process 'C:\Users\user\MudraCompanion\MudraCompanion.exe' -WorkingDirectory 'C:\Users\user\MudraCompanion'
   Start-Sleep 15
   ```

**Probe:**
```
C:\Users\user\mudra-project\.venv\Scripts\python.exe C:\Users\user\mudra-project\probe_snc.py
```

**Success (SNC flows on the hotspot):** the router is the problem, not
the band or Companion. Fix it at the router:
- Xfinity app → **WiFi** → View WiFi equipment → **Advanced Security**
  → turn it **off**, or allow-list this PC / the Mudra traffic.
- Reconnect the PC to home Wi-Fi and re-run the probe to confirm.
- **You are done. Do not run Steps 1-6.**

**Failure (SNC silent on the hotspot too):** the network is clear —
now the ladder below is worth walking. Reconnect to home Wi-Fi and go
to Step 1.

**Also on this checklist if the hotspot test is inconclusive:** any
other product that filters traffic above this PC — Eero Secure, Fing,
ISP "protected browsing" or parental controls, a router-level VPN, or
a DNS filter such as NextDNS/Pi-hole. Same signature, same test.

---

## Step 1 — Power-cycle the band

**Do:**
- Hold the band's power button until it fully shuts down (LED off).
- Wait 10 seconds.
- Power it back on. Wait for the pairing LED (steady green usually
  means paired-and-ready).

**Success criterion:** the band's LED settles into its normal
paired-and-idle state within ~20 seconds of powering on. If it stays
in a fast blink (searching) for more than 60s, the pairing was lost
— proceed to Step 2 anyway.

---

## Step 2 — Verify Bluetooth pairing in Windows Settings

**Do:**
1. Open **Settings → Bluetooth & devices**.
2. Confirm "Mudra Band 2-1706" is listed under Paired devices.
3. If listed but shows "Not connected", click it → Connect.
4. If missing, click "Add device" → Bluetooth → wait for the band to
   appear → pair.

**Success:** Windows Settings shows the band as **Connected**.

**Failure:** If Windows won't see the band at all, the band's radio
is off or the Windows BT stack is wedged. Try
`Restart-Service bthserv -Force` from an elevated PowerShell, then
retry pairing. If still nothing, go to Step 6 (isolate the band
against another host).

---

## Step 3 — Launch Companion v1.0.16 and confirm pairing

**Do (PowerShell):**
```
# clean any residue from previous session
Get-Process | Where-Object { $_.Name -match 'mudra|companion|pythonw' } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-ChildItem $env:TEMP -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^_MEI|^AweZip' } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

# launch v1.0.16 direct (NOT via Mudra Link)
Start-Process 'C:\Users\user\MudraCompanion\MudraCompanion.exe' -WorkingDirectory 'C:\Users\user\MudraCompanion'
Start-Sleep 15
```

**Probe:**
```
C:\Users\user\mudra-project\.venv\Scripts\python.exe C:\Users\user\mudra-project\probe_snc.py
```

**Success:** probe prints `[PASS] SNC IS FLOWING` with `sample rate: ~1000 /s`. Exit code 0. **STOP — you are done. Launch Factum via `run.bat`.**

**Failure:**
- Exit code 2 (no Companion): Companion crashed on init — re-check
  event log for a new `MudraCompanion.exe` fault, note the module,
  add to STATUS.md, proceed to Step 5 (try v1.0.15).
- Exit code 3 (band disconnected): pairing didn't survive — go back
  to Step 2 and force reconnect, then retry Step 3.
- Exit code 1 (**most likely** — the failure mode we chased all
  night): sub is acked but zero frames. Proceed to Step 4.

---

## Step 4 — Launch Mudra Link alongside Companion

Companion's BLE subscribe may need Link's presence to enable the
band's data characteristic. Link's "network issue detected" error is
harmless for this purpose — we just need the process running.

**Do:**
- Click the Mudra Link icon on the taskbar / Start menu.
- Dismiss any error dialog it shows. Do NOT close the app.
- Wait ~10 seconds.

**Probe:**
```
C:\Users\user\mudra-project\.venv\Scripts\python.exe C:\Users\user\mudra-project\probe_snc.py
```

**Success:** `[PASS] SNC IS FLOWING`.

**Failure:** kill Link (`Stop-Process -Name mudra_link -Force`) to
avoid interference, and go to Step 5.

---

## Step 5 — Roll back Companion to v1.0.15

If v1.0.16 broke the "stream without Link" path, v1.0.15 will show it.

**Do:**
```
Get-Process | Where-Object { $_.Name -match 'mudra|companion|pythonw' } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-ChildItem $env:TEMP -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^_MEI|^AweZip' } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

# launch v1.0.15 direct
Start-Process 'C:\Users\user\MudraCompanion-v1.0.15\MudraCompanion.exe' -WorkingDirectory 'C:\Users\user\MudraCompanion-v1.0.15'
Start-Sleep 15
```

**Probe:**
```
C:\Users\user\mudra-project\.venv\Scripts\python.exe C:\Users\user\mudra-project\probe_snc.py
```

**Success:** `[PASS] SNC IS FLOWING`.
- Record which version worked in STATUS.md.
- Add v1.0.15 to `run.bat`-style launcher.
- File an issue upstream (Wearable Devices) noting the regression.

**Failure:** the problem is not Companion-version-specific. Go to
Step 6.

---

## Step 6 — Isolate the band against another host

Take the band OFF this PC's stack entirely, to determine whether the
band itself is broken or the pairing to this PC is.

**Do:** on a phone (any Android/iOS device where Mudra Link installs
successfully — the primary phone won't install it, but a spare might)
or another Windows PC:
1. Install Mudra Link.
2. Pair the band there.
3. Watch a signal in the Link UI (real-time preview screen usually
   shows electrode activity).

**Success (signals show on the other host):** the band and the band's
BLE data channel are fine. The problem is this PC's stack:
- Bluetooth adapter driver
- The way Companion is being spawned on this machine
- Something else system-wide on this Windows install

Next moves:
- Unpair the band from the other host so it can re-pair to this PC.
- On this PC, Device Manager → Bluetooth → identify the adapter →
  Update driver or Uninstall device (Windows will re-install on
  reboot).
- Consider `netsh int reset`, or removing/re-adding the band pairing
  entirely.

**Failure (no signals on other host either):** the band is the
problem. Contact Wearable Devices support with:
- Band serial number: `13240221001706`
- Firmware: `6.0.12.6`
- Symptom: "BLE control channel connects (get_status shows device
  info + battery) but data characteristic never emits (SNC/IMU/
  pressure/gesture all silent) across multiple Companion versions and
  hosts."

---

## Sanity checks that DON'T need to happen (already ruled out)

Don't waste time on these — they were tested and cleared last night:
- Windows Firewall **on this PC** (mudracompanion.exe already has
  Allow rules on Private + Public; port 8766 was never blocked).
  Careful: clearing the local firewall does NOT clear networking.
  The 2026-08-07 block was at the router — that is Step 0, and it is
  a different layer entirely.
- Factum-side bug (independent Python probe reproduces the failure
  with no Factum code involved).
- Python 3.14 env leak into Companion (Test A launched Companion with
  standard env and it ran fine — the leak did not cause the crash).
- Companion crash on init (the current crash pattern was
  Link-spawning-Companion inheriting AppContainer isolation;
  direct-launch works). See `STATUS.md` "Outage 2026-08-07" section.

## If SNC comes back at ANY step

1. Run Factum: `C:\Users\user\mudra-project\run.bat`
2. Confirm the status chip goes green (`LIVE`, samples/s > 0).
3. Record the below-elbow baseline (task #6): active arm RIGHT, click
   the header's `● Record baseline (10s)` button.
4. Ping me and I'll run the analysis.
