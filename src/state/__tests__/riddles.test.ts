import { describe, expect, it } from "vitest";
import { RIDDLES, RUNES, allSeals, runeById, riddleFor, sealPuzzle } from "../../data/riddles";

/** Re-evaluate a carved clue from its TEXT alone — the same information a player has. If the
 *  generator ever emits text our parser doesn't know, this test fails loudly instead of
 *  silently blessing unsolvable doors. */
function truthOf(clue: string): (p: string[]) => boolean {
  const m = clue.match(/^(\w+) (.+)$/) as RegExpMatchArray;
  const rune = RUNES.find((r) => r.name === m[1]);
  if (!rune) throw new Error(`clue names an unknown rune: ${clue}`);
  const id = rune.id;
  switch (m[2]) {
    case "is absent from this seal.": return (p) => !p.includes(id);
    case "opens the verse.": return (p) => p[0] === id;
    case "closes the verse.": return (p) => p[2] === id;
    case "holds the middle line.": return (p) => p[1] === id;
    case "never opens it, nor closes it.": return (p) => p[0] !== id && p[2] !== id;
    case "does not open the verse.": return (p) => p[0] !== id;
    case "does not close the verse.": return (p) => p[2] !== id;
    default: throw new Error(`unparsable clue text: ${clue}`);
  }
}

describe("riddleFor", () => {
  it("is a pure function of seed+floor — staring at the stone cannot reroll it", () => {
    for (let floor = 0; floor < 5; floor++) {
      expect(riddleFor(1234, floor)).toEqual(riddleFor(1234, floor));
    }
  });

  it("reshuffles answers but keeps exactly one correct option", () => {
    for (let seed = 0; seed < 60; seed++) {
      const v = riddleFor(seed, seed % 4);
      expect(v.correctAt).toBeGreaterThanOrEqual(0);
      expect(v.answers).toHaveLength(v.riddle.answers.length);
      expect([...v.answers].sort()).toEqual([...v.riddle.answers].sort());
      expect(v.answers[v.correctAt]).toBe(v.riddle.answers[v.riddle.answer]);
    }
  });

  it("shuffles away from table order at least sometimes and spans the table", () => {
    let shuffledAway = 0;
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const v = riddleFor(seed * 31 + 7, 0);
      seen.add(v.riddle.id);
      if (v.answers.join() !== v.riddle.answers.join()) shuffledAway++;
    }
    expect(shuffledAway).toBeGreaterThan(20);
    expect(seen.size).toBe(RIDDLES.length); // every riddle reachable across the seed space
  });

  it("every table entry has its answer index inside its own options", () => {
    for (const r of RIDDLES) {
      expect(r.answer).toBeGreaterThanOrEqual(0);
      expect(r.answer).toBeLessThan(r.answers.length);
      expect(new Set(r.answers).size).toBe(r.answers.length); // no duplicate options
    }
  });
});

describe("sealPuzzle", () => {
  it("is deterministic per seed+floor", () => {
    for (let floor = 0; floor < 4; floor++) {
      expect(sealPuzzle(777, floor)).toEqual(sealPuzzle(777, floor));
    }
  });

  it("every door is uniquely solvable from its clues alone — seeds 0..99 × floors 0..5", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (let floor = 0; floor <= 5; floor++) {
        const { solution, clues } = sealPuzzle(seed * 7919 + 13, floor);
        expect(solution).toHaveLength(3);
        expect(new Set(solution).size).toBe(3); // distinct runes
        for (const r of solution) runeById(r); // known ids

        const fits = allSeals().filter((p) => clues.every((c) => truthOf(c)(p)));
        expect(fits, `seed ${seed} floor ${floor}: solvable`).toHaveLength(1);
        expect(fits[0]).toEqual(solution);
      }
    }
  });
  it("keeps clue text tight — between three and five lines", () => {
    for (let seed = 0; seed < 200; seed++) {
      const { clues } = sealPuzzle(seed * 104729 + 1, 3);
      // "absent" alone leaves 6 seals and no single clue can pin below 2 — so ≥3 always.
      expect(clues.length).toBeGreaterThanOrEqual(3);
      expect(clues.length).toBeLessThanOrEqual(5); // observed max over 14k seed/floor combos
    }
  });
});
