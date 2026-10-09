import { hashStr, mulberry32 } from "../core/rng";

export type ModifierId = "none" | "cursed" | "frantic" | "riches" | "hollows" | "storm";

export interface ModifierDef {
  id: ModifierId;
  name: string;
  /** Tavern rumor line template ({gate} substituted). */
  rumor: string;
  /** Short effect summary shown on the omen card at the gate. */
  effect: string;
}

/** Ordered rotation list — index order is load-bearing for the daily formula. */
export const MODIFIERS: ModifierDef[] = [
  { id: "none", name: "Fair Weather", rumor: "{gate} sees fair weather today.", effect: "No omen — the depths behave exactly as billed." },
  { id: "cursed", name: "Cursed", rumor: "A curse clings to {gate}: foes strike truer (crit 6%→12%).", effect: "Foe crit chance doubles (6% → 12%)." },
  { id: "frantic", name: "Frantic", rumor: "{gate} seethes — foes will strike first.", effect: "Foes act before the party during round 1." },
  { id: "riches", name: "Riches", rumor: "{gate} glitters: +50% gold and chest loot rolls.", effect: "+50% gold from kills (and richer chests)." },
  { id: "hollows", name: "Hollows", rumor: "{gate} churns — undead rise stronger, vermin wither (±1 level).", effect: "Undead +1 level, vermin −1 level." },
  { id: "storm", name: "Storms", rumor: "The {gate} reeks of Storms… spells cost −2 SP.", effect: "Every spell costs 2 SP less (floor 1)." },
];

/** Epoch day number from an epoch-ms timestamp. */
export function dayNumber(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 86400000);
}

/** Daily modifier for a gate: list[(dayNumber + gateIndex) % 6]. */
export function modifierForGate(gateIdx: number, dayNum: number): ModifierDef {
  return MODIFIERS[(dayNum + gateIdx) % MODIFIERS.length];
}

/**
 * The omen draft at gate entry. Today's ambient modifier leads the hand — the tavern rumor
 * promised it — followed by two others drawn from a stream seeded by (day, gate, run number).
 * Carry one below as your run modifier, or descend unbound for none. Deterministic per draft.
 */
export function omensFor(gateIdx: number, dayNum: number, runNumber: number): ModifierDef[] {
  const ambient = modifierForGate(gateIdx, dayNum);
  const rng = mulberry32(hashStr(`omens:${dayNum}:${gateIdx}:${runNumber}`));
  const rest = MODIFIERS.filter((m) => m.id !== "none" && m.id !== ambient.id);
  const picks: ModifierDef[] = [];
  while (picks.length < 2 && rest.length > 0) {
    picks.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  }
  return [ambient, ...picks];
}
