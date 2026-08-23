# STATUS

Living handoff doc. Update in place as work progresses. A fresh Claude
session should be able to pick up cold from this file plus BUILD.md
(design spec) plus NEXT.md (roadmap).

Last updated: 2026-08-12

---

## 🔴 THE HONEST POSITION — 2026-08-13

Recorded after user stopped the analysis phase to build architecture
from these findings.

1. **Previous 98–99% trigger recall was CV LEAKAGE** — adjacent
   windows crossed the train/test boundary. Correct grouped LORO
   gives 70–88%. **Treat every earlier figure in this project as
   optimistic until recomputed.**

2. **Best measured recall at 1% false-activation = 20.0%** (v1 raw,
   arm-wave distractor, correct grouped LORO by cue index).
   **Not usable as-is.**

3. **v2's 21 spectral features do NOT beat v1's 15 under correct
   grouping and appear to overfit.** Individual spectral features
   rank highest by univariate AUC, but the full set generalises no
   better than v1. **Default to v1 until data volume justifies more.**
   v2 stays available, not default.

4. **Amplitude is an INVERTED discriminator.** Arm movement produces
   MORE signal than a trigger attempt:
     - trigger (curl pointer finger): +11.87 dB raw, +11.32 dB HP20
     - distractor arm-wave:           +17.47 dB raw, +15.30 dB HP20
   Amplitude AUC trigger-vs-arm-wave = 0.224 raw / 0.282 HP20 (below
   0.5 = anti-correlated). Recall @ 1% FA on amplitude alone = 0.0%
   in both. **No amplitude threshold can work.**

5. **Only trigger probes have a cue schedule.** Distractors (mouse,
   arm-wave) were recorded free-form → proper grouped LORO impossible
   on the negative side. **Protocol defect, not an analysis choice.**
   Fixed going forward: distractor_daily and distractor_extreme both
   get cued structure.

6. **Diagnosis: insufficient DATA, not insufficient MODELLING.**
   Effect sizes > 1.2 on individual features and AUC ≈ 0.90 on the
   best single feature, but 20% recall at a strict operating point.
   75 positive windows, 5 repetitions, one session, one arm. The
   model is doing what it can with what it has; the answer is more
   and better data, not more features.

### What this means going forward

- **No more analysis on the existing eight recordings.** Build the
  architecture, record fresh cued data under the fixed protocol,
  measure THERE.
- **Motion gating is the primary mechanism, not an enhancement.**
  IMU_ACC subscription needed (not currently subscribed).
- **Censored samples are missing data with a known bound, not real
  ±1.0 values.** Treated as such — see censored-data architecture
  in the WORKLOG and Part 2 spec.
- **Abstention is a valid output.** A device that says nothing during
  arm movement is better than one that guesses.

### CH3 pinning fixture — diagnosed and paused (2026-08-14)

- Fixture: band on the table off-skin, both apps live. Factum shows
  ch2/ch3 pinned; Mudra native app shows quarter bar. **Not a Factum
  bug** — wire captures prove Companion delivers ch2/ch3 rms ~0.97
  and 93% clipped at the source. Factum faithfully renders what's on
  the wire.
- The rail-alternation is a ~45 Hz frame-to-frame flip (18 samples
  per frame agree, next frame flips), classic floating-electrode
  signature. HP20 does NOT collapse it enough to look small.
- Mudra reference HTMLs (`mudra-monitor.html`, `emg-visualizer.html`)
  are broken — Number-cast batched-array to NaN — not doing DSP.
  So the native Mudra app's "quarter bar" is unreadable from source.
- **Paused. User will collect on-skin recording data first.** If
  on-skin clip% is modest, this fixture is off-skin floating noise
  and there is nothing to fix.
- If it comes back up, the honest fix is Option B: explicit off-skin
  detection (median at ±0.95, clip% > 50% at rest, sign-flip rate
  < 15%) with a "BAND OFF SKIN" label — NOT HP20 on the display.

### Session ceiling / other notes

- Residual clipping after HP20 on arm-wave: 3.5–7.6% per channel.
  RMS understated on strongest contractions — compresses strong vs
  moderate effort. Not fixable in software. Matters for future
  proportional control.
- Probe 001 ch2 (2026-08-12): 6-second intermittent electrode contact
  fault mid-recording (rms 5× neighbours, 17% clipped), self-resolved
  by probe 002. Preflight must include per-channel rest-RMS outlier
  check that NAMES the offending channel.
- Sub-20 Hz SNC power fraction is a monster motion feature by itself:
  trigger median 0.051, arm-wave median 0.294 — the SNC-derived
  motion score. IMU_ACC will be cleaner (zero muscle content).

---

## Where the project is

**Factum** (repo folder still called `armband/` for backward compat)
is a Windows / tkinter Python GUI (Python 3.14). Sole end user is
Kyle, bilateral transradial amputee — helper puts the band on him, so
placement repeatability and one-click flows are first-class.

Runtime dependencies live in a project venv at `.venv/` (Python 3.14.7,
numpy 2.5.1, websocket-client 1.9.0). System Python is intentionally
NOT used — a stale user-site install could shadow bundled libraries
in Mudra's own tools and cause weird failures (see the 2026-08-07
outage below).

The band must be in STANDBY (not ACTIVE), because ACTIVE runs Mudra's
own gesture engine and does not emit SNC.

**The WebSocket host is no longer assumed to be Companion.** Two
programs can serve port 8766, and Factum connects to whichever is up:

- **Mudra Companion** — the standalone PC bridge, serves `/events`.
- **Mudra Link desktop → Studio tab** — newer, also listens on 8766.
  Companion may therefore be optional now.

The endpoint is configurable (`armband/config.json` → `ws_candidates`,
or pin one with `ws_url`; `FACTUM_WS_URL` overrides both for a single
run). The client rotates through the candidates on every reconnect and
settles on whichever produces frames, so nothing needs changing when
you swap hosts.

Run our app:
- `run.bat` (preferred — activates the venv and clears
  `PYTHONNOUSERSITE`/`PYTHONPATH` before invoking `armband\app.py`)
- Or manually: `.venv\Scripts\python.exe armband\app.py`

Run Companion (if using it rather than the Link Studio tab):
- `C:\Users\user\MudraCompanion\MudraCompanion.exe` — the
  freshly-extracted copy of v1.0.16. **Do not launch via Mudra Link**;
  Link's AppContainer isolation breaks Companion's PyQt6 sip init.
  Link is only needed to pair the band; once paired, close Link.

Project layout:

    mudra-project/
        BUILD.md                    design spec
        NEXT.md                     roadmap / ordered work list
        STATUS.md                   this file
        RECOVERY.md                 SNC restore ladder (Step 0 = router!)
        probe_snc.py                standalone SNC pipeline probe
        armband/
            app.py                  tkinter app (simple by default)
            config.py               app config + WS endpoint candidates
            mudra_client.py         WebSocket client + ring buffer
            contact_check.py        contact/quality heuristic
            probe_store.py          probe CSV I/O + streaming ProbeWriter
            session.py              one field session (folder + manifest)
            profiles.py             Profile / ProfileStore
            profile_docs.py         generates CLAUDE.md + README.md
            analysis.py             automatic per-session analysis
            selftest_flow.py        end-to-end check, no GUI, no band
            config.json             written on first run
            profiles/
                _last_profile.txt   pointer to last-used profile
                <profile-name>/     profile folder (see profiles.py docstring)

Every module is self-testable: `python <module>.py` runs its own
checks. `selftest_flow.py` runs the whole field workflow headless —
run it after any change to storage or analysis.

---

## Design principle — SIMPLIFY (2026-08-08, overrides other UI rules)

**More in the background, less on screen.** The target user for the
main screen is a helper in a rehab room who has never seen the app
before, not the developer.

- Default view = profile, arm, signal status, current action. Nothing
  else. Everything else sits behind an **Advanced** toggle, off by
  default, persisted in `config.json`.
- Anything the app can decide for itself, it does — thresholds, window
  sizes, filter defaults, session naming, filenames, probe numbering.
  A control appears only where someone needs to override the choice.
- Automate silently: session creation, baseline prompting, continuous
  saving, analysis on close, file organisation, logging. None of these
  needs a click.
- Diagnostics live in the Log tab, never in the main flow.

Applied to what was already built; applies to everything from here.

---

## What exists

Modules — all self-testable via `python <module>.py`:

- `config.Config` — one JSON config with working defaults for
  everything, env overrides (`FACTUM_WS_URL`, `FACTUM_ADVANCED`), and
  the WS candidate list. A missing or corrupt config is not an error.
- `mudra_client.MudraClient` — WebSocket client with auto-reconnect,
  rotation across all configured endpoints, ring buffer per channel,
  `tail(n)` for exact-count draining during recording, coarse
  `signal_state()`, unknown-message-type logging, first-N-frames
  diagnostic report, DC-drift sampler, `troubleshooting_causes()` and
  `known_good_sequence()` — both of which now lead with the
  router-level security check.
- `contact_check.compute_metrics()` / `evaluate()` / `format_report()`
  — pass/warn/fail on DC offset, AC RMS, clip %, pair correlations.
- `probe_store` — schema `armband/probe/2`. Header keys are the ones
  in the Update 7+8 spec (`profile / arm / session / probe / started /
  duration_s / sample_rate_hz / effort / fatigue / his_confidence /
  placement / filters / notes`), columns are `timestamp,ch1,ch2,ch3`.
  Reads schema 1 files too. **`ProbeWriter` streams to disk during
  recording** and rewrites the header on close, so a crash costs
  nothing — the partial file is valid and marked `status: incomplete`.
  `probe_filename()` gives `002_curl-ring-finger_1433.csv`.
- `session.Session` — one visit: `session.json` (date, location, who
  was present, notes, battery %, charger), `session_notes.md`
  (timestamped quick notes), `probes/`, `probes.json` manifest,
  `analysis.json`, `REPORT.md`, `ANALYSIS_PROMPT.md`. Stamps are
  `YYYY-MM-DD_HHMM`, with a letter suffix if two sessions start in the
  same minute (append-only is enforced — folders are never reused).
  `export_zip()` bundles the session plus the profile docs.
- `profiles.Profile` / `ProfileStore` — folder-per-profile, per-arm
  subtrees, `placement/` at profile root, and `close_session()` that
  analyses automatically.
- `profile_docs` — generates `CLAUDE.md` and `README.md` at profile
  root. Regenerates only files that still carry the generator marker,
  so hand edits are never clobbered.
- `analysis` — the automatic engine. Per probe: SNR vs the session's
  own rest probe, onset latency, rise sharpness, repetition splitting,
  within-probe consistency, channel signature, usability score.
  Across probes: pairwise separability (regularised Fisher d', the
  same boundary an LDA will draw). Across sessions: drift for the same
  probe name. Writes `analysis.json`, `REPORT.md`, `ANALYSIS_PROMPT.md`.

UI (`app.py`) — simple mode is **two tabs**:

- `HeaderBar` — profile picker + New, type badge, arm toggle, signal
  chip, running session timer, quick-note box (Enter or Ctrl+N), and
  the Advanced toggle.
- `Banner` — one sentence, and only when there is something to do:
  what is wrong with the signal, or the fatigue reminder after 20
  minutes. Silent when all is well.
- **Session tab** (the Exploration Lab, and in simple mode the whole
  app): a single cue line telling the helper what happens next; a
  free-text probe name box that suggests names he has used before on
  this arm; one big Record button; countdown; streaming capture; then
  an inline rating strip (effort / fatigue / confidence 1-5 / note)
  with defaults pre-selected so it can be skipped entirely. Below
  that, the sortable probe library (reps, consistency, vs rest,
  effort, fatigue, confidence, usability, notes), scoped to this
  session or every session on this arm. Select any two rows for a
  plain-language separability verdict. Footer: open folder, export
  zip, end session & analyse.
- **Log tab** — connection state, endpoint, frames/samples/rate, band
  info, the ranked troubleshooting causes (router first), the
  known-good sequence, and the rolling event log.
- Advanced adds: Contact & Placement (live meters, verdict,
  correlations, placement note that gets stamped into every subsequent
  probe header), Profile (notes, per-arm placement history, session
  list with Open REPORT.md / Reopen / Close & analyse, delete), and
  the four not-yet-built tabs.
- `RecordingOverlay` — countdown, then drains the client's ring buffer
  to disk every 100 ms. "Stop and keep" finalises early; Cancel still
  keeps what was captured rather than throwing it away.

---

## Verified empirically (do not re-litigate)

- SNC delivers 18 samples/channel/frame, ~53 frames/s, ~1000 Hz
  effective sample rate.
- The `frequency` field on SNC messages reads `21` and is NOT the
  sample rate. A bug where it was treated as such is fixed —
  `MudraClient.samples_per_second()` now derives from
  `frames_received / samples_received`.
- Companion key `gestures` (plural) is used where docs say `gesture`.
  Assume other keys may differ; we log unknown types instead of
  dropping.
- Band ACTIVE mode consumes SNC locally → no stream. STANDBY is what
  we want.
- Connection is reliable only on a fresh Companion launch with our
  app connecting first.
- Channels: ch1=Ulnar, ch2=Median, ch3=Radial.

Storage rules that are locked in:

- CSV + JSON only. Never `.npz`, never pickle for data (a fitted
  classifier `.pkl` is fine but must be shadowed by a JSON metrics
  file).
- Every probe CSV starts with a self-describing `#` header block.
- Sessions are append-only. A session folder is never overwritten and
  never renamed — historical data is how drift gets detected.
- Save continuously during recording, never only at the end. A crash
  must not cost what he already gave us.
- Every profile carries a `CLAUDE.md` and a plain `README.md` so the
  folder explains itself to a stranger in ten years.

---

## Untested / needs verification with the band

Everything below is verified against synthetic signal only. The
headless flow test (`selftest_flow.py`) covers profile creation, session
creation, streamed recording, mid-recording readability, crash
survival, ratings, quick notes, close-and-analyse, cross-session
comparison and zip export — all with generated data. The GUI smoke
test boots the real window and walks every tab. Neither has seen a
band.

- **A real recording end to end.** No probe has ever been captured
  from live SNC. First live session should be: rest, then two or three
  probes, then end the session and read REPORT.md.
- Whether the rep-splitter finds his actual attempts. This is the
  single riskiest assumption in the analysis — synthetic bursts are
  much cleaner than a phantom movement.
- Whether the consistency / d' thresholds mean anything on real data.
- Auto-reconnect when the host is restarted mid-session, and whether
  a reconnect mid-recording leaves a gap or a duplicate (the drain
  logic uses `samples_received` deltas, so it should simply record
  fewer samples — unverified).
- Endpoint rotation actually landing on the Link Studio tab.
- STATE_ALREADY_IN_USE handling — code exists, unobserved in the wild.
- The "all three channels clip at ±1.0 at rest" mystery (below).

---

## Outage 2026-08-07 — RESOLVED — root cause was the ROUTER

**ROOT CAUSE: Xfinity Advanced Security was blocking Mudra's network
traffic at the router.** Not the band. Not Companion. Not Factum. Not
the Windows firewall on this PC. Proof: on a phone hotspot, everything
worked immediately and with no other change.

**If SNC ever goes silent again, check this FIRST — before touching the
band, Companion, Windows Bluetooth, or anything else.** It cost hours
because every local layer looked healthy and nothing on this PC reports
a router-level block. The signature is: control channel fine, data
channel silent, all local diagnostics green.

How to test it in under two minutes:

1. Tether the PC to a phone hotspot.
2. Relaunch Companion, run `probe_snc.py`.
3. If SNC flows on the hotspot but not on home Wi-Fi, it is the router
   — go disable Xfinity Advanced Security (Xfinity app → WiFi →
   View WiFi equipment → Advanced Security → off, or allow-list the
   PC) and retest on home Wi-Fi.

Note this class of cause generally: **router-level / ISP-level security
products can silently drop traffic that every local diagnostic reports
as healthy.** Xfinity Advanced Security is the one that bit us; any
equivalent (Eero Secure, Fing, ISP "protected browsing", parental
controls, a VPN or DNS filter on the router) belongs on the same
checklist.

Two other failure modes were chained onto this and are also recorded
below: Companion crashing on launch when spawned by Mudra Link
(Phase 1, real and separately fixed), and the long dead-end where the
symptom looked like a BLE data-characteristic problem (Phase 2 — that
diagnosis was wrong; it was the router all along).

### Phase 1 (resolved): Companion crashed on init when spawned by Link

Symptoms: Mudra Link showed a "network issue detected" firewall error
on launch; SNC stopped flowing. Hypothesis was "system networking /
firewall change" — wrong.

Actual cause: `MudraCompanion.exe` crashed with `0xC0000005` inside
`PyQt6/sip.cp314-win_amd64.pyd` every time Mudra Link spawned it. The
"firewall" error in Link is a downstream symptom (Link can't reach
Companion because Companion is dead).

Fix (2026-08-07 21:14 local): wipe stale AweZip extractions in
`%TEMP%`, extract `MudraCompanion-Windows.zip` fresh into
`C:\Users\user\MudraCompanion\`, launch `MudraCompanion.exe`
**directly**, not via Mudra Link. Companion then bound port 8766,
paired the band over BLE, and returned correct firmware / battery /
serial number.

Why direct-launch works but Link-launch crashes: Link is a UWP / MSIX
Store app running inside an AppContainer. When Link spawns Companion,
the child inherits DLL-search and env constraints that break PyQt6's
sip binding at init. Direct-launch from a normal user shell has no
such isolation.

**Standing rule: launch Companion via
`C:\Users\user\MudraCompanion\MudraCompanion.exe`. Never via Link.**

### Phase 2 (RESOLVED — it was the router): data-channel silent

Kept for the evidence trail and because the *symptom* will look
identical if this recurs. **The conclusion drawn at the time — a
wedged BLE data characteristic — was wrong.** Xfinity Advanced
Security was blocking the traffic. Everything below is what the
router-blocked state looks like from inside this PC, which is exactly
why it is so misleading: every local layer reports healthy.

Companion is up, band is paired, control channel is healthy — but the
band pushes ZERO data of any kind. Not `snc`, not `imu_acc`, not
`imu_gyro`, not `pressure`, not `gesture`, not `battery` as a stream.

Evidence collected 2026-08-07 22:35 → 22:47:
- `get_status` and `get_device_info` return `state: connected` with
  full device info (`name: Mudra Band 2-1706`, `firmware: 6.0.12.6`,
  `battery: 79-84%`, `hand: RIGHT`, address `E1:DE:69:81:92:E1`).
- Battery reading decreases across polls (84 → 83 → 79), proving
  Companion is actively querying the band — BLE control is alive.
- `subscribe snc` (and any signal) returns `subscription_status
  {subscribed: true}` immediately, then 15s of silence.
- Same test with subscribe ONLY to `snc` (matching Factum's exact
  behaviour): still zero frames. So it is not a "mutually-exclusive
  signal modes" problem (see BUILD §4.3 / get_docs response for the
  IMU / pointer / nav mutual exclusion).
- `unsubscribe snc` seems to cause the band's control-channel state
  to flip to `disconnected` in `get_device_info` — that behaviour is
  reproducible and is a Companion bug independent of the main issue.
- **The failure signature — control channel alive, data channel
  silent** — is the exact signature of "the BLE data
  characteristic's notifications were never enabled." Historically
  the Mudra Link app is what enables them.
- Mudra Link is running (PID stable, no crash events), but has zero
  outbound connections — not even to Companion on :8766. Link is
  hanging silently before it gets to any handshake. Its "network
  issue detected" message is unexplained: no DNS lookups, no
  connection attempts. Launching Link with a cleared PATH does not
  help (Store apps re-init env under AppContainer; our env changes
  don't reach it).

### Ruled out this session

- Firewall / Windows networking **on this PC** (rules for
  `mudracompanion.exe` are Allow on Private+Public; no recent Windows
  updates since Nov 2025; port 8766 is not blocked; port has an active
  listener; probes connect fine). Correctly ruled out — but note the
  blind spot this created: ruling out the *local* firewall was taken
  as ruling out networking entirely. The block was one hop upstream,
  at the router.
- Factum being the source (independent Python probe reproduces the
  failure with no Factum code in the loop).
- Python 3.14 env leak into Companion (Test A launched Companion with
  standard env — user-Python still on PATH — and it ran fine; the
  leak did not cause the crash and does not cause the silent-data
  problem).
- Companion crash on init (was Phase 1; Phase 2 has no crash — it's
  a Companion-alive, data-not-flowing state).

### What actually fixed it

Nothing on this PC. The traffic was being blocked upstream by Xfinity
Advanced Security. Moving to a phone hotspot restored SNC instantly,
which isolated the router as the only remaining variable.

The ladder that was planned (power-cycle band → re-pair Bluetooth →
Companion v1.0.16 → Link alongside → roll back to v1.0.15 → isolate
against another host) was never needed. It is preserved in RECOVERY.md
*below* the network check, because those steps are still the right
ones for a genuinely band-side or Companion-side failure — they just
must not be attempted before the network has been cleared.

### Files ready for the recovery session

- `RECOVERY.md` — numbered post-reboot sequence with per-step probe
  commands and success criteria.
- `probe_snc.py` (project root) — one-command SNC pipeline test.
  Exit codes: 0 = SNC flowing, 1 = subscribed-but-silent (Phase 2
  signature), 2 = no Companion, 3 = band disconnected.
- `C:\Users\user\MudraCompanion\MudraCompanion.exe` — v1.0.16, extracted.
- `C:\Users\user\MudraCompanion-v1.0.15\MudraCompanion.exe` — v1.0.15, extracted.

### API details captured tonight (add to BUILD.md eventually)

From `get_docs` response, signals are grouped into mutually-exclusive
modes. Documented for future implementation of the Exploration Lab /
Classifier:
- `snc` — standalone; safe with pressure, gesture, battery.
- `imu_acc`, `imu_gyro` — IMU mode; incompatible with `navigation`,
  `nav_direction`, `button`.
- `navigation` + `button` — pointer mode; incompatible with IMU and
  with `nav_direction`.
- `nav_direction` — incompatible with IMU, `navigation`, `button`.
- `pressure`, `gesture`, `battery` — always available alongside any
  mode.

Other commands beyond docs: `trigger_gesture` (simulate a gesture on
Companion side for testing), `status` (alias for `get_status`),
`get_docs` (returns the full API doc as a JSON `docs` message on
connect and on request).

Evidence gathered during the outage (all findings pre-fix):
- `mudra_link.exe` running (Store app UI); no `MudraCompanion.exe`
  process anywhere. Port 8766 had no listener — probe returned
  `WinError 10061` (connection actively refused).
- Windows Application event log, 2026-08-07 16:41:35, event 1000:
  `Faulting application name: MudraCompanion.exe`,
  `Faulting module name: sip.cp314-win_amd64.pyd`,
  `Exception code: 0xc0000005` (Access Violation),
  `Faulting module path: C:\...\_MEI502002\PyQt6\sip.cp314-win_amd64.pyd`.
- Also on 2026-08-06 21:45:50, event 1002:
  `MudraCompanion.exe stopped interacting with Windows and was closed`
  (application hang, WER killed it).
- 8 fresh AweZip extract dirs today between 16:36 and 16:47 —
  eight relaunch attempts, all failed.
- Companion is a PyInstaller-packaged Python 3.14 + PyQt6 app
  (`_MEI…` PyInstaller runtime dir; `cp314` = Python 3.14). Payload
  build date 2026-05-19; the .exe itself hasn't changed.
- Firewall rules for `mudracompanion.exe` are all Allow / Private+Public.
  Firewall isn't blocking; there's nothing to block. Nothing recent
  from Windows Update either — newest KB installed is 2025-11-20.
  BUT: `LocalFirewallRules: N/A (GPO-store only)` — Group Policy
  manages firewall, so if a future fix requires a new firewall rule,
  the local `+ Allow` prompt may not stick without admin.

**Phase 1 diagnosis was**: Mudra-side crash triggered specifically by
the Link-spawn code path. Fix was NOT reinstall/downgrade —
direct-launch worked with the same v1.0.16 binary. That finding stands.

**Do not fiddle with Windows Firewall.** That was never the failure.
Firewall Allow-rules for `mudracompanion.exe` already exist for both
Private and Public profiles (see earlier dump). The networking problem
was at the **router**, not on this machine — see the root-cause block
at the top of this section.

---

## Known bugs / unresolved

- **All three channels clip at ±1.0 at rest and track each other
  within 0.003.** Cause unknown. Candidates: differential inputs
  floating, mains hum swamping the signal (charger plugged in), band
  too loose, all three electrodes on the same tissue, Companion
  side-scaling artifact. Not yet investigated. Contact-check heuristic
  will report this as FAIL (high correlation, high clip %) which is
  correct behaviour, but we haven't diagnosed the root cause.
- ~~App crashing on launch.~~ Not reproducible; the GUI smoke test
  boots it, walks every tab in both modes, and shuts down clean.
- ~~`RecordingOverlay._sample_rate_hz = 1000` hardcoded.~~ Fixed — the
  overlay now takes `client.samples_per_second()` at the start of a
  recording (rounded to 10 Hz so the timestamp column stays
  consistent) and records the exact measured rate in the header as
  `extra.measured_rate_hz`.
- ~~`load_probe` stops at the first non-`#` line.~~ Fixed — header
  parsing stops at the column row instead, and a torn final line from
  a crash is dropped rather than failing the whole read.
- **Consistency thresholds are uncalibrated.** `consistency` is
  `1/(1 + mean CV across repetitions)`, and the "0.70 good / 0.50
  problem" lines are reasoned, not measured — no real signal has gone
  through them yet. Expect to move them after the first live session.
  Same for `separable_d_prime = 1.5` and the 12 dB "full marks" point
  in the usability score. All three live in `config.json`.
- Rep-splitting assumes he pauses between attempts. A probe recorded
  as one long continuous contraction will come back as one rep and
  report "cannot judge repeatability", which is correct but only
  helpful if whoever is recording knows to leave gaps. The overlay
  says so during recording ("repeat the movement several times, with
  a clear pause between").

---

## Build 0.4.0 — 2026-08-08 evening (autonomous)

The app now does real work rather than only gathering data. New modules:

- `protocols.py` — guided recording. The overlay cues each attempt
  (GO / RELAX, colour band, countdown, timeline) and **records the cue
  schedule with the samples**, so analysis knows where attempts were
  meant to be instead of inferring it. Five protocols: repeated
  attempts, rest, **everyday movement (no attempt)**, graded effort,
  sustained hold.
- `calibrate.py` — per-arm auto-calibration. Finds the onset threshold
  **by search** (raise k until rest never trips it), measures the d'
  noise floor from rest-vs-rest, and derives trigger hold times.
  Re-runs on every session close. Writes `<arm>/calibration.json`.
- `coach.py` — the in-app guide. Plain-language "what just happened"
  ("baseline is 23% quieter than the last one"), one instruction for
  what to do next, a six-step checklist to a usable mouse click, and
  clickable movement suggestions with the anatomy behind them. Local
  and rule-based — no API key, works offline.
- `model.py` — LDA in numpy, serialised as **plain JSON coefficients**.
  No pickle at all, so the CSV+JSON rule now holds without exception.
  Grouped leave-one-repetition-out cross-validation (splitting
  correlated windows would inflate accuracy badly). Picks a confidence
  **operating point** against a stated false-fire budget.
- `detector.py` — live inference: confidence threshold, hold time,
  refractory. `evaluate_recording()` replays a recording as if live,
  which is how the false-fire claim gets checked against real data.
- `output.py` — pluggable sinks (dry run, mouse click, key press,
  BT-HID stub) with interlocks: dry run default, explicit arm, 5-minute
  expiry, refractory, full log. Self-test asserts every interlock holds.
- `integrity.py` — SHA-256 manifest of every file, append-only
  `audit.log`, and `verify_profile()`. Tampering with a finalised probe
  is detected. Groundwork for the eventual server sync.

UI: simple mode is now **Session / Trigger / Log**. Trigger is in
simple mode because it is the point of the app. Esc disarms live output
from any tab.

### Measured on real signal (right wrist, 2026-08-08_2046)

- Sample rate over Link Studio is **840 Hz**, not the ~1000 recorded
  earlier from Companion. The adaptive rate detection caught it.
- Rest envelope: mean 0.0725, sd 0.0149, peak 0.116.
- **Amplitude alone cannot work.** The everyday-movement recording hit
  +13.5 dB above rest — identical to a real attempt — and produced
  6-10 false triggers in 30s at *every* threshold from k=2 to k=12.
  What separates them is the pattern (waveform length across channels),
  not the size.
- Cued protocol worked first time: 5/5 attempts produced signal,
  consistency 0.845 (vs 0.42 for random arm movement).
- Trained model replayed over the recordings: **zero false fires across
  90s of rest and everyday movement**, but caught only 1 of 5 attempts.
  That is the honest cost of a 1% false-fire budget on one session's
  data. More data should improve recall without giving that back.

---

## Build 0.5.0 — 2026-08-08 late (autonomous)

Focus: make the app smarter, and check its own claims.

- `features.py` — **versioned** feature extraction. v1 was the classic
  15 amplitude/complexity features; **v2 adds 21 more**: spectral shape
  per channel (median/mean frequency, three band powers) and
  cross-channel ratios (log RMS ratios, dominance, entropy spread).
  Driven by evidence: the everyday-movement recording matched a real
  attempt at +13.5 dB, so amplitude could never separate them — but
  spectrum and channel pattern can.
  **Measured on real data: accuracy 70.0% → 73.2%, signal recall
  65.5% → 71.7%, and still zero false fires on live replay.**
  Every model records which feature version it was trained on, and the
  detector always computes that one. A mismatch crashed loudly during
  development, which is exactly what it should do.
- `training.py` — model selection, registry, and learning curve.
  - Tries several configurations and keeps the best by a cost that
    weights false fires 10× above missed detections.
  - Archives every model under `<arm>/models/` with its metrics, flags
    regressions against the previous version, and can restore one.
  - **Learning curve**: trains on increasing amounts of data and
    reports whether more sessions would help.
- `quality.py` — live signal-quality monitoring. Clipping, dropout,
  channel collapse, baseline drift vs the calibrated floor, and mains
  interference. Rolling window with agreement required, so a one-off
  blip stays quiet and a real problem surfaces in the banner **during**
  the session. Every issue carries a specific fix.

### The learning curve, measured on real data

| repetitions | windows | accuracy | signal recall |
|---|---|---|---|
| 2 | 564 | 76.2% | 47.4% |
| 4 | 602 | 77.9% | 69.7% |
| 5 | 621 | 76.8% | 68.4% |
| 6 | 639 | 73.2% | **71.7%** |

Verdict: *still improving, still climbing at the last step.* More
sessions are currently the highest-value thing to do — which is the
first time that claim has been measured rather than assumed. Watch this
table: when it flattens, more repetitions stop being the answer and
placement, movement choice, or features become the bottleneck.

### Bug found and fixed during this build

Model selection reported identical results for every shrinkage value.
Cause: `fit(..., shrinkage: float = SHRINKAGE)` binds the default at
definition time, so rebinding the module global had no effect and every
candidate silently used 0.15. Now threaded through explicitly — and the
choice matters: shrinkage 0.05 gives **50.4% recall vs 41.6%** at 0.15.

---

## Build 0.6.0 — 2026-08-09 (autonomous)

`assistant.py` — the optional AI session assistant (NEXT.md UPDATE 3),
plus an **AI assistant** tab (Advanced).

- **Optional by construction.** No `anthropic` package, no key, no
  network — each returns a plain message and the app carries on. The
  local `coach.py` guidance is unaffected; the assistant is a second
  opinion, never a prerequisite.
- **Summaries only, enforced.** `build_payload()` assembles an
  allow-list of metrics, ratings and notes (~6 KB for a full session).
  `_assert_no_bulk_data()` then refuses to send anything containing a
  list longer than 64 items. The guard should be unreachable — it
  exists because the cost of being wrong is publishing a person's raw
  physiological recording, and its self-test proves it fires.
- Answers append to `ASSISTANT_NOTES.md` in the session folder, so the
  advice lives with the data it was given.

API details worth keeping (checked against current docs, 2026-08-09):

- Default model is **`claude-opus-5`**, overridable in config. NEXT.md
  named `claude-sonnet-4-6` when the roadmap was written.
- `temperature` / `top_p` / `budget_tokens` are **rejected** on this
  model family — steering is by prompt; depth by
  `output_config.effort`.
- Thinking is on by default; raw chain of thought is never returned.
- Safety classifiers can decline a request: HTTP 200 with
  `stop_reason: "refusal"` and possibly empty `content`. The code
  checks `stop_reason` **before** reading `content` — indexing
  `content[0]` unconditionally would crash. Server-side fallbacks are
  opted into so a decline is re-run automatically.
- Streaming with `get_final_message()`, so a long answer on a slow
  connection cannot hit an HTTP timeout.

---

## Build 0.7.0 — 2026-08-09 (autonomous)

Two modules, both aimed at the goal rather than at the data.

`vocabulary.py` — **works backwards from "Kyle drives a mouse"** to the
set of inputs required, and names the specific next thing to record.
More probes is not the goal; the planner exists to stop a session being
spent on a seventh variant of a movement he already has.

- Three tiers, each usable on its own: **one reliable click** (with
  scanning, that alone drives a whole interface), **two inputs**
  (select + back), **three or more** (diminishing returns).
- A capability counts as met only when the movement clears the trigger
  bar against everyday movement **and** repeats across days with a
  fresh placement. Either alone is a signal that worked once, not an
  input anyone can rely on.
- On the current data it correctly reports **0 of 3 capabilities**, with
  `curling pointer finger; sustained` (d'=3.27) as promising but
  unconfirmed, and the next action as "record it again on another day"
  — confirming a provisional input beats hunting for a new one.

`everyday.py` + `--run` mode — the app running for real rather than for
a session. The end user cannot operate a mouse or keyboard, so the app
has to already be running.

- `--run` boots straight into detection: no splash, no main window, no
  setup UI. A compact always-on-top panel shows state in colour, large
  enough to read across a room.
- Windows Startup shortcut installer (Trigger tab → *Everyday mode…*),
  pointing at the venv's `pythonw.exe` so nothing flashes a console and
  no stale user-site install can shadow a bundled library.
- Brings up a Mudra host if none is listening — Link first, Companion
  as fallback, launched **directly** (never spawned from Link, which
  crashes it).
- **Still starts disarmed.** Autostart is convenience; arming stays a
  deliberate action every time. The run-mode smoke test asserts this.

### Open question, recorded rather than guessed at

**Cursor movement probably should not come from SNC at all.** The band
has its own pointer mode (`navigation` + `button`, IMU-driven), which
is a far better fit for moving a cursor. Whether it can run
*simultaneously* with `snc` is untested — the docs group signals into
mutually exclusive modes and call `snc` "standalone", which suggests
not. It is a two-minute check: subscribe to both and see.

It matters because the answer changes the design: if exclusive, either
use scanning (no cursor needed) or one band per arm — he has two. If
not exclusive, IMU pointing plus an SNC click is the strongest option.
**Do not build the mouse layer until this is answered.** The note lives
in `vocabulary.CURSOR_NOTE` and is shown in the app.

---

## Build 0.8.0 — 2026-08-09 (autonomous)

`auth.py` + **Connect…** in the AI assistant tab. Optional should not
mean "only if you already know how to set an environment variable", so
connecting is now a button.

- **Install** — `pip install anthropic` into the project venv only
  (never system Python), run off the UI thread with the result
  reported.
- **Sign in** — launches `ant auth login` in a visible console; it
  opens a browser and stores a short-lived profile under
  `~/.config/anthropic/` that every Anthropic SDK finds on its own.
  Preferred: no secret is written into this project.
- **API key** — validated (`sk-ant-` prefix) before anything is
  stored, then persisted via `setx` and applied to the running process
  so no restart is needed.

Two things worth knowing, both surfaced in the dialog:

- **A Claude Pro/Max subscription is not API access.** claude.ai and
  the Claude desktop app are a separate product with separate billing,
  and the desktop app exposes no local endpoint another program can
  use — there is nothing to "connect to" there. The dialog says so up
  front rather than letting someone discover it after pasting the
  wrong credential.
- **A stale API key shadows a fresh browser login.** The SDK resolves
  `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → stored profile, so
  `describe()` reports *which credential is actually winning* and warns
  when both exist. This is the failure that presents as "I signed in
  and it still doesn't work". There is a **Remove saved key** button
  for exactly that case.

---

## Build 0.9.0 — 2026-08-09 — assistant runs on the Claude subscription

The assistant now has **two backends**, and the default costs nothing
extra:

- **`claude_cli` (default)** — shells out to the Claude Code CLI that is
  already installed on this machine (`%APPDATA%\npm\claude.cmd`,
  v2.1.226) in non-interactive print mode. It runs on the operator's
  **existing Claude subscription** — no API key, no separate API bill.
  The full ~11 KB system prompt plus the session payload goes in on
  **stdin**, because Windows caps a command line at about 8 KB.
- **`api`** — the Anthropic SDK, billed as API usage. Fallback.

Why this route: the Messages API is billed separately from a Claude
subscription, and no amount of code makes a subscription pay for API
calls — that is a product boundary. `ant auth login` authorises API
access *for an organisation*; it does not spend subscription tokens,
which is why it lands on the console's API-key page. Going through
Claude Code sidesteps the question by using the surface the
subscription already covers.

Verified end to end against the real `max-debug` session: 5,823 bytes
sent, answer returned, appended to `ASSISTANT_NOTES.md`.

### The assistant immediately found something the local analysis missed

Asked what to do next session, it flagged that the everyday-movement
recording was *"using band like a mouse cursor"* — **IMU/whole-arm
motion, not the ordinary activity that actually causes false fires**
(scratching, reaching, resting the arm). So the d' figures against it
are optimistic, and the negative class needs re-recording with the arm
doing normal things rather than pointing.

That is a genuine flaw in the data none of the rule-based checks could
have caught, and it is exactly the job this assistant exists to do.

### Also in this build

- `auth.install_cli()` — one-button download of the Anthropic CLI,
  checksum-verified against the release manifest **before** extraction
  (it fetches an executable and then runs it). Refuses to install on a
  mismatch; tested by deliberately corrupting the archive.
- `auth.ant_path()` no longer trusts `PATH`. A process inherits its
  environment at launch, so installing the CLI while the app is running
  left the app unable to see it. It now checks install locations
  directly, and `Sign in` launches by full path.
- `auth.test_connection()` — one ~16-token request that distinguishes
  the failure modes that otherwise look identical: bad credential
  (401), valid credential without API entitlement (403), no credit, and
  a plain network failure.

---

## Build 1.0.0 — 2026-08-09 — the system judges the recordings, not the room

The rule the user set: *"a BAD RECOrding should not have to be deleted,
but kept and analized anyway by AI, its not up to a human to determine
whether a test was bad or not."*

The manual "exclude this recording" feature built earlier that day is
**gone**. It was the wrong shape: it asked the person in the rehab room
to judge clipping, drift and internal inconsistency, none of which they
can see, and it removed data on the strength of that judgement.

### `probe_quality.py` — evidence, not opinion

Every recording now carries a `verdict` (good / suspect / unusable), a
0–1 `score`, and `flags` that each name the measurement behind them and
what to do about it. Checks are environmental (clipping, channel
dropout, channel collapse, mains, baseline drift), behavioural (cue
miss, internal inconsistency, no signal, too short) and contextual
(outlier against other takes of the same movement, needs ≥2 siblings).

**Nothing is ever discarded.** A flagged recording is still analysed
and still reported; the flag says what to distrust, not what to ignore.

Two calibration errors found and fixed against real data:

- Verdicts landing exactly on the 0.40 score boundary put "he produced
  nothing" and "the electrode fell off" in `suspect`. Now a categorical
  `disqualifying` set (`channel_dropout`, `clipping`, `no_signal`,
  `too_short`) forces `unusable` regardless of arithmetic.
- The clipping threshold was calibrated on rest and condemned **all
  three** real movement recordings at 7–9%. Now kind-aware: rest may
  clip 0.5–2%, a movement 5–25%.

Against the real `max-debug` sessions it reads:

    rest                                   good      1.00
    rest 2                                 good      1.00
    curling pointer finger                 suspect   0.78  ch2 clips 7.2%
    Normal movement (everyday)             suspect   0.78  ch3 clips 7.1%
    curling pointer finger; sustained      suspect   0.78  ch1 clips 9.4%

Where it surfaces: a **Recording** column in the probe library
(colour-coded, right-click → *Why was this flagged?* for the full
evidence); a **How much to trust this session** section near the *top*
of REPORT.md, before any usability number a reader could form an
opinion on; and `recording_quality` in the assistant payload, with a
system-prompt note (`probe_quality.ASSISTANT_NOTE`) telling it the
flags are a rule set and it is not — disagree when the evidence
supports it.

`analyse_session` recomputes and persists the verdict every run, so
sessions recorded before the check existed get one too, and contextual
flags update as siblings arrive.

### Automatic second opinion after every recording

`assistant.quick_opinion()` is wired into the rating strip. The moment
a recording finishes, a three-sentence verdict is requested in a
background thread and appears in a **SECOND OPINION** panel while the
person is still in the chair. Best-effort throughout: no backend, no
network, a refusal or a timeout all end with the panel simply not
appearing. Superseded questions are dropped by token, so a fast second
recording never shows the first one's answer. `auto_opinion` in config
turns it off.

Verified live, 10.5 s round trip on the real session. It caught
something no local check did — that the "sustained" recording has only
one repetition, so its repeatability is unknown — alongside the
clipping and a concrete fix.

### Step-by-step walkthrough before every recording

*"the app needs to smart tell me what you want me to test"* — the
next-action headline says **which** recording to make, which is not the
same as knowing **how**. `coach.walkthrough()` returns numbered steps
grouped BEFORE YOU PRESS RECORD / WHILE IT RUNS / WHEN IT FINISHES,
specific to the protocol and the movement name, rewritten as either
changes. Open by default — the person who needs it does not know there
is something to click.

The content is written for a helper who has never seen the app: agree
what the movement means before recording it; complete stillness between
attempts, because the gap is what separates them; a missed attempt is a
finding, do not restart; watch him, not the screen. For a sustained
hold: *let it fade if it fades — whether the signal holds IS the
result.*

### Permission prompts

`.claude/settings.local.json` replaced its 50 one-off command entries
with broad allow rules plus `defaultMode: acceptEdits`, so restarting
and testing Factum no longer prompts.

---

## Build 1.1.0 — 2026-08-09 — anatomy, and hardening for a real session

### Kyle's arms are not symmetric (CORRECTION)

Stated by the user and now encoded everywhere:

- **LEFT** — amputated about an inch above the wrist bone; the wrist
  bone is gone. Long transradial: nearly the whole forearm, so the
  finger and wrist muscle bellies are intact. **The working arm**, and
  the only one a forearm band fits.
- **RIGHT** — amputated **at the elbow**. No forearm at all. Only
  biceps/triceps remain, carrying no finger content.

This invalidated a claim written throughout the project before the
levels were known — that "two residual limbs double the available
vocabulary." **There is one forearm here.** Removed from
`profile_docs.DEFAULT_SUBJECT_CONTEXT`, `assistant._PROJECT_CONTEXT`
and `analysis.render_prompt`; `DOCS_VERSION` bumped to 3 so every
generated `CLAUDE.md`/`README.md` on disk was rewritten.

### `anatomy.py` — the limb, drawn

Placement was free text (*"3 fingers below elbow, mark A"*). Whose
fingers? Rotate the band far enough and the ulnar electrode sits over
the median group, so an identical movement produces a different signal
and the analysis truthfully reports that the movement drifted.

Placement is now two numbers against a drawn limb: **millimetres from
the elbow crease** and **degrees of rotation**. Vector geometry on a
tkinter Canvas — no image files, works offline, renders identically
anywhere. Side view (drag the band along the arm) plus cross-section
(drag to rotate, three coloured electrodes). Stored in `profile.json`,
mirrored to `placement_notes.md`, stamped into every probe header.

It also reports drift: *"Band has moved since last time: 25 mm further
out, rotated 40 deg. Expect the same movement to look different; that
is the placement, not him."*

A limb with no forearm refuses placement and says why. Limb defaults
come from the profile TYPE — a **debug** profile is the developer's own
intact arm, so it is never told it has no forearm mid-session.

### Two real bugs found while hardening

**1. Stale thresholds silently overrode the measured ones.** `config.json`
on disk still held `separable_d_prime: 1.5` and `onset_threshold_k: 3.0`
— the pre-calibration values — and a saved config wins over a code
default. The app was running with the d' threshold *below the measured
noise floor of 1.73*: every "these are distinguishable" verdict under
that floor was noise reported as a finding, which is the exact failure
this app exists to prevent.

Fixed with `CALIBRATION_REVISION` + `CALIBRATED_KEYS` in `config.py`.
Saved copies of measured thresholds from an older revision are retired
on load, the measured value takes over, and the app says so in the
banner. Preferences (`advanced`, window geometry) are untouched. The
GUI smoke test now asserts every calibrated key matches its default —
that check would have caught this.

**2. Sample rate fell back to 1000 Hz.** The stream actually delivers
830–840 Hz. Every probe measures and stamps its own rate, so this only
fired if the stream stuttered at the instant recording began — but it
would then write a number 19% high, permanently, into a file whose
whole purpose is to describe itself accurately in ten years. Now falls
back to a measured `fallback_sample_rate_hz: 840`, and every probe
records **`sample_rate_source: measured | assumed`** so a stranger can
tell the difference. `probe_quality` warns on `assumed` (never
disqualifies — the samples are fine, only cross-recording frequency
comparisons drift).

### `preflight.py` — can we record right now?

One pass over everything that would quietly ruin a session, run every
second and shown as one line at the top of the Session tab: signal
live and at a sane rate, profile selected, debug-vs-subject, limb has a
forearm, placement on record, baseline present, disk space, folder
writable, assistant reachable. Three severities; each answer says what
to *do*. A session with Kyle costs a car journey and twenty minutes of
a tiring arm — the failures worth catching are the ones you only notice
afterwards.

### Shipping launcher

`run.bat` had two invisible defects: **bare LF line endings** (cmd.exe
mis-parses them — it was emitting `'M' is not recognized` eight times
per launch) and **UTF-8 em dashes** that arrive as mojibake in the OEM
codepage. Rewritten ASCII-only with CRLF via
`scratchpad/write_runbat.py`, which asserts both. It now builds its own
venv and installs dependencies on first run, repairs missing imports,
launches console-free via `pythonw`, and logs to `logs\launch.log`
instead of flashing a window and vanishing. Verified: clean output,
visible window, correct title.

### Also

- Probe library gained a colour-coded **Recording** column (quality
  verdict); the quality headline fills an empty Notes cell.
- `_headline` no longer emits a double full stop on sentence-form flags.
- GUI smoke test no longer depends on config left over from a previous
  run — that order-dependence had it silently passing on an empty
  walkthrough panel.

---

## Ordered next work

1. ~~Get the app launching again.~~ Done.
2. ~~Finish the profile system.~~ Done.
3. ~~Exploration Lab.~~ Built 2026-08-08.
4. ~~Field storage layout + automatic analysis (Updates 7+8).~~ Built.
5. ~~Simplify the front end.~~ Built — simple mode is two tabs.
6. **Run a real session with Kyle.** Everything above is verified on
   synthetic data only. Record rest + two or three probes, end the
   session, read REPORT.md, and bring back what the numbers actually
   look like so the thresholds can be calibrated.
7. Diagnose the "all 3 channels clip at ±1.0 at rest" mystery on a
   live signal.
8. ~~Classifier.~~ Built — `model.py`, JSON-only LDA.
9. ~~Action mapping with pluggable output.~~ Built — `output.py`.
10. **More data on one movement.** The single biggest lever on recall
    right now. Same movement, several sessions, band re-placed each
    time. The false-fire side is already where it needs to be; recall
    is what is short.
11. Promotion UI: mark which probes become training classes. Currently
    every movement probe is used. There is still no fixed movement list.
12. Switch mode / scanning for everyday use.
13. Bluetooth HID to the iPhone — the seam exists (`output.BluetoothHIDSink`),
    the stack does not.
14. AI session assistant (NEXT.md UPDATE 3), env var
    `ANTHROPIC_API_KEY`. `ANALYSIS_PROMPT.md` is already the payload it
    should send — summaries only, never raw sample arrays. Note the
    in-app coach is deliberately local and must keep working without it.
15. Server sync. `integrity.py` provides the content hashes and
    per-profile revision a sync layer needs.
16. Autostart + tray (NEXT.md UPDATE 4).

---

## Ground rules the user has enforced

- **More in the background, less on screen.** Default view shows only
  what is needed to run a session; Advanced is off by default. See the
  design-principle section above.
- CSV + JSON only for data. No `.npz`, no pickled arrays.
- Every recording lives under a profile. Nothing gets written outside
  a profile folder.
- Sessions are append-only. Never overwrite, never rename.
- Save continuously during recording, never only at the end.
- The end user cannot operate a mouse/keyboard reliably. Every
  primary flow needs to work with minimal input.
- Everything except the AI assistant works with no internet. Sessions
  happen offline, in a rehab facility, on battery.
- This data may be used for the rest of his life. Formats must stay
  readable in ten years by someone who is not us — hence CLAUDE.md and
  a plain README.md in every profile.
- Assistant (Claude API) is optional; app must work fully without an
  API key. Assistant never receives raw sample arrays.

---

## Docs on disk

- `BUILD.md` — full design spec (purpose, audience, Companion API,
  ten modules, ground rules, open questions). Rebuilt this session
  from NEXT.md + STATUS.md + code so the spec lives on disk rather
  than only in chat history.
- `NEXT.md` — roadmap / ordered work list, kept lightly-edited.
- `STATUS.md` — this file. Living state only.
- `RECOVERY.md` — numbered post-reboot recovery sequence with per-step
  probe commands and success/failure branches. Use this after the
  reboot before doing anything else.
- `probe_snc.py` — standalone SNC pipeline test used by RECOVERY.md.
