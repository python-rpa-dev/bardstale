import { FAMILIES, type Family } from "./bestiary";
import type { Rng } from "../core/rng";

export interface BountyDef {
  family: Family;
  count: number;
  gold: number;
}

/** id is stable across days — used for completed/slot bookkeeping. */
export function bountyId(b: Pick<BountyDef, "family" | "count">): string {
  return `${b.family}-${b.count}`;
}

const REWARDS: Record<Family, number[]> = {
  vermin: [40, 90, 160], // counts 3/5/8
  humanoid: [70, 150, 260],
  undead: [90, 190, 320],
  giant: [120, 240], // giant uses counts 1/2
};

const COUNTS: Record<Family, number[]> = {
  vermin: [3, 5, 8],
  humanoid: [3, 5, 8],
  undead: [3, 5, 8],
  giant: [1, 2],
};

/** Full pool: family × its kill counts. Order is deterministic; the board shuffles it by daily seed. */
export const BOUNTY_POOL: BountyDef[] = FAMILIES.flatMap((family) =>
  COUNTS[family].map((count, i) => ({ family, count, gold: REWARDS[family][i] })),
);

/** Fisher–Yates on a copy, driven by the injected rng. */
export function shuffledPool(rng: Rng): BountyDef[] {
  const a = BOUNTY_POOL.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The board shows exactly the first 3 of the pool shuffled by daily seed. */
export function offersForDay(rng: Rng): BountyDef[] {
  return shuffledPool(rng).slice(0, 3);
}
