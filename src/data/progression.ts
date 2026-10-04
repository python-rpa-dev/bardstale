export const LEVEL_CAP = 20;

/** XP needed to go from `lvl` to lvl+1. */
export function xpForNext(lvl: number): number {
  return Math.round(50 * Math.pow(lvl, 1.7));
}

/**
 * Anti-grind tax: XP multiplier applied to a kill's base XP.
 * `avg` = mean party level, `mobLvl` = monster level.
 * A lvl-10 party killing lvl-2 rats gets 5% XP; tougher foes pay up to 1.5x.
 */
export function xpMult(mobLvl: number, avg: number): number {
  return mobLvl < avg
    ? Math.max(0.05, 1 - 0.15 * (avg - mobLvl))
    : Math.min(1.5, 1 + 0.08 * (mobLvl - avg));
}

/** True when the tax is heavy enough that the UI must warn about it. */
export function xpTaxWarn(mobLvl: number, avg: number): boolean {
  return xpMult(mobLvl, avg) < 0.5;
}
