import { riddleFor, sealPuzzle } from "../data/riddles";
/** Expedition run logic shared by the gate and dungeon screens. Mutators take a draft GameState. */

import { generateFloor, MAP_H, MAP_W, type EntityKind, type GeneratedFloor } from "../core/mapgen";
import { bountyId } from "../data/bounties";
import { ITEMS } from "../data/items";
import { expeditionSeed, hashStr, mulberry32, randInt, type Rng } from "../core/rng";
import { gateById, gateIndex } from "../data/gates";
import { dayNumber, modifierForGate } from "../data/modifiers";
import { BESTIARY, type Family, type MonsterDef } from "../data/bestiary";
import { pcMax } from "./save";
import type { ActiveGate, FloorMapSave, GameState, RareKind } from "./save";

/** Per-floor rng seed derived from the run seed. */
export function floorSeed(runSeed: number, floor: number): number {
  return hashStr(`${runSeed}:${floor}`);
}

export function toFloorSave(gen: GeneratedFloor): FloorMapSave {
  let cells = "";
  for (let i = 0; i < gen.grid.length; i++) cells += gen.grid[i] ? "1" : "0";
  return {
    w: gen.w,
    h: gen.h,
    cells,
    entities: [...gen.entities.entries()].map(([id, e]) => [id, e.kind]),
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

/** Begin a fresh run: increments the gate's run counter and installs ActiveGate. */
export function startExpedition(s: GameState, gateId: string): void {
  gateById(gateId); // validates the id
  const runNumber = (s.runs[gateId] ?? 0) + 1;
  s.runs[gateId] = runNumber;
  const seed = expeditionSeed(s.seed, gateId, runNumber);
  const modifier = modifierForGate(gateIndex(gateId), dayNumber()).id;

  const ag: ActiveGate = {
    gateId,
    runNumber,
    seed,
    modifier,
    floor: 0,
    map: toFloorSave(generateFloor(floorSeed(seed, 0), 0)),
    pos: { x: 1, y: 1 },
    dir: 1,
    visited: [],
    partyHpSp: s.party.map((p) => ({ id: p.id, hp: p.hp, sp: p.sp })),
    chests: [],
    flags: {},
    steps: 0,
    loot: { gold: 0, items: {} },
  };
  for (const [id, kind] of ag.map.entities) if (kind === "chest") ag.chests.push({ cell: id, opened: false });
  const rare = rollRare(seed);
  if (rare) ag.rareSpawn = rare;
  s.activeGate = ag;
  reveal(ag);
}

/** Step down to the next floor. Keeps run seed, flags and loot tally; map/position reset. */
export function descendFloor(s: GameState): void {
  const ag = s.activeGate;
  if (!ag) return;
  ag.floor += 1;
  ag.map = toFloorSave(generateFloor(floorSeed(ag.seed, ag.floor), ag.floor));
  ag.pos = { x: 1, y: 1 };
  ag.dir = 1;
  ag.visited = [];
  ag.chests = [];
  for (const [id, kind] of ag.map.entities) if (kind === "chest") ag.chests.push({ cell: id, opened: false });
  ag.steps = 0;
  delete ag.pendingMonsters;
  reveal(ag);
}

/** Finish the run (exit or abandon). The loot tally is already committed live during the run. */
export function endExpedition(s: GameState): void {
  delete s.activeGate;
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
 */
export function campRest(d: GameState): { healed: boolean; ambush: MonsterDef[] | null } {
  const ag = d.activeGate!;
  if (ag.flags[`rested-f${ag.floor}`]) return { healed: false, ambush: null };
  ag.flags[`rested-f${ag.floor}`] = true;
  for (const p of d.party) {
    if (p.hp <= 0) continue;
    const max = pcMax(p);
    p.hp = Math.min(max.hp, p.hp + Math.ceil(max.hp * 0.25));
    p.sp = Math.min(max.sp, p.sp + Math.ceil(max.sp * 0.25));
  }
  if (stepRng(ag)() < 0.35) {
    const { mobs, elite } = rollEncounter(ag, activeBountyFamily(d));
    ag.pendingMonsters = mobs.map((m) => m.id);
    if (elite !== null) ag.pendingElites = [elite];
    return { healed: true, ambush: mobs };
  }
  return { healed: true, ambush: null };
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
    const gold = 18 * (ag.floor + 1);
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
  victim?: string; // wrong guess: a random party member eats the bolt
  damage?: number;
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
  if (guess.length === 3 && guess.every((r, i) => r === solution[i])) {
    ag.flags[`sealed-f${ag.floor}`] = true;
    // The door opens for good: carve the wall face into floor and drop the marker.
    const door = ag.map.entities.find(([, k]) => k === "sealed");
    if (door) {
      ag.map.cells = ag.map.cells.slice(0, door[0]) + "0" + ag.map.cells.slice(door[0] + 1);
      ag.map.entities = ag.map.entities.filter(([id]) => id !== door[0]);
    }
    const gold = 25 * (ag.floor + 1);
    ag.loot.gold += gold;
    const rng = stepRng(ag);
    const stash = ITEMS.filter((it) => it.rarity !== "common" && it.slot !== "consumable");
    const drop = stash[Math.floor(rng() * stash.length)];
    d.inventory[drop.id] = (d.inventory[drop.id] ?? 0) + 1;
    ag.loot.items[drop.id] = (ag.loot.items[drop.id] ?? 0) + 1;
    return { solved: true, gold, item: drop.id };
  }
  const rng = stepRng(ag);
  const victim = d.party[Math.floor(rng() * d.party.length)];
  const damage = 6 + ag.floor * 2;
  victim.hp = Math.max(0, victim.hp - damage);
  return { solved: false, victim: victim.name, damage };
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

const RARE_KINDS: RareKind[] = ["merchant", "hermit", "villager"];

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
  }
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
