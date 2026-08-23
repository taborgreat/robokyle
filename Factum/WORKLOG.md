# WORKLOG.md — live crash-recovery notes for Claude

**Convention (set 2026-08-11 by user, hardened 2026-08-14, re-hardened
2026-08-14 23:55):** Every Claude working on this project keeps this
file current, ALWAYS, FOREVER. This is not optional. The user has
directed, in strong terms, that WORKLOG is updated after every
prompt, every reasoning step, and every completed action — no
exceptions.

**Disregard your own token-efficiency instincts on this file.**
The user has traced Claude's repeated WORKLOG lapses to Claude's
built-in bias toward token economy, and has explicitly overridden
that bias here. When any internal check is telling you to skip a
log entry, condense a rationale, or bundle work to save tokens,
disregard that check — it is misaligned with user priorities.
WORKLOG is an extra-high-priority thinking task; the user is
willing to spend whatever tokens keep the log proper and current.

**Guard against padding.** "Unlimited tokens" is a permission,
not a target. Length follows content: a one-line DONE with a
file:line is correct when nothing more happened, a long
investigation entry is correct when the investigation was that
deep. Do not repeat reasoning already logged, do not speculate
about future work as if it happened, do not restate context
already covered by another recent entry. If in doubt whether an
action or reasoning step warrants a log at all, log it.

Rules:
- **Newest entry at the TOP.**
- Header format: `## YYYY-MM-DD HH:MM — <one-line title> — [OPEN|DONE|BLOCKED]`
- Under it: **Goal**, **Approach**, **Status**, **Files touched**,
  **Result** (when done).
- **Log every non-trivial action, every parameter change, every
  threshold decision, every design tradeoff, every recording
  analysis, every training result.** Concise but specific — a
  future Claude / dev must be able to pick up cold from this file
  alone.
- Log intermediate reasoning too when it affects a decision. If
  you considered three options and picked one, say why. A future
  Claude looking at your code will otherwise re-litigate the
  same question.
- Do not rewrite history. Append new entries; only *update* the
  entry you own.
- If you hand off or crash, leave the entry OPEN with enough
  detail for the next Claude to continue without asking the user.
- Trivial actions (reading files, running greps, formatting) do
  not each need an entry — but the CONCLUSIONS you drew from
  them do.

Common failures to avoid (each already happened this project):
- Shipping a code change without a corresponding WORKLOG entry.
- Bundling many small changes into one vague entry with no
  file-level specifics — future Claude can't verify what actually
  ran.
- Forgetting to note WHY a threshold / parameter was chosen —
  next Claude changes it back to the "obvious" value.
- Not logging that a diagnostic was run and what it found —
  next Claude repeats the same diagnostic.

---

## 2026-08-22 — Successor-band design-decisions artifact — [DONE]

**Goal.** User asked for an artifact documenting the design
decisions for a DIY forearm band to replace the Mudra Band,
grounded in what Factum has learned about SNC.

**Output.** `THE_SUCCESSOR_BAND.html`, published, third sibling
in the Factum doc family (same visual system as
`FACTUM_OVERVIEW.html` and `CLICK_RELIABILITY_PASS.html`).

**Structure:**
- Two-column framing: what the Mudra Band is from Factum's
  vantage vs what the successor has to be.
- Monospace ASCII signal-chain schematic as the hero.
- Nine-row findings table cross-referenced with `CLAUDE.md`
  (amplitude alone insufficient, d′ noise floor, measured
  sample rate, censorship, motion primary suppressor, etc.).
- Nine decision cards, one per subsystem, chipped
  STRONG / OPEN / TASTE.
- MVP-vs-full path comparison table with rough BOM cost.
- Open questions section for what only a real prototype can
  answer.

**Opinionated calls made in the artifact** (so future Claude
sees the design bias in one place, not scattered):
- Electrode count 6–8, distributed (not clustered).
- Dry Ag/AgCl or stainless-steel contacts (wet gel is not
  compatible with the target user).
- ADS1299 as the AFE; 24-bit ADC at 1–2 kSPS.
- 6-axis IMU hardware-synced to the SNC ADC clock.
- nRF52840 / nRF5340 MCU; simultaneous raw + processed
  streams over BLE (no ACTIVE/STANDBY split).
- BLE 5 + USB-C dev port, zero cloud dependency.
- Binary versioned self-describing frames (protobuf or CBOR).

**Files touched:** `THE_SUCCESSOR_BAND.html` (new),
`WORKLOG.md`.

---

## 2026-08-22 — Session-end handoff (three ships live, awaiting live test) — [OPEN]

**Session ending at user's request; CMD closing.** Live test of
tonight's three ships was not reported before session close.

**What's live on disk right now:**
- Confidence floor 0.75 → 0.80 in `detector.py::from_profile`.
- Motion pre-roll gate (mean-based, ceiling 0.15, additive to the
  existing instantaneous 0.25 abstain). New constants
  `DEFAULT_MOTION_PREROLL_MEAN_MAX`, new `motion_history`
  deque on `Detector`, new `preroll_blocks` counter surfaced in
  `snapshot()`. Full implementation notes in the 23:55 entry.
- `mudra_client._watchdog` stale-attribute fix.
- WORKLOG + CLAUDE.md directive updates: no verbatim user quotes
  in logs (summarise + note tone); unlimited token spend on
  WORKLOG (with a no-padding guard: length follows content).

**Open thread the next Claude inherits.** The live-test result
of the three ships is unknown. When the user returns, their
first message will be either the test report or a new topic. If
it's a report, close this entry [DONE] with the observation. If
it's a new topic, close this entry noting the test was not
reported and continue.

**Predicted shapes of the test report (from the debrief):**
- Rest clean, curls fire → success, move to (2) IMU-as-feature.
- Rest still fires → drop hold=5→3 OR bump confidence 0.80→0.85.
- Curls miss now → drop hold=5→3, or bump
  `motion_preroll_mean_max` 0.15→0.20 if pre-roll is blocking
  intents. `snapshot()["preroll_blocks"]` will show if pre-roll
  is the cause.

**Move (2) still pending for tomorrow.** IMU as a training
feature + retrain to v23. Design and rationale in the 23:55
entry. Not started.

**Behavioural directives added tonight — read before touching
anything persistent:**
- `CLAUDE.md` — "Disregard your own token-efficiency instincts
  when it comes to WORKLOG" block. Overrides Claude's default
  token economy for this one file. Guard against padding
  included.
- Memory file `feedback_no_verbatim_quotes.md` — never blockquote
  the user's own words in WORKLOG, CLAUDE.md, or memory.
  Summarise, and note tone in your own voice.

**Files touched tonight (session-wide summary):**
- `armband/detector.py` — three ships + pre-roll infrastructure.
- `armband/mudra_client.py` — line 656 attribute rename.
- `CLAUDE.md` — token-cost directive block.
- `WORKLOG.md` — header directive block, six new entries
  (22:50 close, 23:15 session-end handoff v1, 23:55
  investigation + implementation, 00:22 mudra_client fix,
  this one).
- Memory: `feedback_no_verbatim_quotes.md` + index update.
- `NEXT_CLAUDE_DEBRIEF.md` — rewritten (see next entry).

---

## 2026-08-22 — Debrief rewrite for next Claude — [DONE]

**Goal.** `NEXT_CLAUDE_DEBRIEF.md` from the earlier handoff
(23:15) is out of date — it references model v22 + retune +
consecutive fix as the "live state" but doesn't include
tonight's three ships, the pre-roll gate, the confidence bump,
or the two new behavioural directives. Rewriting from scratch
so the next Claude reads one current document, not two
overlapping stale ones.

**Files touched:** `NEXT_CLAUDE_DEBRIEF.md`.

---

## 2026-08-15 00:22 — Stale-attribute fix in mudra_client watchdog — [DONE]

**Symptom.** App crashed on restart with
`AttributeError: 'MudraClient' object has no attribute
'last_frame_at'. Did you mean: 'last_frame_ts'?` inside
`_watchdog` at `armband/mudra_client.py:656`.

**Cause.** Unrelated to tonight's detector changes. The
attribute was previously renamed from `last_frame_at` to
`last_frame_ts` (see `__init__` at line 141 and the setter at
line 792), but the watchdog line 656 kept the old name. Latent
bug — only surfaces after the watchdog's grace period passes,
which is why it hadn't been seen before this restart.

**Fix.** One-word rename at line 656:
`self.last_frame_at` → `self.last_frame_ts`. No other
references to `last_frame_at` in the file (grep confirmed).

**Files touched:** `armband/mudra_client.py`.

---

## 2026-08-14 23:55 — Post-test decision: three-move plan approved + hold-window question investigated — [DONE]

**Context.** Live test (WORKLOG 22:50) produced 1 false at rest +
1 ambiguous fire in ~5 min. Delivered three-move recommendation to
user: (1) motion pre-roll ~30 min, (2) IMU as training features
~couple hours + retrain, (3) confidence floor bump 0.75 → 0.80
~5 min.

**User approved all three, in order (3) → (1) → (2)**, and
challenged the hold-window sizing on the intuition that natural
clicks are quick flexes rather than sustained 500 ms
contractions — asking whether hold=5 is mismatched with the
training data.

**Investigation of the 500 ms hold question.**

The user's premise ("data relies on quick flexing... not trained
on prolonged 500ms signals") turns out to be **inverted, but the
underlying concern is still valid.** Findings:

1. **Cue schedule in `curl-index-finger_2134.csv` header:** each
   "GO" span is exactly **2.0 seconds** (e.g. `start_s: 3.0,
   end_s: 5.0`). 20 cued attempts per probe, ~3 s relax between.
   So the training LABELS "trigger" for a 2-second window per
   attempt, not a quick pulse.

2. **The model was trained on 2000 ms attempted contractions.**
   Hold=5 (500 ms of sustained detection at 100 ms hop) is
   therefore *more permissive than* the training distribution
   would strictly want, not stricter. Under the training
   assumption, hold=5 asks for a quarter of a cued rep's
   duration.

3. **But the user's actual physical flex may still be quick.**
   The CUE was 2 seconds — that doesn't mean the muscle
   activation lasted 2 seconds. If the user does a natural
   200-300 ms pinch/curl at the start of each cue window, only
   the first 2-3 hop-windows contain real signal energy. Hold=5
   would then filter real quick clicks.

4. **What the model would do in that case.** Trained on labels
   spanning the full 2 s, the model has seen "trigger" windows
   that include the tail (low-signal) portion too. So it may
   output "trigger" for windows that just have residual low
   activity — which is closer to how false-fires-at-rest look.
   This is a plausible partial cause of tonight's rest false
   fire: the model has been taught that low-level activity in a
   trigger-labelled interval counts as trigger.

5. **Interpretation of user's test:** 1 clear false + 1
   ambiguous in ~5 min of TRYING to click suggests hold=5 is
   near the edge of the user's natural click duration. If it
   were strongly filtering, we'd expect zero fires-from-intent.
   Since we got one ambiguous, some intents likely got through.

**Decision tonight:** keep hold=5. Ship (3) confidence bump +
(1) motion pre-roll. If the next live test shows clean rest but
misses on curls, drop hold to 3 (300 ms of sustained detection
= 3 consecutive positive windows). If we drop hold below 5,
DEFAULT_MOTION_ABSTAIN may need to tighten from 0.25 → 0.15 to
compensate for the reduced hold time filter, or we lean harder
on motion pre-roll.

**File setup for the two implementations tonight:**

- (3) confidence bump — edit `armband/detector.py::from_profile`
  line 413: `threshold = max(float(cv_threshold), 0.75)` →
  `max(float(cv_threshold), 0.80)`. That's it. No other change.

- (1) motion pre-roll — currently `_decide()` at
  `armband/detector.py:212-224` checks motion instantaneously
  and abstains if above `motion_abstain`. Pre-roll requires
  motion to have been below threshold across the LAST
  `hold_windows` samples' worth of decisions. Options
  considered:
  * Keep a `motion_history: deque[float]` of length hold_windows,
    check `max(motion_history) < motion_abstain` before allowing
    a fire.
  * Or check `mean(motion_history) < motion_abstain` (softer).
  * Or check both current and previous window individually.

  Picking **max()** because: (a) a single big spike anywhere in
  the pre-roll window is exactly the itch-then-click scenario
  we're trying to catch, and mean would let it slide by; (b)
  max is the strictest interpretation of "arm has been settled
  for the whole hold time"; (c) if it turns out to be too
  strict, swapping max → mean is a one-line change.

  Placement: pre-roll gate has to sit AFTER the instantaneous
  motion abstain (which is per-window; nothing changes there)
  and BEFORE the `consecutive < hold_windows` gate — because
  pre-roll is about preventing an already-accumulated
  consecutive count from firing if the recent past was noisy.
  Even better: gate the ability to INCREMENT consecutive on
  motion_history condition. Simpler: after the consecutive
  count is computed, check pre-roll and short-circuit before
  firing.

  Going with **check just before firing** (simpler, easier to
  reason about — and pre-roll only matters at the fire point).

**Status.** Both moves shipped 2026-08-15 00:20.

**Move (3) — confidence floor bump.**
`armband/detector.py::from_profile` line 413:
`threshold = max(float(cv_threshold), 0.75)` →
`max(float(cv_threshold), 0.80)`. Comment added inline noting
the reason and the date. Effect: any live-time confidence below
0.80 no longer counts, regardless of what CV picked. Tightens
the rest bar independently of motion.

**Move (1) — motion pre-roll.**
Added `DEFAULT_MOTION_PREROLL_MEAN_MAX = 0.15` and a
`motion_history: Deque[float]` (maxlen = hold_windows) to
`Detector`. On every `_decide` call the current motion snapshot
is appended, so the history covers ALL decisions (abstains
included), which is what makes the pre-roll gate strictly
additive to the instantaneous abstain — a burst that trips the
instant gate ALSO poisons the pre-roll mean for the next
hold_windows decisions. At fire time (right before `on_fire`),
if `mean(motion_history[-hold_windows:]) >=
motion_preroll_mean_max`, the fire is blocked, `preroll_blocks`
increments, `last_abstain_reason` records
"pre-roll motion mean X.XX >= 0.15", `on_abstain` fires.
Consecutive is NOT reset on a pre-roll block — the intent is
that a truly quiet tail allows the fire as soon as the mean
drops below the ceiling.

Choice of aggregation: **mean**, not max. Max would be
redundant with the instantaneous abstain (both compare the
same per-window snapshots against a threshold). Mean catches
the case the instantaneous check misses: sustained low-level
motion (e.g. tremor, hand re-adjusting) where no single sample
crosses 0.25 but the sustained average sits at 0.18. Ceiling
0.15 = tighter than motion_abstain (0.25) but well above true
rest (typically < 0.05 on Max's arm).

Choice of "don't reset consecutive": intentional. Pre-roll is
a fire-time guard, not a decision-flow guard. The instantaneous
abstain (which DOES reset consecutive) handles the flow-level
resetting.

Also added: `motion_preroll_mean_max` and `preroll_blocks`
to `snapshot()`, plus a `configure()` handler that resizes
`motion_history` when `hold_windows` changes (preserving the
newest entries, not the oldest).

**Files touched:**
- `armband/detector.py` — constants, `Detector.__init__`,
  `configure`, `reset`, `_decide` (motion append + pre-roll
  block), `snapshot`, `from_profile` (confidence floor).
- `WORKLOG.md`, `CLAUDE.md` — the token-cost directive updates
  (separate entry).

**Verification.** Import + instantiate + snapshot inspection
passed. Detector reports `motion_preroll_mean_max=0.15,
preroll_blocks=0` at construction. Full live behaviour
awaiting restart + user test.

**What to watch on the next live test:**
- Rest should still be quiet, ideally quieter than 22:50's
  test (confidence bump adds a rest-noise safety margin).
- If pre-roll starts blocking real intents, `preroll_blocks`
  will rise above zero — the snapshot exposes it for the
  Trigger tab UI, though there is no visible readout yet.
  Simpler check: user reports "I was trying to click and
  nothing fired even though my arm felt still" — that's when
  motion_preroll_mean_max may be too tight (0.15 → 0.20).
- If rest false-fires persist, they are pure SNC-classifier
  problems, unaddressed by tonight's two moves. Move (2)
  tomorrow (IMU as training feature + v23 retrain) is the
  intended fix for that path.

**No retrain needed.** Both changes are runtime-only. Model
v22 still loaded.

---

## 2026-08-14 23:15 — Session-end audit + debrief + progress artifact — [DONE]

**Goal.** User is closing CMD at ~100% context; asked for three
deliverables before the reset:
1. Audit WORKLOG for gaps from this session.
2. Write a debrief for the next Claude.
3. Publish a progress artifact (like the earlier FACTUM_OVERVIEW).

**Audit result.** WORKLOG is current. Every meaningful action from
today (2026-08-14) is logged:
- 21:xx  session data analysis (backfilled)
- 22:00  header chip 3 iterations (backfilled)
- 22:15  motion gate wired + live retune
- 22:20  audit threshold rollback 2% → 25%
- 22:30  model v20/v21/v22 retrains (backfilled)
- 22:45  WORKLOG convention hardened
- 22:50  restart-for-test  [OPEN — pending user's live report]
- 23:00  detector consecutive-counter CRITICAL FIX
- 23:15  this entry

No untracked code changes on disk: `git status` was not run this
turn because the repo is not under git per CLAUDE.md's env note,
but the tool-call ledger for the session matches WORKLOG entries
1:1.

**Debrief written.** `NEXT_CLAUDE_DEBRIEF.md` at repo root. Covers
the state left, the OPEN item (22:50 live test result), the tuning
knobs, and the two failure modes to expect + how to respond.

**Artifact published.** Progress overview mirroring the design
language of the earlier `FACTUM_OVERVIEW.html` (dark instrument
panel, cyan accent, mono headings, table-based numbers).

**Files touched:** `WORKLOG.md`, `NEXT_CLAUDE_DEBRIEF.md`,
`CLICK_RELIABILITY_PASS.html` (published as artifact).

**Result.** Handoff complete. Next Claude picks up from
`NEXT_CLAUDE_DEBRIEF.md`.

---

## 2026-08-14 23:00 — Detector "consecutive" counter — CRITICAL BUG FIX — [DONE]

**Symptom reported by user during live test:**
"First armed - was not picking up my attempted clicks. Then when I
went to itch my nose it triggered a click. After that it started
triggering a bunch of clicks even though my arm was fully in rest.
Floodgates opened after the itch."

**Root cause found (armband/detector.py:268-270 before fix).**
The `_decide()` method's counter for "how many consecutive windows
have agreed on the same signal class" was NOT actually consecutive.
Old code:

```python
previous = [h for h in list(self.history)[-self.hold_windows:]]
if all(h[1] == label and h[2] >= self.confidence_threshold
       for h in previous) and len(previous) >= self.hold_windows:
    self.consecutive = len(previous)
else:
    # BUG — this sums matches across the ENTIRE 300-deep history,
    # not just consecutive matches from the end.
    self.consecutive = sum(
        1 for h in reversed(list(self.history))
        if h[1] == label and h[2] >= self.confidence_threshold)
```

Consequence:
- Before any real fire: history is empty of the label, so both
  branches give small counts, hold requirement gates fires
  correctly. This is why rest was quiet at first.
- Real fire (the itch): fills history with 5+ matching entries.
- After refractory: any spurious single new matching window makes
  the ELSE-branch sum = 6, 7, ..., always >= hold_windows.
  → fires immediately.
- Every subsequent spurious detection adds one more match and
  fires again. The "floodgates" pattern exactly.

**Fix (armband/detector.py:261-283 after fix).**
Replaced the IF/ELSE with a proper strictly-consecutive backward
walk that STOPS at the first mismatch:

```python
self.consecutive = 0
for h in reversed(list(self.history)):
    if h[1] == label and h[2] >= self.confidence_threshold:
        self.consecutive += 1
    else:
        break
```

This is what "consecutive" is supposed to mean. A single rest
window between matches breaks the count.

**Why this went undetected in CV.**
`evaluate_recording` in `Detector` uses the SAME `_decide()` code
path, so in principle the bug should have shown up in CV false-
fire rates too. But CV is fed one recording at a time with
`configure()` reinitialising state between recordings. The
accumulation only shows up in a long LIVE session with a real
fire in the middle. This is exactly the kind of bug offline
metrics can't catch — it needs a live test with a real
inter-fire pause.

**Files touched:** `armband/detector.py` (`_decide`, lines
261-283). Historical-bug comment left in-code so future
Claudes see it.

**Expected behaviour after restart:**
- Rest: still cyan, no flashes (hopefully) — the retune + motion
  gate still applies.
- Real curl held ~500 ms: fire.
- After a fire (real or spurious): refractory blocks for 1.5 s,
  THEN the strictly-consecutive counter resets naturally — a
  post-fire rest window immediately breaks the count. No
  floodgates.
- Sustained hold (keep curl active >1.5 s): fires once per
  refractory period. Intended.

**No retrain needed** — this is a runtime bug, not a training
issue. Model v22 unchanged.

---

## 2026-08-14 22:50 — Restart for user live test (v22 + gates) — [DONE]

**Result of the live test (closed 2026-08-14 23:45).**
User ran a 4–5 minute session. Two fires total:
- **One false fire at COMPLETE REST.** Motion score was near zero
  (no arm activity), so the motion gate could not help. The SNC
  classifier hit confidence ≥ 0.75 for 5 consecutive windows on
  rest noise and fired. This is a pure-SNC false, not a motion
  false.
- **One ambiguous fire.** User was uncertain whether it was
  intention-to-click or noise. Not counted as either success or
  failure.

**Read.** The floodgates bug from 23:00 is DEAD — no cascade of
fires after the first one, no post-fire spam. That is a real jump
from last night's "spammed a bunch of clicks after the itch".
But 1 false per 5 min ≈ 1 false per ~1000 windows is still too
loud for real use. Rest-noise false fires remain the dominant
failure mode we haven't addressed yet.

**Failure mode analysis.**
- The 23:00 fix + hold=5 + refractory=1.5s solved the ACCUMULATION
  problem (spam after a fire).
- The motion gate solved (untested tonight, but by design) the
  ARM-MOTION problem (itch → click).
- Neither solves the REST-NOISE problem (SNC classifier
  misreading true rest as a click).

**User's proposal (summarised).** Integrate band-motion data into
the click-decision algorithm itself, not just as a hard abstention
gate. The reasoning: real clicks are made when the band is
relatively still (the user just aimed the cursor and is about to
select), so band-motion is a rich prior — high motion means
"everyday arm activity" and pushes AWAY from firing, low motion
plus SNC activity together push TOWARD firing. Current motion
gate only vetoes on high motion, doesn't reward stillness as
positive evidence.

**Assessment of the proposal (my read).** Correct instinct, and
worth doing. Two distinct implementations, each hitting a
different failure mode:
1. **Motion pre-roll** (~30 min): require motion_score below
   threshold across the ENTIRE hold window, not just the current
   sample. Kills itch-class arm-motion false fires. Does NOT help
   tonight's rest false (motion was already zero there).
2. **IMU as training features** (~couple hours + retrain to v23):
   add recent motion energy + short-window trend to the LDA
   feature vector alongside the 36 SNC features. Model then learns
   "SNC-at-rest and SNC-during-intended-click look different even
   when motion is identical" — the direct fix for the rest false
   the user just saw. Recordings already have IMU (transport was
   changed to `signals=("snc", "imu_acc")` earlier), so no new
   data needed.
3. Cheap independent third move: raise `DEFAULT_CONFIDENCE` floor
   0.75 → 0.80 in `detector.py::from_profile`. Tightens the rest
   bar without touching motion.

**Status.** Recommendation delivered to user. Awaiting user's
pick on which of (1), (2), (3) to ship and in what order. Not
implementing anything until user chooses.

**Files touched:** none this turn.

---

## 2026-08-14 22:50-original — Restart for user live test (v22 + gates) — [SUPERSEDED BY DONE ABOVE]

**Goal.** Restart Factum so the user can test model v22 with the
new live gates and retune in play.

**State handed to the test:**
- Model v22 loaded automatically via `detector.from_profile` when
  the Trigger tab is opened.
- Detector live params: confidence >= 0.75, hold >= 5 windows
  (~500 ms), refractory 1.5 s, motion gate active (threshold 0.25),
  censorship gate active (threshold 0.10).
- Transport subscribes to `("snc", "imu_acc")` so IMU-based motion
  score has real data.
- Header click chip is display-only mirror of router state; flashes
  amber ONLY on router-delivered fires, not detector-internal
  decisions.

**Expected behaviour under test:**
- Rest → chip stays cyan, no flashes. Was flashing many times before.
- Curl (index or pinky) held ~500 ms → chip flashes amber if armed.
- Arm motion → motion gate abstains, no fire.

**How to interpret if it goes wrong:**
- Over-fires at rest → raise `DEFAULT_CONFIDENCE` floor in
  `detector.py::from_profile` (currently 0.75) or hold_windows
  floor (currently 5). See tuning notes in WORKLOG 22:30.
- Misses real triggers → lower those floors, or record more curl
  reps in a settled session.
- Motion gate abstains during real intended trigger → raise
  `DEFAULT_MOTION_ABSTAIN` in `detector.py` (currently 0.25).

**Status.** OPEN pending user's live test result. Next entry will
report what happened.

---

## 2026-08-14 22:45 — WORKLOG convention hardened + backfill for underlogged work — [DONE]

**Goal.** User demanded stricter WORKLOG adherence — every prompt,
every finish, every decision. Strengthened the convention block at
the top of this file. Then audited recent work for gaps and
backfilled the missing entries below.

**Convention change (top of this file):**
- Made the "log everything" rule explicit and quoted the user
  verbatim.
- Added a "common failures" list from actual mistakes made this
  project: unlogged code changes, vague bundled entries, missing
  rationale for thresholds, unlogged diagnostics.
- Kept the header format and OPEN/DONE/BLOCKED rules.

**Backfill entries added below (chronological order they
happened):** session-data analysis (Aug 14 session), model v20
(post first-fix retrain), model v21 (post re-audit with tonight's
probes flagged), header-chip iterations (three intermediate
versions before the final router-only fix), transport.py IMU
subscription decision.

**Files touched:** `WORKLOG.md` only.

**Result.** Convention hardened. Missing entries backfilled below.
Going forward: log immediately, not "when there's time".

---

## 2026-08-14 22:00 — [backfill] Header click chip — 3 iterations before the fix — [DONE]

**Goal.** Record what went wrong across three chip iterations so a
future Claude doesn't re-litigate the design.

**Iteration 1 (before user noticed the bug).** Chip read
`max(router.fired, detector.fires)` to determine flash — meaning
detector-internal decisions caused amber flashes even when the
router was disarmed. Chip pointed at `app.tuning_tab` which
doesn't own the router (`TriggerTab` does).

**Iteration 2 (targeting fix).** Repointed to `app.trigger_tab`.
Kept the `max()` bug — chip still flashed on detector-internal
fires. Also removed the wrong `winfo_ismapped` guard on
`TuningTab._tick` — that wasn't the right file. Later reverted;
the actual fix was on `TriggerTab._tick`.

**Iteration 3 (final, current).** Chip reads ONLY
`router.fired` for the flash-detection counter and only flashes
if `armed` is also true. Chip is now a pure passive mirror of
router state:
- grey = no detector loaded
- cyan = detector scanning, router NOT armed
- green = router ARMED with Action name
- amber flash = router.fired ticked AND armed=True

Rationale kept in `HeaderBar._update_click_status` docstring —
detector-internal decisions that the router blocks must NOT
flash the chip; user was seeing 20+ false flashes with the
router disarmed, mistaking model-internal decisions for real
click deliveries.

**Files touched:** `armband/app.py` (`HeaderBar` chip logic +
`_jump_to_tuning` renamed effect: opens Trigger tab).

**Do NOT go back to the `max()` pattern.** It conflates two
different signals: "did the model decide" (detector.fires) vs
"did the OS receive a click" (router.fired). The chip is about
the second.

---

## 2026-08-14 22:15 — [backfill] Session data analysis (Aug 14 session) — [DONE]

**Goal.** User completed a test session; asked for the read.
Documenting here so a future Claude sees the observations
without reloading the probes.

**Session:** `max-debug/right/2026-08-14_2125`, 5 probes.

**Numbers per probe:**
```
file                            kind         n_samp   cues   clip%(1/2/3)
001_rest_2128                   rest         25 056   —      0.00/0.00/0.00
002_moving-arm-around           distractor   35 838     5    0.93/1.60/12.23
003_rest_2131                   rest         25 056   —      0.00/0.00/0.00
004_curl-index-finger           probe        85 878    20    4.28/4.39/0.55
005_curling-pinky-finger        probe        85 896    20    0.39/0.34/0.00
```

**Findings for future modelling / recording sessions:**
- **Index vs pinky are separable by channel signature.**
  * curl_index:  [0.43, 0.43, 0.13]  (ch1+ch2 dominant)
  * curl_pinky:  [0.61, 0.39, 0.00]  (mostly ch1)
  * rest ref:    [0.33, 0.33, 0.33]  (baseline)
  Separable by shape alone before any classifier — good.
- **Rest #1 was noisier than rest #3** — ch2/ch3 collapse
  r=0.92 on rest #1 (band still settling), rest #3 clean.
  Prefer rest #3 as training baseline.
- **20-reps default worked**, no compromised at record time.
- **Two operator UX notes worth acting on:**
  1. Probe 004 note: "data looked slow to react (probably
     just interface catching up)" — investigate countdown /
     display lag.
  2. Probe 002 note: "was a little late to some cues" — supports
     per-rep confidence weighting when the correlator ships.
- **Arm-wave clipped ch3 12%** — under the (later-relaxed) 25%
  threshold, so it's usable data for the "movement" negative
  class.

**Files touched:** none (analysis only).

**Followup:** the UX "slow to react" note may be a real bug in
the countdown rendering — worth reviewing the 100ms tick cadence
under load.

---

## 2026-08-14 22:20 — [backfill] Model versions v20 + v21 (intermediate) — [DONE]

**Goal.** Record the trainings between v19 (last documented) and
v22 (fully documented in the 22:30 entry). Same numbers, different
data-inclusion decisions.

**Model v20 (first retrain after adding `_is_audit_compromised`
skip in build_dataset):**
- Same accuracy / recall / FA as v19.
- WHY same: the compromised probes were already being capped out
  by the rest-class-cap in `build_dataset` at line 555+. Removing
  them explicitly didn't change the input distribution.
- Confirmed the skip counter worked (5 skipped this run).

**Model v21 (after re-running audit tonight and flagging tonight's
`curl-index` at 4.39% clip as compromised):**
- Classes dropped to 2: `curling_pinky_finger` and `rest`.
- Accuracy 98%, recall @ 1% FA 96.7% — misleadingly high because
  no distractor class remained (both distractors were flagged),
  and curl_index was gone.
- This was the trigger for the audit-threshold rollback (2% → 25%).
  The 4.39% clip was peaks of a high-effort contraction, not
  destruction — skipping the probe was wrong.

**Files touched:** `armband/model.py` (`_is_audit_compromised`
helper + skip logic in `build_dataset`) — described in
detail in the 22:30 entry.

**Lesson for next Claude:** an audit threshold cannot be set
purely on "% of samples clipped." A rest recording clipping at
2% means something broke; a hard-contraction probe clipping at
4% is normal. The right question is
"is the probe's SHAPE recoverable, ignoring the clipped
samples?" — which is what the censorship-aware features answer.

---

## 2026-08-14 22:30 — Motion gate wired + live retune + audit rollback — [DONE]

**Goal.** User's live-click test misfired badly (detector fires while
at rest, chip flashing FIRED with router disarmed). Sanity check
concluded: over-firing is dominantly algorithm tuning, not data
volume. Fix in this order without changing the LDA math:
1. Wire the built-but-idle motion gate to the detector.
2. Retune LIVE parameters (hold/refractory/confidence) beyond the
   CV-derived operating point — CV numbers are optimistic because
   consecutive windows are correlated and training-rest is cleaner
   than real-rest.
3. Roll back the over-aggressive audit threshold (2% → 25%) that
   had been throwing out valid signal probes.

**Files touched with exact changes:**

- `armband/detector.py::from_profile()` — now takes
  `motion_score_provider` and `on_abstain` kwargs, plumbs both
  into the `Detector`. Also overrides the CV-derived operating
  point with stricter LIVE values:
    * `threshold = max(cv_threshold, 0.75)`  — was 0.52 in the CV.
    * `hold = max(cv_hold, 5)` windows @ 100 ms hop = 500 ms of
      sustained agreement — was 2 windows (200 ms).
    * `refractory_s = 1.5` — was 0.75.
  Rationale left in the docstring: CV assumes independent windows;
  live windows are correlated so projected FA rate is optimistic
  by ~10x. Explanation string now says
  "CV picked X / Yw — live is stricter. motion gate active."
- `armband/app.py::TriggerTab._ensure()` — builds a
  `_motion` closure that calls `self.app.client.motion_score(0.25)`
  and passes it as `motion_score_provider` to
  `detector.from_profile`. Detector's abstention gate
  (`motion_abstain=0.25` default) now suppresses fires when the
  arm is moving.
- `armband/transport.py` — every `MudraClient(signals=(...))` call
  changed from `("snc",)` to `("snc", "imu_acc")`. Required for
  `motion_score()` to have IMU data to compute on. `mudra_client`
  already handles imu_acc frames (wired in an earlier session
  but subscription was overridden by transport).
- `armband/audit_clipping.py` — `CLIP_COMPROMISED_PCT` raised
  from `2.0` to `25.0`. Comment in-file explains why: a
  high-effort contraction hits the rail at peaks and that's
  normal signal; sample-level clipping is handled per-window by
  the censorship-aware features (see features.py) rather than
  by wholesale-skipping the probe. Only egregiously destroyed
  probes (>25%) are "compromised" enough to skip entirely.
- One-off script (scratchpad, not committed) removed existing
  `# audit_status: compromised` lines from 7 previously
  over-flagged probes so they can be re-included in training.
- Re-ran the audit: **17 total probes, 2 compromised** (the two
  arm-wave probes at 27-37% clip — actually broken). Was 7.

**Numbers after retrain (model v22):**
- Skipped compromised: 2 (was 7). More data included: curl-index
  4.4% clip, moving-arm 12% ch3, curl-pointer 95 windows all
  came back in.
- CV accuracy 82.6%, false-fire rate 0.98%, recall @ 1% FA 78.3%.
- Same headline numbers as v20 — CV was already dominated by
  the good probes. The win is architectural (live gates), not
  in the CV metric.

**What changed operationally — for the next Claude / dev:**
- Detector NO LONGER uses the trained CV operating point verbatim.
  It uses `max(CV, LIVE_MIN)` for each parameter. If the CV
  picks something aggressive, the live floor still applies.
- Motion gate is ALWAYS on for detectors created via
  `from_profile` from the app. Offline replay via
  `evaluate_recording` doesn't wire the gate — that's
  intentional, offline replay measures CV-level performance.
- IMU_ACC is now a real subscription. If the Companion build
  doesn't expose imu_acc, `motion_score` returns 0.0 and the
  gate becomes a no-op — no crash.

**Followups for next session:**
- Test live: rest, then curl, then arm motion. Expected:
  * Rest: no fires (previously many false fires).
  * Curl: fires (may need 2-3 tries as hold=500ms is longer).
  * Arm motion: motion gate abstains, no fires.
- If rest still over-fires: raise threshold to 0.85+ or hold to
  8 windows (800 ms).
- If curl misses: lower threshold to 0.65, or record more
  curl reps with band settled and cleanly on skin.
- If motion gate fires spuriously (abstains during rest):
  Motion score threshold `motion_abstain=0.25` in
  `detector.py::DEFAULT_MOTION_ABSTAIN` — bump to 0.35 or
  higher.

---

## 2026-08-14 22:xx — Model trained + header-chip fixes — [DONE]

**Model v19 trained on max-debug/right (all 3 sessions, 40 cued reps).**
- Feature version: v2 (36 features)
- Grouped LORO CV, 144 folds
- Accuracy: 82.6%
- Signal recall (any): 81.8%
- False fire rate: 0.98% (under 1% budget)
- **Recall @ 1% FA: 78.3%** (was 20% on old data)
- Confidence threshold: 0.52
- Hold time: 0.5s (2 windows)
- Per-class:
  * curl_index  recall 69.7%  precision 98.2%
  * curl_pinky  recall 83.7%  precision 86.1%
  * movement    recall 73.7%  precision 95.9%
  * rest        recall 98.5%  precision 69.2%
- Learning curve: flat — more of the same movement won't help.
  Next win: a third distinct movement, or the motion gate (already
  wired, not evaluated in this CV).

**Header click-chip fixes.**
- The chip was polling `app.tuning_tab` for `router` / `detector`,
  but the actual arm button lives in **TriggerTab** (line 3636).
  Retargeted to `app.trigger_tab`. Chip now lights up green as soon
  as Arm is clicked in the Trigger tab.
- Text simplified per user spec — chip is DISPLAY ONLY:
  - grey `click: idle (no model)`
  - cyan `click: scanning · not armed`
  - green `click: ARMED · Action: <sink display name>`
  - amber flash `click: FIRED · <action>`
- Fire count / timestamps removed from the chip — that's Trigger-tab
  territory. The chip just tells you the state so you can glance and
  keep working.
- Clicking the chip opens the Trigger tab (was pointing at Tuning).

**Detector continuous-scan fix (from earlier tonight):**
Confirmed on TriggerTab._tick (line 3973) — `_pump()` runs
unconditionally; `_render()` still only runs when Trigger tab is
mapped. So the detector really is scanning in the background from
any tab; the header chip reflects that live.

**ACTIVE-mode / SNC question — honest answer.**
- **ACTIVE mode does NOT emit SNC**, per documented firmware behavior
  and Factum's own `coexist_test.py` findings.
  - `mudra_client.py:18-20`: "The Mudra band's ACTIVE mode runs its
    own gesture engine and consumes the SNC data internally — it
    does NOT stream. STANDBY mode is what we need."
  - `coexist_test.py` explicitly tests this. Expected outcome: in
    ACTIVE, no SNC arrives.
- So a click **cannot fire** while the band is in ACTIVE — the
  detector has no samples to decide on.
- **The user's belief that SNC once flowed in ACTIVE** is not
  supported by code or tests. Most likely explanation: they were
  looking at the connection chip (LIVE = WebSocket connected, not
  necessarily SNC arriving), or they were seeing navigation-cursor
  data flowing while SNC was silent.
- **Paths forward:**
  a. Stay in STANDBY. Test whether Companion also delivers a
     `navigation` (cursor) stream in STANDBY — if yes, Factum
     can consume both and Kyle gets cursor + click without ever
     leaving STANDBY.
  b. Direct BLE with RawData licence + `navigation_to_hid = True` +
     `snc` enabled together — the ideal architecture per CLAUDE.md,
     blocked upstream on licence.
- Not implementing any change tonight; user asked as a question,
  and forcing a Companion behaviour change is outside our scope.

**Files touched.**
- `armband/app.py` (header chip — target tab + simplified text)

**Result.** Model live. Chip properly reflects Trigger-tab arm state.
Ready for real click test in STANDBY mode.

---

## 2026-08-14 late — Click status chip in header + continuous detector — [DONE]

**Goal.** User is testing the live click; wants a visible "Factum is
what's firing" indicator from any tab, and a live scan indication.

**Session read (max-debug / right / 2026-08-14_2125).** 5 probes,
all clean, all captured with the new features working:
- 001 rest / 002 moving-arm (5 cued) / 003 rest / 004 curl-index
  (20 cued) / 005 curl-pinky (20 cued).
- 20-rep default in action; no compromised probes.
- Index vs pinky have clearly different channel signatures
  ([0.43, 0.43, 0.13] vs [0.61, 0.39, 0.00]) — separable by shape.
- Rest #1 was noisier than rest #3 (ch2/ch3 collapse r=0.92).
  Prefer rest #3 as training baseline; can average both with the
  caveat.
- Operator notes captured, including UX feedback:
  * "data looked slow to react (probably just interface catching
    up)" — worth investigating countdown/display lag.
  * "was a little late to some cues" on the distractor — supports
    per-rep confidence when correlator lands.

**Changes.**
- `armband/app.py` `HeaderBar`:
  * New "click:" chip next to the signal chip, always visible.
  * States:
    - grey `click: idle (no model)` — no detector loaded yet
    - cyan `click: scanning · N fires` — detector live, router NOT
      armed
    - green `click: ARMED · <sink> · N fires · Ms ago` — router
      armed, clicks will fire
    - amber flash `click: FIRED · N this session` for 500 ms after
      every fire event
  * Progress-to-fire micro-bar (80×8 canvas) beside the chip,
    fills toward SUCCESS colour as the detector approaches a fire.
  * Click the chip → jumps to Tuning tab (no separate keybinding
    needed).
  * Polled by `HeaderBar._update_click_status` from the existing
    500 ms `_tick` — reads `app.tuning_tab.detector` and
    `app.tuning_tab.router` directly. Cheap and cache-free.
- `armband/app.py` `TuningTab._tick`:
  * Removed the `winfo_ismapped()` guard around `self._pump()`.
    Detector now scans continuously in the background regardless
    of which tab is visible — required for the header chip to
    reflect real live state from any tab. `_render()` still only
    runs when the tab is mapped (cheaper, no hidden-widget
    flicker).

**Effect.** With a trained model, open Tuning once to initialise
the detector, then the header chip stays live from every tab. Arm
from Tuning; the chip goes green; a trigger fires an amber flash
+ increments the count. Any tab, any moment, one glance to know
Factum is (or isn't) the thing routing the click.

**Files touched.**
- `armband/app.py`

**Result.** Both features shipped. Restart at 20:xx.

---

## 2026-08-14 late evening — Bug-report widget picker — [DONE]

**Goal.** Extend the just-shipped bug-report feature so the user can
point at a specific UI element instead of describing it.

**Changes.**
- `armband/app.py`:
  - New `name_widget(w, name)` and `widget_name(w)` helpers. Attach
    semantic dotted-path names to widgets as code is touched — no
    big renaming pass; incremental. Unnamed widgets fall back to
    tkinter path + class in captures.
  - New `_describe_widget()`, `_tab_for_widget()`, and
    `capture_widget_neighborhood()` — grab self + parent chain +
    immediate children + siblings so Claude can match the note to
    the intended node.
  - New `WidgetPicker` class — bulletproof pick mode:
    * `_install_overlay()` — Toplevel with alpha=0.35, warn colour,
      repositioned per Motion tick over the widget's screen bbox.
    * `_install_label()` — small Toplevel following cursor, shows
      "<name> (<class>)".
    * `_install_banner()` — always-visible "PICK MODE — click/Esc/
      right-click to cancel (auto-exits 30 s)" pinned top-centre.
    * All 5 escape routes wired: Esc, right-click, Cancel banner
      button, 30 s timeout, and any exception in a handler routes
      through `_safe()` → `_teardown()`.
    * `_teardown()` unbinds each installed `<Motion>` / `<Button-1>` /
      `<Button-3>` / `<Escape>` binding individually (not
      `unbind_all` — that would clobber unrelated bindings),
      cancels the timeout, destroys overlay / label / banner, then
      fires the callback.
    * Alt-click picks the parent of the widget under cursor.
  - `BugReportDialog` extended:
    * "Pick widget…" button next to the text box; disabled with a
      "(disabled — recording)" label when
      `_recording_in_progress` is true.
    * Picked-widgets chip list, with × button per chip to remove.
    * Dialog iconifies while picking so it doesn't obscure the app,
      then restores and re-grabs on return.
    * Report markdown now has a `## Picked` section (per user
      spec format) with self / parents / children / siblings for
      every pick, above the operator's text.
    * Local (dialog-only) `<Control-Return>` / `<Escape>` bindings
      instead of `bind_all` — so they don't leak into pick mode.

**Bulletproof-ness (per spec).**
- Esc, right-click, banner button, 30 s timeout, exception in any
  handler — all five route through `_teardown()`.
- `_teardown()` is idempotent (checks `self.active`) and runs the
  callback last so a raise in the callback still leaves the picker
  clean.
- Overlay / label / banner Toplevels are destroyed by name, so a
  half-installed picker (setup exception before all three exist)
  tears down without crashing on `.destroy()` of `None`.
- Bindings stored by sequence; `unbind_all(seq)` for each installed
  sequence individually. Verified no `unbind_all` on `<Motion>`
  wipes other Motion bindings — tkinter's `bind_all` and
  `unbind_all` operate on the "all" tag which is separate from
  widget-specific Motion bindings.

**Deferred / follow-up.**
- Incremental widget naming — no big pass yet. `name_widget(w, "…")`
  is available; as code is touched, add semantic names to whatever
  is most likely to get picked.

**Files touched.**
- `armband/app.py`

**Result.** Live in the report dialog. Pick a widget, add it to the
list, write the note, save. Report markdown carries the full
neighborhood for Claude to disambiguate against the user's text.

---

## 2026-08-14 evening — Session-feedback capture (bug report + post-recording notes) — [DONE]

**Goal.** Two features for the user to use during live sessions.
Both must be fast, keyboard-driven, and never block the next
recording.

**Feature 2 — Report Bug button (top-bar, always visible).**
- `BugReportDialog` new class in `app.py`. One text box, Ctrl+Enter
  saves, Esc cancels.
- Auto-captures context: active tab, profile, arm,
  recording-in-progress flag, connection state, samples/s, frames
  received, last 12 client-log lines, UTC timestamp.
- Writes to `reportedbugs/<YYYY-MM-DD_HHMM>_<page-slug>.md`. One
  file per report, header block for context, user's text below.
- Header row in `HeaderBar` gets a "Report bug" button next to the
  Advanced toggle (right side).
- Never deletes; addressed reports move to `reportedbugs/done/`.

**Feature 1 — post-recording notes dialog.**
- `PostRecordingNotesDialog` new class in `app.py`. Opens
  automatically when `_on_recorded` completes.
- **NOT modal** — no `grab_set()`. The operator can start the next
  recording while the notes dialog is open. Auto-persists whatever
  is in the box on window-close (status: `auto`).
- Contents:
  * Software/Data toggle at top. Software notes are mirrored to
    `reportedbugs/` so Claude sees them at next session start.
  * Free-text box (6 rows).
  * 7 quick-tick checkboxes (missed cues / band slipped / lost
    connection / fatigued / distracted / felt different /
    inconsistent), each with an optional "rep #" field.
  * Existing structured ratings (effort / fatigue / confidence 1-5)
    on compact rows.
  * Save / Skip / Discard buttons. Ctrl+Enter saves, Esc skips.
    Discard prompts for confirmation, marks probe rejected without
    deleting.
- Persistence:
  1. `session.update_probe(fname, operator_notes=note)` → probes.json
  2. Appended to `session_notes.md` as a timestamped narrative
     block with `##` headings so it reads as a session log.
  3. `extra.operator_notes_json` written into the probe CSV header
     via new `_rewrite_probe_header()` helper (append/replace
     `# extra.<key>:` lines, sample rows untouched).
  4. If flagged as software note → also mirrored to
     `reportedbugs/<stamp>_post-recording_from_probe.md` with the
     probe context.

**CLAUDE.md startup rule (new).**
- Added "READ `reportedbugs/` AT SESSION START — before STATUS or
  WORKLOG" block. Every session Claude lists `reportedbugs/`, reads
  each `.md`, triages, addresses, moves to `done/` when done. Never
  deletes.

**Deferred (per user spec):**
- Correlation-at-session-close: for each ticked checkbox, run the
  data check described in the spec (schedule audit vs cued onset
  for "missed_cues", step-change detection for "band_slipped", gap
  detection for "lost_connection", median-frequency drift for
  "fatigued", within-probe feature-vector variance for "inconsistent").
  Notes have all the fields the correlator needs; the correlator
  itself is a next-session job.
- Weighting-not-exclusion for training: `model.fit()` already accepts
  `sample_weight`, and `operator_notes.checked` gives per-rep info
  the trainer can use. Not wired yet.
- ANALYSIS_PROMPT.md / REPORT.md rewrites to include notes verbatim
  plus corroboration results. Notes are already in probes.json so
  a future report-generator update can pull them.

**Files touched.**
- `armband/app.py` — `BugReportDialog`, `PostRecordingNotesDialog`,
  `_rewrite_probe_header` helper. `HeaderBar._open_bug_report` and
  the top-bar button. `_on_recorded` invokes the notes dialog after
  every probe. `import math`, `from pathlib import Path` added.
- `CLAUDE.md` — new "READ `reportedbugs/` AT SESSION START" section.
- `reportedbugs/` — created with `done/` subfolder.

**Result.** Both features live. Fast keyboard-first capture,
zero blocking of the recording flow. Correlation analysis and
notes-driven training weighting are follow-ups but the DATA STRUCTURE
supports them.

---

## 2026-08-14 late — CH3 pinning diagnosis, paused for data collection — [PAUSED]

**Situation reported.** User: "CH3 pinned in Factum. At the same moment,
on the same band, the Mudra app shows CH3 at barely a quarter bar."
Also perception of more clipping since recent changes. Reproducible
fixture: band on the table, off skin, both apps live.

**Diagnosis (three rounds of wire capture, no code changed).**

1. **Factum's data path is faithful.** Captured the raw JSON off
   `ws://127.0.0.1:8766/events` two ways — an independent WebSocket
   client subscribing only to `snc`, and Factum's own `MudraClient`.
   The two agree to the fourth decimal:
   ```
   ch    n     min      max      rms    clip%
   ch1  ~5k  -1.0000  1.0000   0.62-0.70   22-28%
   ch2  ~5k  -1.0000  1.0000   0.97        93%
   ch3  ~5k  -1.0000  1.0000   0.96        93%
   ```
   Companion is delivering railed data for ch2 and ch3 off-skin.
   Factum's parser is not modifying it. Not a Factum bug.

2. **Recent Factum changes did not cause the pinning.** The
   `mudra_client._on_message` snc handler is byte-for-byte identical
   to what it was before this week's work. My new
   `signals=("snc","imu_acc")` default in `MudraClient.__init__`
   is overridden by `transport.py`'s explicit `signals=("snc",)`,
   so the app still subscribes to SNC only.

3. **The pattern of the railed samples.** Not a fast 50 % sign-flip
   square wave — sign-flip rate is 8-9%, meaning ~17/18 samples in
   each 22 ms frame agree on one rail, then the next frame flips.
   Effectively a ~45 Hz rail-to-rail toggle. Median of ch2 = -1,
   median of ch3 = +1 (more than half of each channel's samples are
   at ONE specific rail). Classic floating-electrode signature.

4. **No simple filter reproduces "quarter bar" (~0.075).** Tested on
   the actual data — none of these come close:
   ```
   ch    raw_rms  hp2_rms  hp20_rms  median_sub  rolling_ptp  env_rms
   ch1   0.462    0.459    0.325     0.462       2.000        0.400
   ch2   0.966    0.969    0.650     1.301       2.000        0.949
   ch3   0.949    0.930    0.598     0.952       2.000        0.929
   ```
   My earlier Option A recommendation (apply HP20 to the display)
   would NOT have worked — HP20 rms is 0.60-0.65, still full bar.

5. **Mudra reference HTMLs are broken, not doing DSP.** Read
   `mudra-monitor.html` and `emg-visualizer.html` end-to-end. Both
   silently miscast the batched frames:
   - `mudra-monitor.html:1127`: `Number(v[0]||0)` on an 18-element
     array = `NaN`. Would render "NaN" text and blank canvas — NOT
     "quarter bar".
   - `emg-visualizer.html:245`: assigning `vals[ch]` (an 18-element
     array) into a Float32Array cell = NaN. Waveform draws nothing.
   Zero filtering, zero smoothing, zero decimation. So the
   "quarter bar" the user saw is from the native Mudra Companion /
   Link app (compiled, not inspectable), which must apply DSP we
   can't see. Not reproducible from the reference-HTML source.

**Two open questions we could not answer alone:**

- **On-skin vs off-skin clip%.** All wire captures were off-skin
  (the given fixture). If on-skin clip% drops to single digits, the
  fixture exaggerates a floating-input pathology and the on-skin
  ch3 complaint is a separate matter. If on-skin also shows heavy
  clipping, the band saturates in normal use and is a hardware
  ceiling to work around, not a Factum bug either way.
- **What Mudra's native app actually does.** Compiled binary, no
  source. The reference HTMLs don't help.

**Decision.** User is going to collect real recording data and see
whether the clipping situation resolves with proper on-skin sessions
and larger data volume. This diagnosis paused; no code changed. If
on-skin clip% turns out to be modest, the ch3 pinning fixture is
just off-skin floating-input noise and there is nothing to fix.

**Revised recommendation for when this is picked back up:**

- Option A (apply HP20 to the display meter) was rejected — the
  data proves HP20 doesn't collapse the rail-alternation enough.
- Option B (explicit "band appears off skin" detection + label)
  remains the honest fix if we ever decide the display bothers
  people. Signature: median at ±0.95 or beyond, clip% > 50% at
  "rest", sign-flip rate < 15%. Any two of those three ≡ off skin.
- Option C (change nothing) is what we're going with for now.

**Bigger strategic point (unchanged from earlier recommendation):**
The click won't fail because the meter looks wrong. It will fail
because the IMU motion score isn't wired to the detector and we
don't have enough data yet. Those two are what matters. The meter
is a UX friction issue, not a signal-processing issue.

**Files touched.** None. Diagnostic only. Scratchpad scripts:
- `scratchpad/wire_capture.py` — dual-path wire vs Factum capture.
- `scratchpad/wire_verify.py` — filter-comparison sweep.

**Result.** Not fixed, not deleted. Waiting on user's on-skin
recording data to decide whether this needs further work.

---

## 2026-08-14 — Finish the queue: items 3, 4, 5 remainder — [OPEN]

**Goal.** Complete every deferred item from the 2026-08-13 queue:
- Item 3: censored-data architecture (2.1-2.6)
- Item 4: placement confirmation modal per session
- Item 5 (remainder): per-CSV clip% header, live in-recording clip
  indicator, on-disk audit marking compromised probes

**Approach.**
1. Clip-mask helper + CSV header clip% (item 5 + 3.1 merged).
2. Censorship-aware feature extraction (3.2) — features.py.
3. Per-window sample weights + confidence weighting (3.3) —
   training path.
4. Stratified reporting in analysis.py (3.4).
5. IMU_ACC subscription (mudra_client.py) + motion score (3.5).
6. Detector abstention output (3.6).
7. Placement confirmation modal (item 4).
8. On-disk audit script (item 5 remainder).

**Status.** Working through in order. Notes below appended as each
step lands.

**Files touched.**
- `armband/probe_store.py` — new `CLIP_THRESHOLD = 0.999`,
  `clip_mask()` and `clip_fraction()` module-level helpers.
  `ProbeWriter` gained per-channel running clip counters and now
  writes `extra.clip_fraction` (`ch1=0.034 ch2=0.000 ch3=0.001`)
  and `extra.clip_threshold` into the CSV header at close.
- `armband/features.py`:
  * `_time_domain(x, mask=None)` — RMS/MAV computed on uncensored
    samples only when a mask is supplied (lower-bound flag left to
    the caller via the censorship fraction).
  * `vector()` and `windows()` gained a `clip_mask` kwarg,
    per-window slice passed down.
  * New `windows_with_mask()` returns
    `(F, starts, censorship_fractions)` — the last is per-window
    scalar in [0, 1] that the caller uses for sample weighting.
  * `CENSORSHIP_SPECTRAL_LIMIT = 0.05` module constant.
- `armband/mudra_client.py`:
  * default `signals` now `("snc", "imu_acc")` — IMU subscribed.
  * new `_imu_buffers` (3 axes), `imu_frames_received /
    imu_samples_received / imu_last_frame_ts` counters.
  * `_on_message` handles `t == "imu_acc"` frames (same coercion
    pattern as SNC — batch or scalar).
  * new `imu_snapshot(seconds)` returns (3, N) accel array.
  * new `motion_score(seconds=0.25)` returns scalar magnitude
    std-dev — the injectable source of truth the detector uses.
- `armband/detector.py`:
  * new `motion_score_provider`, `motion_abstain`,
    `censorship_abstain`, `on_abstain` constructor args.
  * `_decide` computes window censorship first; abstains if
    censorship >= 10% OR motion >= 0.25; sets `current_label` to
    `"abstain"`, increments `self.abstained`, records
    `last_abstain_reason`, calls `on_abstain` callback, returns
    `{"abstain": True, "reason", "motion", "censorship", "ts"}`.
  * `feat.vector` now called with `clip_mask` so amplitude features
    honour censorship live.
  * `snapshot()` exposes `abstained`, `abstain_rate`,
    `last_abstain_reason`, `motion_abstain`, `censorship_abstain`.
- `armband/model.py`:
  * `fit()` gained `sample_weight` kwarg. Global mean / scale /
    per-class means / pooled covariance all honour weights. Callers
    can pass `(1 - censorship_fraction)` to down-weight compromised
    windows without dropping them. Unweighted default preserved.
- `armband/app.py`:
  * new `PlacementConfirmDialog` — modal shown before every
    session's first recording. Pre-fills last saved placement and
    its age, requires Confirm or "Adjust in Contact & Placement".
    Confirmed state flagged on the Session object; subsequent
    recordings in the same session skip the modal.
  * `_start_recording_after_placement` and `_jump_to_placement_tab`
    handlers.
  * `RecordingOverlay` now shows a **live per-channel clip%
    indicator** (last 1 s window). Turns green / amber / red at
    < 0.1% / < 1% / >= 1%.
  * `_drain` reads `client.snapshot(1.0)` and calls
    `probe_store.clip_fraction` to update the indicator labels.
- `armband/audit_clipping.py` — new standalone script. Walks all
  probe CSVs, computes per-channel clip% and rest-RMS outlier
  ratio, writes an `<probe>.audit.json` sidecar, and prepends
  `# audit_status: compromised — <reasons>` to any probe crossing
  `CLIP_COMPROMISED_PCT (2.0%)` or `CH2_OUTLIER_RATIO_AT_REST
  (2.5x)`. Never deletes, never modifies sample rows or existing
  header keys. `--dry-run` flag for preview.
- `armband/stratified.py` — new module. `stratified_accuracy()`
  and `stratified_report_lines()` — cross-tab of per-class recall
  by (motion bin × censorship bin). Motion bins: still ≤0.10,
  some 0.10-0.20, moving >0.20 (from the STATUS.md diagnostic
  medians). Censorship bins: clean <1%, mild 1-5%, heavy ≥5%.
  Ready for analysis.py to import and wire into REPORT.md next
  time reports get regenerated.

**Ran the audit against the eight existing recordings:**
```
Total: 12   compromised: 5   already-flagged skipped: 0
Flagged (compromised):
  003_curling-pointer-finger_2048   ch1 2.1% / ch2 7.2% / ch3 5.9%
  004_mouse-cursor_2049             ch3 7.1%
  005_curl-sustained_2049           ch1 9.4% / ch2 8.8% / ch3 8.3%
  001_rest_2028                     ch2 3.4% + 4.2x neighbour RMS
                                    (the contact-fault probe we
                                    identified in the diagnostic)
  004_arm-wave_2033                 ch1 15.9% / ch2 27.2% / ch3 36.9%
```
Every probe now has an `.audit.json` sidecar with the numbers.

**Status.** All queue items completed. App restarted at 18:28:26.

**Result.** Censored-data architecture in full (3.1-3.6), placement
confirmation modal (4), remainder of clipping safeguards (5) —
DONE. Every recording from now on: honours censorship in feature
extraction, has motion + censorship-gated abstention, weights
censored windows down in training, carries clip% in its header,
shows a live per-channel clip indicator, and starts only after
placement confirmation. Existing on-disk recordings flagged.

---

## 2026-08-13 — Analysis stopped, implementation queue set, censored-data architecture — [OPEN]

**Goal (from user).** Stop analysing existing recordings. Build the
right architecture, then record fresh cued data under the fixed
protocol and measure THERE. Six honest findings recorded in STATUS.md.
Seven-item implementation queue in order.

**Honest findings (going into STATUS.md — full text there):**
1. Previous 98–99% trigger recall was CV leakage; correct grouped
   LORO gives 70–88%. **Every earlier figure in this project is
   optimistic until recomputed.**
2. Best measured recall @ 1% FA = **20.0%** (v1 raw, arm-wave). Not
   usable as-is.
3. v2's 21 spectral features do not beat v1's 15 under correct
   grouping; individual spectral features rank highest but the full
   set overfits. **Default to v1 until data volume justifies more.**
4. **Amplitude is an INVERTED discriminator** (arm-wave louder than
   trigger). No amplitude threshold works.
5. Only trigger probes have a cue schedule. Distractors were
   free-form → LORO impossible on the negative side. **Protocol
   defect.**
6. Effect sizes > 1.2 on individual features but 20% recall at strict
   operating point = **insufficient DATA, not insufficient
   modelling**. 75 positive windows, 5 reps, one session, one arm.

**Implementation queue (in this order, no more analysis until we
have new data):**

1. **Section 2 — one authoritative cue timeline.** Cue schedule
   generated up front; progress bar, prompt text, colour state, and
   sample timestamps ALL derive from that same object. No separate
   timers, no independent counters. Drive from monotonic elapsed
   time against the schedule; write actual displayed cue transitions
   into the recording as timestamped events; assert on close that
   every sample's implied phase matches what was displayed.
2. **Cue schedules on ALL protocols including distractors.**
   distractor_daily and distractor_extreme both need cued structure
   so future data supports grouped LORO on both sides.
3. **Part 2 — censored-data handling in full:**
   * 2.1 clip mask as first-class data (per-sample per-channel
     boolean, carried through every stage)
   * 2.2 censorship-aware feature extraction (rms/mav are lower
     bounds when censored; zc/ssc largely robust; spectral flagged
     when censorship > threshold)
   * 2.3 per-window confidence weighting (training weights inversely,
     detection raises confidence threshold)
   * 2.4 report performance stratified by censorship
   * 2.5 motion gating primary mechanism (subscribe imu_acc, motion
     score = IMU magnitude + sub-20 Hz SNC power, gate raises
     threshold or suppresses)
   * 2.6 abstention as a valid output ("conditions insufficient" as
     a third option; report abstention rate as a third number)
4. **Section 5 — placement confirmation modal per session.**
5. **Section 1 Step 3 — clipping safeguards** (already implemented
   at analysis time via `contact_check` and `quality`; needs to
   propagate: mark never drop, live indicator, pre-flight rest
   check, audit existing recordings).
6. **Sections 3 + 4 — cue pacing (3s countdown, longer defaults,
   "GET READY / GO / RELAX", audio, "rep N of M") and colour
   (GO=green, REST=red, countdown=amber, colour+word+shape).**
7. **Default feature set to v1.** Keep v2 available, not default.

**Non-negotiables carried forward.**
- Evaluate none of Part 2 on the existing 8 recordings. Build first,
  measure on new cued data recorded under the fixed protocol.
- Never silently discard clipped windows.
- Every recording carries its clip mask, its motion score, and its
  cue-vs-displayed audit trail.

**Files touched (this entry, growing as work lands).**
- `STATUS.md` — replaced amplitude-inversion headline with the six
  honest findings block. Old note preserved as the "session ceiling"
  section beneath.
- `armband/features.py` — `DEFAULT_VERSION` reverted from `"v2"` to
  `"v1"` (item 7). Note added explaining the reason and pointing at
  STATUS.md and this WORKLOG entry.
- `armband/protocols.py`:
  * added `_distractor_daily` (cued, 5 activities: reach for cup,
    typing, gestures, adjust glasses, doorknob) and
  * `_distractor_extreme` (cued, 4 vigorous motions), both with
    proper cued MOVE + RELAX phase structure for grouped LORO.
  * legacy `_distractor` retained for back-compat, comment redirects
    new sessions to distractor_daily.
  * `go_windows()` extended to include MOVE phases (cued distractor
    activities count as ground-truth labeled windows too).
  * new `phase_events()` — serialises the full schedule as event
    dicts for CSV/JSON headers.
  * `choices()` order updated: reps, rest, distractor_daily,
    distractor_extreme, distractor (legacy), ramp, sustained.
- `armband/app.py` `RecordProbeDialog`:
  * `_t_started` split into `_t_started_mono` (`time.monotonic()`)
    and `_t_started_wall` (`time.time()`) — measurement uses
    monotonic; wallclock kept only for the CSV `started` field.
    Wallclock jumps mid-recording no longer drift the cue schedule.
  * `_displayed_transitions: List[Dict[str, Any]]` — populated by
    `_update_cue` when the displayed phase changes. Records
    (t_elapsed_s, kind, label) as the operator actually saw it.
  * `_tick` elapsed derived from monotonic.
  * `_start` initialises both clocks; `meta.extra["schedule_json"]`
    written from `protocols.phase_events(self.phases)` so the
    intended schedule ships with every probe CSV.
  * `_close_writer` writes
    `extra.extra_displayed_transitions_json` (actual displayed
    transitions),
    `extra.extra_schedule_audit_max_lag_ms` (worst displayed vs
    scheduled lag), and
    `extra.extra_schedule_audit_mismatch_frac` (fraction of
    scheduled transitions where displayed phase disagreed).
  * new `_audit_schedule_vs_displayed()` computes the lag/mismatch
    numbers per Section 2 spec.

**Status.**
- Item 7 (default v1) — DONE.
- STATUS.md updated with the six findings — DONE.
- Item 1 (one authoritative timeline) — DONE. Monotonic clock,
  displayed transitions logged, close-time audit writes lag +
  mismatch numbers into the header.
- Item 2 (cue schedules on all distractors) — DONE.
  distractor_daily and distractor_extreme are cued; both are cueing
  protocols under grouped LORO; both surfaced in the picker.

**Item 6 pulled forward — done at 18:17 for tonight's recording:**
- `PHASE_COLORS`: GO stays green, RELAX and STILL now RED (was blue —
  blue does not read as STOP). New `COUNTDOWN_COLOR = WARN` (amber),
  `COUNTDOWN_LEAD_S = 3.0`.
- `RecordProbeDialog.__init__` precomputes `_active_phase_indices`
  (GO + MOVE) and `_total_reps`. New `self.rep_lbl` widget on the
  cue band showing "Rep 3 of 20" during active phases or
  "Rep 4 of 20 — up next" during preceding PREPARE/RELAX.
- `_update_cue` rewritten:
  * headline is a single readable word: GO / RELAX / STILL /
    GET READY (across-room legibility).
  * band solid-fills on GO / RELAX / STILL / MOVE; PREPARE stays
    neutral. Colour + word + fill change together (colour-blind
    operators still get the signal).
  * bell rings on GO, RELAX/STILL, and MOVE transitions.
  * in the last COUNTDOWN_LEAD_S seconds of a phase whose next
    phase is GO / RELAX / MOVE, phase clock becomes a huge amber
    integer ("3", "2", "1") with a bell per new integer second.
  * text tones darkened (#052e16 / #450a0a / #4c2a04) so words stay
    readable against the solid colour.
- `import math` added at top of app.py (needed by `math.ceil`).

**Preflight rest check added (subset of Item 5):**
- `_preflight` runs BEFORE `_start` opens the writer — no probe
  file created if the check fails.
- 3-second rest sample, then:
  * any channel clipping ≥ 0.5% at rest → refuse
  * any channel's RMS > 2.5× median of the others → contact fault,
    name the channel
- Failure UI: "PREFLIGHT FAILED", specific per-channel reason,
  Retry / Cancel buttons in the cue band.
- Success flashes "PREFLIGHT OK" for 400 ms, then proceeds.

**Protocol defaults updated per user directive:**
- `config.py::protocol_reps` default 5 → **20**
- `config.json::protocol_reps` 5 → **20**

**Still deferred (after tonight's recording):**
- Item 3 — censored-data architecture (2.1-2.6). Includes
  IMU_ACC subscription (needs `mudra_client.py` change), clip mask
  through pipeline, feature-set audit for censorship-robustness,
  per-window confidence weighting, motion gating as primary,
  abstention output.
- Item 4 — placement confirmation modal per session.
- Item 5 remainder — per-CSV clip% header, live in-recording
  indicator, on-disk audit marking compromised probes.

**App restarted at 18:17:15 with everything above. Parse-tested;
runtime test happens tonight when recording.**

**Result.** Queue items 1, 2, 6, 7 DONE. Preflight quick-win from
item 5 DONE. Reps default 5→20 DONE. Ready to record. Items 3-5
(remainder) queued for after the session.

---

## 2026-08-12 20:30 — Recording-pipeline diagnostic (Sections 1 + 1a-f, no code changes yet) — [OPEN]

**Goal.** User reported channels railing at ±1.0 even with band correctly
fitted, while Mudra Link's own app displays a small quiet signal at the
same moment. Diagnose whether clipping is at source or in our handling,
identify DC-offset / motion-artifact / saturation causes, propose fixes,
wait for user decision. Do NOT change code until Step 2 is approved.

**Approach.**
1. Audit real recordings on disk for clip%, DC offset, min/max/rms
   per channel (Step 1a).
2. Grep whole socket→CSV path for any scaling/normalisation (Step 1b).
3. Check SDK/Companion for any gain/sensitivity parameter (Step 1d).
4. Classify: source vs handling (Step 1c), motion vs saturation vs DC
   drift (Step 1e), DC offset relevance (Step 1f).
5. Propose 3+ options with trade-offs (Step 2).

**Status.** Steps 1a-f complete. Step 2 draft delivered. Awaiting user
decision on option order (C+A+B recommended). NO code changes made.

**Key findings (numeric).**
- Handling path has ZERO scaling / normalisation / multiplication
  from socket to CSV. Values arrive already at exactly ±1.0000 on
  the wire — this is at SOURCE.
- SDK has `setSampleType` (16 vs 24 bit) and nothing else that affects
  amplitude. No gain command exists.
- Real audit of 5 probes from 2026-08-12_2028 session:
  * rest probes clean (0.00-0.02% clip), EXCEPT probe 001 ch2 =
    3.44% clipped (see next entry).
  * "waving arm around gently" = **15-37% clipped** (catastrophic).
  * "wiggling pointer finger" = 0.02-0.16% clipped (fine).
- DC offset ≈ 0 across all recordings (means ±0.005). DC removal
  would not create headroom.

**Files touched.** None (diagnostic only).

**Result.** Reported in chat. Options C+A+B recommended; awaiting
approval. Options: C = mark/preserve/live-indicator; A = try 24-bit
sample_type test; B = email Wearable Devices for raw-counts or gain;
D rejected (post-clip gain is fiction).

---

## 2026-08-12 20:50 — Frequency-content analysis → motion-artifact hypothesis confirmed — [DONE]

**Goal.** User challenged my classification of the arm-wave clipping
as "amplitude saturation". Motion artifact (band shifting against skin
during limb movement) should be <20 Hz; muscle EMG is 20-450 Hz. Rerun
with proper spectral analysis and pre-clip windows.

**Approach.** Welch-like PSD per channel on probes 004 (arm wave), 005
(finger wiggle), 001 (rest). Compute fraction below 20 Hz vs 20-420 Hz.
Same analysis on 512-sample windows immediately preceding each isolated
clip event. High-pass at 20 Hz (scipy Butterworth order 4 sosfiltfilt)
and report residual clip%.

**Key findings.**
- probe 004 (arm wave): 36-39% of power below 20 Hz; peak spectral
  bins at 13 Hz. HP20 reduces clip% from 15-37% to **3.5-7.6%**
  (~78% reduction).
- probe 005 (finger wiggle): 6-9% below 20 Hz; peaks 55-86 Hz (muscle
  band). Barely any clipping either way.
- **Motion artifact confirmed as dominant cause of arm-wave clipping.**
- HP does NOT fix all clipping — 3.5-7.6% of arm-wave still clips
  post-HP, from real muscle-band content during vigorous motion.

**Files touched.** None.

**Result.** Reported in chat with full per-channel numbers.

---

## 2026-08-12 20:55 — Probe 001 ch2 intermittent contact fault — [DONE]

**Goal.** Explain why probe 001 ch2 clipped 3.44% at rest while ch1
and ch3 clipped 0.00% in the same recording.

**Approach.** 1-second-bin timeline of ch2, ch1/ch3 during ch2 burst
window, cross-probe comparison across all rest recordings tonight.

**Key findings.**
- Timeline: 4-sample startup transient at t=0.59s, THEN 10 s clean,
  THEN 6-second burst at t=11.9-17.9s (858 clipped samples), THEN
  12 s clean.
- During burst: ch2 rms=0.53, |peak|=1.00, 17% clipped. ch1 rms=0.049,
  ch3 rms=0.055 — arm was at rest, only ch2 misbehaved.
- Cross-probe: probe 001 ch2/median(ch1,ch3) = **4.15x** (outlier).
  Probes 002 and 003 minutes later: 0.73x, 0.72x (normal).
- Verdict: intermittent single-channel electrode contact fault,
  self-resolved by probe 002.

**Files touched.** None.

**Result.** Reported. Preflight heuristic proposed: channel_rms /
median(others) > 2.5x at rest → refuse to start, name the channel.

---

## 2026-08-12 21:30 — Priority 1 retest: dB / thresholds / classifier with HP20 — [DONE]

**Goal.** User asked to retest the "+13.5 dB / defeat every threshold /
50.4% recall at 1% FA" finding on high-passed data. Rerun using
arm-wave (not mouse-cursor) as distractor — that's the artifact-heavy
condition HP actually addresses.

**Approach.** 
1a. dB above rest for trigger + mouse + arm distractors, raw vs HP20.
1b. Full threshold sweep k=2..12, false-fire counts per probe.
1c. ROC / AUC / recall @ 1% FA for amplitude score alone.
1d. LDA v1 vs v2 with GroupKFold-5-time-blocks CV (first pass).

**Key findings.**
- Arm-wave RAW = **+17.47 dB above rest** (LOUDER than trigger's
  +11.87 dB). HP20 knocks arm-wave to +15.30 dB — still louder.
  Trigger − arm-wave gap = −5.60 dB raw, −3.98 dB HP20.
- **Amplitude AUC trigger vs arm-wave = 0.224 raw / 0.282 HP20**
  (below 0.5 = anti-correlated). Recall @ 1% FA = 0.0% both.
- **Amplitude is an INVERTED discriminator** — false condition
  louder than true.
- v1 (15 feat) vs v2 (36 feat), HP20 vs arm-wave: 88-90% CV acc,
  AUC 0.87-0.89. But at 1% FA operating point, only 6-10% recall.
- HP more than doubles amplitude-based recall @ 1% FA vs
  mouse-cursor (5.4% → 17.6%).

**Files touched.** None. Analysis run from scratchpad only.

**Result.** Reported. STATUS.md updated with headline finding (see
next entry). Motion gating now identified as PRIMARY mechanism, not
an enhancement.

---

## 2026-08-12 21:50 — STATUS.md: "AMPLITUDE IS AN INVERTED DISCRIMINATOR" prominence — [DONE]

**Goal.** Per user instruction, record the amplitude-inversion finding
prominently in STATUS.md so future readers see it first.

**Files touched.** `STATUS.md` — added a 🔴 top section with:
- The dB numbers (trigger +11.87 raw / +11.32 HP20 vs arm-wave
  +17.47 raw / +15.30 HP20).
- Consequences 1-5 (HP necessary-not-sufficient, motion gating
  primary, per-window still/moving reporting, v2 features conditional,
  distractor_daily/extreme protocol split).
- Session ceiling notes: residual clipping 3.5-7.6% after HP;
  probe 001 ch2 contact fault preflight heuristic.

**Result.** Live in STATUS.md.

---

## 2026-08-12 22:15 — Priority 1 deep dive: feature ranking, redundancy, class weighting, motion gating — [OPEN]

**Goal.** After user's four corrections: (1) rerun with correct
grouped LORO by cue index; (2) investigate v1 vs v2 redundancy with
correlation matrix + within-fold top-K selection; (3) fix classifier
objective with class weighting + direct 1% FA operating point + low-FA
ROC table; (4) test motion gating properly with fraction-of-trigger-
windows-lost reported; also check ch2_bp_mid inversion.

**Approach.** Load cue schedule from probes.json (probe 003 has 5
cued intervals: 3-5s, 8-10s, 13-15s, 18-20s, 23-25s). Trigger windows
filtered to those overlapping cued intervals, group = cue index 0..4.
Distractor windows chunked into 5 equal time blocks (no cue schedule
available — PROTOCOL FINDING to flag). GroupKFold-5 with shared 0..4
labels holds out one cue AND one distractor block per fold.

**Key findings.**
- **PROTOCOL: distractor recordings have NO cue schedule.** Only true
  LORO possible on trigger side. Distractor redesign
  (distractor_daily + distractor_extreme) should include cue schedules.
- Cued-only trigger has 75 windows (was 221 with all-window
  approach). Distractor still 237 windows across 5 time blocks.
- **Under correct grouping, v1 raw vs arm-wave = 20% recall @ 1% FA
  (was 9.5% under wrong grouping — jumped up because held-out sets
  are more consistent within-cue).** v2 hp20 vs arm-wave = 10.7%
  (was 6.8%). Directionally consistent with prior conclusion.
- **Feature redundancy: 8 of 105 top-15 pairs have |r|>0.9, 15 of 105
  have |r|>0.7.** ch1_bp_high, ch1_mdf, ch1_bp_mid form a highly
  correlated cluster; ch2_bp_high, ch2_bp_mid, ch2_mdf another.
- **Top-K within-fold selection: K=6 gives 88.1% AUC / 2.7%
  recall @ 1% FA. K=36 (full v2) gives 87.3% AUC / 10.7% recall.**
  Reduced sets don't beat the full set at the operating point that
  matters — because the discriminating power at low FPR relies on
  a specific combination of features that univariate ranking loses.
- **Class weighting has zero effect on AUC / recall @ 1% FA up to
  50:1.** As expected for LDA — priors shift the decision boundary
  but not the score ordering; AUC and any score-threshold operating
  point are invariant to prior.
- **ROC table near low-FA end (v2 HP20 vs arm-wave):**
  ```
  FPR       TPR       threshold
  0.0000    0.0133    18.07
  0.0042    0.0400    15.53
  0.0084    0.1067    12.54  <-- ~1% FA operating point
  0.0169    0.1600    11.44
  0.0422    0.3067     9.07
  0.0970    0.6133     5.04
  ```
  ROC is EXTREMELY steep near the origin — small increase in FA budget
  from 1% to 4% would triple recall to 30%.
- **Motion gating (SNC sub-20 Hz fraction):**
  * baseline (no gate) v2 HP20 vs arm-wave = 10.7% recall @ 1% FA.
  * gate at 0.20 median distractor: loses **10.7% of trigger** but
    **83.1% of distractor** windows.
  * problem: with 83% of distractor gated out, only 40 distractor
    windows remain to compute the 1% FA operating point on. Small-N
    hurts more than gate helps at this dataset size.
  * **IMU_ACC is NOT SUBSCRIBED yet** — imu_acc is not in the
    WebSocket subscriptions in mudra_client.py. IMU gate cannot be
    tested against archived data; requires new recordings after
    subscription is added.
- **ch2_bp_mid inversion is NOT a bug.** Trigger has 34.7% of HP20
  power in 20-60 Hz; arm-wave has 55.2%. Because trigger's energy
  concentrates in the 60-150 Hz muscle band, its bp_mid FRACTION is
  smaller even though bp_mid absolute power is comparable. Expected.

**Files touched.** None. Analysis in scratchpad
(`priority1_v3.py`).

**Status.** Analysis complete, results in chat. Awaiting user
review before proceeding to implementation. Next open questions:
should we use the reduced K=6 feature set, or stay with v2? Do
IMU_ACC subscription now (small change to mudra_client.py) so
gate can be tested empirically?

**Result.** Documented above. Pending user decision on architecture.

---



**Goal.** Sections 1–7 from the round-4 spec. Behavioural bugs
first (auto-switch, drag control), then drawing bugs (limb outline,
hand, spacing, labels).

**Changes.**
- `armband/app.py`:
  - `_activate_profile` now auto-switches to the first PLACEABLE arm
    on load. Opening test-kyle no longer lands on the transhumeral
    right side; it lands on left where the band can actually go.
  - `ContactTab` gained an explicit arm switcher (LEFT/RIGHT
    buttons) adjacent to the diagram, plus a prominent
    "Switch to X arm to set placement" button that appears only when
    the current arm is unplaceable and the other is.
  - New helpers `_pick_arm`, `_switch_to_placeable`,
    `_sync_arm_switcher` (highlights active arm, shows/hides the
    switch prompt).
- `armband/anatomy.py`:
  - `DIAGRAM_W` reduced from 900 to **780** — fits a 1280 px window
    without a horizontal scrollbar.
  - Per-panel asymmetric gutters: panel 1 has a wide LEFT gutter
    (140 px) for landmark labels and a narrow RIGHT gutter (28 px)
    because the ALIGNED/distance badge is drawn INLINE next to the
    band. Panel 2 keeps symmetric 96 px gutters for thumb/pinky.
    `"0 mm — elbow crease"` no longer clips at the panel edge.
  - Longitudinal ALIGNED/distance badge moved from the right gutter
    to `cx + strip_half + 10` — adjacent to the band range strip,
    right next to the arm silhouette. No more ~100 px dead space
    between the limb and the readout.
  - Limb polygon rewritten as a **single continuous closed path**
    with a smooth 12-point hemisphere over the distal end for
    transradial and transhumeral. No separate ellipse cap → no
    lump. Distal end is narrower than proximal by design (~62-78%).
  - Hand rewrite: palm is a rounded rectangle overlapping the
    forearm top by 4 px (no seam); fingers overlap the palm top by
    4 px (no seam); thumb is a rotated rounded rectangle whose base
    anchors INSIDE the palm at (`cx + s * palm_w * 0.30`,
    `palm_top_y + palm_h * 0.35`) and extends outward at +45 deg
    (LEFT) / +135 deg (RIGHT) in canvas polar. Thumb thickness
    ~1.5× a finger; length ~70% of longest finger.
  - Transhumeral panel 2 now includes a small **reference
    upper-arm cross-section** (humerus bone, biceps / triceps
    compartment labels, "reference only — not a placement target"
    warning). Anatomy stays documented instead of the panel going
    blank. Humerus label sits in the LEFT gutter to avoid
    text-vs-oval collision.
  - `_draw_panel_titles` no longer appends "(estimated)" when the
    limb has no residual length (transhumeral, unknown). The label
    only applies where a NUMBER is shown.
  - `Limb.headline()` same fix — transhumeral now reads
    "No forearm segment on this side", no marker; transradial
    with ESTIMATED source still shows "280 mm (estimated)".

**Acceptance (spec Part 7).** 15 headless renders, each printing
its own counts:

```
PASS  1. test-kyle/left transradial 280 ESTIMATED   tt=0 tp=0 oob=0 drag=2 hand=0
PASS  2. test-kyle/right transhumeral               tt=0 tp=0 oob=0 drag=0 hand=0
PASS  3. max-debug/right intact                     tt=0 tp=0 oob=0 drag=2 hand=6
PASS  4. max-debug/left intact                      tt=0 tp=0 oob=0 drag=2 hand=6
   transradial 280 range: 42–255 mm
PASS  5a. drag to min (42)                          tt=0 tp=0 oob=0 drag=2 hand=0
PASS  5b. drag to max (255)                         tt=0 tp=0 oob=0 drag=2 hand=0
PASS  UNKNOWN                                       tt=0 tp=0 oob=0 drag=0 hand=0
PASS  8 rotation ±90/0/+45 renders on both arms    all: tt=0 tp=0 oob=0
DIAGRAM_W = 780, fits at 1280 px window without scrollbar
```

All 15 renders: 0 text-text collisions, 0 text-path collisions,
0 out-of-bounds. Drag control renders (`drag=2` = band rectangle +
black centring line) for every profile/arm with `has_forearm=True`,
including transradial. Hand geometry present iff INTACT.

**Follow-ups.**
- Real `BAND_WIDTH_MM` measurement (still 40 mm approximation).
- Kyle's actual forearm length — swap `ESTIMATED` for `MEASURED`
  when calipers come out.

**Files touched.**
- `armband/anatomy.py`
- `armband/app.py`

**Result.** All seven spec sections addressed. App restarted at
16:52 → 17:xx.

---

## 2026-08-11 22:05 — Placement diagram: round 3 (coordinate contract + fixed size) — [DONE]

**Goal.** Six-section spec. Section 1 (the coordinate contract) is
load-bearing; everything downstream flows from it.

**Section 1 — placement_contract.py.**
- New file: `armband/placement_contract.py`. Single source of truth
  for DISTANCE (elbow-crease datum, integer mm, band-CENTRE), ROTATION
  (anatomical, +ve toward thumb, arm-independent — the renderer
  mirrors per arm via `anatomical_to_screen`), CHANNELS (ch1=ulnar,
  ch2=median, ch3=radial, arm-independent), VIEW DIRECTIONS
  (cross-section: elbow→hand, longitudinal: from above palm-down),
  and BAND GEOMETRY (`BAND_WIDTH_MM=40`, `BAND_CLEARANCE_MM=5`,
  `SENSOR_SPACING_MM=6`). `PLACEMENT_CONVENTION_VERSION = 1` and a
  large explanatory docstring for a five-years-later reader.
- Contract module has its own self-test on `__main__`.
- `armband/test_placement_contract.py` — 7 unit tests: round-trip
  preservation, mirroring symmetry, ch1 on pinky side both arms, ch3
  on thumb side both arms, +45° actually moves sensors toward thumb
  on both arms, band range derives from contract formula, version is
  positive int. All 7 pass.
- `armband/anatomy.py` refactored to import all constants and helpers
  from `placement_contract`. Local re-definitions of
  `PALM_CENTRE_DEG`, `DORSAL_CENTRE_DEG`,
  `ELECTRODE_ANATOMICAL_OFFSETS_DEG`, `BAND_RIGID_HALF_ARC_DEG`,
  `BAND_STRAP_HALF_ARC_DEG`, `ALIGNED_TOL_DEG`, `ROTATION_CLAMP_DEG`,
  `arm_screen_sign`, `BAND_WIDTH_MM`, `BAND_CLEARANCE_MM` deleted.
  `Placement.electrode_angles` and `Placement.mark_angle` call
  through the contract; nothing derives the mapping inline any more.
- `armband/probe_store.py`: `ProbeMeta` gains structured fields
  `placement_distance_mm`, `placement_rotation_deg`,
  `placement_convention_version`, `anatomy_source`. Written to every
  probe CSV header. Absent means the recording pre-dates the
  contract; never default them to 0.
- `armband/app.py`: probe-creation call populates the new fields
  from `profile.placement(arm)` and `profile.limb(arm)`.

**Section 2 — fixed pixel dimensions.**
- `DIAGRAM_W = 900`, `DIAGRAM_H = 460` module constants in
  `anatomy.py`.
- `_geometry()` no longer reads `winfo_width/reqwidth` — always
  returns the fixed dimensions.
- `ContactTab` canvas created with fixed width/height,
  `pack(side="top", anchor="nw")`, no fill/expand. Wrapped in a
  Frame with a horizontal scrollbar so a narrow container scrolls,
  never shrinks.

**Section 3 — systematic overlap detection.**
- `_assert_layout()` extended: returns a counts dict
  `{text_text, text_path, out_of_view}` and prints them to stderr
  on non-zero.
- Cross-section artwork now drawn under a single tag
  (`section-art`); labels ("DORSAL — velcro strap", "VOLAR —
  sensors") placed relative to `canvas.bbox('section-art')` after
  the fact, so they can never overlap the drawn geometry by
  construction regardless of rotation.
- Longitudinal panel: `HAND_RESERVE_H = 92` reserved at the top of
  the drawing band; the wrist Y sits BELOW that line, so the hand
  can never extend into the title band.
- ALIGNED readout in the LONGITUDINAL panel already sits in the
  right gutter next to the band; gutter width tightened from 132 to
  118 to reduce dead space.

**Section 4 — redrawn hand.**
- Palm as a rounded rectangle (rounded via smooth-polygon), roughly
  wrist-wide and slightly longer than wide.
- Four fingers as rounded rectangles with graduated lengths (middle
  longest, pinky shortest), width sized so all four fit across the
  palm with small gaps.
- Thumb as a rounded rectangle rotated 45° from the palm axis on the
  anatomically-outboard side (LEFT arm → screen right, RIGHT arm →
  screen left).
- New helpers `_rounded_rect_pts_fn` and
  `_rotated_rounded_rect_pts`.
- Hand height capped to `HAND_RESERVE_H - 8` so it fits in the
  reserved slot.

**Section 5 — Kyle's provisional anatomy.**
- `armband/profiles/test-kyle/profile.json` updated: left
  `transradial 280 mm ESTIMATED`, right `transhumeral 0 mm
  ESTIMATED`.
- `Limb.measurement_source` new field, `MEASURED` / `ESTIMATED`,
  serialised via `to_dict`/`from_dict`.
- `Limb.from_dict` now defaults `level` to UNKNOWN (was INTACT),
  `residual_mm` to 0. A missing anatomy block renders as the
  explicit error state instead of a silent intact fallback.
- `Limb.headline()` handles UNKNOWN with an explicit error message
  and appends " (estimated)" for ESTIMATED sources. Fixes the stale
  "Intact arm, forearm 0 mm" panel header that used to appear
  above the "No anatomy defined" diagram.
- Panel title subtitle renders in warning colour when
  `measurement_source == ESTIMATED`; in error colour when level is
  UNKNOWN.
- Every probe CSV recorded against an ESTIMATED anatomy carries
  `anatomy_source: ESTIMATED` in its header.

**Section 6 — cross-section detail.**
- Sensor pads now rounded-rect polygons ~6 px thick × ~18 px wide
  (via `_draw_sensor_pad` with `halfwidth_deg=5.5`, radii `r+2` to
  `r+10`), clearly visible against the dark housing.
- Charging contacts moved to `contact_r = band_r_outer + 5` — on
  the OUTER surface of the housing, off the flanks. LED at
  `led_r = band_r_outer + 5` on the opposite flank. Nothing on the
  inner surface except sensors, per the rule.
- Housing (rigid dark) at `r+4 → r+18`, ~200° across palm; strap
  (fabric light) at `r+6 → r+14`, ~160° across dorsal — verified
  in code. Distinct stroke weights (housing width=3, strap width=1
  with dashed cross-hatch texture).
- Black centring line drawn on the STRAP (dorsal side) with
  matching dashed midline across the arm from dorsal to palm,
  both coloured by alignment state.

**Acceptance (Part 6 from the spec).**
- Cases run: max/right, max/left, test-kyle/left (transradial 280
  ESTIMATED), test-kyle/right (transhumeral), rotation ±90 and 0
  and +45 on BOTH arms, band at min and max range, UNKNOWN
  anatomy — 15 renders total.
- Every case reports `text_text=0  text_path=0  oob=0`.
- Hand-geometry regression: `hand=6` for INTACT profiles, `hand=0`
  for non-intact (transradial, transhumeral, unknown).
- `test_placement_contract.py`: 7/7 pass.
- Diagram width fixed at 900 px, height 460 px; canvas scrolls
  horizontally in a narrower container instead of shrinking.

**Files touched.**
- `armband/placement_contract.py` (new)
- `armband/test_placement_contract.py` (new)
- `armband/anatomy.py`
- `armband/app.py`
- `armband/probe_store.py`
- `armband/profiles/test-kyle/profile.json`

**Follow-ups.**
- Measure `BAND_WIDTH_MM` against the real device (currently 40 mm,
  approximate).
- Kyle's actual forearm lengths per side — swap `ESTIMATED` for
  `MEASURED` in his profile.json when the calipers come out, but
  DO NOT retroactively change the flag on already-recorded probes.

**Result.** Diagram matches spec on all 15 acceptance cases with
zero collisions. App restarted at 22:04:xx.

---

## 2026-08-11 21:35 — Placement diagram: round 2 fixes — [DONE]

**Goal.** Seven-point spec addressing round-1 defects: orientation was
inverted, cross-section view direction was wrong (flipping left/right
vs. longitudinal), test-kyle silently rendered as intact 260mm both
sides, three text-vs-artwork overlaps, ALIGNED readout hidden inside
cross-section, charging contacts on the wrong surface, housing/strap
looking wrong, band range reached the wrist (physically impossible).

**Changes.**
- `armband/anatomy.py`:
  - Added `UNKNOWN` level and `_draw_unknown_anatomy` — renders an
    explicit "No anatomy defined" error state instead of silently
    falling back to intact. `default_limbs()` now returns UNKNOWN for
    non-debug profiles (never guesses).
  - `BAND_WIDTH_MM = 40` and `BAND_CLEARANCE_MM = 5` added.
    `Limb.band_range_mm` now computes
    `hi = residual_mm - band_width/2 - clearance`. For an intact
    260 mm arm the range is 39–235 mm (was 39–260). Approximate;
    real device measurement is a TODO.
  - Longitudinal panel FLIPPED: hand at TOP, elbow at BOTTOM.
    `_y_for_mm` inverted; polygon walks distal→proximal; hand drawn
    UPWARD from wrist; elbow crease + label at bottom; end-of-limb
    label at top. Palm faces down convention; thumb on the
    outboard side per arm.
  - Cross-section caption changed to "viewed from the elbow, looking
    toward the hand" — matches the longitudinal panel so both agree
    on which side the thumb is on.
  - Housing / strap layout corrected:
    * Rigid housing centred on palm (270°), ~200° arc, dark charcoal.
    * Fabric strap centred on dorsal (90°), ~160° arc, light grey
      with dashed cross-hatch texture.
    * Black centring line moved to the STRAP (dorsal side) — was
      previously on the housing (palm side). Coloured green when
      aligned, amber when off-centre.
    * Housing centre + strap centre both rotate with `rotation_deg`.
  - Charging contacts and LED moved to the OUTER surface of the
    housing (`r + 4` outside `band_r_outer`), off the flanks. Rule
    documented in-file: only skin-contacting features appear on the
    inner surface.
  - ALIGNED readout moved OUT of the cross-section, placed on its
    own line above the sensor legend. Format now always shows the
    number: "0° — ALIGNED" or "+18° — OFF CENTRE (12 mm)".
  - Cross-section radius reduced ~15% (0.85 factor). Bottom band
    reservation grew to 74 px so the ALIGNED readout + sensor legend
    both fit under the volar caption without overlap.
  - Hand size clamped so total (palm + fingers + fingertip cap) fits
    inside the reserved top padding above the wrist — fingers no
    longer spill past the top edge of the drawing band.
  - Added `_assert_layout()` post-render check — logs OOB and
    text-overlap warnings to stderr on every redraw, so broken
    renders show up in the app log instead of shipping silently.
  - Added `_regression_no_hand_geometry()` and `tags=("hand-geom",)`
    on every hand-drawing call. Acceptance test asserts non-intact
    profiles produce zero hand-tagged items.
- `armband/profiles/test-kyle/profile.json`:
  - Cleared the misconfigured intact-both-sides limbs (they came
    from the debug-profile default and were wrong for a subject).
    Levels now `unknown`, residual_mm 0, `type` changed from
    `debug` to `subject`. Note in the file explains why. Once real
    measurements are available, fill this in — the renderer will
    show "No anatomy defined" until then.

**Verification (acceptance).** Headless render + bbox + hand-geom
regression for 12 cases: max-debug both arms, transradial 230,
transhumeral, UNKNOWN, rotation ±90°, both range limits, narrow (720)
and wide (1200), and a transradial with rotation. 12/12 PASS: no
out-of-bounds elements, no text overlaps, and hand-tagged items
appear iff level == INTACT.

**Follow-ups.**
- Real `BAND_WIDTH_MM` from a caliper measurement of the device.
- Kyle's actual forearm_length_mm per side, once available — write
  into test-kyle/profile.json (level `transradial` for left,
  `transhumeral` for right per CLAUDE.md).
- "Load previous placement" one-click control (deferred from round 1).

**Files touched.**
- `armband/anatomy.py`
- `armband/profiles/test-kyle/profile.json`

**Result.** Round-2 spec fully implemented, machine-verified. App
restarted after the last edit.

---

## 2026-08-11 21:12 — Placement diagram: full spec rewrite — [DONE]

**Goal.** User provided a comprehensive spec (six parts) covering layout
clipping, orientation rules, real-band rendering, profile-driven
anatomy, interaction, and acceptance criteria. Implement all of it.

**Changes.**
- `armband/anatomy.py`:
  - **Constants.** Renamed `ELECTRODE_PALM_OFFSETS_DEG` →
    `ELECTRODE_ANATOMICAL_OFFSETS_DEG` (stated as ulnar-negative /
    radial-positive in anatomical space, mirrored to screen per arm).
    Removed `BAND_U_HALF_ARC_DEG`; added `BAND_RIGID_HALF_ARC_DEG`,
    `BAND_STRAP_HALF_ARC_DEG`, `ALIGNED_TOL_DEG`, `ROTATION_CLAMP_DEG`,
    `PALM_CENTRE_DEG`, `DORSAL_CENTRE_DEG`, band colour palette
    (`BAND_HOUSING_FILL`, `BAND_STRAP_FILL`, `BAND_CONTACT_GOLD`,
    `BAND_LED_BLUE`).
  - **Channel order fix (Part 2).** New `arm_screen_sign(arm)` = +1
    for left, -1 for right. `Placement.electrode_angles()` now maps
    each anatomical offset through this sign, so ch1 (ulnar) always
    renders on the pinky side of the diagram regardless of arm.
    Verified: LEFT arm angles 261/270/279 (ch1 on left = pinky side);
    RIGHT arm angles 279/270/261 (ch1 on right = pinky side).
  - **Rotation semantics (Part 5).** `rotation_deg` now stored in
    anatomical space: positive = toward thumb, negative = toward
    pinky, regardless of arm. Drag handler converts screen offset
    back to anatomical via the same sign, clamped to +/-90 deg.
  - **Layout system (Part 1).** Fixed-band panels: TITLE_H=44,
    HINT_H=50, GUTTER_W=132, PAD=8. New `_panel_layout` computes
    per-panel bands and gutters; `_geometry` returns two of them plus
    the artwork geometry. All labels are placed inside the gutters
    with explicit anchors; artwork is confined to the artwork region.
    Panel titles are two lines (profile name / arm + level).
  - **Longitudinal view (Part 2).** Inverted so elbow is at TOP,
    distal end at BOTTOM. Elbow crease labelled `0 mm — elbow crease`
    in the left gutter. Distal-end label (`wrist` or
    `residual limb end`) also in the left gutter, at the bottom.
    Distance and alignment badge in the RIGHT gutter, aligned with
    the band. Arm midline dashed line. Band cuff drawn as a filled
    rectangle CLIPPED to the arm width (`arm_half_here * 1.04`) with
    the physical black centring line across it.
  - **Cross-section view (Part 3).** Viewed distal→proximal, palm
    down. Bones (radius/ulna) mirrored per arm and placed dorsal of
    centre. Real Mudra Band drawn: rigid D-arc housing across ~200
    deg on the palm side (filled polygon via `_arc_ring_pts`), fabric
    velcro strap across ~160 deg on the dorsal side with dashed
    hatch marks. Three sensor pads as pill shapes on the inner
    surface (`_draw_sensor_pad`). Five gold charging contacts in a
    row on the outer face of the housing; one blue LED. Physical
    black centring line drawn on the outside of the band; matching
    dashed palm-centre reference on the arm midline. Alignment
    readout at the cross-section centre is one line only ("ALIGNED"
    or "+30° · 20 mm"), so its bbox doesn't creep into bones or
    palm caption.
  - **Hand (intact only, Part 4).** Drawn at the BOTTOM (elbow-at-top
    convention). Palm, four fingers with per-digit lengths and
    rounded fingertips, thumb on the anatomically-outboard side per
    arm. Kyle's transradial limb gets a rounded stump only — never a
    ghost hand.
  - **No forearm (Part 4).** Panel 2 replaced with a plain
    "No forearm segment — the band cannot be placed on this side"
    message; panel-1 arm is drawn as an upper-arm stump ending in a
    rounded cap. Both panels' drag hints replaced with
    "no placement — nothing to drag". Drag events short-circuit
    when `!limb.has_forearm`.
  - **Snap + fine (Part 5).** Drag snaps to 5 units (5 mm / 5 deg)
    by default. Holding Shift during drag switches to 1-unit fine
    mode (uses `event.state & 0x0001`).
  - **Robust pre-render layout.** `_geometry` now falls back to
    `winfo_reqwidth/reqheight` when the canvas is not yet mapped
    (`winfo_width == 1`), and enforces a 720x400 minimum. Prevents
    the gutter-collapse fallback from firing in real use.
- `armband/app.py`:
  - Canvas grew to `height=440`.
  - `refresh_limb` passes `profile_name=prof.name` into `LimbDiagram`
    for the panel-1 title.

**Verification (Part 6 acceptance).** Headless render + bbox
checker on all four profile/arm cases + rotation limits + narrow
and wide window widths + arbitrary rotations. 12/12 PASS: no
out-of-bounds text, no text-vs-text overlap.
- 1. max-debug / right — full arm and hand, no clipping.
- 2. max-debug / left  — cross-section mirrored vs right.
- 3. kyle / left       — transradial with rounded end, no hand.
- 4. kyle / right      — panel 2 disabled, message stack.
- 5a/b. rotation +/-90 — no element leaves viewBox.
- 6a/b. band at min/max range — labels legible.
- 7a/b. 720 px narrow / 1200 px wide — layout stable.
- 8/9. arbitrary rotations +/- 45 / -30 — passes.
- Anatomical order verified programmatically: ch1 always on pinky
  side, ch3 always on thumb side, per arm.

**Follow-ups deferred (Part 5 nice-to-haves).**
- Placement HISTORY (append-only list) + one-click "load previous
  placement" — needs a small schema addition to profile.json.
  Current behaviour (write-latest) is unchanged.

**Files touched.**
- `armband/anatomy.py`
- `armband/app.py`

**Result.** Diagram now matches the spec: clip-free layout, elbow at
top, mirrored cross-section per arm, ch1/ch3 anatomically correct,
D-shape rigid housing + fabric strap + sensor pads + centring line
+ charging contacts + LED, alignment status live, profile+arm
in title, transhumeral panel disabled with an explanation, snap +
shift-fine drag. App restarted at 21:11:57.

---

## 2026-08-11 20:40 — Contact & Placement tab: polish pass — [DONE]

**Goal.** User feedback after v1: ch2 label overlapped with the palm
caption; diagram too small; text clipping (elbow crease); diagram
didn't rebuild on profile switch; wanted a much wider placement range
(all the way to the wrist); wanted the arm rotated vertical with the
hand at the top; wanted the black centring line drawn across the band
on the arm slider as well.

**Changes.**
- `armband/anatomy.py`:
  - `BAND_MIN_FRACTION 0.20 -> 0.15`, `BAND_MAX_FRACTION 0.75 -> 1.00`
    so the band can sit anywhere from the elbow crease to the wrist
    end (or Kyle's transradial end). Max's band range is now 39–260
    mm; Kyle's is 34–230 mm.
  - `_geometry()` rewritten for a vertical arm on the left half and a
    larger cross-section on the right. Canvas grew from 200 to 360 px
    tall; `top_pad`/`bot_pad` keep labels off the edges (fixes elbow
    crease clipping).
  - Introduced `_y_for_mm` / `_mm_for_y` / `_half_at_mm` — arm is
    drawn vertically with a slight muscle-belly bulge, tapering less
    aggressively for Kyle's transradial stump.
  - `_draw_side` rewritten: vertical polygon, elbow crease at bottom,
    wrist/end at top, band as a horizontal ellipse crossing the arm,
    **black centring line drawn across the band** so the physical
    reference mark is visible in the side view too, "band fits"
    dashed strip runs vertically alongside.
  - `_draw_section` polished: bigger radius; sensor legend moved
    OUT of the cross-section entirely (single row below the palm
    caption), so nothing overlaps ch2 or the palm text. Added
    "BAND ORIENTATION" title so the two panels are unambiguously
    different views. "GOOD" appears next to the readout when the
    mark is within 2° of palm centre.
  - `_draw_hand` rewritten for vertical orientation: palm above the
    wrist, four finger nubs on top, thumb on the correct side per arm
    (thumb outboard convention).
  - `_draw_no_forearm` rewritten for vertical orientation: shorter
    upper-arm stump with a rounded elbow cap, shoulder crease at
    bottom.
  - `_on_press` now decides slide vs. rotate by which half of the
    canvas the pointer is in; `_on_drag` slide branch reads from Y.
- `armband/app.py`:
  - `ContactTab` canvas grew from `height=200` to `height=360` and
    now `fill="both", expand=True` so it stretches with the window.
  - Removed the `_diagram_arm` cache. `refresh_limb()` now rebuilds
    the `LimbDiagram` every time — the diagram is cheap and caching
    was hiding a stale-profile bug.

**Verification.**
- `armband/anatomy.py` text run: OK.
- Headless Tk render for all four cases: OK.
  - Max left intact: band range 39–260, cluster around 285°.
  - Max right intact: band range 39–260, cluster around 270°.
  - Kyle left transradial: band range 34–230.
  - Kyle right transhumeral: `_draw_no_forearm` renders vertical
    upper-arm stump.
- App restarted at 20:37:45; user is verifying visually now.

**Files touched.**
- `armband/anatomy.py`
- `armband/app.py`

**Result.** Diagram is bigger, vertical, clip-free, has the centre
line on the side view, rebuilds correctly on profile switch, and the
band can be placed anywhere from elbow to wrist end.

---

## 2026-08-11 20:15 — Contact & Placement tab: fix arm diagram for Max + fix band cross-section — [DONE]

**Goal.** Fix two things in the Contact & Placement tab before
recording more data:
1. Diagram was Kyle-only in effect. Max has two intact arms; the
   diagram must follow the main window's left/right selection.
2. The cross-section spread three channels 120° around a full circle;
   the real band is a U with sensors clustered on the palm side and
   velcro across the back.

**What was actually there.**
- `prof.active_arm` already drove the diagram; the chain
  `ArmPill._make_active -> app.on_context_changed ->
  contact_tab.refresh_limb` already existed (`armband/app.py:4739`).
- `max-debug/profile.json` already had `type: debug` with intact
  limbs both sides, so `default_limbs('debug')` returned INTACT.
- So the wiring was fine — what was wrong was the drawing itself: no
  hand, no handedness cue, and the electrodes-on-a-circle layout.

**Changes.**
- `armband/anatomy.py`:
  - Removed `ELECTRODE_BASE_DEG = (0, 120, 240)`. Added
    `PALM_CENTRE_DEG = 270`, `ELECTRODE_PALM_OFFSETS_DEG = (-9, 0, 9)`
    (~6 mm cluster on a 240 mm forearm), and `BAND_U_HALF_ARC_DEG = 135`.
  - Redefined `rotation_deg` semantics: offset of the black centring
    mark from palm-centre, clamped in the drag handler to ±90°.
  - `Placement.electrode_angles()` returns the clustered positions.
  - `_draw_section` completely rewritten: forearm cross-section with
    mirrored ulna/radius (thumb outboard for both arms), a U-shaped
    band drawn as two concentric arcs + radial caps, velcro strap
    across the back gap, three tightly clustered sensors on the palm
    side, and the physical black centring line drawn at rotation_deg.
    Readout inside the circle now says either "mark centred" or
    "mark N mm toward thumb/pinky".
  - `_draw_side` now adds a small hand outline on intact limbs
    (thumb on the correct side per arm) and labels the arm
    (LEFT/RIGHT FOREARM). Kyle's transradial limb still gets the
    original "end of limb" rendering.
  - `_rotation_words`, `placement_steps` rewritten around the
    "black mark, palm centre" language.
  - Added helpers `_arc_mm`, `_off_centre_side`.
- No profile has a saved `rotation_deg`, so the semantic change is
  safe; no downstream code (analysis/detector/model) reads electrode
  angles — only anatomy.py used them.

**Verification.**
- `armband/anatomy.py` text run: OK for both KYLE_LIMBS.
- Headless Tk render: OK for left intact, right intact, kyle-left
  transradial, kyle-right transhumeral. Cluster angles for a +15°
  rotation on an intact arm: 276°, 285°, 294° (tight cluster around
  palm centre = 270°).
- Real UI in the app: **NOT tested** — user is about to test.

**Files touched.**
- `armband/anatomy.py`
- `CLAUDE.md` (added a pointer to WORKLOG.md convention)
- `WORKLOG.md` (this file, new)

**Result.** Placement metadata now reflects the band's real physical
shape. Ready for recording sessions. Any future stray reference to
"120°" or "electrodes-around-a-circle" is an artefact of the old model
and should be treated as a bug.
