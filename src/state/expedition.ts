/** Expedition run logic shared by the gate and dungeon screens. Mutators take a draft GameState. */

import { generateFloor, MAP_H, MAP_W, type EntityKind, type GeneratedFloor } from "../core/mapgen";
import { bountyId } from "../data/bounties";
import { expeditionSeed, hashStr, mulberry32, randInt, type Rng } from "../core/rng";
import { gateById, gateIndex } from "../data/gates";
import { dayNumber, modifierForGate } from "../data/modifiers";
import { BESTIARY, type Family, type MonsterDef } from "../data/bestiary";
import type { ActiveGate, FloorMapSave, GameState } from "./save";

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
    map: toFloorSave(generateFloor(floorSeed(seed, 0))),
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
  s.activeGate = ag;
  reveal(ag);
}

/** Step down to the next floor. Keeps run seed, flags and loot tally; map/position reset. */
export function descendFloor(s: GameState): void {
  const ag = s.activeGate;
  if (!ag) return;
  ag.floor += 1;
  ag.map = toFloorSave(generateFloor(floorSeed(ag.seed, ag.floor)));
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
 * Spawn 1–3 monsters from the gate's level band. When a bounty for a family in-band is active,
 * that family's members are weighted twice as often — bounties should feel responsive.
 */
export function rollEncounter(ag: ActiveGate, bountyFamily: Family | null): MonsterDef[] {
  const def = gateById(ag.gateId);
  const [lo, hi] = def.levels;
  const pool = BESTIARY.filter((m) => m.lvl >= lo && m.lvl <= hi);
  const weights = pool.map((m) => (bountyFamily && m.family === bountyFamily ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const rng = stepRng(ag);
  const count = randInt(rng, 1, 3);
  const out: MonsterDef[] = [];
  for (let i = 0; i < count; i++) {
    let roll = rng() * total;
    let idx = 0;
    while (idx < pool.length - 1 && roll > weights[idx]) {
      roll -= weights[idx];
      idx++;
    }
    out.push(pool[idx]);
  }
  return out;
}

/** The active bounty's family if any, for encounter weighting. */
export function activeBountyFamily(s: GameState): Family | null {
  const id = s.bounties.active;
  if (!id) return null;
  const offer = s.bounties.offers.find((o) => bountyId(o) === id);
  return offer ? offer.family : null;
}
