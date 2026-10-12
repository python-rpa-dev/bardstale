# Hollow Vale — Feature Reference

*A browser roguelike in the old style: hold town, take an omen at the gate, crawl a
first-person maze, trade blows in turn-based combat, and bank your gold before the
dark takes it. Everything is seeded; nobody dies permanently — the Temple just charges.*

Living document of shipped features (history in git log). Open ideas live in [IDEAS.md](IDEAS.md).

## Core loop

- Town hub — Guild · Temple · Tavern · Shop · Codex — → Gate of Adventures → raycast dungeon → surface and bank.
- Daily rotation keyed to `dailySeed(today)`: three bounty offers from an 11-def pool, ambient gate omen, the rivals' daily carts; a new-day toast greets you on boot.
- Omen draft at the gate: carry one of three daily modifiers into the run; the tavern-promised "today's sign" is badged in the descend modal.

## Gates & floors

- Five gates — Hollow Roots, Sunken Cloister, Gallows Fen, Wyrm Vault, Ember Spire — with level bands, wall palettes, and ambient modifiers ("hollows" shifts foe levels).
- Gate lords: one per gate (bark-thrall, cloister-lich, fen-matriarch, vault-wyrm, ashfiend) — one-time enrage at 30% HP; the three non-breath lords rear back every third round and unleash a telegraphed special the next turn (Root Grasp, Death Rime, Brood Cry) that Guard halves, while vault-wyrm and ashfiend keep their cadenced fire-breath. Elites: +level, double gold, guaranteed uncommon drop.
- Flooded floors: the Sunken Cloister drowns ~12% of each floor's cells from the second down — wading logs a slurp, doubles the odds of being found, and Auto-Walk takes dry routes whenever one exists (blue sheen on the minimap; the legend names the water only for gimmick gates).
- Collapsing floors: the Ember Spire shakes itself down — every 25 steps the stairs cave in and grind open on a fresh cell, always walkable, reachable, and clear of other features (relocation is seeded per run, so reloads replay it identically; descending resets the countdown; the ⌛ legend and the gate card warn you).
- Torchlight survival: 30 steps of flame per floor; darkness emboldens foes (18% → 26% ambushes). Tiers: Torch / Tallow (60 steps, smoke −10% ambushes while lit) / Witchlight (45 steps, reveals hidden cells within 2); the kind persists across floors.
- Black floors: every third floor from the third down is pitch-black — even a lit torch reaches only 1.5 cells, unlit traps bite twice as hard, but chest drops climb one rarity rung and elite kills there drop rare gear instead of uncommon.
- Floor content: chests, secret walls, traps, healing shrines (each also yields one moonpetal sprig), riddle stones, rune-sealed vaults; rare-spawn merchant / hermit / villager / black altar (8%).
- The black altar: three standing bargains, one per run — Blood Price (−4 HP each living hero for 30 g × depth through the purse chokepoint), Deep Bargain (every foe +1 level and every kill pays ×1.5 gold, all run long), Ash for Flesh (the torch gutters out; every living wound knits whole).
- Cross-floor Auto-Walk: paths to the stairs and descends floor after floor, halting on foes, traps, and unopened chests.

## Combat

- Turn-based verbs — attack / spell / item / flee — plus a Quick Resolve simulation; medals are claimed with victory.
- Blind & burn statuses recorded through one central damage ledger; riches/pocket-luck gold math verified by an omen balance sweep.
- Foe behaviors: skittish vermin rout below 25% HP (half XP, no gold), undead guardians bar escape (Flee disables itself), captains rally living allies with a damage aura — each tactic taught on its codex card.
- Class SP rails for all four classes — mage blasts, cleric heals, fighter strikes, and now rogue knives: Backstab (DEX×1.5+4 through half DEF, +15% crit), Steal Purse (pocket 3+2×foeLvl gold, kept even if the foe escapes), Crippling Cut (the target deals −30% damage for the rest of the fight) — unlocked at levels 1/4/8.
- Seeded Monte-Carlo balance probe locks the difficulty shape: win rates, HP-attrition gradient across gates, XP tax, stalemate-freedom.

## Town services

- Guild: party roster and leveling, plus two shelves — the Hall of Runs (the last 8 surfaced runs: depth, kills, medals, loot, crew, newest first) and the Fallen Expeditions memorial (the last 8 wipes: gate, depth F, day, what stood over them, the crew as they went in; retreats are never remembered). Temple of the Quiet Light: per-member heal, bulk "Heal All", revive tokens — death is a fee, not an ending.
- The Broken Antler tavern: bounty board, ambient omen promise, and a hearth kitchen that brews shrine-grown moonpetal + coin into potions (cheaper than buying). Merchants' Row: Mira and Bram run rival carts — overlapping daily stock (~70% each, union complete), and each discounts the goods the other doesn't carry that day; the rare tier unlocks at 300 lifetime gold earned (career stat, not current purse).
- Codex: first kills stamp pages; completing a foe family earns its medal — permanent perks. Chronicle: lifetime deeds ledger including biggest hit, crit count, and career gold.

## Run structure & economy

- Level-up boons: deterministic 7-boon offers that never repeat while fresh ones remain; camp actions Rest / Scout / Trophy once per floor with shared 35% ambush risk.
- One wallet (purse + bank merged; v1 saves migrate automatically); every gold inflow — victory, bounty, chest, camp windfall — flows through a single `earn()` chokepoint that feeds the chronicle.
- Gate-lord trophies: each of the five lords drops its trophy on the first kill, displayed on the Guild's Trophy Shelf with a permanent town-wide perk — temple healing −25%, revives −40%, bounty payouts +30% (stacks with medals), Merchants' Row prices −20%, hearth brewing −30%.
- Critical-HP pulse with a once-per-run hint toward shrines and temple; the defeat modal shows your heroes' closing fight lines.
- Daily Challenge: one date picks one gate, omen and seed for every player — `dailyChallenge(dayKey)` derives all three from the day hash, so everyone fights the same maze. Scores (depth·100 + kills·10 + gold) land on a local best-ten board from any exit path; the finish modal offers a copy-pasteable share string (`HV-2026-10-09 #2: 4F/16 kills/533 g`).

## Presentation

- First-person raycaster with per-gate wall palettes and tiled POV textures; minimap glyphs for stairs, chests, shrines, riddles, and seals plus a blue sheen over explored flooded cells (explored cells only).
- Icon command bar with tooltips, battle-mode icon rail, dungeon log capped at 60 lines; procedural BGM plus game-moment SFX with volume and mute — including a dark-layer drone that breathes in as torchlight dims below the warning threshold and fades out when relit or leaving the dungeon.

## Accessibility & mobile

- High-contrast mode, reduced motion, colorblind palette + glyphs, font scaling (the dungeon shell refits or flows), screen-reader route announcements, sr-only labels, aria-pressed toggles.
- Touch support at 390px: dpad controls; viewport-locked shells keep buttons above the fold at every window size.

## Platform & engineering

- Installable offline PWA; GitHub Pages deploy with CI running build + tests + Playwright e2e, including a deterministic full-loop spec on a pinned clock.
- One-time coach-mark welcome tour; global `?` cheat sheet; settings modal on every screen (persisted and migrated).
- Seeded RNG everywhere (`mulberry32` / `hashStr`) — no `Math.random`; single `commit()` mutation entry; debounced localStorage save with daily rotation.
- Strict save export/import validation with hostile-input clamps; migrations for the wallet merge and chronicle backfill; title-screen build stamp (version + git hash).
