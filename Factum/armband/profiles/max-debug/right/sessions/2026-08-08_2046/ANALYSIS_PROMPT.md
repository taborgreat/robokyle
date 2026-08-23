# Analysis prompt — max-debug / right / 2026-08-08_2046

Paste everything below into a Claude conversation, or point a Claude Code session at this folder and ask it to read this file.

---

## Context

I am working with Kyle, who has a bilateral transradial amputation (both hands removed just above the wrist). We are recording surface nerve/muscle signals from his residual forearm with a Mudra Band (3 electrodes: ch1 ulnar, ch2 median, ch3 radial, ~1000 Hz). The movements he attempts are phantom/attempted movements, not executed ones — there is no hand to move. There is no fixed movement list: we are discovering which signals he can produce at all.

The goal is the SMALLEST set of reliably separable signals, not the largest. Consistency and low effort beat raw signal strength: a weak movement performed identically every time is more useful than a strong one that varies, and a movement that tires him will not survive daily use.

## This session

- Date: 2026-08-08
- Arm: right
- Rest recording: yes
- Movement probes: 3

## Probe data

**curling pointer finger**
- repetitions: 5, consistency: 0.85, usability: 0.69
- strongest channel: ch3 (radial) at +13.5 dB above rest
- channel signature (share of energy): [0.248, 0.381, 0.371]
- onset latency: 3.00s, rise time: 1.00s
- his ratings: effort unrated, fatigue unrated, confidence unrated/5

**Normal movement. using band like a mouse cursor**
- repetitions: 10, consistency: 0.42, usability: 0.51
- strongest channel: ch3 (radial) at +13.5 dB above rest
- channel signature (share of energy): [0.201, 0.25, 0.549]
- onset latency: 5.20s, rise time: 0.19s
- his ratings: effort unrated, fatigue unrated, confidence unrated/5

**curling pointer finger; sustained**
- repetitions: 1, consistency: —, usability: 0.32
- strongest channel: ch3 (radial) at +14.8 dB above rest
- channel signature (share of energy): [0.335, 0.322, 0.343]
- onset latency: 3.00s, rise time: 0.28s
- his ratings: effort unrated, fatigue unrated, confidence unrated/5

## Pairwise separability (d')

- curling pointer finger vs Normal movement. using band like a mouse cursor: d'=1.98, expected confusion 16%
- curling pointer finger vs curling pointer finger; sustained: d'=2.50, expected confusion 11%
- Normal movement. using band like a mouse cursor vs curling pointer finger; sustained: d'=3.20, expected confusion 5%

## What I want from you

1. What do these numbers mean in plain language?
2. Which probes should be promoted into a training set, and which should be dropped — and why?
3. Which pairs will get confused by a classifier?
4. What specific thing should we try in the next session, ranked, most valuable first?
5. Anything in the placement or the baseline that looks wrong?

Do not ask for the raw sample arrays — the CSVs are large and the summaries above are what matters. If you need something specific from them, say which probe and which number.
