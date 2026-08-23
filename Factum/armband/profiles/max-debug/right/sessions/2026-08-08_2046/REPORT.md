# Session report — max-debug / right / 2026-08-08_2046

Generated 2026-08-08T20:50:05 by Factum. This file is meant to be readable on its own: you do not need the app, and you do not need to have been there.

## What we recorded

- **Date**: 2026-08-08
- **Arm**: right
- **Band battery**: 14% (on battery)
- **Started**: 2026-08-08T20:46:30   **Ended**: 2026-08-08T20:50:05
- **Probes**: 3 movements, plus a rest recording

## What looked good

- **curling pointer finger** — usability 0.69, consistency 0.85, +13.5 dB above rest, effort unrated, 5 repetitions

## What looked bad

- **curling pointer finger; sustained** — usability 0.32 (not enough repetitions to judge)

## Every probe

| # | Probe | Reps | Consistency | vs rest | Effort | Fatigue | His conf. | Usability |
|---|-------|------|-------------|---------|--------|---------|-----------|-----------|
| 1 | rest (rest) | — | — | — | — | — | — | — |
| 2 | rest 2 (rest) | — | — | — | — | — | — | — |
| 3 | curling pointer finger | 5 | 0.85 | +13.5 dB | — | — | — | 0.69 |
| 4 | Normal movement. using band like a mouse cursor | 10 | 0.42 | +13.5 dB | — | — | — | 0.51 |
| 5 | curling pointer finger; sustained | 1 | — | +14.8 dB | — | — | — | 0.32 |

## Can these be told apart?

d' below 1.0 means a classifier will confuse them; above 1.5 they are usably distinct; above 3.0 unmistakable.

| Probe A | Probe B | d' | Expected confusion | Verdict |
|---------|---------|----|--------------------|---------|
| curling pointer finger | Normal movement. using band like a mouse cursor | 1.98 | 16% | distinct |
| curling pointer finger | curling pointer finger; sustained | 2.50 | 11% | distinct |
| Normal movement. using band like a mouse cursor | curling pointer finger; sustained | 3.20 | 5% | distinct |

## What changed since last time

No earlier session recorded these probe names — this is the baseline they will be compared against next time.

## What to try next

- 'curling pointer finger' separates cleanly from ordinary movement (d'=1.98) — a promising trigger candidate.
- 'curling pointer finger; sustained' separates cleanly from ordinary movement (d'=3.20) — a promising trigger candidate.
- 'Normal movement. using band like a mouse cursor' is strong but he cannot repeat it (consistency 0.42). Worth re-recording with a clearer cue before writing it off — an inconsistent movement is unusable as it stands.
- 'curling pointer finger; sustained' shows fewer than two clear attempts, so repeatability could not be judged. Re-record it with several distinct attempts separated by a clear rest.
- Best candidate so far: 'curling pointer finger' (usability 0.69, consistency 0.8453, effort unrated). Record it again next session to confirm it repeats across days.

## Baseline (rest) recording

- Duration: 30.145s
- ch1 (ulnar): RMS 0.07431, DC offset +0.0009, clipping 0.0%
- ch2 (median): RMS 0.07808, DC offset -0.0071, clipping 0.0%
- ch3 (radial): RMS 0.06968, DC offset -0.0003, clipping 0.0%

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
