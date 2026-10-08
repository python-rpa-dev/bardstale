# Hollow Vale — Future Ideas Backlog

Captured 2026-10-08 from the post-polish feature review, plus a second batch the same evening.
Implemented since capture (see git log): omen draft at gate entry, blind + burn statuses with a
central damage recorder, biggest-hit / crit-count Chronicle rows, bounty tracker HUD in the dungeon.
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

- **Shop stock tiers** (S) — rare tier unlocks at cumulative banked gold so town visibly grows with
  progress. One predicate over existing wallet + `items.rarity`.
- **Herbalism & brewing** (M) — shrine visits yield 1 herb; the tavern kitchen brews herb+gold into
  potions (new `items.ts` rows, no new screens). Makes shrines a real decision instead of free HP.
- **Merchant rivalry** (S) — two rival stalls, each discounts items the other doesn't stock that
  day (`dailySeed` again). Sits on top of shop stock tiers.

## Platform

- **Installable PWA offline** (S) — `public/manifest.webmanifest` + icon already ship; add a
  ~30-line service worker + registration for install-to-desktop and full offline play.
- **GitHub Pages deploy check** (S) — `.github/workflows/deploy.yml` exists; confirm it actually
  publishes and share the public URL.
- **Keybind overlay** (S) — `?` opens a cheat sheet of existing bindings; pure DOM modal.
- **Combat log panel** (S) — fight events already carry text; surface the last 10 lines in a
  collapsible side list so Quick Resolve losses are diagnosable.

## Atmosphere & dark

- **Darkness as a place, not a timer** (M) — dedicated "black floors" per gate: raycast radius 1.5,
  traps invisible to Look unless lit, but loot tables upgrade one rarity tier. Risk/reward per
  floor; pure mapgen flag + `isLit` checks that already exist on ActiveGate.lightTurns.
- **Torch quality tiers** (S) — Torch (30 steps) / Tallow (60, smoke: −10% ambush encounters while
  lit) / Witchlight (cold: reveals hidden cells within 2). One field on the use payload; shop
  restocks by day via existing `dailySeed`.
- **Dark-layer ambience** (S–M) — the music engine exists: add a low drone layer that fades in as
  `lightTurns` drops below 10 and out when relit. Per-oscillator `setVolume` is already wired.

## Combat depth

- **Foe behaviors** (S–M) — vermin flee at <25% HP (fleeing kill = half XP), undead guard-lock
  adjacent PCs, humanoid captains buff allies. Data-driven `behavior?: string` on bestiary rows;
  the per-family AI branch in `core/combat.ts` already exists. Pairs with the backlogged gate-lord
  phases: telegraphs ("rears back → wide sweep") make row order matter.

## Run structure

- **Hall of Runs** (M) — keep the last 8 finished runs (loadout, depth, loot, medals earned) as a
  guild shelf. The Chronicle is lifetime totals; this is per-run memory. Serialize on
  `endExpedition`, render beside the ledger.
