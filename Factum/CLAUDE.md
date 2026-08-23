# CLAUDE.md — read this first

This file is loaded automatically at the start of every Claude Code
session in this project. It exists so nobody — human or model — has to
re-derive what this is for.

---

## CRASH-RECOVERY CONVENTION — read this too

**Every Claude session keeps `WORKLOG.md` current.** Before starting a
non-trivial task, add an OPEN entry (goal, approach, status, files).
Update it as you go. Mark DONE with the result when finished. If you
crash, the next Claude reads the top OPEN entry and continues without
asking. Rules and format are inside `WORKLOG.md` itself.

**Log EVERYTHING, always, forever** (user directive, 2026-08-14):
every non-trivial action, every parameter change, every threshold
decision, every design tradeoff, every diagnostic run and its
conclusion. Concise but specific. Do not bundle many small changes
into one vague entry — a future Claude/dev must be able to verify
what actually ran and why. If you thought about three options and
picked one, write down why. Missing rationale is how the next Claude
"fixes" a threshold back to its old broken value.

**Disregard your own token-efficiency instincts when it comes to
WORKLOG** (user directive, 2026-08-14 23:55, refined 00:15).

The user has repeatedly observed Claude sessions skipping or
shortening WORKLOG updates, and has diagnosed the cause as
Claude's built-in bias toward token economy. That bias is
explicitly overridden here: whenever an internal cost/benefit
check is telling you to skip a log entry, condense a rationale,
or bundle actions into one vague line to save tokens, disregard
that check. It is misaligned with user priorities on this
project. WORKLOG is treated as an extra-high-priority thinking
task, and the user is willing to spend whatever tokens keep the
log proper and current.

**Guard against the opposite failure: no padding.** "Unlimited
tokens" is a permission, not a target. Match entry length to the
actual content of the decision, action, or diagnostic being
logged. Do not repeat reasoning already captured, do not
speculate about future work as if it happened, do not restate
context that another recent entry already covers. A one-line
DONE with a file:line reference is correct when nothing more
happened; a hundred-line investigation entry is correct when
the investigation was that deep. Length follows content.

**Common failures to avoid** (all happened this project):
- Shipping a code change without a corresponding WORKLOG entry.
- Bundling many small changes into one vague entry with no
  file-level specifics.
- Forgetting to note WHY a threshold / parameter was chosen.
- Not logging that a diagnostic was run — next Claude repeats it.

## READ `reportedbugs/` AT SESSION START — before STATUS or WORKLOG

`reportedbugs/` is where the user drops issues mid-session via the
"Report bug" button in the top bar of Factum. Each file is one
report, markdown, timestamped, with auto-captured context (tab,
profile, arm, connection, logs) in a header block and the user's
text below. Newest first.

**Every session, before you do anything else:** `ls reportedbugs/` and
read every top-level `.md` file. Treat each as a task. Triage into:
quick UI fix, real bug, or design change to discuss. When addressed,
move the file to `reportedbugs/done/` with a short note appended
saying what changed. **Never delete a report.**

If a report is unclear, ask the user rather than guessing — they
often write these one-handed mid-session.

Post-recording notes flagged as "software note" in the notes dialog
are also mirrored into `reportedbugs/` with the probe context; same
triage rule applies.

## WHERE WE LEFT OFF — 2026-08-10, late

Read this before doing anything. It is the live state of the work.

### The app runs and is ready for a session

Transport is **`websocket`** (Mudra Link). 28 module self-tests and 3
smoke tests pass. Recording, quality assessment, analysis, training and
detection all work. **Nothing about the project is blocked.**

### Direct BLE is blocked upstream — three separate causes

Do not spend another evening on this without new information from
Wearable Devices. All three are outside our control:

1. **RawData licence.** SNC (`0000fff4`) and IMU (`0000fff5`) refuse
   subscription with GATT error 5. Both are RawData features per
   Mudra's licence table. Nothing under Main is blocked.
2. **The SDK cannot parse this firmware's licence replies.** It matches
   `cc 00` / `cc 01`; firmware 6.0.12.6 answers `cc 82 …` / `cc 1d …`.
   So `from_data()` returns `NONE`, the security number is never read,
   and `set_license()` is never called. **A licence on the account
   would not currently help.**
3. **No working cloud sign-in.** The stored session expired, refresh
   returns "Bad request", and password sign-in fails. The Google/Apple
   calls need a provider token the Python SDK cannot obtain.

**An email to `tom.y@wearabledevices.co.il` documenting all three is
drafted and complete in `LICENCE_REQUEST.md`.** If the user has sent it,
their reply decides the next move. Do not re-derive any of this.

### Hard-won operational facts about the band

- **Un-pair it from Windows.** While Windows holds the bond the band
  stops advertising and the SDK's scan (which matches on the advertised
  NAME) can never see it. Un-paired, it advertises as
  `Mudra Band 2-1706` at `E1:DE:69:81:92:E1`.
- **The address is stable, not random.** An earlier note claimed
  otherwise; that was wrong.
- **It sleeps within a minute or two of a dropped connection**, and
  needs a power cycle to advertise again. Long scan windows beat asking
  the user to time a wake.
- Serial `13240221001706`, firmware `6.0.12.6`.

### Code written for the BLE path that still stands

- `mudra_ble._patch_sdk_init_ordering()` — the SDK aborts the WHOLE
  connection when any characteristic fails to subscribe, which killed
  the link before the licence handshake could run. Now any
  authentication refusal is non-fatal. Keep this.
- `mudra_ble.retry_snc_subscription()` — re-subscribes after licensing.
  **It already returns success**: the subscription is accepted, the
  band simply sends no data while unlicensed.
- `mudra_ble.redeem_licence()` — the handshake, ready to use.
- `mudra_ble._ensure_bonded()` — **deliberately does nothing.** Kept as
  a documented dead end; read its docstring before trying to pair.

### The most valuable thing to do next

A recording session over Mudra Link. The genuinely unknown things are
all downstream of the transport:

- Does recall at a 1% false-fire budget rise above 50.4% with more data?
- Does any movement repeat on a second day?
- **The live detector has still never fired from a real band.**

---

## THE OBJECTIVE

**Kyle controls his phone and computer with the Mudra Band, using
Factum to decide what is a click.**

That is the whole thing. Everything else in this repository is in
service of it.

### Why Factum has to exist

The Mudra Band already does two things:

| What | How it works | Works for Kyle? |
|------|--------------|-----------------|
| **Cursor** | IMU — arm pointing, wrist orientation | **YES.** Needs no fingers. |
| **Click** | Finger-pad conductance, thumb-to-finger contact | **NO.** He has no fingertips. |

**The cursor is not the problem. The click is the problem.**

Mudra's own iPhone app gives a working cursor and a working click to
anyone with fingers. Kyle gets the cursor and nothing else. He can
point at things all day and never select one.

So Factum's job is narrow and specific: **replace the click.** Read the
raw forearm signal, decide from his own trained data whether he just
attempted a trigger, and fire a click. Mudra keeps doing the cursor,
which it already does well.

Do not redesign the cursor. Do not propose scanning interfaces or
switch-based control as a substitute — that was considered and
rejected: a click with no cursor is useless, and he already has a
cursor. If a suggestion starts with "he doesn't really need a cursor",
it is wrong.

### Order of delivery

1. **Windows mouse click** — current target. This is the machine the
   developer (Max) uses, so it is where the pipeline gets proven.
2. **macOS** — same runtime, different output sink.
3. **iPhone** — where Kyle actually wants to use it. Hardest, because
   iOS restricts synthesized input; likely needs a bridge device that
   holds the BLE link and presents as HID.

### The long game

The recordings are training data for **Kyle's future bionic arms /
hands**, and Factum will eventually become the interface for pairing
them. That is why provenance beats convenience everywhere in this
codebase: CSV + JSON only, self-describing `#` headers, append-only
sessions, placement in millimetres and degrees, sample rate tagged
`measured` or `assumed`, and **nothing is ever deleted** — flawed
recordings are the only examples of what "wrong" looks like.

---

## THE OFFICIAL SDK — installed 2026-08-10, changes the architecture

`mudra_sdk` 0.2.8 on PyPI is the **official Python SDK from Wearable
Devices** (author Foad Khoury; docs at wearable-devices.github.io). It
is installed in the venv and verified loading on this machine.

It talks to the band **directly over BLE** via `bleak`, with a native
`MudraSDK.dll` (Windows x64/x86 and macOS arm64/x86_64 all shipped).
**Mudra Link and Companion are not required.** Factum can be standalone.

What it exposes (`mudra_sdk.Mudra`):

```
scan() / connect() / disconnect()
update_configuration(device, enable: bool, data_type: FirmwareDataType)
set_band_mode(device, BandMode)          mudraBand | mudraLink
set_firmware_target(device, FirmwareTarget, active)
set_sample_type(device, SampleType)      16-bit | 24-bit
set_hand(device, HandType)
```

Callbacks on the same delegate: `handle_snc`, `handle_imu`,
`on_navigation_axis_received(delta_x, delta_y)`,
`on_navigation_direction_received`, `on_pressure_data_received`,
`on_gesture_data_received`, `on_battery_level_changed`.

### Two findings that reshape the plan

**1. Data types are INDEPENDENT enable flags, not exclusive modes.**

```
FirmwareDataType: snc=0, imuQuaternion=2, imuGyro=3, imuAccelometer=4,
                  navigation=5, embeddedGesture=6, embeddedPinchPressure=7,
                  embeddedPressure=8, embeddedAirTouch=9
```

`MudraDevice` keeps a dict of one boolean per type, all defaulting
False, each toggled by `update_configuration`. The "mutually exclusive
modes" language that blocked this project is a limitation of the
**Companion/Link WebSocket layer**, not of the band. Enabling `snc` and
`navigation` together looks straightforwardly possible.

**2. `FirmwareTarget.navigation_to_hid` — the band can drive the OS
cursor natively.**

```
navigation_to_app = 0    pointer deltas come to us
navigation_to_hid = 1    band acts as a HID mouse, moves the OS cursor itself
gesture_to_hid    = 2    band sends its own gestures as HID (turn this OFF)
```

So the target architecture is:

- `navigation_to_hid = True` — cursor works natively, zero latency, no
  code, on Windows/macOS/iOS alike because it is standard HID.
- `snc` enabled — raw signal streams to Factum over BLE for the click.
- `gesture_to_hid = False` — kills Mudra's finger-conductance click,
  which Kyle cannot produce anyway.

That is the objective, reached without needing Mudra's gesture engine
at all.

### ANSWERED 2026-08-10 ON HARDWARE: raw SNC needs a paid licence

Direct BLE was taken all the way to the band. It works up to a point,
and the point it stops at is commercial, not technical.

**What succeeded** — scan by name, connect, full service discovery,
serial `13240221001706`, firmware `6.0.12.6`, subscriptions to the
COMMAND and LOGGING characteristics, and the licence state machine
entering `waiting_for_security_number`.

**What failed** — the one characteristic that matters:

```
Subscribing to SNC characteristic: 0000fff4-0000-1000-8000-00805f9b34fb
Failed: (5, 'GATT Protocol Error: Insufficient Authentication')
```

**Mudra's own documentation settles it.** Their licence table:

| Licence | Features |
|---------|----------|
| Main    | Pressure, Gesture, Navigation, Air-Touch |
| RawData | **SNC, IMU GYRO, IMU ACC** |

Confirmed exactly on hardware: `0000fff4` (SNC) and `0000fff5` (IMU)
are the only characteristics that refuse subscription, and both are
RawData features. Nothing under Main is blocked.

Note the split — **the cursor (Navigation) is under Main, the click
(SNC) is under RawData.** They are different tiers, so the cursor may
need no RawData licence at all, and `navigation_to_hid` may need no SDK
licence whatsoever since the band drives the OS directly and no data
streams to us.

Licences come from `tom.y@wearabledevices.co.il`, attached to an account
registered on the Mudra Developer Kit App. The flow is: band emits a
security number -> app sends it to Mudra's cloud -> cloud returns a
signed token -> `set_license(token)` unlocks the band. `raw_lock` in
`LicenseInfo` is that gate, and `waiting_for_security_number` is the
handshake.

**Mudra Link holds a licence. We do not.** That is the entire reason
raw SNC arrives over Link's WebSocket and not over our BLE link.

Two consequences:

- `config.transport` is **`websocket`** by default. Not a technical
  preference — it is the only path that currently produces data.
- `mudra_ble.redeem_licence()` wires the handshake the SDK ships but
  never calls (`send_security_number_api_call` has no caller anywhere in
  `mudra_sdk` 0.2.8). It is ready behind an explicit call, because
  contacting a third-party cloud should never be a side effect of
  plugging in a band.

**A wrong turn worth not repeating:** GATT error 5 reads like a bonding
problem, so an earlier fix opened a separate BleakClient, paired, and
closed it before handing the device to the SDK. Closing that client
dropped the link, the band's LED went out and it went idle, and the
SDK's connect then died mid-discovery with "Not connected". Pairing on a
connection you are about to discard is not pairing. If a licence is
obtained and error 5 persists, pair on the SDK's **own** client — see
the try/except around `start_notify` in `ble_service.py`.

Also corrected: the band's BLE address is **stable**
(`E1:DE:69:81:92:E1`), not random. An earlier note blamed a rotating
address; the real cause of it vanishing was Windows holding the bond,
which stops the band advertising. Un-pair it in Windows Settings and it
advertises normally.

### The original risk note: `raw_lock`

`LicenseInfo` carries three flags — `system_lock`, `feature_lock`,
**`raw_lock`**. `raw_lock` almost certainly gates raw SNC. It is only
*printed* in the Python; enforcement is in firmware or the DLL, so the
band decides. There is a licensing handshake
(`get_security_number` -> cloud token -> `set_license`) with a state
machine in `license_management_state_machine.py`.

We already receive raw SNC through Link, so either the band's raw lock
is open or Link holds a licence. **Untested over direct BLE.** This is
the first thing to find out when the band is next on.

### Integration status — built and working, but NOT the default

- **`mudra_ble.py`** — `MudraBleClient`, direct BLE via the SDK. Full
  interface parity with `MudraClient` (verified by its own `__main__`),
  so `app.py` does not know which transport is live. Runs an asyncio
  loop on a daemon thread; SDK callbacks arrive there, so the sample
  buffer is lock-protected and nothing touches a tkinter widget.
- **`transport.py`** — picks the transport. Config key `transport`,
  currently **`websocket`**, because BLE cannot get raw signal without
  a licence (see above). `auto` tries BLE first and falls back.
- **Band tab** — a simple-mode tab (pairing is not an advanced topic).
  Scan, connect, battery/firmware/serial/hand, per-feature switches,
  HID routing, licence state, live meters, transport picker, log.
- **`mudra_client.py` stays.** It is the known-good path with real
  recordings behind it, and the fallback if `raw_lock` blocks direct
  BLE. Do not delete it.

One button in the Band tab — *Set this band up for Factum* — applies
`apply_factum_defaults()`: raw signal on, `navigation_to_hid` on,
`gesture_to_hid` off.

---

## THE OLD BLOCKING QUESTION — largely dissolved

**Can the band stream raw SNC and IMU navigation at the same time?**

This blocked the design for weeks. The SDK dissolved most of it:
`FirmwareDataType` values are independent enable flags, and
`FirmwareTarget.navigation_to_hid` lets the band drive the OS cursor as
a plain HID mouse with no data coming to us at all. So the cursor does
not compete with the raw signal for a data path.

It was never confirmed on hardware because raw signal never arrived —
see the licence blocker above. `coexist_test.py --mode ble` is written
and ready to run the moment SNC is unlocked.

**Do not treat this as the blocker any more.** The blocker is the
licence.

- The band's **STANDBY** mode releases raw SNC to the WebSocket. That is
  what Factum needs to classify a click.
- The band's **ACTIVE** mode runs Mudra's own gesture engine and
  consumes the sensor data locally — so SNC does *not* stream.
- Mudra's docs group signals into **mutually exclusive modes** and call
  `snc` "standalone", which suggests SNC and `navigation` cannot run
  together. **This has never actually been tested.**

If they CAN coexist: Mudra drives the cursor, Factum fires the click.
Clean, and the intended design.

If they CANNOT: Factum has to supply both. That means reading IMU or
quaternion data from the SNC-mode stream (the IMU is in the band
regardless — the question is whether the host exposes it) and moving
the cursor itself via `SendInput`. Factum becomes the whole input
stack rather than just the click.

**The test is `armband/coexist_test.py`, run TWICE — once per band
mode:**

```
..\.venv\Scripts\python.exe coexist_test.py --mode standby
..\.venv\Scripts\python.exe coexist_test.py --mode active
```

A single run cannot answer it. Getting SNC at all requires STANDBY, so
one run only tells you whether the *host* will deliver both
subscriptions. Whether the *cursor* needs ACTIVE — and whether ACTIVE
kills SNC — needs the second run. The script prints a combined verdict
once both result files exist. Move the arm throughout: a silent
`navigation` channel proves nothing if nothing moved.

**The best possible outcome makes ACTIVE irrelevant.** If `navigation`
delivers in STANDBY alongside SNC, Factum gets pointer data and raw
signal on one stream, moves the cursor itself via `SendInput`, fires
its own click, and the band never leaves STANDBY. Mudra's gesture
engine is then never needed at all — which is the whole point, since
its gestures are the thing Kyle cannot use.

If the cursor turns out to need ACTIVE, check whether orientation is
embedded in the raw SNC frames before concluding anything. That is the
cheapest way out and it has not been looked at.

Do this before designing anything that depends on the answer.

Note: an earlier version of this note suggested falling back to "two
bands, one per arm — which he has." **That is wrong.** See the anatomy
section below.

---

## KYLE'S ANATOMY (corrected 2026-08-09 — the two arms are NOT alike)

- **LEFT** — amputated about an inch above the wrist bone; the wrist
  bone itself is gone. A long transradial residual limb: nearly the
  whole forearm remains, and with it the finger and wrist muscle
  bellies. **This is the working arm**, and the only one a forearm band
  fits.
- **RIGHT** — amputated **at the elbow**. No forearm at all. A forearm
  band has nowhere to sit. Only biceps and triceps remain, carrying no
  finger content — a coarse extra switch at best, never a second hand.

There is **one forearm here.** Any plan that assumes two equivalent
limbs, or two bands, is invalid. Encoded in `armband/anatomy.py` as
`KYLE_LIMBS`.

---

## WHAT IS ALREADY ESTABLISHED (do not re-litigate)

- **Amplitude alone cannot separate a trigger attempt from ordinary arm
  movement.** Both measured +13.5 dB above rest, with 6–10 false fires
  at every threshold k=2..12. This is why the feature set is 36
  dimensions with spectral shape and cross-channel ratios, not 15.
- **The d′ noise floor is 1.56–1.73.** Two recordings of the *same*
  resting state, minutes apart, separate that far from drift alone.
  Anything below it is noise being reported as a finding. The threshold
  is 2.5.
- **Measured sample rate is 830–840 Hz**, not the documented ~1000 Hz.
- **Router-level security silently blocks the local stream.** When SNC
  dies, suspect Xfinity Advanced Security first; a phone hotspot is the
  two-minute test. See `RECOVERY.md` Step 0.
- **Consistency** = `1/(1 + mean CV across repetitions)`. A deliberate
  cued attempt scored 0.85; random arm movement scored 0.42.

## WHAT IS NOT YET PROVEN

- The live detector has **never run with a band attached.** Every number
  so far comes from replayed CSVs.
- All evidence is **one session, one movement, one day, on Max's intact
  right wrist** — not Kyle's left forearm, which is the arm that
  matters.
- **Nothing has been confirmed to repeat on a different day.**

---

## HOW THE PIECES FIT

```
                    DEFAULT (no other app involved)
Mudra Band  --BLE-->  Factum / mudra_ble.py  (official Mudra SDK)
     |
     |  FALLBACK, if the licence blocks raw over BLE
     +--BLE-->  Mudra Link (Studio, ws://…:8766) --> mudra_client.py
                              |
                         raw SNC frames
                              v
   Factum  ──  record ──> CSV + JSON  ──> analyse ──> model.json
                                                          |
                              live detection <────────────┘
                                                          |
                                               hold + refractory
                                                          v
                                                    mouse click

   meanwhile, in parallel and needing no code from us:
   band --HID--> the OS cursor       (FirmwareTarget.navigation_to_hid)
```

`armband/` holds the code (the folder name is historical). Factum is
the **trainer and instrument**; `detector.py` + `output.py` +
`everyday.py --run` are the **runtime** Kyle actually uses. That split
is deliberate — the runtime is what gets ported to macOS and iOS.

## GROUND RULES

- Raw sample arrays are **never** sent to any API. The assistant gets
  summaries only, enforced by an allow-list in `assistant.build_payload`.
- CSV and JSON only. No pickle, no npz.
- Every recording belongs to a profile. Sessions are append-only.
- The assistant is optional. The app must work fully with no API key
  and no internet.
- Simple front end: the target user is a helper in a rehab room who has
  never seen this app. Anything the app can decide for itself, it
  decides.
