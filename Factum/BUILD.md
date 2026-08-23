# BUILD

Full spec for **Factum** — the Mudra Band accessibility-control app.
(Repo folder is still called `armband/` and the storage schema tag is
still `armband/probe/1`, both for backward compatibility with data
already on disk.) This is the durable design doc — what the app is,
who it is for, how it talks to the Mudra Companion, and what each
module has to do. Living state (what is built, what is broken, what
is next) lives in `STATUS.md`. Roadmap-shaped notes live in `NEXT.md`.

---

## 1. Purpose

Turn raw sEMG (surface electromyography) from the Mudra Band into
reliable, low-effort switch inputs for a person who has no hands. The
band is worn on the residual limb; the app reads Mudra Companion's SNC
(single-neuron-channel) stream, filters the signal into a small set of
distinct movements the user can produce voluntarily and repeatably,
then dispatches those movements as input events — first as PC
keystrokes, later as HID over Bluetooth so an iPhone accepts them as
Switch Control input.

The app is a discovery tool first and a controller second. We do not
know in advance which movements the user can produce, how strong they
are, or which ones look distinct to a classifier. The whole flow is
built around finding that out on real data.

Non-goals: gesture recognition of a fixed vocabulary; anything that
assumes fingers exist; anything requiring the user to hold a phone or
click a mouse.

---

## 2. Who this is for

End user is Kyle, bilateral transradial amputee (both hands removed
just above the wrist). Design constraints that fall out of that:

- **All five stock Mudra gestures are unavailable.** Tap, pinch,
  swipe, point, and rotate are defined by fingers touching or a hand
  rotating; the pressure feature measures literal thumb-to-finger
  contact. None of this is anatomically available. The app trains on
  the user's own signals with no fixed movement list anywhere in the
  UI.
- **A helper puts the band on him.** Placement repeatability is a
  first-class feature, not a nice-to-have. The app records placement
  notes per arm per session, computes across-session repeatability
  automatically, and asks the helper the questions that force the
  right observations to be made.
- **He cannot reliably operate a mouse or keyboard to launch the
  app.** The primary flow after calibration is: turn the PC on → app
  autostarts → tray icon shows connected → app detects his signal
  invisibly → keystrokes fire. The full UI is for calibration only.
- **Two residual limbs → two independent signal sources.** The
  profile system holds a `left` and `right` sub-tree that mirror each
  other. Even if each arm produces only one reliable contraction,
  that doubles the available vocabulary.
- **His priority is his iPhone.** iOS forbids third-party apps
  injecting system-wide input, so the PC presents itself to the phone
  as a Bluetooth keyboard. iOS accepts Bluetooth keyboards as switch
  inputs, so Switch Control scanning gives him the whole phone from
  one reliable contraction.

Primary developer / helper is the person reading this file. Not a
research subject in a lab — a person living with the device.

---

## 3. Design principles

- **More in the background, less on screen.** This is the principle
  that overrides the others when they conflict. The target user for
  the main screen is a helper in a rehab room who has never seen the
  app before — not the developer.
  - The default view shows only what is needed to run a session:
    profile, arm, signal status, and the current action. Everything
    else lives behind an **Advanced** toggle, off by default.
  - Anything the app can decide for itself, it decides — thresholds,
    window sizes, filter defaults, session naming, filenames. A
    control is exposed only where someone genuinely needs to override
    the choice.
  - Session creation, rest prompting, continuous saving, analysis on
    close, file organisation and logging are all silent. None of them
    needs a click.
  - Diagnostics live in the Log tab, never in the main flow.
- **Consistency beats raw signal strength.** A weak movement performed
  identically every time is more useful than a strong one that varies.
  **Amended 2026-08-08:** effort and fatigue are recorded and reported
  but act as tie-breakers, not disqualifiers — "getting a good result
  even if tiring is not worth throwing out." The fatigue penalty in the
  usability score dropped from 0.30 to 0.05 accordingly, and reliability
  now carries 0.90 of the weight.
- **Nothing is a fixed constant if it can be measured.** Thresholds are
  derived per-person from that arm's own rest recordings, because a
  constant chosen in advance was demonstrably wrong: `separable_d_prime`
  shipped at 1.5, and real data showed two recordings of the *same*
  resting arm score 1.56-1.73 apart from drift alone. See
  `calibrate.py`.
- **Fail closed on output.** Anything that can affect the machine
  outside Factum defaults to dry run, requires explicit arming, expires
  by itself, and is stopped by Esc from any screen. Missing a click is
  always better than emitting one nobody asked for.
- **Human-legible storage forever.** CSV + JSON only for data.
  Self-describing `#` comment header block at the top of every probe
  CSV. Never `.npz`, never pickle for data (a fitted classifier
  `.pkl` is fine, but it must be shadowed by a JSON metrics file
  next to it). In ten years the files must still open in Excel and
  any text editor.
- **Every recording lives under a profile.** Nothing is ever written
  outside a profile folder. Mis-filed data is worse than lost data.
- **Log the unexpected instead of dropping it.** Unknown WebSocket
  message types get counted and surfaced, not silently ignored, so
  Companion protocol drift is spotted the day it happens.
- **Assistant is optional.** The app must work fully with no
  Anthropic API key. Claude is a coach, not a dependency.
- **Local models only for classification.** Claude never receives raw
  sample arrays; it receives compact summaries.

---

## 4. Mudra Companion API — empirical facts

Companion is Mudra's PC-side bridge (system-tray app, ships with the
band). It exposes a WebSocket on `127.0.0.1:8766`. We treat what we
observe on the wire as authoritative; documented behaviour that
disagrees with observation is treated as wrong.

### 4.1 Endpoints and connection

- Primary: `ws://127.0.0.1:8766/events`
- Fallback: `ws://127.0.0.1:8766`

The client tries the primary first, falls back to the bare host if the
primary connects but yields no data. Reconnect uses exponential
backoff (1s, 2s, 5s, 10s cap). If Companion reports
`client_already_connected`, we back off to 5s polling and keep trying
so the user does not have to click Reconnect after closing the other
client.

Connection is only reliable on a **fresh Companion launch with our
client as the first thing to connect.** The known-good startup
sequence is documented in-app under Troubleshoot, and reproduced here:

1. Quit Mudra Companion completely (right-click tray → Quit).
2. Close the Mudra Link app on the phone.
3. Reopen Companion on the PC.
4. Pair the band in Companion (battery + firmware should appear).
5. Put the band in STANDBY mode.
6. Confirm Companion says the server is LIVE.
7. Launch this app first — before any other Mudra client.

### 4.2 Band mode matters

The band has two modes:

- **ACTIVE** — Mudra's own on-band gesture engine runs; the band
  consumes the sensor data locally and **SNC does not stream over
  the socket**. Companion also seems to disable its own server output
  in this mode.
- **STANDBY** — raw SNC is released to Companion, and Companion
  broadcasts it. This is what we need.

"Subscribed but zero frames for >3s" is a first-class UI state
(`STATE_NO_SNC`) with a specific message: "Band is likely in ACTIVE
mode. Put the band in STANDBY, then restart Companion, then launch
this app first." We do not treat it as a generic "waiting" state.

### 4.3 Wire protocol

Client → server (JSON):

```
{ "command": "subscribe", "signal": "snc" }
{ "command": "unsubscribe", "signal": "snc" }
{ "command": "get_status" }
```

The client also re-issues `subscribe` on every status poll (~2s) so
that a band that transitions ACTIVE → STANDBY starts streaming
without a manual reconnect.

Server → client message types the client recognises. Anything not in
this set is counted in `unknown_types` and logged the first time it
appears, so a Companion protocol change is caught early:

- `snc` — sample batch (see §4.4).
- `status` — Companion + device status snapshot; body has
  `device.{firmware, serial_number, hand, battery, charging}` and,
  in this build, embeds `subscriptions` under it too.
- `connection_status` — unsolicited on connect; contains
  `usage.available_signals` (list of strings the server can emit).
- `subscriptions` — unsolicited on connect; a `dict` of subscription
  state. **This build uses the key `gestures` (plural) where the
  docs say `gesture` (singular).** Assume other keys may differ.
- `subscription_status` — ack of a subscribe/unsubscribe.
- `docs` — full protocol docs pushed on connect. Ignored.
- `error` — server-side error; body has an `error` string, which
  gates the `STATE_ALREADY_IN_USE` UI state.
- Signal channels: `gesture` / `gestures`, `button`, `pressure`,
  `imu_acc`, `imu_gyro`, `navigation`, `nav_direction`, `battery`,
  `device`.

### 4.4 SNC frame shape (verified empirically)

An `snc` frame's `data.values` is a 3-element list; each element is
either a list of samples for that channel or a bare scalar. Empirical
values on this Companion build:

- 3 channels: **ch1 = Ulnar, ch2 = Median, ch3 = Radial.**
- Batch size: **18 samples per channel per frame.**
- Frame arrival rate: **~53 frames/s.**
- Effective sample rate: **~1000 Hz.**
- Value range: nominally `[-1, +1]` float. **In current at-rest
  observations all three channels sit at ±1 and track each other
  within 0.003 — cause unresolved (see §14).**
- `data.frequency` field reads **21** and **is NOT the sample rate**.
  A previous bug where it was used as such is fixed. The client
  derives `samples_per_second` from `samples_received /
  frames_received` × observed frame rate instead.

The client's ring buffer holds five seconds per channel and is
protected by a single lock; `snapshot(seconds)` returns a `(3, N)`
`float32` array of the most recent `seconds` worth of samples.

---

## 5. Repository layout

    mudra-project/
      NEXT.md              roadmap and ordered work
      STATUS.md            living session-cold state
      BUILD.md             this file
      armband/
        app.py             tkinter app (single-window, tabbed)
        mudra_client.py    Companion WebSocket client + ring buffer
        contact_check.py   contact-quality heuristic and report
        probe_store.py     probe CSV + metrics JSON I/O
        profiles.py        Profile + ProfileStore
        profiles/          on-disk profile tree
          _last_profile.txt
          <profile-name>/  see §6 for layout inside

Everything runs in one process. There is no server component and no
background daemon (yet — the tray build in §12 will make the app a
long-lived process, but still one process).

---

## 6. Profile system — the top-level container

Every recording, log, measurement, and model belongs to exactly one
profile. Nothing is ever written outside a profile folder. Deleting a
profile deletes everything under it.

### 6.1 On-disk layout

    armband/profiles/
      _last_profile.txt        pointer, one line, holds last-opened name
      <profile-name>/
        profile.json           name, type, notes, active arm, open sessions
        log.txt                rolling append-only event log
        left/
          placement_notes.md   append-only human notes, dated bullets
          characterization.json
          thresholds.json
          mappings.json
          model.pkl            fitted classifier (only binary — shadowed
                               by model.json for auditability)
          model.json           metrics + feature list for the model
          sessions/
            2026-08-07_15-32-11/
              session.json     started_utc, ended_utc, arm, profile
              baseline_rest.csv
              characterize_rest.csv
              characterize_contract.csv
              probes/
                curl-index_001.csv
                curl-index_001.metrics.json
                ...
        right/                 mirror of left/

### 6.2 Naming rules

Profile names are lowercase, `[a-z0-9_-]{1,64}`, start with an
alphanumeric. Whitespace on input is collapsed to `-`. Names are
normalised before use so casing typos do not create duplicate profiles.

Session stamps are `YYYY-MM-DD_HH-MM-SS` in local time. They sort
lexically and are unambiguous when copied between machines.

### 6.3 Profile types

- **`subject`** — real user profile. Everything counts.
- **`debug`** — throwaway profile for testing the app. Visible badge
  in the UI so this data is never mistaken for real recordings.

### 6.4 The Profile API (`profiles.py`)

- `ProfileStore(root)` — directory-backed collection.
  `list_profiles`, `exists`, `create`, `load`, `load_or_create`,
  `delete`, `last_used`, `set_last_used`.
- `Profile` — thin handle around a folder. Path helpers for every
  arm-scoped file (`placement_notes_path`, `characterization_path`,
  `thresholds_path`, `mappings_path`, `model_path`, `model_metrics_path`).
- Session helpers: `current_session_dir(arm, create=True)` opens or
  returns the currently open session on that arm and lazily writes
  `session.json`. `close_session(arm)` stamps `ended_utc` and clears
  the open pointer. `reopen_session(arm, stamp)` un-ends a
  previously-closed session (used when the helper realises they
  finished too early). `session_info(arm, stamp)` returns a structured
  dict (started_utc, ended_utc, open flag, baseline count, probe
  count).
- Placement notes: `append_placement_note(arm, note)` appends a
  timestamped bullet to `placement_notes.md`. Never overwrites.
- `set_notes(text)` updates the profile-level free-text notes.

### 6.5 UI expectations for the profile system

The **profile bar** at the top of the window is always visible on
every tab: profile picker + `+ New`, type badge (SUBJECT / DEBUG),
arm toggle (Left / Right radio), open-session indicator, primary CTA
`Record baseline (10s)`. Mis-filed data is worse than lost — the
picker cannot be hidden.

The **Profile tab** is the deep view: summary strip, profile-level
notes editor, per-arm columns each with placement-notes history,
add-note entry, and a session list (Treeview: stamp, state, baselines,
probes) with Open-in-Explorer / Reopen / Close-open-session /
Make-active. Delete-profile requires the helper to type the name to
confirm.

---

## 7. The ten modules

Numbered by rough order of dependence. 1 through 3 are foundational; 4
and 5 are the calibration loop; 6 and 7 are the run-time loop; 8, 9
and 10 are ergonomics on top.

### Module 1 — Contact check (`contact_check.py`)

Purpose: tell the helper whether the band is on the arm well enough
to bother recording anything.

Inputs: a `(3, N)` float32 window of recent SNC samples (nominally 1s
at 1000 Hz).

Computed:

- `dc_offset` per channel (mean).
- `ac_rms` per channel (RMS after DC removal).
- `clipped_pct` per channel (% of samples with `|x| >= 0.999`).
- `corr[3,3]` pairwise AC-coupled Pearson correlation.
- `max_pair_corr` and which pair.

Thresholds (rationale in code): correlation `>=0.90` fails,
`>=0.70` warns; clipping `>=2%` fails, `>=0.5%` warns; DC offset
`|>=0.50|` fails, `|>=0.30|` warns; AC RMS below `0.005` per channel
= no signal.

Output: `ContactVerdict(passed, severity, headline, issues, hints)` — a
structured verdict where `hints` are specific physical actions
("unplug the laptop from its charger", "wipe the residual limb and
inside of the band with a damp cloth", "rotate the band 30–60°").

UI: shown side-by-side with three live RMS meters and the correlation
triple. The verdict, meters, and correlations update at 5 Hz off the
ring buffer, so the helper can watch them respond in real time as they
adjust the band.

**Recalibration is expected.** The current thresholds are heuristic
starting points; once the ±1-at-rest mystery (§14) is understood, the
numbers get revisited.

### Module 2 — Placement guide

Purpose: reduce day-to-day placement variance to something the
classifier can survive.

Provides:

- A free-text placement-note field per arm ("3 fingerwidths below
  elbow, band label facing thumb"), appended as timestamped bullets
  to `<arm>/placement_notes.md`. Never overwritten.
- History view of every past note, so the helper can copy last
  session's arrangement rather than reinvent it.
- Across-session repeatability score (computed by the Exploration
  Lab, module 10) that surfaces here as a plain-language answer to
  "does today look like a normal day for this arm?".

Not a wizard. The helper reads the last note, positions the band,
watches the three RMS meters move independently, adds a new note if
they moved anything.

### Module 3 — Profiles (`profiles.py` + Profile tab)

Spec in §6. This is the container everything else fills.

### Module 4 — Guided training

Purpose: get from "the user can produce some movements" to "we have
class-labelled recordings ready for a classifier".

Flow (per session):

1. Contact check must pass (or the helper acknowledges a warn).
2. Record a **rest baseline** at the start of every session. His
   baseline drifts with placement, skin condition and fatigue, and
   every other measurement is relative to it. The header CTA
   `Record baseline (10s)` does this.
3. For each movement promoted from the Exploration Lab into the
   training set: countdown, prompt, record N repetitions with rests
   between, save each rep as a probe under
   `probes/<class>_<001>.csv`.
4. Show live per-class strength during recording so the helper can
   stop early if a rep was clearly wrong.

Training is not a wizard the user follows silently — it is a
conversation between the helper and the app about which recording to
keep and which to redo. Every probe is annotated with `effort`,
`fatigue`, and `confidence` (1–5) at recording time.

### Module 5 — Classifier

Purpose: given a live window of SNC, return "class X, confidence C".

Model: LDA or linear SVM over engineered features. Not a neural net.
Reasons: (a) tiny training sets — dozens of probes per class, not
thousands, (b) interpretable so we can see which channels each class
lives on and diagnose confusion, (c) fast enough to run in-process on
short windows, (d) small enough that the fitted model is a few
kilobytes.

Feature vector per window (draft — locked in when the classifier is
implemented):

- Per channel: mean, std, RMS, MAV (mean absolute value), waveform
  length, zero-crossing rate, slope-sign changes, spectral centroid,
  dominant frequency, band-power in a few bands.
- Cross-channel: pairwise correlations, RMS ratios.
- Onset features: latency from rest crossing, rise sharpness.

Persistence: `<arm>/model.pkl` for the fitted estimator, `model.json`
for feature list + per-class metrics + confusion matrix. The `.pkl`
is the only binary artefact in the tree and is always shadowed by the
JSON so we can read the results without unpickling.

Live inference runs against a rolling window (~250–500 ms), fires a
class when confidence crosses a per-class threshold and the previous
`hold_ms` has elapsed to avoid re-triggering on the same contraction.

### Module 6 — Action mapping

Purpose: translate `class_id → output event`.

The map is stored per-arm in `<arm>/mappings.json` as an ordered list
of rules:

```
[
  { "class": "curl-index",  "output": "keystroke", "value": "space" },
  { "class": "spread",      "output": "keystroke", "value": "return" }
]
```

The output layer is **pluggable**:

- `keystroke` — `pynput` on the local machine (development).
- `hid_ble` — Bluetooth HID to a paired iPhone (module 7 + Switch
  Control).
- Future: OSC, MIDI, MQTT, whatever a specific assistive rig needs.

Do not hardcode `pynput` as the only output path. The dispatch layer
takes an `Output` interface and asks it to `send(event)`.

### Module 7 — Switch mode / iPhone output

Purpose: turn one reliable contraction into whole-phone control.

Mechanism: the PC presents itself as a Bluetooth HID keyboard. iOS
accepts Bluetooth keyboards as **Switch Control** sources, so Kyle's
one contraction is scanned across every element on the screen and
selected on the next contraction (or on a long-hold, depending on the
Switch Control config he sets on the phone).

The app has a **Switch mode** tab that is the day-to-day surface: it
shows connection to the phone, shows the class firing in real time,
and has a big obvious pause button. Everything else in the app is
setup.

### Module 8 — AI session assistant

Purpose: turn the numeric feedback into plain language and specific
next actions.

Uses the Anthropic API. Model: `claude-sonnet-4-6`. API key comes from
the `ANTHROPIC_API_KEY` environment variable; if unset, the tab shows
a friendly "assistant off — the app works fully without it" panel and
nothing calls out to the network.

**What Claude receives** (compact summaries only, never raw samples):

- Contact check stats (DC offset, AC RMS, clip %, correlations).
- Per-probe summaries: strength, consistency, effort, fatigue,
  confidence, my written notes.
- Per-class accuracy, confusion matrix, per-channel weights from
  the classifier.
- Profile placement notes, session history, across-session
  repeatability.

**What Claude returns:**

- What the numbers mean in plain English.
- The single best fix to try next, ranked.
- Which probes to promote into the training set, which to drop and
  why.
- Explicit flags for probe pairs that the classifier will confuse.
- A written session note appended to the profile.

System prompt: explains bilateral transradial amputation; that
movements are attempted / phantom rather than externally-visible; that
the goal is the smallest set of reliably separable signals, not the
largest.

### Module 9 — Autostart, background mode, tray

Purpose: usable by someone who cannot operate a mouse to launch the
app.

- `--run` mode: boots straight into detection using the last-used
  profile, no setup UI, no clicks needed.
- **Minimize to system tray.** The full UI is calibration only; day
  to day it runs invisible.
- Windows Startup shortcut so it launches at login.
- Auto-reconnect if the band drops or Companion restarts, with
  backoff (already implemented in `mudra_client.py`).
- Detect on startup whether Companion is running, and launch it if
  not.
- **Tray icon** showing state at a glance: connected / signal quality
  / which profile is loaded / which arm is active.
- `run.bat` in the project root so the helper never has to see a
  command line.

### Module 10 — Exploration Lab

Purpose: **discover** which movements the user can produce, before
committing to a class list. This is deliberately built BEFORE the
classifier, because we do not know his usable movement set.

Concept: a **probe** is a single short recording. Free-text name
chosen by the user in the moment ("curl ring finger", "spread
fingers", "the twitchy one"), not from a fixed list. Configurable
duration, default 30s, with countdown. Records raw SNC to disk,
tagged to the profile and arm.

Alongside each probe:

- **Structured ratings**, filled by the helper at record time:
  effort (easy / moderate / strenuous), fatigue after repetition
  (none / some / high), user's self-reported confidence he was doing
  the same thing each time (1–5).
- **Free-text notes**, filled during or after recording.

**Auto-computed per probe** (all written to
`<name>.metrics.json` next to the CSV):

- Signal-to-baseline ratio per channel, relative to the session's
  rest recording.
- Onset latency and rise sharpness.
- Within-probe consistency: split into repetitions, measure variance
  of the feature vector across them. A movement that looks
  different every time is unusable no matter how strong it is.
- Across-session repeatability when the same probe name is recorded
  on different days.
- Channel signature — which channels carry it (which of ulnar /
  median / radial lights up).

**Probe library**: all probes for a profile in one sortable table,
with strength, consistency, effort, and notes side by side. Filter by
arm, sort by any column.

**Pairwise separability**: for any two probes, how distinguishable
they are (Fisher discriminant ratio or LDA cross-validation on that
pair alone). Two strong probes that look identical to the classifier
are one input, not two.

**Rest is a probe.** The session baseline is recorded via the same
mechanism, with `kind=baseline` in the CSV header, so every other
metric is relative to a real recording rather than a hardcoded zero.

**Promotion**: probes are promoted from the library into the training
set (module 4). That is how the class list gets built. The classifier
never sees probes that were not explicitly promoted.

---

## 8. Storage format — probes (`probe_store.py`)

Every SNC recording is one CSV file with a comment header block. No
binary formats for data. Ten years from now this must open in Excel
and hand off cleanly when a session folder is copied to another
machine.

Header block: `#` lines, colon-separated `key : value`, aligned. Keys
present in every probe:

    probe_name, profile, profile_type, arm, kind, recorded_utc,
    duration_s, sample_rate_hz, n_samples, channels, value_range,
    schema

Keys present when non-default:

    notes, effort, fatigue, confidence, extra.<any-scalar>

Grid: `t_ms, ulnar, median, radial`. Values written at millisecond
resolution with 5 decimals. `t_ms` is computed from sample index and
`sample_rate_hz`, not observed timestamps.

Schema tag: `armband/probe/1`. A schema bump means a breaking change;
readers must handle old versions or refuse to open them explicitly.

Metrics computed later go to a sibling `.metrics.json` with the same
stem, so the raw grid stays a clean numeric file.

---

## 9. UI shell

Single tkinter window, dark theme. Always-visible header (top to
bottom):

1. **Profile bar** — profile picker + `+ New`, type badge, arm
   toggle, open-session indicator, primary CTA (baseline record).
2. **Status chip** — connection state, band FW / hand, battery,
   live samples/s. Color-coded per `signal_state()`.
3. **Diagnostic banner** — one sentence telling the helper what to
   DO next, driven by `state_message()`.
4. **Troubleshoot panel** (collapsible) — the numbered known-good
   startup sequence + rolling connection event log + unknown-type
   counter for Companion protocol drift.

Then a tabbed notebook:

- **1-2 Contact & Placement** — meters + verdict + correlations +
  placement-note entry.
- **3 Profile** — full CRUD view of the active profile.
- **4 Exploration Lab** — probe recorder + library + pairwise
  separability + promotion controls.
- **5 Classifier** — training + confusion matrix + per-class
  thresholds.
- **6 Actions** — action-mapping editor.
- **7 Switch mode** — the day-to-day surface.
- **8 AI assistant** — optional, gated on `ANTHROPIC_API_KEY`.
- **9 Log** — full rolling log, unknown-type list, DC-drift
  timeline.

Anything the helper needs to do repeatedly (change arm, start
baseline, see current profile) is in the always-visible header, not
inside a tab.

---

## 10. Runtime — connection handling

Enforced by `mudra_client.py`:

- Auto-connect on startup, auto-reconnect on any drop, never require
  a human to click Reconnect.
- Backoff schedule 1s → 2s → 5s → 10s.
- Detect "subscribed but zero frames for 3s" as `STATE_NO_SNC` and
  surface the STANDBY-mode fix, not a generic "waiting".
- Detect `client_already_connected` as `STATE_ALREADY_IN_USE` and
  slow the reconnect loop to 5s so we do not hammer Companion while
  waiting for the other client to close.
- Re-issue `subscribe` on every status poll (~2s) so a band that
  flips ACTIVE → STANDBY starts streaming without a manual
  reconnect.
- Live samples/s counter always visible in the header.
- Every connection event (`connect`, `ws open`, `first SNC frame`,
  `reconnect in Xs`, unknown types) is appended to a rolling log
  the Troubleshoot panel can display.

---

## 11. Empirically-verified facts (do not re-derive)

- SNC: 18 samples per channel per frame, ~53 frames/s, ~1000 Hz
  effective sample rate.
- The `frequency` field on SNC messages reads `21` and is **not**
  the sample rate.
- Companion key `gestures` (plural) is used where docs say `gesture`.
- STANDBY streams; ACTIVE does not.
- Fresh Companion launch with our client first = the only reliable
  connection.
- Channels: ch1 Ulnar, ch2 Median, ch3 Radial.
- Storage: CSV + JSON only, no `.npz` or pickle for data.

---

## 12. Ordered work (matches NEXT.md → ORDER OF WORK)

1. Connection handling (module 1 requirements from NEXT.md) — done.
2. Contact check + placement guide, verified on a live signal —
   contact-check code done, live verification pending.
3. Profile system with two-arm support — done.
4. Exploration Lab — not started.
5. Classifier — not started.
6. Action mapping with pluggable output — not started.
7. Switch mode — not started.
8. AI session assistant — not started.
9. Autostart and tray — not started.

Live state of "done / in-progress / next" is in STATUS.md, not here.

---

## 13. Ground rules — non-negotiable

- CSV + JSON only for data.
- Every recording lives under a profile.
- The end user cannot operate a mouse or keyboard reliably; every
  primary flow must survive that.
- Claude API is optional and never receives raw sample arrays.
- Log unknown Companion message types; never silently drop.
- Storage schemas carry a version tag; readers refuse to guess.

---

## 14. Open questions

- **Why do all three channels sit at ±1 at rest and track each
  other within 0.003?** Candidates: differential inputs floating,
  mains hum swamping the signal (charger plugged in), band too
  loose, all three electrodes on the same tissue, Companion
  side-scaling artefact. The contact check will (correctly) call
  this a FAIL until it is diagnosed, but the root cause is unknown.
  This has to be resolved before the classifier can be trusted at
  all — a classifier trained on a floating input learns noise.
- Whether the AI assistant should be given the ability to *write*
  training-set changes directly, or only recommend them. Current
  answer: recommend only, human commits.
- Whether the classifier should ever run on both arms fused into
  one feature vector, or always treat them as independent detectors
  ORed together. Current answer: independent.
