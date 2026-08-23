# Analysis prompt — max-debug / right / 2026-08-08_1701

Paste everything below into a Claude conversation, or point a Claude Code session at this folder and ask it to read this file.

---

## Context

I am working with Kyle, who has a bilateral transradial amputation (both hands removed just above the wrist). We are recording surface nerve/muscle signals from his residual forearm with a Mudra Band (3 electrodes: ch1 ulnar, ch2 median, ch3 radial, ~1000 Hz). The movements he attempts are phantom/attempted movements, not executed ones — there is no hand to move. There is no fixed movement list: we are discovering which signals he can produce at all.

The goal is the SMALLEST set of reliably separable signals, not the largest. Consistency and low effort beat raw signal strength: a weak movement performed identically every time is more useful than a strong one that varies, and a movement that tires him will not survive daily use.

## This session

- Date: 2026-08-08
- Arm: right
- Rest recording: yes
- Movement probes: 0

## Probe data

## Pairwise separability (d')

- not enough probes to compare

## What I want from you

1. What do these numbers mean in plain language?
2. Which probes should be promoted into a training set, and which should be dropped — and why?
3. Which pairs will get confused by a classifier?
4. What specific thing should we try in the next session, ranked, most valuable first?
5. Anything in the placement or the baseline that looks wrong?

Do not ask for the raw sample arrays — the CSVs are large and the summaries above are what matters. If you need something specific from them, say which probe and which number.
