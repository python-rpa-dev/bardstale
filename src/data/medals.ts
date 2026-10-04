import type { Family } from "./bestiary";

export interface MedalDef {
  family: Family;
  name: string;
  /** Permanent perk id consumed by combat/tavern/codex code. */
  perk: "bounty-gold-10" | "guaranteed-flee-loot" | "heal-sp-cost-2" | "start-guarded";
  perkText: string;
}

export const MEDALS: MedalDef[] = [
  { family: "vermin", name: "Vermin Bane", perk: "bounty-gold-10", perkText: "+10% bounty gold." },
  { family: "humanoid", name: "Scourge of Man", perk: "guaranteed-flee-loot", perkText: "The party always flees with its loot." },
  { family: "undead", name: "Lights in the Dark", perk: "heal-sp-cost-2", perkText: "Heal spells cost −2 SP." },
  { family: "giant", name: "Giantbreaker", perk: "start-guarded", perkText: "Start every combat Guarded: first hit vs each PC deals half damage (once per combat per PC)." },
];

export function medalForFamily(family: Family): MedalDef {
  const m = MEDALS.find((x) => x.family === family);
  if (!m) throw new Error(`no medal for ${family}`);
  return m;
}
