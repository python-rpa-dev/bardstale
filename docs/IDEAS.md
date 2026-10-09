# Hollow Vale — Future Ideas Backlog

Captured 2026-10-08 from the post-polish feature review, plus a second batch the same evening.
Everything shipped since capture is recorded in [FEATURES.md](FEATURES.md) — this file holds only open ideas.
Effort: S ≈ hours, M ≈ a day, L ≈ multi-day.

## Run depth

- **Rogue tricks** (S–M) — give the rogue an SP rail (backstab / steal gold / disarm) instead of
  passives-only; fixes the 3-of-4-classes-have-actions asymmetry. Hooks: `data/spells.ts`
  unlock-table pattern + combat cast rail.
- **Gate lord phases** (M) — telegraphed specials ("the wyrm rears back…") and phase changes for
  boss fights instead of stat-checks. Hook: boss branch in `core/combat.ts`.
- **A 4th gate with a floor gimmick** (M–L) — e.g. collapsing floors (stairs relocate after N
  turns) or flooded cells that slow movement. Hooks: `data/gates.ts` + manifest wall-texture slots
  + one new mapgen placement rule.

## Meta & replayability

- **Daily Challenge mode** (M) — a gate card locked to `dailySeed(today)` shared by all players,
  local best-score board, shareable result string ("HV-2026-10-08 #7: 3F/41 kills/912 g").
  Hooks: `dailySeed` exists; settings export/download UI is half-built.
- **Trophy economy** (S–M) — each gate lord drops a trophy granting a town-wide buff, displayed in
  the Guild; extends the existing camp "take a trophy" action into medal-style perks.
- **Quest chains** (L) — 2–3 step quests layered on the bounty board (recover X from gate A,
  deliver to NPC Y). Extends `data/bounties.ts` offer shape with item/flag objectives; biggest
  content win per line of code after gates.

## Town life

- **Herbalism & brewing** (M) — shrine visits yield 1 herb; the tavern kitchen brews herb+gold into
  potions (new `items.ts` rows, no new screens). Makes shrines a real decision instead of free HP.
- **Merchant rivalry** (S) — two rival stalls, each discounts items the other doesn't stock that
  day (`dailySeed` again). Sits on top of shop stock tiers.

## Atmosphere & dark

- **Darkness as a place, not a timer** (M) — dedicated "black floors" per gate: raycast radius 1.5,
  traps invisible to Look unless lit, but loot tables upgrade one rarity tier. Risk/reward per
  floor; pure mapgen flag + `isLit` checks that already exist on ActiveGate.lightTurns.

## Run structure

- **Hall of Runs** — shipped; see the Guild shelf line in FEATURES.
