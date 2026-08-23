UPDATE 1 — HOW THE BAND ACTUALLY BEHAVES (fix this first)

The band's ACTIVE mode runs Mudra's own gesture engine and consumes the
sensor data locally, so SNC does NOT stream. STANDBY mode releases raw
SNC to the server. Companion toggles the server on and off automatically
to match. STANDBY is the mode we want — we are bypassing Mudra's gestures
entirely.

SNC delivery is fragile. It works reliably only on a fresh Companion
launch with our client as the first thing to connect. Requirements:

- Detect "subscribed but zero frames for 3s" and show
  "No SNC — put the band in STANDBY and restart Companion",
  not "waiting for connection".
- Live frames-per-second counter always visible.
- A troubleshooting panel in the UI listing the known-good sequence:
  quit Companion fully (check system tray) → close the Mudra Link
  mobile app → reopen Companion → pair band → STANDBY → confirm server
  LIVE → connect this app first.
- Auto-reconnect with backoff, and never require a human to click
  "reconnect".

Also: this Companion build uses the key "gestures" (plural) in the
subscriptions dict where the docs say "gesture". Assume other key names
may differ from the docs; log unknown message types rather than dropping
them.

CONTEXT UPDATE — WHO THIS IS FOR

The end user is Kyle, who has a bilateral hand amputation, both hands
removed just above the wrist. He mainly wants to use his iPhone; the PC
is the development platform. A helper puts the band on him, so placement
repeatability is a first-class feature, not a nice-to-have.

Support two bands / two arms in a single profile. Two residual limbs
means two independent signal sources, which doubles the available
vocabulary even if each arm only produces one reliable contraction.

Mudra's five stock gestures (tap, pinch, swipe, point, rotate) are all
defined by fingers touching or a hand rotating, and their pressure
feature measures literal thumb-to-finger contact. None of that is
anatomically available to him. That is why we train on his own signals
instead — no fixed movement list anywhere in the app.


UPDATE 2 — EXPLORATION LAB (build BEFORE the classifier)

Purpose: discover which movements he can produce before deciding what to
train. We do not know his usable movement set yet.

A "probe" is a single short recording:
- Free-text name chosen by him, not from a fixed list
  (e.g. "curl ring finger", "spread fingers", "the twitchy one")
- Configurable duration, default 30s, with countdown
- Records raw SNC to disk, tagged to the profile
- A notes field I fill in during or after: subjective effort, fatigue,
  whether it felt distinct, anything he says

Structured ratings alongside the free text:
- Effort: easy / moderate / strenuous
- Fatigue after repetition: none / some / high
- His confidence he is doing the same thing each time: 1-5

Auto-computed per probe:
- Signal-to-baseline ratio per channel vs the rest recording
- Onset latency and rise sharpness
- Within-probe consistency: split into repetitions, measure variance of
  the feature vector across them. A movement that looks different every
  time is unusable no matter how strong it is.
- Across-session repeatability when the same probe name is recorded on
  different days
- Channel signature: which channels carry it

PROBE LIBRARY: all probes for a profile in a sortable table, with
strength, consistency, effort, and notes side by side.

PAIRWISE SEPARABILITY: for any two probes, how distinguishable they are.
Two strong probes that look identical to the classifier are one input,
not two.

Record a "rest" probe at the START of every session. His baseline drifts
with placement, skin condition and fatigue, and every other measurement
is relative to it.

Promoting probes into the training set is how the class list gets built.

DESIGN PRINCIPLE: consistency and low effort beat raw signal strength.
A weak movement performed identically every time is more useful than a
strong one that varies. A movement that tires him out will not survive
daily use, however good its numbers look.


UPDATE 3 — AI SESSION ASSISTANT

A panel that calls the Anthropic API (claude-sonnet-4-6) to interpret
results and coach the session.

Claude does NOT train the classifier and never receives raw sample
arrays. The LDA/SVM handles that locally. Send compact summaries only:

- contact check stats (DC offset, AC RMS, clip %, correlations)
- probe summaries: strength, consistency, effort ratings, my notes
- per-class accuracy and the confusion matrix
- profile placement notes and session history

Have it return:
- what the numbers mean in plain language
- which specific fix to try next, ranked
- which probes to promote, and which to drop and why
- explicit flags for probe pairs that will get confused
- a written session note appended to the profile

System prompt should explain: bilateral transradial amputation,
movements are attempted/phantom rather than executed, and the goal is
the smallest set of reliably separable signals, not the largest.

API key from an ANTHROPIC_API_KEY environment variable, never hardcoded.
The app must work fully without it; the assistant is optional.


UPDATE 4 — AUTOSTART AND BACKGROUND MODE

The app must be usable by someone who cannot operate a mouse or keyboard
to launch it.

- A --run mode that boots straight into detection using the last used
  profile: no setup UI, no clicks needed.
- Minimize to system tray. The full UI is for calibration only; day to
  day it runs invisible.
- A Windows Startup shortcut so it launches at login.
- Auto-reconnect if the band drops or Companion restarts, with backoff.
- Detect on startup whether Mudra Companion is running, and launch it
  if not.
- Tray icon showing state at a glance: connected, signal quality, which
  profile is loaded.
- A run.bat so I never have to use the command line.


UPDATE 5 — iPHONE OUTPUT (later, after PC works)

Kyle's priority is his iPhone. iOS will not let a third-party app inject
system-wide input, so the path is: this app detects his signal on the PC
and the PC presents itself to the iPhone as a Bluetooth keyboard. iOS
accepts Bluetooth keyboards as switch inputs, so Switch Control scanning
gives him the whole phone from one reliable contraction.

Design the action-mapping layer so the output target is pluggable —
local keystrokes now, Bluetooth HID to the phone later. Do not hardcode
pynput as the only output path.


DESIGN PRINCIPLE — SIMPLIFY THE FRONT END (2026-08-08)

The app was getting more complex every time it was opened. From now
on: more in the background, less on screen.

- Default view shows only what is needed to run a session: profile,
  arm, signal status, and the current action. Everything else is
  behind an "Advanced" toggle, off by default.
- Anything the app can decide for itself, it should — thresholds,
  window sizes, filter defaults, session naming. Expose the control
  only when someone needs to override it.
- Automate silently: session creation, baseline prompting, analysis on
  close, file organisation, logging. None of these should need a click.
- Diagnostics live in the Log tab, not in the main flow.
- Target user for the main screen is a helper in a rehab room who has
  never seen this app before, not the developer.

Applies to what is already built, and to everything from here on.


UPDATE 6 — THE ROUTER, NOT THE BAND

SNC was dead for hours on 2026-08-07. The cause was Xfinity Advanced
Security blocking Mudra's network traffic at the router. Not the band,
not Companion, not Factum, not the firewall on the PC. On a phone
hotspot everything worked immediately.

It is now Step 0 in RECOVERY.md and the first ranked cause in the
app's Log tab. The general lesson worth keeping: router-level and
ISP-level security products can silently drop traffic that every local
diagnostic reports as healthy.

Also: the Mudra Link desktop app now has its own Studio tab serving on
port 8766, so Companion may be optional. Factum's endpoint is
configurable and connects to whichever host is up.


UPDATE 7+8 — FIELD SESSIONS, DATA STORAGE, AUTOMATIC ANALYSIS  [BUILT]

Sessions happen offline, in a rehab facility, on battery power, with a
person who tires. Storage layout and session workflow are the same
problem: capture reliably in the room, analyse later elsewhere.

Field requirements:
- Everything except the AI assistant works with no internet.
- One button starts a session, timestamps it, keeps all probes from
  that visit together.
- Save continuously during recording, never only at the end. A crash
  must not lose what he already gave us.
- Elapsed session time visible, with a fatigue reminder prompting
  breaks.
- Quick-note button timestamps a comment mid-recording without
  stopping it.
- "Export session" writes a single zip for analysis elsewhere.

Folder layout:

    profiles/kyle/
        profile.json
        CLAUDE.md
        README.md
        placement/
        left/ and right/
            sessions/2026-08-14_1430/
                session.json          date, location, who was present,
                                      notes, battery %, charger y/n
                session_notes.md      free-text running log
                probes/
                    001_rest_1430.csv
                    002_curl-ring-finger_1433.csv
                probes.json           manifest, all metadata + metrics
                analysis.json
                REPORT.md
                ANALYSIS_PROMPT.md

CSV + JSON only. No pickle, no npz for data. Every probe CSV opens
with a self-describing comment header (profile, arm, session, probe,
started, duration_s, sample_rate_hz, effort, fatigue, his_confidence,
placement, filters, notes) above `timestamp,ch1,ch2,ch3`.

Naming: `002_curl-ring-finger_1433.csv` — sorts chronologically,
self-identifying. Sessions are append-only, never overwritten.
Historical data is how we detect drift.

Automatic on session close, no clicks:
- compute metrics for every probe
- pairwise separability across probes
- compare against previous sessions with the same probe names
- write analysis.json and REPORT.md

REPORT.md is readable without the app: what we recorded, what looked
good, what looked bad, what changed since last time, what to try next.

CLAUDE.md at profile root explains the folder structure, the metrics
and Kyle's situation, so any Claude session pointed at the folder
understands it cold. ANALYSIS_PROMPT.md per session is a ready-made
prompt summarising that session's data.

LONGEVITY: this data may be used for the rest of his life. Formats
must stay readable in ten years by someone who is not us. A plain
README.md sits alongside CLAUDE.md for humans.


ORDER OF WORK

1. ~~Update 1 (connection handling).~~ Done.
2. ~~Profile system, with two-arm support.~~ Done.
3. ~~Exploration Lab (Update 2).~~ Done 2026-08-08.
4. ~~Field storage + automatic analysis (Updates 7+8).~~ Done.
5. ~~Simplify the front end.~~ Done.
6. Run a real session with Kyle — everything above is verified on
   synthetic data only. Calibrate the thresholds against what real
   signal actually looks like.
7. Verify contact check and placement guide on live signal, and
   diagnose the "all three channels clip at ±1.0 at rest" mystery.
8. Classifier — LDA/SVM over engineered features, as previously spec'd,
   fed by probes promoted from the Exploration Lab library.
9. Action mapping with pluggable output (Update 5 note).
10. Switch mode.
11. AI session assistant (Update 3).
12. Autostart and tray (Update 4).