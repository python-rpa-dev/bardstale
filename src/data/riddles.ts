/** Riddle stones and rune-seal doors: pure, seeded puzzle content. No RNG singletons — every
 *  selector derives from the run seed + floor so puzzles survive reloads untouched. */

import { hashStr, mulberry32 } from "../core/rng";

export interface RiddleDef {
  id: string;
  prompt: string;
  /** Display order in the table; riddleFor() reshuffles per floor. Exactly one is correct. */
  answers: string[];
  answer: number; // index into answers
}

export const RIDDLES: RiddleDef[] = [
  { id: "darkness", prompt: "The more of me there is, the less you see. What am I?", answers: ["Darkness", "Smoke", "Sleep"], answer: 0 },
  { id: "echo", prompt: "I speak without a mouth and hear without ears. I have no body, but with the wind I come alive.", answers: ["A ghost", "An echo", "A rumour"], answer: 1 },
  { id: "name", prompt: "What belongs to you alone, yet your companions use it more than you do?", answers: ["Your name", "Your shadow", "Your coin"], answer: 0 },
  { id: "footsteps", prompt: "The more you take of me, the more you leave behind. What am I?", answers: ["Breaths", "Years", "Footsteps"], answer: 2 },
  { id: "silence", prompt: "I am so fragile that saying my name breaks me. What am I?", answers: ["Silence", "Glass", "A vow"], answer: 0 },
  { id: "map", prompt: "I have cities, but no houses. Forests, but no trees. Water, but no fish. What am I?", answers: ["A dream", "A map", "A tale"], answer: 1 },
  { id: "compass", prompt: "I have a needle but I stitch nothing. I point the way home for those who know me. What am I?", answers: ["A compass", "A pine branch", "A loom"], answer: 0 },
  { id: "breath", prompt: "Lightest of burdens: even the strongest hero cannot hold me long. What am I?", answers: ["Feathers", "A promise", "Breath"], answer: 2 },
];

export function riddleById(id: string): RiddleDef {
  const hit = RIDDLES.find((r) => r.id === id);
  if (!hit) throw new Error(`unknown riddle ${id}`);
  return hit;
}

/** Deterministic shuffle (Fisher–Yates) over a copy. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface RiddleView {
  riddle: RiddleDef;
  /** Answer strings in display order — the correct one is at `correctAt`. */
  answers: string[];
  correctAt: number;
}

/** The floor's riddle with its answer options reshuffled. Same seed+floor ⇒ same view, so a
 *  reload mid-stare cannot reroll the stone. */
export function riddleFor(runSeed: number, floor: number): RiddleView {
  const rng = mulberry32(hashStr(`${runSeed}:riddle:${floor}`));
  const riddle = RIDDLES[Math.floor(rng() * RIDDLES.length)];
  const tagged = shuffled(
    riddle.answers.map((text, i) => ({ text, correct: i === riddle.answer })),
    rng,
  );
  return { riddle, answers: tagged.map((t) => t.text), correctAt: tagged.findIndex((t) => t.correct) };
}

// ---------- Rune-seal doors ----------

export interface RuneDef {
  id: string;
  name: string;
  glyph: string; // decorative only — every control carries the spoken name for AT
}

export const RUNES: RuneDef[] = [
  { id: "ember", name: "Ember", glyph: "ᚠ" },
  { id: "gale", name: "Gale", glyph: "ᚹ" },
  { id: "wave", name: "Wave", glyph: "ᛚ" },
  { id: "stone", name: "Stone", glyph: "ᛏ" },
];

export function runeById(id: string): RuneDef {
  const hit = RUNES.find((r) => r.id === id);
  if (!hit) throw new Error(`unknown rune ${id}`);
  return hit;
}

/** All ordered picks of 3 distinct runes — the puzzle's whole solution space (24). */
export function allSeals(): string[][] {
  const out: string[][] = [];
  for (const a of RUNES) for (const b of RUNES) for (const c of RUNES) {
    if (a.id !== b.id && b.id !== c.id && a.id !== c.id) out.push([a.id, b.id, c.id]);
  }
  return out;
}

interface Clue {
  text: string;
  ok: (p: string[]) => boolean;
}

/**
 * Seeded seal puzzle for one floor: a 3-rune solution plus the fewest carved clues that pin it
 * down uniquely. The generator always starts from "the missing rune is absent" and adds true
 * statements until only one of the 24 possible seals still fits — so every door is solvable by
 * reading, never by luck, and identical across reloads.
 */
export function sealPuzzle(runSeed: number, floor: number): { solution: string[]; clues: string[] } {
  const rng = mulberry32(hashStr(`${runSeed}:seal:${floor}`));
  const order = shuffled(RUNES.map((r) => r.id), rng);
  const sol = order.slice(0, 3); // distinct by construction
  const missing = RUNES.find((r) => !sol.includes(r.id))!;

  const pool: Clue[] = [
    { text: `${missing.name} is absent from this seal.`, ok: (p) => !p.includes(missing.id) },
    { text: `${runeById(sol[0]).name} opens the verse.`, ok: (p) => p[0] === sol[0] },
    { text: `${runeById(sol[2]).name} closes the verse.`, ok: (p) => p[2] === sol[2] },
    { text: `${runeById(sol[1]).name} holds the middle line.`, ok: (p) => p[1] === sol[1] },
    { text: `${runeById(sol[1]).name} never opens it, nor closes it.`, ok: (p) => p[0] !== sol[1] && p[2] !== sol[1] },
    { text: `${runeById(sol[2]).name} does not open the verse.`, ok: (p) => p[0] !== sol[2] },
    { text: `${runeById(sol[0]).name} does not close the verse.`, ok: (p) => p[2] !== sol[0] },
  ];

  const clues = [pool[0]];
  let candidates = allSeals().filter((p) => clues.every((k) => k.ok(p))); // 6 seals survive "absent"
  for (const c of shuffled(pool.slice(1), rng)) {
    if (candidates.length === 1) break; // already uniquely pinned — stop adding text
    const after = candidates.filter(c.ok);
    // Every clue is true of sol, so `after` never empties. Only keep clues that actually narrow.
    if (after.length > 0 && after.length < candidates.length) {
      clues.push(c);
      candidates = after;
    }
  }
  return { solution: sol, clues: clues.map((c) => c.text) };
}
