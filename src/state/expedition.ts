import { RELICS, relicById } from "../data/relics";
import { riddleFor, sealPuzzle } from "../data/riddles";
/** Expedition run logic shared by the gate and dungeon screens. Mutators take a draft GameState. */

import { generateFloor, MAP_H, MAP_W, type EntityKind, type GeneratedFloor } from "../core/mapgen";
import { bountyId } from "../data/bounties";
import { ITEMS } from "../data/items";
import { dailySeed, expeditionSeed, hashStr, mulberry32, randInt, type Rng } from "../core/rng";
import { GATES, gateById, gateIndex, type GateDef } from "../data/gates";
import { dayNumber, MODIFIERS, modifierForGate, type ModifierId } from "../data/modifiers";
import { BESTIARY, type Family, type MonsterDef } from "../data/bestiary";
import { emptyChronicle, HALL_SIZE, pcMax, restWoundDecay } from "./save";
import type { ActiveGate, DailyBest, FloorMapSave, GameState, RareKind, RunRecord } from "./save";
import { earn } from "./party";

/** Per-floor rng seed derived from the run seed. */
export function floorSeed(runSeed: number, floor: number): number {
  return hashStr(`${runSeed}:${floor}`);
}

/** Steps of torchlight granted at run start and on every new floor. */
export const LIGHT_PER_FLOOR = 30;

/** Steps between collapses on the Ember Spire: the stair will not wait longer than this. */
export const COLLAPSE_PERIOD = 25;

/** Collapse-gimmick gates run a countdown on every floor; other gates never set the field. */
function collapsePeriodFor(def: GateDef): number {
  return def.gimmick === "collapse" ? COLLAPSE_PERIOD : 0;
}

/** A gate without the field (legacy saves) reads as lit — never punish old codes. */
export function isLit(ag: ActiveGate): boolean {
  return ag.lightTurns === undefined || ag.lightTurns > 0;
}

/**
 * Every third floor from the third down is pitch-black: torchlight shrinks to arm's reach,
 * unlit traps bite twice as hard, and the dark hoards richer loot. Derived purely from the
 * floor number, so saves can never desync and mapgen stays untouched.
 */
export function isDarkFloor(floor: number): boolean {
  return floor >= 2 && (floor - 2) % 3 === 0; // floors 2, 5, 8… (0-based)
}

/** Encounter odds on open corridor cells; the dark emboldens foes. Tallow smoke (while lit) dulls them ~10%. Pure for tests. */
export function encounterChance(lit: boolean, smoke = false, relicDelta = 0): number {
  const base = !lit ? 0.26 : smoke ? 0.18 * 0.9 : 0.18;
  return Math.max(0.02, Math.min(0.5, base + relicDelta)); // relics bend odds, never break them
}

/** Perks of the run's current torch kind (tallow smokes, witchlight reveals). Pure for tests. */
export function lightMods(ag: ActiveGate): { smoke: boolean; reveal: number } {
  const def = ag.torchKind ? ITEMS.find((i) => i.id === ag.torchKind) : undefined;
  const u = def?.use;
  if (u?.kind !== "light") return { smoke: false, reveal: 0 };
  return { smoke: !!u.smoke, reveal: u.reveal ?? 0 };
}

/**
 * Witchlight's cold glow marks hidden secret walls, traps and sealed doors within its radius
 * (Chebyshev) as explored — glyphs appear on the minimap without a Look. Once per cell per run;
 * returns the kinds newly uncovered so the screen can log them. Mutates visited + flags in place.
 */
export function witchReveal(ag: ActiveGate): EntityKind[] {
  const mods = lightMods(ag);
  if (!isLit(ag) || mods.reveal <= 0) return [];
  const found: EntityKind[] = [];
  for (const [id, kind] of ag.map.entities) {
    if (kind !== "secret" && kind !== "trap" && kind !== "sealed") continue;
    const ex = id % MAP_W;
    const ey = Math.floor(id / MAP_W);
    if (Math.max(Math.abs(ex - ag.pos.x), Math.abs(ey - ag.pos.y)) > mods.reveal) continue;
    if (ag.flags[`witch-${id}`]) continue;
    ag.flags[`witch-${id}`] = true;
    if (!ag.visited.includes(id)) ag.visited.push(id);
    found.push(kind);
  }
  return found;
}

export function toFloorSave(gen: GeneratedFloor): FloorMapSave {
  let cells = "";
  for (let i = 0; i < gen.grid.length; i++) cells += gen.grid[i] ? "1" : "0";
  return {
    w: gen.w,
    h: gen.h,
    cells,
    entities: [...gen.entities.entries()].map(([id, e]) => [id, e.kind]),
    ...(gen.flood.length ? { flood: gen.flood } : {}), // dry floors stay byte-identical to old saves
  };
}

export function gridFromSave(map: FloorMapSave): Uint8Array {
  const g = new Uint8Array(map.w * map.h);
  for (let i = 0; i < g.length; i++) g[i] = map.cells.charCodeAt(i) - 48;
  return g;
}

export function entityAt(ag: ActiveGate, cell: number): EntityKind | null {
  const hit = ag.map.entities.find(([id]) => id === cell);
  return hit ? (hit[1] as EntityKind) : null;
}

/** True when `cell` lies under brackish water — steps there cost double (extra encounter roll). */
export function isFlooded(ag: ActiveGate, cell: number): boolean {
  return ag.map.flood?.includes(cell) ?? false;
}

/**
 * One step of the spire's countdown (collapse gates only). At zero the stair crumbles
 * and grinds open on another reachable, feature-free cell. True = the floor just shifted.
 */
export function collapseTick(ag: ActiveGate): boolean {
  if (ag.collapseTurns === undefined) return false;
  ag.collapseTurns -= 1;
  if (ag.collapseTurns > 0) return false;
  ag.collapseTurns = COLLAPSE_PERIOD;
  relocateStairs(ag);
  return true;
}

/** Move the stair entity to a fresh cell, seeded by the run so reloads replay identically. */
function relocateStairs(ag: ActiveGate): void {
  const rng = mulberry32(hashStr(`${ag.seed}:collapse:${ag.floor}:${ag.steps}`));
  const grid = gridFromSave(ag.map);
  const taken = new Set(ag.map.entities.map(([id]) => id));
  const start = ag.pos.y * MAP_W + ag.pos.x;
  // BFS from the hero: the new stair must be walkable AND reachable, never a cruel island.
  const dist = new Map<number, number>([[start, 0]]);
  const q = [start];
  const cands: number[] = [];
  for (let head = 0; head < q.length; head++) {
    const cur = q[head];
    const d0 = dist.get(cur)!;
    const cx = cur % MAP_W;
    const cy = Math.floor(cur / MAP_W);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const nid = ny * MAP_W + nx;
      if (grid[nid] === 1 || dist.has(nid)) continue;
      dist.set(nid, d0 + 1);
      if (!taken.has(nid) && d0 + 1 >= 5) cands.push(nid); // never rip the stair out from underfoot
      q.push(nid);
    }
  }
  if (!cands.length) return; // a floor too small to collapse — the spire grumbles and waits
  cands.sort((a, b) => a - b); // BFS order leans on insertion; sorting keeps the pick seed-pure
  const target = cands[Math.floor(rng() * cands.length)];
  const si = ag.map.entities.findIndex(([, k]) => k === "stairs");
  if (si >= 0) ag.map.entities[si] = [target, "stairs"];
}

/** Flood-gimmick gates drown their deeper floors; 0.9 means a pool forms on nearly every descent. */
function floodChanceFor(def: GateDef): number {
  return def.gimmick === "flood" ? 0.9 : 0;
}

/** Reveal `cell` and its open orthogonal neighbours on the minimap. */
export function reveal(ag: ActiveGate): void {
  const grid = gridFromSave(ag.map); // live grid — opening a secret carves new openings
  const add = (id: number) => {
    if (!ag.visited.includes(id)) ag.visited.push(id);
  };
  const cell = ag.pos.y * MAP_W + ag.pos.x;
  add(cell);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = ag.pos.x + dx;
    const ny = ag.pos.y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
    const nid = ny * MAP_W + nx;
    if (grid[nid] === 0) add(nid);
  }
}

/** Begin a fresh run: increments the gate's run counter and installs ActiveGate.
 *  `omen` is the drafted sign carried below; omitted falls back to today's ambient modifier.
 *  `runSeed` overrides the per-save derivation — the daily challenge uses one shared seed. */
export function startExpedition(s: GameState, gateId: string, omen?: ModifierId, runSeed?: number): void {
  const def = gateById(gateId); // validates the id
  const runNumber = (s.runs[gateId] ?? 0) + 1;
  s.runs[gateId] = runNumber;
  const seed = runSeed ?? expeditionSeed(s.seed, gateId, runNumber);
  const modifier = omen ?? modifierForGate(gateIndex(gateId), dayNumber()).id;

  const ag: ActiveGate = {
    gateId,
    runNumber,
    seed,
    modifier,
    floor: 0,
    map: toFloorSave(generateFloor(floorSeed(seed, 0), 0, floodChanceFor(def))),
    pos: { x: 1, y: 1 },
    dir: 1,
    visited: [],
    partyHpSp: s.party.map((p) => ({ id: p.id, hp: p.hp, sp: p.sp })),
    chests: [],
    flags: {},
    steps: 0,
    lightTurns: LIGHT_PER_FLOOR, // the first torch is struck at the threshold
    torchKind: "torch",
    loot: { gold: 0, items: {} },
    killsThisRun: 0, // Hall of Runs kill counter for this expedition
    medalsThisRun: 0,
  };
  for (const [id, kind] of ag.map.entities) if (kind === "chest") ag.chests.push({ cell: id, opened: false });
  const period = collapsePeriodFor(def);
  if (period) ag.collapseTurns = period; // the spire starts counting the moment you step in
  const rare = rollRare(seed);
  if (rare) ag.rareSpawn = rare;
  s.activeGate = ag;
  const chron = (s.chronicle ??= emptyChronicle()); // reaching floor 0 is depth 1
  chron.deepestFloor = Math.max(chron.deepestFloor, ag.floor + 1);
  reveal(ag);
}

/** Step down to the next floor. Keeps run seed, flags and loot tally; map/position reset. */
export function descendFloor(s: GameState): void {
  const ag = s.activeGate;
  if (!ag) return;
  ag.floor += 1;
  const chron = (s.chronicle ??= emptyChronicle());
  chron.deepestFloor = Math.max(chron.deepestFloor, ag.floor + 1);
  ag.map = toFloorSave(generateFloor(floorSeed(ag.seed, ag.floor), ag.floor, floodChanceFor(gateById(ag.gateId))));
  ag.pos = { x: 1, y: 1 };
  ag.dir = 1;
  ag.visited = [];
  ag.chests = [];
  for (const [id, kind] of ag.map.entities) if (kind === "chest") ag.chests.push({ cell: id, opened: false });
  ag.steps = 0;
  ag.lightTurns = Math.round(LIGHT_PER_FLOOR * relicMods(ag).lightMult); // fresh flame, new keeper's measure
  const period = collapsePeriodFor(gateById(ag.gateId));
  if (period) ag.collapseTurns = period; // new floor, new countdown
  delete ag.pendingMonsters;
  reveal(ag);
}

/** Finish the run (exit or abandon). The loot tally is already committed live during the run;
 * surfacing pins the run's memory to the Guild's Hall of Runs — newest first, capped at HALL_SIZE. */
export function endExpedition(s: GameState, surfaced = false): DailyBest | undefined {
  const ag = s.activeGate;
  if (surfaced && ag) {
    const rec: RunRecord = {
      gateId: ag.gateId,
      dayKey: s.dayKey,
      runNumber: ag.runNumber,
      depth: ag.floor + 1, // a surfaced run ends on its deepest floor — completion is descent
      kills: ag.killsThisRun ?? 0,
      medals: ag.medalsThisRun ?? 0,
      gold: ag.loot.gold,
      items: { ...ag.loot.items },
      crew: s.party.map((p) => ({ name: p.name, level: p.level })),
    };
    (s.hall ??= []).unshift(rec);
    if (s.hall.length > HALL_SIZE) s.hall.length = HALL_SIZE; // the shelf forgets its oldest memory
  }
  const dailyRec = ag?.daily ? recordDaily(s, ag) : undefined; // dailies land on the board whether they surface or fall
  delete s.activeGate;
  return dailyRec;
}

// ---------- daily challenge ----------

/** The board keeps this many best attempts across all days. */
export const DAILY_BOARD_SIZE = 10;

/** Today's shared challenge: one gate, one omen, one seed — identical for every player on the date. */
export function dailyChallenge(dayKey: string): { gateId: string; omen: ModifierId; seed: number } {
  const day = dailySeed(dayKey);
  const rng = mulberry32(day);
  const gate = GATES[randInt(rng, 0, GATES.length - 1)];
  const omens = MODIFIERS.filter((m) => m.id !== "none");
  return {
    gateId: gate.id,
    omen: omens[randInt(rng, 0, omens.length - 1)].id as ModifierId,
    seed: hashStr(`${day}:${gate.id}`),
  };
}

/** Enter today's challenge from any save — same date means the same maze for everyone. */
export function startDailyRun(s: GameState): void {
  const dc = dailyChallenge(s.dayKey);
  startExpedition(s, dc.gateId, dc.omen, dc.seed);
  if (s.activeGate) s.activeGate.daily = true;
}

/** `HV-2026-10-08 #7: 3F/41 kills/912 g` — copy-pasteable bragging rights. */
export function dailyShare(best: DailyBest): string {
  return `HV-${best.dayKey} #${best.attempt}: ${best.depth}F/${best.kills} kills/${best.gold} g`;
}

/** Pin a finished daily run to the leaderboard — every exit path counts, best ten scores stand. */
function recordDaily(s: GameState, ag: ActiveGate): DailyBest {
  const depth = ag.floor + 1;
  const kills = ag.killsThisRun ?? 0;
  const entry: DailyBest = {
    dayKey: s.dayKey,
    gateId: ag.gateId,
    attempt: ag.runNumber,
    depth,
    kills,
    gold: ag.loot.gold,
    crew: s.party.map((p) => p.name).join(", "),
    score: depth * 100 + kills * 10 + ag.loot.gold,
  };
  const board = (s.dailyBests ??= []);
  board.push(entry);
  board.sort((a, b) => b.score - a.score || b.dayKey.localeCompare(a.dayKey));
  if (board.length > DAILY_BOARD_SIZE) board.length = DAILY_BOARD_SIZE;
  return entry;
}

/**
 * Shrine activation: living members fully heal and the spring yields one brewing herb for the
 * tavern kitchen. Once per floor; returns false when the shrine sleeps. Herb rides the loot
 * tally, so a wipe forfeits it like any other unclaimed prize.
 */
export function activateShrine(s: GameState): boolean {
  const ag = s.activeGate!;
  const flag = `shrine-f${ag.floor}`;
  if (ag.flags[flag]) return false; // one drink per floor
  ag.flags[flag] = true;
  for (const p of s.party) {
    if (p.hp <= 0) continue; // shrines heal the living; the temple revives the dead
    const m = pcMax(p);
    p.hp = m.hp;
    p.sp = m.sp;
  }
  s.inventory.moonpetal = (s.inventory.moonpetal ?? 0) + 1; // gathering is instant; brewing waits for the hearth
  ag.loot.items.moonpetal = (ag.loot.items.moonpetal ?? 0) + 1;
  return true;
}

/** Deterministic per-event rng: advances ActiveGate.steps so reloads replay identically. */
export function stepRng(ag: ActiveGate): Rng {
  ag.steps += 1;
  return mulberry32(hashStr(`${ag.seed}:${ag.floor}:step:${ag.steps}`));
}

/**
 * Spawn 1–3 monsters from the gate's level band (gate lords excluded). When a bounty for a
 * family in-band is active, that family's members are weighted twice as often. ~12% of packs
 * carry one elite: `elite` is its index into `mobs`, or null.
 */
export function rollEncounter(ag: ActiveGate, bountyFamily: Family | null): { mobs: MonsterDef[]; elite: number | null } {
  const def = gateById(ag.gateId);
  const [lo, hi] = def.levels;
  const pool = BESTIARY.filter((m) => m.lvl >= lo && m.lvl <= hi && !m.boss);
  const weights = pool.map((m) => (bountyFamily && m.family === bountyFamily ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const rng = stepRng(ag);
  const count = randInt(rng, 1, 3);
  const mobs: MonsterDef[] = [];
  for (let i = 0; i < count; i++) {
    let roll = rng() * total;
    let idx = 0;
    while (idx < pool.length - 1 && roll > weights[idx]) {
      roll -= weights[idx];
      idx++;
    }
    mobs.push(pool[idx]);
  }
  const elite = rng() < 0.12 ? randInt(rng, 0, mobs.length - 1) : null;
  return { mobs, elite };
}

/**
 * Campfire rest: once per floor the living recover 25% max HP/SP — but firelight draws eyes,
 * so ~35% of rests end in an ambush (pendingMonsters set for the caller to resolve).
 * A night by the fire also knits one Wound stack per afflicted hero (focus endures).
 */
export function campRest(d: GameState): { healed: boolean; ambush: MonsterDef[] | null; woundsKnit: number } {
  const ag = d.activeGate!;
  if (ag.flags[`rested-f${ag.floor}`]) return { healed: false, ambush: null, woundsKnit: 0 };
  ag.flags[`rested-f${ag.floor}`] = true;
  let woundsKnit = 0;
  for (const p of d.party) {
    if (p.hp <= 0) continue;
    const max = pcMax(p);
    p.hp = Math.min(max.hp, p.hp + Math.ceil(max.hp * 0.25));
    p.sp = Math.min(max.sp, p.sp + Math.ceil(max.sp * 0.25));
    woundsKnit += restWoundDecay(p.statuses);
  }
  if (stepRng(ag)() < 0.35) {
    const { mobs, elite } = rollEncounter(ag, activeBountyFamily(d));
    ag.pendingMonsters = mobs.map((m) => m.id);
    if (elite !== null) ag.pendingElites = [elite];
    return { healed: true, ambush: mobs, woundsKnit };
  }
  return { healed: true, ambush: null, woundsKnit };
}

/**
 * Campfire scout: once per floor, send a runner — the whole floor plan (minus walls)
 * lights up on the minimap. No healing, no ambush risk: information is cheap here.
 */
export function campScout(d: GameState): { revealed: boolean; cellsRevealed: number } {
  const ag = d.activeGate!;
  if (ag.flags[`scouted-f${ag.floor}`]) return { revealed: false, cellsRevealed: 0 };
  ag.flags[`scouted-f${ag.floor}`] = true;
  const seen = new Set(ag.visited);
  let added = 0;
  for (let id = 0; id < ag.map.cells.length; id++) {
    if (ag.map.cells[id] === "1" || seen.has(id)) continue;
    ag.visited.push(id);
    added++;
  }
  return { revealed: true, cellsRevealed: added };
}

/**
 * Campfire trophy: butcher the last kill and salt the camp — loot 12g per floor depth
 * on the spot, but the blood scent draws company far more often (60% vs rest's 35%).
 */
export function campTrophy(d: GameState): { gold: number; ambush: MonsterDef[] | null } {
  const ag = d.activeGate!;
  if (ag.flags[`trophy-f${ag.floor}`]) return { gold: 0, ambush: null };
  ag.flags[`trophy-f${ag.floor}`] = true;
  const gold = 12 * (ag.floor + 1);
  earn(d, gold); // trophy gold lands in the purse on the spot — loot tally mirrors it for the summary
  ag.loot.gold += gold;
  if (stepRng(ag)() < 0.6) {
    const { mobs, elite } = rollEncounter(ag, activeBountyFamily(d));
    ag.pendingMonsters = mobs.map((m) => m.id);
    if (elite !== null) ag.pendingElites = [elite];
    return { gold, ambush: mobs };
  }
  return { gold, ambush: null };
}

/**
 * Answer the floor's riddle stone — one chance per floor either way. Correct: loot gold
 * (18g × depth). Wrong: the stone always wakes its guardian (pendingMonsters for the caller).
 */
export function answerRiddle(d: GameState, pickIndex: number): { correct: boolean; gold: number; ambush: MonsterDef[] | null } {
  const ag = d.activeGate!;
  if (ag.flags[`riddle-f${ag.floor}`]) return { correct: false, gold: 0, ambush: null }; // dark since the last attempt
  ag.flags[`riddle-f${ag.floor}`] = true;
  const view = riddleFor(ag.seed, ag.floor);
  if (pickIndex === view.correctAt) {
    const gold = Math.floor(18 * (ag.floor + 1) * relicMods(ag).goldMult);
    earn(d, gold); // riddle gold lands in the purse on the spot
    ag.loot.gold += gold;
    return { correct: true, gold, ambush: null };
  }
  const { mobs, elite } = rollEncounter(ag, activeBountyFamily(d));
  ag.pendingMonsters = mobs.map((m) => m.id);
  if (elite !== null) ag.pendingElites = [elite];
  else delete ag.pendingElites;
  return { correct: false, gold: 0, ambush: mobs };
}

export interface SealOutcome {
  solved: boolean;
  gold?: number;
  item?: string; // stash drop id, added to inventory + loot when solved
  victim?: string; // wrong guess (or a forced key-turn): a random party member eats the bolt
  damage?: number;
  relicChoices?: string[]; // the vault's pedestal offers two relics — once per run, then never again
}

/** Open a solved or forced vault: carve the door, pay gold + stash, lay the pedestal once per run. */
function openSeal(d: GameState, rng: Rng): SealOutcome {
  const ag = d.activeGate!;
  ag.flags[`sealed-f${ag.floor}`] = true;
  // The door opens for good: carve the wall face into floor and drop the marker.
  const door = ag.map.entities.find(([, k]) => k === "sealed");
  if (door) {
    ag.map.cells = ag.map.cells.slice(0, door[0]) + "0" + ag.map.cells.slice(door[0] + 1);
    ag.map.entities = ag.map.entities.filter(([id]) => id !== door[0]);
  }
  const gold = Math.floor(25 * (ag.floor + 1) * relicMods(ag).goldMult);
  earn(d, gold); // seal gold lands in the purse on the spot
  ag.loot.gold += gold;
  const stash = ITEMS.filter((it) => it.rarity !== "common" && it.slot !== "consumable");
  const drop = stash[Math.floor(rng() * stash.length)];
  d.inventory[drop.id] = (d.inventory[drop.id] ?? 0) + 1;
  ag.loot.items[drop.id] = (ag.loot.items[drop.id] ?? 0) + 1;
  const relicChoices = ag.relic ? undefined : pickRelicPair(ag.seed, ag.floor);
  return relicChoices ? { solved: true, gold, item: drop.id, relicChoices } : { solved: true, gold, item: drop.id };
}

/**
 * Turn the rune seal. A correct ordered triple opens the door for good — deep gold plus one
 * guaranteed uncommon-or-better gear piece. A wrong guess costs 6+2×depth damage to a random
 * hero and the door stays shut: retrying is possible, surviving the brute force is not.
 */
export function trySeal(d: GameState, guess: string[]): SealOutcome {
  const ag = d.activeGate!;
  if (ag.flags[`sealed-f${ag.floor}`]) return { solved: false }; // already opened on this floor
  const { solution } = sealPuzzle(ag.seed, ag.floor);
  if (guess.length === 3 && guess.every((r, i) => r === solution[i])) return openSeal(d, stepRng(ag));
  const rng = stepRng(ag);
  const victim = d.party[Math.floor(rng() * d.party.length)];
  const damage = 6 + ag.floor * 2;
  victim.hp = Math.max(0, victim.hp - damage);
  return { solved: false, victim: victim.name, damage };
}

/** Skeleton Key: the seal opens at a touch — but the vault still defends itself with the
 *  same bolt a wrong guess would have eaten. Returns the open outcome (with the pedestal offer). */
export function forceSeal(d: GameState): SealOutcome {
  const ag = d.activeGate!;
  if (ag.flags[`sealed-f${ag.floor}`]) return { solved: false };
  const rng = stepRng(ag);
  const victim = d.party[Math.floor(rng() * d.party.length)];
  const damage = 6 + ag.floor * 2;
  victim.hp = Math.max(0, victim.hp - damage);
  const out = openSeal(d, rng);
  out.victim = victim.name;
  out.damage = damage;
  return out;
}

/** The active bounty's family if any, for encounter weighting. */
export function activeBountyFamily(s: GameState): Family | null {
  const id = s.bounties.active;
  if (!id) return null;
  const offer = s.bounties.offers.find((o) => bountyId(o) === id);
  return offer ? offer.family : null;
}

// ---------- Rare spawns (plan M7): one-off expedition events ----------

/** Chance that a wandering event joins a run. */
export const RARE_CHANCE = 0.08;

const RARE_KINDS: RareKind[] = ["merchant", "hermit", "villager", "altar"];

/** Deterministic rare-spawn roll for a run seed — null on most runs. */
export function rollRare(runSeed: number): RareKind | null {
  const rng = mulberry32(hashStr(`${runSeed}:rare`));
  if (rng() >= RARE_CHANCE) return null;
  return RARE_KINDS[Math.floor(rng() * RARE_KINDS.length)];
}

/** Flavor line for the return toast and the loot summary card. */
export function describeRare(kind: RareKind): string {
  switch (kind) {
    case "merchant":
      return "A wandering merchant traded with your party below.";
    case "hermit":
      return "A hermit's blessing left a fresh page in the codex.";
    case "villager":
      return "You freed a trapped villager — the temple will remember.";
    case "altar":
      return "A black altar took its price below.";
  }
}

export type BargainId = "blood" | "oath" | "flame";

export interface Bargain {
  id: BargainId;
  label: string;
  hint: string;
}

/** The black altar's three standing offers — every seeker takes exactly one. */
export function altarBargains(): Bargain[] {
  return [
    { id: "blood", label: "Blood Price", hint: "Each living hero sheds 4 HP; the bowl pays 30 g per floor of depth" },
    { id: "oath", label: "Deep Bargain", hint: "Every foe this run runs +1 level — but each kill pays half again as much gold" },
    { id: "flame", label: "Ash for Flesh", hint: "Snuff the torch to nothing; the cold dark heals every living hero whole" },
  ];
}

/** Take one bargain. The altar is spent either way — one price per run. Returns the toast line. */
export function applyBargain(d: GameState, id: BargainId): string {
  const ag = d.activeGate!;
  ag.flags["rare-done"] = true;
  switch (id) {
    case "blood": {
      for (const p of d.party) if (p.hp > 0) p.hp = Math.max(1, p.hp - 4); // the bowl takes its due but never a life
      const gold = 30 * (ag.floor + 1);
      earn(d, gold);
      return `The bowl drinks deep. ${gold} g rises from the ash in a slow red rain.`;
    }
    case "oath":
      ag.oathDepth = true;
      return "You speak the oath. Something far below answers — and starts counting your coins twice.";
    case "flame": {
      ag.lightTurns = 0; // the dark closes in at once...
      for (const p of d.party) if (p.hp > 0) p.hp = pcMax(p).hp; // ...and the cold knits flesh while it watches
      return "The torch dies with a hiss. Cold dark rushes in — and the wounds close anyway.";
    }
  }
}

// ---------- Relics: one run-defining trinket per run, claimed at the first vault ----------

/** Every relic rule the crawl consumes, resolved once from the claimed id. */
export interface RelicMods {
  lightMult: number; // torchlight per floor scales by this
  ambushDelta: number; // added to encounterChance
  goldMult: number; // expedition gold (vault, riddle, kills, chests)
  chestGoldMult: number; // chest gold only
  trapMult: number; // trap damage
  chestAmbush: boolean; // opening a chest always springs a foe
  autoSeal: boolean; // rune seals open at a touch (Skeleton Key)
  dmgBonus: number; // +damage on every blow, both sides
}

export function relicMods(ag: ActiveGate | undefined): RelicMods {
  const m: RelicMods = { lightMult: 1, ambushDelta: 0, goldMult: 1, chestGoldMult: 1, trapMult: 1, chestAmbush: false, autoSeal: false, dmgBonus: 0 };
  switch (ag?.relic) {
    case "emberheart":
      m.lightMult = 1.5;
      m.ambushDelta = 0.06;
      break;
    case "owl-mask":
      m.ambushDelta = -0.08;
      m.lightMult = 0.75;
      break;
    case "grave-coin":
      m.goldMult = 1.5;
      m.trapMult = 2;
      break;
    case "skeleton-key":
      m.autoSeal = true;
      break;
    case "greed-molar":
      m.chestGoldMult = 2;
      m.chestAmbush = true;
      break;
    case "butcher-hook":
      m.dmgBonus = 2;
      break;
  }
  return m;
}

/** Two distinct relics on the vault's pedestal, seeded so the same floor always offers the same pair. */
export function pickRelicPair(seed: number, floor: number): [string, string] {
  const rng = mulberry32(hashStr(`${seed}:relic:${floor}`));
  const a = Math.floor(rng() * RELICS.length);
  let b = Math.floor(rng() * RELICS.length);
  if (b === a) b = (b + 1) % RELICS.length;
  return [RELICS[a].id, RELICS[b].id];
}

/** Claim one of the vault's offers — the run carries exactly one relic. Returns the toast line. */
export function pickRelic(d: GameState, id: string): string {
  const ag = d.activeGate!;
  ag.relic = id;
  const m = relicMods(ag);
  if (m.lightMult !== 1 && ag.lightTurns !== undefined) ag.lightTurns = Math.round(ag.lightTurns * m.lightMult); // the flame adjusts to its new keeper
  const def = relicById(id);
  return `${def.name} — ${def.boon}. But ${def.cost.toLowerCase()}.`;
}

export interface Ware {
  id: string;
  price: number; // flat −25% off shop price
}

/** Deterministic merchant stock for a run: three uncommon/rare goods at −25%. */
export function merchantWares(ag: Pick<ActiveGate, "seed">): Ware[] {
  const pool = ITEMS.filter((i) => i.rarity !== "common");
  const rng = mulberry32(hashStr(`${ag.seed}:wares`));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3).map((d) => ({ id: d.id, price: Math.max(1, Math.floor(d.price * 0.75)) }));
}

/** Hermit's gift: one random codex-unseen bestiary member; null when the book is full. */
export function hermitGift(ag: Pick<ActiveGate, "seed">, codex: string[]): MonsterDef | null {
  const unseen = BESTIARY.filter((m) => !codex.includes(m.id));
  if (!unseen.length) return null;
  const rng = mulberry32(hashStr(`${ag.seed}:hermit`));
  return unseen[Math.floor(rng() * unseen.length)];
}
