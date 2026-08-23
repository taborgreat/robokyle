# Session report — max-debug / right / 2026-08-14_2125

Generated 2026-08-14T21:45:51 by Factum. This file is meant to be readable on its own: you do not need the app, and you do not need to have been there.

## What we recorded

- **Date**: 2026-08-14
- **Arm**: right
- **Band battery**: 80% (on battery)
- **Started**: 2026-08-14T21:25:54   **Ended**: 2026-08-14T21:45:50
- **Probes**: 3 movements, plus a rest recording

## How much to trust this session

2 of 5 recordings were flagged automatically.

Nothing was discarded. Every flagged recording is still analysed and still appears below; the flag says what to distrust, not what to ignore.

- **rest** — suspect (0.85): Usable but flagged — ch2 and ch3 track each other closely (r=0.92).
  - ch2 and ch3 track each other closely (r=0.92)  →  Some independence is being lost. A small rotation of the band usually helps.
- **moving arm around** — suspect (0.78): Usable but flagged — ch3 clips on 12.2% of samples at the peaks.
  - ch3 clips on 12.2% of samples at the peaks  →  Some peak information is lost. Fine if the movement is strong; worth re-seating that electrode if it gets worse.

## What looked good

- **curl index finger** — usability 0.67, consistency 0.88, +10.2 dB above rest, effort unrated, 20 repetitions
- **curling pinky finger** — usability 0.56, consistency 0.90, +4.2 dB above rest, effort unrated, 20 repetitions

## What looked bad

- Nothing to flag.

## Every probe

| # | Probe | Reps | Consistency | vs rest | Effort | Fatigue | His conf. | Usability | Recording |
|---|-------|------|-------------|---------|--------|---------|-----------|-----------|-----------|
| 1 | rest (rest) | — | — | — | — | — | — | — | suspect |
| 2 | moving arm around | 5 | 0.89 | +12.9 dB | — | — | — | 0.72 | suspect |
| 3 | rest (rest) | — | — | — | — | — | — | — | good |
| 4 | curl index finger | 20 | 0.88 | +10.2 dB | — | — | — | 0.67 | good |
| 5 | curling pinky finger | 20 | 0.90 | +4.2 dB | — | — | — | 0.56 | good |

## Can these be told apart?

d' below 1.0 means a classifier will confuse them; above 1.5 they are usably distinct; above 3.0 unmistakable.

| Probe A | Probe B | d' | Expected confusion | Verdict |
|---------|---------|----|--------------------|---------|
| curl index finger | curling pinky finger | 2.27 | 13% | distinct |
| moving arm around | curling pinky finger | 2.52 | 10% | distinct |
| moving arm around | curl index finger | 2.58 | 10% | distinct |

## What changed since last time

No earlier session recorded these probe names — this is the baseline they will be compared against next time.

## What to try next

- 'curling pinky finger' separates cleanly from ordinary movement (d'=2.52) — a promising trigger candidate.
- 'curl index finger' separates cleanly from ordinary movement (d'=2.58) — a promising trigger candidate.
- Best candidate so far: 'curl index finger' (usability 0.67, consistency 0.8779, effort unrated). Record it again next session to confirm it repeats across days.

## Baseline (rest) recording

- Duration: 29.478s
- ch1 (ulnar): RMS 0.09659, DC offset -0.0010, clipping 0.0%
- ch2 (median): RMS 0.09720, DC offset -0.0093, clipping 0.0%
- ch3 (radial): RMS 0.09908, DC offset -0.0022, clipping 0.0%

## How usability is scored

usability = 0.45 x consistency + 0.25 x strength + 0.20 x his confidence + 0.10 x effort, minus a small fatigue tie-breaker (none 0, some 0.02, high 0.05). Consistency is weighted highest on purpose: a movement he cannot repeat identically is unusable no matter how strong it is. Effort and fatigue are recorded and reported but deliberately carry little weight — a movement that produces a good, repeatable result is worth keeping even if it is tiring, and should not be scored out of contention for it.

## What the numbers mean

- **snr_vs_rest** — How much louder the channel is than this session's rest recording, in dB. 0 dB means indistinguishable from rest. Above ~6 dB is a signal you can see; above ~12 dB is comfortable.
- **onset_latency_s** — Seconds from the start of the recording to the first burst of activity. Only meaningful when he was cued to start immediately.
- **rise_time_s** — How long the first burst took to go from 10% to 90% of its peak. Shorter is a crisper onset and easier to trigger on.
- **reps** — Bursts of activity found in the recording — one per attempt at the movement.
- **consistency** — How alike the repetitions are, 0-1, computed as 1/(1 + mean coefficient of variation of the feature vector across repetitions). 1.0 means identical every time. This is the number that matters most: a movement he cannot repeat identically is unusable no matter how strong it is. Above 0.70 is good, below 0.50 is a problem.
- **channel_signature** — Share of the movement's energy carried by each electrode. A movement concentrated on one channel is easier to separate than one spread evenly across all three.
- **usability** — Overall 0-1 score, weighted heavily toward whether the movement repeats reliably. Effort and fatigue are recorded but carry little weight: a tiring movement that gives a good, repeatable result is worth keeping. See 'How usability is scored'.
- **d_prime** — Separability between two probes along the best linear boundary. Below 1.0 the classifier will confuse them; above 1.5 they are usably distinct; above 3.0 they are unmistakable.

---

Raw data: `probes/` (CSV, one file per probe, self-describing header). Machine-readable version of this report: `analysis.json`. Manifest: `probes.json`.
