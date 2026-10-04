export type ModifierId = "none" | "cursed" | "frantic" | "riches" | "hollows" | "storm";

export interface ModifierDef {
  id: ModifierId;
  name: string;
  /** Tavern rumor line template ({gate} substituted). */
  rumor: string;
}

/** Ordered rotation list — index order is load-bearing for the daily formula. */
export const MODIFIERS: ModifierDef[] = [
  { id: "none", name: "Fair Weather", rumor: "{gate} sees fair weather today." },
  { id: "cursed", name: "Cursed", rumor: "A curse clings to {gate}: foes strike truer (crit 6%→12%)." },
  { id: "frantic", name: "Frantic", rumor: "{gate} seethes — foes will strike first." },
  { id: "riches", name: "Riches", rumor: "{gate} glitters: +50% gold and chest loot rolls." },
  { id: "hollows", name: "Hollows", rumor: "{gate} churns — undead rise stronger, vermin wither (±1 level)." },
  { id: "storm", name: "Storms", rumor: "The {gate} reeks of Storms… spells cost −2 SP." },
];

/** Epoch day number from an epoch-ms timestamp. */
export function dayNumber(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 86400000);
}

/** Daily modifier for a gate: list[(dayNumber + gateIndex) % 6]. */
export function modifierForGate(gateIdx: number, dayNum: number): ModifierDef {
  return MODIFIERS[(dayNum + gateIdx) % MODIFIERS.length];
}
