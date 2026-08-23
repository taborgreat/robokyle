# Session report — max-debug / right / 2026-08-08_1701

Generated 2026-08-08T19:53:11 by Factum. This file is meant to be readable on its own: you do not need the app, and you do not need to have been there.

## What we recorded

- **Date**: 2026-08-08
- **Arm**: right
- **Band battery**: 76% (on battery)
- **Started**: 2026-08-08T17:01:25   **Ended**: 2026-08-08T19:53:11
- **Probes**: 0 movements, plus a rest recording

## What looked good

- Nothing cleared the bar this session.

## What looked bad

- Nothing to flag.

## Every probe

| # | Probe | Reps | Consistency | vs rest | Effort | Fatigue | His conf. | Usability |
|---|-------|------|-------------|---------|--------|---------|-----------|-----------|
| 1 | rest (rest) | — | — | — | — | — | — | — |
| 2 | baseline (rest) | — | — | — | — | — | — | — |

### Notes taken at the time

- **baseline** — forearm supported on table; recorded to replace the unsupported first rest

## Can these be told apart?

d' below 1.0 means a classifier will confuse them; above 1.5 they are usably distinct; above 3.0 unmistakable.

Not enough probes to compare.

## What changed since last time

No earlier session recorded these probe names — this is the baseline they will be compared against next time.

## What to try next

- No movement probes recorded — only rest. Nothing to compare.

## Baseline (rest) recording

- Duration: 29.807s
- ch1 (ulnar): RMS 0.10460, DC offset +0.0011, clipping 0.0%
- ch2 (median): RMS 0.21146, DC offset -0.0106, clipping 0.1%
- ch3 (radial): RMS 0.20265, DC offset -0.0023, clipping 0.0%

## How usability is scored

usability = 0.40 x consistency + 0.25 x effort + 0.20 x strength + 0.15 x his confidence, minus a fatigue penalty (none 0, some 0.10, high 0.30). Consistency is weighted highest on purpose: a weak movement performed identically every time is more useful than a strong one that varies, and a movement that tires him will not survive daily use however good its numbers look.

## What the numbers mean

- **snr_vs_rest** — How much louder the channel is than this session's rest recording, in dB. 0 dB means indistinguishable from rest. Above ~6 dB is a signal you can see; above ~12 dB is comfortable.
- **onset_latency_s** — Seconds from the start of the recording to the first burst of activity. Only meaningful when he was cued to start immediately.
- **rise_time_s** — How long the first burst took to go from 10% to 90% of its peak. Shorter is a crisper onset and easier to trigger on.
- **reps** — Bursts of activity found in the recording — one per attempt at the movement.
- **consistency** — How alike the repetitions are, 0-1, computed as 1/(1 + mean coefficient of variation of the feature vector across repetitions). 1.0 means identical every time. This is the number that matters most: a movement he cannot repeat identically is unusable no matter how strong it is. Above 0.70 is good, below 0.50 is a problem.
- **channel_signature** — Share of the movement's energy carried by each electrode. A movement concentrated on one channel is easier to separate than one spread evenly across all three.
- **usability** — Overall 0-1 score, weighted toward consistency and low effort rather than raw strength, because those are what survive daily use. See 'How usability is scored' in the report.
- **d_prime** — Separability between two probes along the best linear boundary. Below 1.0 the classifier will confuse them; above 1.5 they are usably distinct; above 3.0 they are unmistakable.

---

Raw data: `probes/` (CSV, one file per probe, self-describing header). Machine-readable version of this report: `analysis.json`. Manifest: `probes.json`.
