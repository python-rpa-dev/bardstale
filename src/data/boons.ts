import { mulberry32, hashStr } from "../core/rng";

/** A permanent per-hero perk granted in place of a stat point at level-up. */
export interface BoonDef {
  id: string;
  name: string;
  hint: string;
  bonus: {
    atk?: number;
    def?: number;
    dex?: number;
    mnd?: number;
    maxHp?: number;
    maxSp?: number;
    crit?: number; // additive crit chance, e.g. 0.06 = +6%
  };
}

export const BOONS: BoonDef[] = [
  { id: "brutal-edge", name: "Brutal Edge", hint: "+1 ATK — the blade lands heavier.", bonus: { atk: 1 } },
  { id: "stoneflesh", name: "Stoneflesh", hint: "+1 DEF — blows glance off more often.", bonus: { def: 1 } },
  { id: "swiftfoot", name: "Swiftfoot", hint: "+1 DEX — harder to hit, easier to land.", bonus: { dex: 1 } },
  { id: "keen-mind", name: "Keen Mind", hint: "+1 MND — spells bite and wards hold.", bonus: { mnd: 1 } },
  { id: "iron-vitality", name: "Iron Vitality", hint: "+3 max HP, healed now too.", bonus: { maxHp: 3 } },
  { id: "deep-reserves", name: "Deep Reserves", hint: "+2 max SP, restored now too.", bonus: { maxSp: 2 } },
  { id: "killer-instinct", name: "Killer Instinct", hint: "+6% crit chance — find the seam every third fight.", bonus: { crit: 0.06 } },
];

export function boonById(id: string): BoonDef {
  const b = BOONS.find((x) => x.id === id);
  if (!b) throw new Error(`unknown boon ${id}`);
  return b;
}

/**
 * Deterministic pick of `count` distinct boons for one hero's next level.
 * Seeded from hero id + the exact set they already hold, so the same three
 * offers survive reloads and cannot be rerolled by leaving the modal. Held
 * boons are excluded — perks don't repeat while any new ones remain; once a
 * hero holds (nearly) all of them, duplicates return as endgame filler.
 */
export function boonOffers(pcId: string, held: readonly string[], count = 3): BoonDef[] {
  const rng = mulberry32(hashStr(`boon:${pcId}:${held.join(",")}`));
  const fresh = BOONS.filter((b) => !held.includes(b.id));
  if (fresh.length > count) {
    const pool = fresh.slice();
    const out: BoonDef[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out; // random subset of fresh boons only — held never appears
  }
  // Fewer fresh than slots: show every remaining new boon, pad with held ones as endgame filler.
  const filler = BOONS.filter((b) => held.includes(b.id));
  const out = fresh.slice();
  while (out.length < count && filler.length > 0) {
    out.push(filler.splice(Math.floor(rng() * filler.length), 1)[0]);
  }
  return out;
}
