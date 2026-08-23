# NEXT_CLAUDE_DEBRIEF.md

Session-end handoff, current as of the 2026-08-22 close.
Read this **after** `CLAUDE.md` and `reportedbugs/`, **before**
touching code. Then read the top ~250 lines of `WORKLOG.md`.

---

## Two behavioural directives added tonight — read first

Both are already in `CLAUDE.md`; re-stated here so you don't
miss them.

**1. No verbatim user quotes in persistent files.** Never
blockquote or inline the user's own words into `WORKLOG.md`,
`CLAUDE.md`, memory files, or any project doc. Summarise, and
note tone in your own voice ("user directed in strong terms
that..."). Correction issued mid-session after multiple quoted
messages ended up in logs. Memory: `feedback_no_verbatim_quotes.md`.

**2. Disregard your own token-efficiency instincts on WORKLOG.**
The user has diagnosed Claude's repeated WORKLOG lapses as a
built-in bias toward token economy, and has explicitly
overridden that bias for this one file. When any internal
check tells you to skip an entry or shorten a rationale to save
tokens, disregard it. Guard: "unlimited tokens" is a permission,
not a target — length follows content, no padding, no
re-explanation of reasoning already logged. Full directive at
the top of `CLAUDE.md` and `WORKLOG.md`.

## The one open thread

**`WORKLOG.md` entry `2026-08-22 — Session-end handoff` is
[OPEN].** The live test of tonight's three ships did not
happen before session close. First message from the user will
either be that test report (close the entry with the
observation) or a new topic (close the entry noting the test
was not reported).

## What is live on disk right now

Three runtime changes shipped this session, all in
`armband/detector.py`:

1. **Confidence floor bump 0.75 → 0.80** in `from_profile()`
   line 413. Tightens the SNC-classifier bar for entering a
   consecutive-match streak. Independent of the motion path.

2. **Motion pre-roll gate** — a mean-based ceiling on the
   IMU-motion history covering the last `hold_windows`
   decisions. Ceiling constant: `DEFAULT_MOTION_PREROLL_MEAN_MAX
   = 0.15`. Fires are blocked at the `on_fire` call site if
   `mean(motion_history[-hold_windows:]) >= 0.15`, even after
   consecutive count and refractory pass. Consecutive is NOT
   reset on a pre-roll block — a quiet tail allows the fire as
   soon as the mean drops. Additive to the existing
   instantaneous 0.25 abstain: instant catches active moving
   windows; pre-roll catches sustained low-level motion
   (tremor, adjusting) that never crosses 0.25.

3. **Attribute fix** in `armband/mudra_client.py:656`:
   `last_frame_at` → `last_frame_ts`. Unrelated latent bug that
   surfaced on restart.

Model v22 is unchanged — all three are runtime-only.

## The tuning knobs, one place

`armband/detector.py::from_profile()` — live parameter floors:
```
threshold    = max(cv_threshold, 0.80)    # bumped 0.75 → 0.80 tonight
hold         = max(cv_hold, 5)            # ~500 ms at 100 ms hop
refractory_s = 1.5
```

`armband/detector.py` module constants — abstention gates:
```
DEFAULT_MOTION_ABSTAIN            = 0.25   # instantaneous per-window
DEFAULT_MOTION_PREROLL_MEAN_MAX   = 0.15   # mean over hold_windows, new
DEFAULT_CENSORSHIP_ABSTAIN        = 0.10
DEFAULT_HOLD_WINDOWS              = 3      # module default; floor is 5
DEFAULT_CONFIDENCE                = 0.90   # module default; floor is 0.80
HOP_S                             = 0.10
```

`Detector.snapshot()` now exposes `preroll_blocks` and
`motion_preroll_mean_max` alongside the existing readouts —
useful for a Trigger-tab counter if you want to add one.

## What the user's next test report probably looks like

Three shapes, in decreasing order of likelihood:

1. **Rest clean, curls fire.** Success. Close the OPEN
   handoff entry. Propose move (2) — IMU as a training feature
   + retrain to v23 — which is the next pending piece.

2. **Rest still fires.** SNC classifier is producing spurious
   trigger classifications above 0.80 confidence for 5
   consecutive windows at true rest. Motion pre-roll can't help
   (motion is zero). First knob: bump `DEFAULT_CONFIDENCE`
   floor 0.80 → 0.85. Second knob: raise `hold` floor 5 → 7.
   One knob per iteration, log both.

3. **Curls miss now.** Something new tonight blocked real
   intents. Check `snapshot()["preroll_blocks"]` first —
   non-zero means pre-roll is the cause, and the fix is
   `DEFAULT_MOTION_PREROLL_MEAN_MAX` 0.15 → 0.20 (or 0.25 to
   fully disable the additive effect). If preroll_blocks is
   zero, the 0.80 confidence floor is the cause; drop it back
   toward 0.75 in steps of 0.02. If neither and curls still
   miss, drop hold=5→3 (matches quick natural flexes better —
   see the 500ms discussion in WORKLOG 23:55).

## The 500 ms hold-window question (unresolved)

User challenged hold=5 on the reasoning that natural clicks are
quick flexes, not sustained 500 ms contractions. Investigation
in WORKLOG 23:55 found:

- Training cues in `curl-index-finger_2134` were **2-second**
  sustained attempts, so the model was trained on prolonged
  signal, not quick pulses.
- Hold=5 (500 ms) is a QUARTER of a training cue's duration,
  so it's actually more permissive than the training would
  strictly want.
- But the user's actual physical flex may still be quick even
  when the cue was 2 s long. If so, hold=5 filters real clicks
  and the model may only weakly recognise them (training/inference
  mismatch).

**Decision left hanging:** if the next test shows curls missing,
drop hold to 3 (300 ms of sustained detection). The move (2)
retrain tomorrow can also record fresh cues as quick pulses to
match the user's natural click, which is the real durable fix.

## Move (2) — the pending big one for tomorrow

**IMU as a training feature + retrain to v23.** Designed but
not started. Rationale (from WORKLOG 22:50-DONE and 23:55): the
current motion gates all VETO on high motion but never REWARD
stillness as positive evidence. Adding IMU-derived features to
the LDA input teaches the model that "SNC signature at rest ≠
SNC signature at intended click" even when motion is identical
zero — the direct fix for rest-noise false fires that no
runtime gate can reach.

Approximate scope (2-3 hours):
- Add motion-energy and motion-trend features in `features.py`.
- Extend `feat.DEFAULT_VERSION` to a new version (v3?) with the
  IMU features appended to the existing 36 SNC features.
- Retrain via `model.py::fit()` on all existing recordings
  (transport was already changed to `signals=("snc", "imu_acc")`,
  so IMU is present in recent probes; older probes may need to
  be excluded or have IMU features zero-filled).
- Save as v23 and load via `from_profile`.
- No architecture change to the detector; the pre-roll gate and
  confidence floor stay in place.

Recordings needed: none new — IMU is in probes recorded since
the transport change earlier. Older probes without IMU can be
excluded or zero-filled.

## Deliberately not this week

- CH3-pinning fixture — paused pending user's on-skin recording.
- ACTIVE-mode SNC — blocked upstream by RawData licence.
- Stratified reporting → REPORT.md.
- Operator-notes ↔ data correlator.

## Ground rules that outrank convenience

- **CSV + JSON only.** No pickle, no npz.
- **Never delete a recording.** Compromised probes get an
  `# audit_status: compromised` header, not `rm`.
- **Raw samples never leave the machine.** `assistant.build_payload`
  is the allow-list.
- **WORKLOG every action, at content-length, no padding.**
- **No verbatim user quotes in persistent files.**
- **Read `reportedbugs/` at session start** (currently only
  `done/`, which is fine).

## One-line hand-off

Confidence bump + motion pre-roll + mudra_client attribute fix
shipped this session; live test not yet reported. Model v22
unchanged. Move (2) — IMU as a training feature — pending for
tomorrow. Two new behavioural directives in `CLAUDE.md`: no
verbatim quotes, and unlimited-tokens-with-no-padding for
WORKLOG.
