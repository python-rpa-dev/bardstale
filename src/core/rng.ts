/** All randomness in the game flows from a passed-in rng function — never Math.random outside tests. */

export type Rng = () => number;

/** mulberry32 PRNG: returns floats in [0,1). Deterministic for a given seed. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, 32-bit. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Expedition seed: stable per save/gate/run. */
export function expeditionSeed(saveSeed: string, gateId: string, runNumber: number): number {
  return hashStr(`${saveSeed}:${gateId}:${runNumber}`);
}

/** Daily rotation seed from the ISO date (UTC slice). */
export function dailySeed(isoDate: string): number {
  return hashStr(isoDate);
}

/** Today's ISO date key, e.g. "2026-10-04". Injectable clock for tests via `now`. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Integer in [lo, hi] inclusive from rng. */
export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
