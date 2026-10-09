# Hollow Vale — Future Ideas Backlog

Captured 2026-10-08 from the post-polish feature review, plus a second batch the same evening.
Everything shipped since capture is recorded in [FEATURES.md](FEATURES.md) — this file holds only open ideas.
Effort: S ≈ hours, M ≈ a day, L ≈ multi-day.

## Run depth

- **Rogue tricks** — shipped; see the class SP rails line under Combat in FEATURES.
- **Gate lord phases** — shipped; see the gate lords line in FEATURES (telegraphed rear-up specials for the three non-breath lords).
- **A 4th gate with a floor gimmick** (M–L) — e.g. collapsing floors (stairs relocate after N
  turns) or flooded cells that slow movement. Hooks: `data/gates.ts` + manifest wall-texture slots
  + one new mapgen placement rule.

## Meta & replayability

- **Daily Challenge mode** — shipped; see the Daily Challenge line under Run structure & economy in FEATURES.
- **Trophy economy** — shipped; see the gate-lord trophies line under Run structure & economy in FEATURES.
- **Quest chains** (L) — 2–3 step quests layered on the bounty board (recover X from gate A,
  deliver to NPC Y). Extends `data/bounties.ts` offer shape with item/flag objectives; biggest
  content win per line of code after gates.

## Town life

- **Herbalism & brewing** — shipped; see the tavern hearth kitchen in FEATURES.
- **Merchant rivalry** — shipped; see the Merchants' Row line in FEATURES.

## Atmosphere & dark

- **Darkness as a place, not a timer** — shipped; see the black floors line in FEATURES.

## Run structure

- **Hall of Runs** — shipped; see the Guild shelf line in FEATURES.
