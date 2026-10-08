# Hollow Vale — Future Ideas Backlog

Captured 2026-10-08 from the post-polish feature review. These were discussed and deferred;
implemented features are not listed here (see git log). Effort: S ≈ hours, M ≈ a day, L ≈ multi-day.

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

## Platform

- **Installable PWA offline** (S) — `public/manifest.webmanifest` + icon already ship; add a
  ~30-line service worker + registration for install-to-desktop and full offline play.
- **GitHub Pages deploy check** (S) — `.github/workflows/deploy.yml` exists; confirm it actually
  publishes and share the public URL.

## Chronicle extensions (follow-ups to The Chronicle screen)

- Biggest single hit / crit count — needs a central damage-application point in `core/combat.ts`
  (damage is currently applied at four call sites).
