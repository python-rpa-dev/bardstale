# Hollow Vale — Future Ideas Backlog

Captured 2026-10-08 from the post-polish feature review, plus a second batch the same evening.
Everything shipped since capture is recorded in [FEATURES.md](FEATURES.md) — this file holds only open ideas.
Effort: S ≈ hours, M ≈ a day, L ≈ multi-day.

## Run depth

- **Rogue tricks** — shipped; see the class SP rails line under Combat in FEATURES.
- **Gate lord phases** — shipped; see the gate lords line in FEATURES (telegraphed rear-up specials for the three non-breath lords).
- **Another floor gimmick** — shipped as the Ember Spire's collapsing floors; see the collapsing
  floors line under Gates & floors in FEATURES (`gimmick` on GateDef + a countdown on `ActiveGate` +
  a seeded BFS relocation in `collapseTick`; the flood gimmick remains the other pattern).

## Meta & replayability

- **Daily Challenge mode** — shipped; see the Daily Challenge line under Run structure & economy in FEATURES.
- **Trophy economy** — shipped; see the gate-lord trophies line under Run structure & economy in FEATURES.
- **Quest chains** — shipped; see the quest chains line under Town services in FEATURES
  (`data/quests.ts` chain pool + `state/quests.ts` link ticks hooked into `claimVictory`
  and the dungeon chest branch).

## Town life

- **Herbalism & brewing** — shipped; see the tavern hearth kitchen in FEATURES.
- **Merchant rivalry** — shipped; see the Merchants' Row line in FEATURES.
- **Ferryman's Ledger** — shipped; see the loan-shark line under Town services in FEATURES
  (`state/ledger.ts` borrow/interest/repay + the tithe inside the `earn()` chokepoint).

## Atmosphere & dark

- **Darkness as a place, not a timer** — shipped; see the black floors line in FEATURES.

## Run structure

- **Hall of Runs** — shipped; see the Guild shelf line in FEATURES.
