# Analysis prompt — max-debug / right / 2026-08-14_2125

Paste everything below into a Claude conversation, or point a Claude Code session at this folder and ask it to read this file.

---

## Context

I am working with Kyle, a bilateral upper-limb amputee. The two sides are NOT alike. **Left**: amputated about an inch above the wrist bone, so the wrist bone is gone — a long transradial residual limb with nearly the whole forearm, and therefore the finger and wrist muscle bellies, intact. This is the working arm and the only one a forearm band fits. **Right**: amputated at the elbow — no forearm at all, so only upper-arm muscle (biceps, triceps) is available, carrying no finger content. Do not assume the right arm can produce anything resembling the left.

We record surface nerve/muscle signals from the residual limb with a Mudra Band (3 electrodes: ch1 ulnar, ch2 median, ch3 radial, ~840 Hz measured). The movements he attempts are phantom/attempted movements, not executed ones — there is no hand to move. There is no fixed movement list: we are discovering which signals he can produce at all.

The goal is the SMALLEST set of reliably separable signals, not the largest. Consistency and low effort beat raw signal strength: a weak movement performed identically every time is more useful than a strong one that varies, and a movement that tires him will not survive daily use.

## This session

- Date: 2026-08-14
- Arm: right
- Rest recording: yes
- Movement probes: 3

## Probe data

**moving arm around**
- repetitions: 5, consistency: 0.89, usability: 0.72
- strongest channel: ch3 (radial) at +12.9 dB above rest
- channel signature (share of energy): [0.199, 0.25, 0.552]
- onset latency: 3.00s, rise time: 3.26s
- his ratings: effort unrated, fatigue unrated, confidence unrated/5

**curl index finger**
- repetitions: 20, consistency: 0.88, usability: 0.67
- strongest channel: ch2 (median) at +10.2 dB above rest
- channel signature (share of energy): [0.431, 0.434, 0.135]
- onset latency: 3.00s, rise time: 0.57s
- his ratings: effort unrated, fatigue unrated, confidence unrated/5

**curling pinky finger**
- repetitions: 20, consistency: 0.90, usability: 0.56
- strongest channel: ch1 (ulnar) at +4.2 dB above rest
- channel signature (share of energy): [0.609, 0.391, 0.0]
- onset latency: 3.00s, rise time: 0.35s
- his ratings: effort unrated, fatigue unrated, confidence unrated/5

## Pairwise separability (d')

- curl index finger vs curling pinky finger: d'=2.27, expected confusion 13%
- moving arm around vs curling pinky finger: d'=2.52, expected confusion 10%
- moving arm around vs curl index finger: d'=2.58, expected confusion 10%

## What I want from you

1. What do these numbers mean in plain language?
2. Which probes should be promoted into a training set, and which should be dropped — and why?
3. Which pairs will get confused by a classifier?
4. What specific thing should we try in the next session, ranked, most valuable first?
5. Anything in the placement or the baseline that looks wrong?

Do not ask for the raw sample arrays — the CSVs are large and the summaries above are what matters. If you need something specific from them, say which probe and which number.
