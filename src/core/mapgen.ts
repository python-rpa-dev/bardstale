/** Seeded expedition floor generator: perfect maze on the odd lattice + punched rooms. Pure — no DOM, no Date. */

import { mulberry32, randInt, type Rng } from "./rng";

export const MAP_W = 21;
export const MAP_H = 21;

/** N/E/S/W unit vectors (y grows south). Index matches ActiveGate.dir. */
export const DIR_VECS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export type EntityKind = "stairs" | "chest" | "shrine" | "trap" | "secret" | "riddle" | "sealed";

export interface GeneratedFloor {
  w: number;
  h: number;
  /** row-major, 1 = wall, 0 = floor. */
  grid: Uint8Array;
  entities: Map<number, { kind: EntityKind }>;
  start: { x: number; y: number; dir: 0 | 1 | 2 | 3 };
}

export function cellId(x: number, y: number, w = MAP_W): number {
  return y * w + x;
}

export function idToXY(id: number, w = MAP_W): { x: number; y: number } {
  return { x: id % w, y: Math.floor(id / w) };
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

/** Orthogonal open-neighbour count of an open cell (1–4). */
export function openDegree(grid: Uint8Array, id: number, w = MAP_W): number {
  const { x, y } = idToXY(id, w);
  let n = 0;
  for (const [dx, dy] of DIR_VECS) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(nx, ny) && grid[cellId(nx, ny, w)] === 0) n++;
  }
  return n;
}

/** BFS shortest path over open cells. Returns cell ids after `from` through `to`, or null. */
export function bfsPath(grid: Uint8Array, from: number, to: number, w = MAP_W, h = MAP_H): number[] | null {
  if (from === to) return [];
  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  const queue = [from];
  seen[from] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === to) break;
    const { x, y } = idToXY(cur, w);
    for (const [dx, dy] of DIR_VECS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const nid = cellId(nx, ny, w);
      if (seen[nid] || grid[nid] === 1) continue;
      seen[nid] = 1;
      prev[nid] = cur;
      queue.push(nid);
    }
  }
  if (!seen[to]) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}

/** BFS distances (cell id → steps) from a start cell over open cells. */
export function bfsDistances(grid: Uint8Array, from: number, w = MAP_W, h = MAP_H): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const { x, y } = idToXY(cur, w);
    for (const [dx, dy] of DIR_VECS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const nid = cellId(nx, ny, w);
      if (dist[nid] !== -1 || grid[nid] === 1) continue;
      dist[nid] = dist[cur] + 1;
      queue.push(nid);
    }
  }
  return dist;
}

/** Iterative recursive-backtracker maze on the odd lattice (nodes at odd x,y). */
function carveMaze(grid: Uint8Array, rng: Rng): void {
  const start = cellId(1, 1);
  grid[start] = 0;
  const visited = new Set<number>([start]);
  const stack: number[] = [start];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const { x, y } = idToXY(cur);
    // Unvisited lattice neighbours two cells away.
    const options: [number, number][] = [];
    for (const [dx, dy] of DIR_VECS) {
      const nx = x + dx * 2;
      const ny = y + dy * 2;
      if (!inBounds(nx, ny)) continue;
      // Perimeter stays wall: lattice nodes live at odd coords ≤ MAP-2.
      if (nx >= MAP_W - 1 || ny >= MAP_H - 1) continue;
      const nid = cellId(nx, ny);
      if (visited.has(nid)) continue;
      options.push([dx, dy]);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = options[randInt(rng, 0, options.length - 1)];
    grid[cellId(x + dx, y + dy)] = 0; // wall between becomes passage
    const nid = cellId(x + dx * 2, y + dy * 2);
    grid[nid] = 0;
    visited.add(nid);
    stack.push(nid);
  }
}

/** Punch 3–5 rooms (4×4..6×6) at even-aligned origins. Each room contains ≥1 lattice node, so it only adds edges to the connected maze skeleton. */
function carveRooms(grid: Uint8Array, rng: Rng): void {
  const count = randInt(rng, 3, 5);
  for (let i = 0; i < count; i++) {
    const rw = randInt(rng, 4, 6);
    const rh = randInt(rng, 4, 6);
    // Even-aligned origin, clamped so the perimeter wall survives.
    const maxKx = Math.floor((MAP_W - 1 - rw) / 2);
    const maxKy = Math.floor((MAP_H - 1 - rh) / 2);
    const rx = 2 * randInt(rng, 1, maxKx);
    const ry = 2 * randInt(rng, 1, maxKy);
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) grid[cellId(x, y)] = 0;
    }
  }
}

/** Shuffle helper (Fisher–Yates). */
function shuffled(items: number[], rng: Rng): number[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Generate one floor. Entrance fixed at (1,1) facing east; exit stairs at the BFS-farthest cell;
 * 3 chests, 1 shrine (free full-heal once per floor), 1 riddle stone (answer for loot gold — or
 * wake its guardian), traps on 4 corridor cells, and one secret-wall alcove (a wall cell touching
 * exactly one open cell — behind it lies a guaranteed rare drop). From depth 1 onward, ~45% of
 * floors also seal a rune-door into a wall face: clues beside the lock, elite stash behind it.
 */
export function generateFloor(seed: number, depth = 0): GeneratedFloor {
  const rng = mulberry32(seed);
  const grid = new Uint8Array(MAP_W * MAP_H).fill(1);
  carveMaze(grid, rng);
  carveRooms(grid, rng);

  const startId = cellId(1, 1); // always a lattice node → open
  const entities = new Map<number, { kind: EntityKind }>();

  const dist = bfsDistances(grid, startId);
  let farthest = startId;
  for (let id = 0; id < grid.length; id++) {
    if (dist[id] > dist[farthest]) farthest = id;
  }
  entities.set(farthest, { kind: "stairs" });

  const openCells: number[] = [];
  for (let id = 0; id < grid.length; id++) if (grid[id] === 0 && id !== startId && id !== farthest) openCells.push(id);

  // Chests and shrine on distinct random floor cells.
  const picks = shuffled(openCells, rng);
  let pi = 0;
  for (let n = 0; n < 3; n++) entities.set(picks[pi++], { kind: "chest" });
  entities.set(picks[pi++], { kind: "shrine" });
  entities.set(picks[pi++], { kind: "riddle" });

  // Traps on corridor cells (exactly two open neighbours), avoiding placed entities.
  const corridors = shuffled(
    openCells.filter((id) => !entities.has(id) && openDegree(grid, id) === 2),
    rng,
  );
  for (let n = 0; n < 4 && n < corridors.length; n++) entities.set(corridors[n], { kind: "trap" });

  // Rune-seal door: a wall face (1–2 open neighbours) near traffic, from floor 2 down only.
  const wallFaces = shuffled(
    Array.from({ length: grid.length }, (_, id) => id).filter((id) => grid[id] === 1 && openDegree(grid, id) >= 1 && openDegree(grid, id) <= 2),
    rng,
  );
  let sealedCell = -1;
  if (depth >= 1 && wallFaces.length > 0 && rng() < 0.45) {
    sealedCell = wallFaces[0];
    entities.set(sealedCell, { kind: "sealed" });
  }

  // Secret alcove: a wall cell touching exactly one open cell (never the door's face).
  const secretCandidates: number[] = [];
  for (let id = 0; id < grid.length; id++) {
    if (grid[id] === 1 && openDegree(grid, id) === 1 && id !== sealedCell) secretCandidates.push(id);
  }

  if (secretCandidates.length) {
    entities.set(shuffled(secretCandidates, rng)[0], { kind: "secret" });
  }

  return { w: MAP_W, h: MAP_H, grid, entities, start: { x: 1, y: 1, dir: 1 } };
}

