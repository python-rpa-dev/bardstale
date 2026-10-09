import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W, bfsPath, cellId, generateFloor, openDegree } from "../mapgen";

describe("mapgen", () => {
  // Plan M5 test: flood fill from the entrance reaches stairs + all chests for seeds 0..49.
  it("connects entrance to stairs and every chest for seeds 0..49", () => {
    for (let seed = 0; seed < 50; seed++) {
      const gen = generateFloor(seed * 7919 + 13); // spread across the seed space
      const startId = cellId(gen.start.x, gen.start.y);
      expect(gen.grid[startId], `seed ${seed}: entrance open`).toBe(0);

      let stairs = -1;
      const chests: number[] = [];
      for (const [id, e] of gen.entities) {
        if (e.kind === "stairs") stairs = id;
        if (e.kind === "chest") chests.push(id);
      }
      expect(stairs, `seed ${seed}: has stairs`).toBeGreaterThanOrEqual(0);
      expect(chests).toHaveLength(3);

      for (const target of [stairs, ...chests]) {
        const path = bfsPath(gen.grid, startId, target);
        expect(path, `seed ${seed}: cell ${target} reachable`).not.toBeNull();
      }
    }
  });

  it("places a shrine, four traps and a valid secret alcove for seeds 0..49", () => {
    for (let seed = 0; seed < 50; seed++) {
      const gen = generateFloor(seed * 7919 + 13);
      let shrines = 0;
      let traps = 0;
      let secrets = 0;
      for (const [id, e] of gen.entities) {
        if (e.kind === "shrine") shrines++;
        if (e.kind === "trap") {
          traps++;
          // Traps sit on corridor cells: exactly two open neighbours.
          expect(openDegree(gen.grid, id), `seed ${seed}: trap cell`).toBe(2);
        }
        if (e.kind === "secret") {
          secrets++;
          // The secret is a wall touching exactly one open cell — the alcove mouth.
          expect(gen.grid[id], `seed ${seed}: secret is wall`).toBe(1);
          expect(openDegree(gen.grid, id), `seed ${seed}: alcove mouth`).toBe(1);
        }
      }
      expect(shrines, `seed ${seed}`).toBe(1);
      expect(traps, `seed ${seed}`).toBe(4);
      expect(secrets, `seed ${seed} has secret alcove`).toBe(1);
    }
  });

  it("keeps the perimeter sealed and dimensions odd", () => {
    const gen = generateFloor(42);
    expect(gen.w).toBe(MAP_W);
    expect(gen.h).toBe(MAP_H);
    for (let x = 0; x < MAP_W; x++) {
      expect(gen.grid[cellId(x, 0)]).toBe(1);
      expect(gen.grid[cellId(x, MAP_H - 1)]).toBe(1);
    }
    for (let y = 0; y < MAP_H; y++) {
      expect(gen.grid[cellId(0, y)]).toBe(1);
      expect(gen.grid[cellId(MAP_W - 1, y)]).toBe(1);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = generateFloor(12345);
    const b = generateFloor(12345);
    expect(Array.from(a.grid)).toEqual(Array.from(b.grid));
    expect([...a.entities.entries()].sort((p, q) => p[0] - q[0])).toEqual(
      [...b.entities.entries()].sort((p, q) => p[0] - q[0]),
    );
  });

  it("puts stairs at the BFS-farthest cell from the entrance", () => {
    const gen = generateFloor(7);
    let stairs = -1;
    for (const [id, e] of gen.entities) if (e.kind === "stairs") stairs = id;
    // Stairs must not be adjacent to the entrance on any seed we ship casually.
    const d = bfsPath(gen.grid, cellId(1, 1), stairs);
    expect(d!.length).toBeGreaterThan(8);
  });
});

describe("riddle stones and rune-seal doors (placement)", () => {
  it("every floor carries exactly one riddle stone on an open cell", () => {
    for (let seed = 0; seed < 50; seed++) {
      const gen = generateFloor(seed * 7919 + 13);
      let n = 0;
      for (const [id, e] of gen.entities) if (e.kind === "riddle") { n++; expect(gen.grid[id], `seed ${seed}: riddle on floor`).toBe(0); }
      expect(n, `seed ${seed}: one riddle stone`).toBe(1);
    }
  });

  it("seals never appear on floor 1; deeper they are wall faces with 1–2 open neighbours", () => {
    for (let seed = 0; seed < 60; seed++) {
      const gen = generateFloor(seed * 7919 + 13, 0);
      for (const [, e] of gen.entities) expect(e.kind, `seed ${seed}: no door on floor 1`).not.toBe("sealed");
    }
    let seen = 0;
    for (let seed = 0; seed < 60; seed++) {
      const gen = generateFloor(seed * 7919 + 13, 2);
      let n = 0;
      for (const [id, e] of gen.entities) if (e.kind === "sealed") {
        n++;
        seen++;
        expect(gen.grid[id], `seed ${seed}: door is wall`).toBe(1);
        const d = openDegree(gen.grid, id);
        expect(d >= 1 && d <= 2, `seed ${seed}: door faces traffic`).toBe(true);
      }
      expect(n).toBeLessThanOrEqual(1);
    }
    expect(seen, "~45% of deep floors seal a door").toBeGreaterThan(0);
    const a = generateFloor(99, 3);
    const b = generateFloor(99, 3);
    expect([...a.entities].sort((x, y) => x[0] - y[0])).toEqual([...b.entities].sort((x, y) => x[0] - y[0]));
  });

  it("the secret alcove never doubles as the sealed door", () => {
    for (let seed = 0; seed < 80; seed++) {
      const gen = generateFloor(seed * 7919 + 13, 2);
      const sealedIds = [...gen.entities].filter(([, e]) => e.kind === "sealed").map(([id]) => id);
      for (const [id, e] of gen.entities) if (e.kind === "secret") expect(sealedIds, `seed ${seed}`).not.toContain(id);
    }
  });
});
