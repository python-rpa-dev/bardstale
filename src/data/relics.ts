/** Relics: run-defining trinkets. One per run, claimed at the first rune-sealed vault.
 *  Each relic bends exactly one rule of the crawl and pays for it with exactly one cost;
 *  the math lives in relicMods (state/expedition), this file is pure copy + identity. */

export interface RelicDef {
  id: string;
  name: string;
  /** What the relic gives — shown on the claim modal and the dungeon chip. */
  boon: string;
  /** What it takes in return. */
  cost: string;
}

export const RELICS: RelicDef[] = [
  { id: "emberheart", name: "Emberheart Sigil", boon: "Torchlight lasts half again as long on every floor", cost: "The sigil smoulders — foes find you 6% more often" },
  { id: "owl-mask", name: "Owl Mask", boon: "Ambush odds fall by 8 points", cost: "Owl eyes hate flame — torchlight burns 25% faster" },
  { id: "grave-coin", name: "Grave Coin", boon: "All expedition gold pays half again", cost: "The dead audit every vault — traps bite twice as hard" },
  { id: "skeleton-key", name: "Skeleton Key", boon: "Rune seals open at a touch — no puzzle, no guessing", cost: "Vaults still defend themselves: forcing one bolts a random hero" },
  { id: "greed-molar", name: "Greed's Molar", boon: "Chests pay double gold", cost: "Every chest you crack springs a foe" },
  { id: "butcher-hook", name: "Butcher's Hook", boon: "Every hero's blow lands +2 damage", cost: "So does every foe's" },
];

export function relicById(id: string): RelicDef {
  const r = RELICS.find((x) => x.id === id);
  if (!r) throw new Error(`unknown relic: ${id}`);
  return r;
}
