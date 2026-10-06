import { classById, RECRUIT_COST, type ClassId } from "../data/classes";
import { itemById } from "../data/items";
import { xpForNext, LEVEL_CAP } from "../data/progression";
import { pcBase, pcMax, makePc, type GameState, type Pc } from "./save";

export interface EffectiveStats {
  atk: number;
  def: number;
  dex: number;
  mnd: number;
}

/** Base + gear bonuses + active status modifiers (poison −DEX). */
export function effectiveStats(pc: Pc): EffectiveStats {
  const out: EffectiveStats = { ...pcBase(pc) };
  for (const slot of ["weapon", "armor", "trinket"] as const) {
    const id = pc.gear[slot];
    if (!id) continue;
    const def = itemById(id);
    if (def.bonus) {
      out.atk += def.bonus.atk ?? 0;
      out.def += def.bonus.def ?? 0;
      out.dex += def.bonus.dex ?? 0;
      out.mnd += def.bonus.mnd ?? 0;
    }
  }
  if (pc.statuses.some((s) => s.kind === "poison")) out.dex -= 1; // poison: −1 DEX while active
  return out;
}

export function critChanceBonus(pc: Pc): number {
  const id = pc.gear.trinket;
  return id ? itemById(id).critChanceBonus ?? 0 : 0;
}

/** Equip from inventory (swaps out the current item of that slot, if any). */
export function equipFromInventory(state: GameState, pcId: string, itemId: string): boolean {
  const pc = state.party.find((p) => p.id === pcId);
  if (!pc) return false;
  const def = itemById(itemId);
  if (def.slot === "consumable") return false;
  if ((state.inventory[itemId] ?? 0) < 1) return false;
  state.inventory[itemId] = (state.inventory[itemId] ?? 0) - 1;
  const previous = pc.gear[def.slot as "weapon" | "armor" | "trinket"];
  if (previous) state.inventory[previous] = (state.inventory[previous] ?? 0) + 1;
  pc.gear[def.slot as "weapon" | "armor" | "trinket"] = itemId;
  return true;
}

export function unequipSlot(state: GameState, pcId: string, slot: "weapon" | "armor" | "trinket"): boolean {
  const pc = state.party.find((p) => p.id === pcId);
  const id = pc?.gear[slot];
  if (!pc || !id) return false;
  delete pc.gear[slot];
  state.inventory[id] = (state.inventory[id] ?? 0) + 1;
  return true;
}

export interface XpResult {
  levels: number; // level-ups gained
}

/** Grant XP to one PC, applying the level cap and free-point grants. */
export function applyXpToPc(state: GameState, pcId: string, xp: number): XpResult {
  const pc = state.party.find((p) => p.id === pcId);
  if (!pc) return { levels: 0 };
  let gained = 0;
  pc.xp += xp;
  while (pc.level < LEVEL_CAP && pc.xp >= xpForNext(pc.level)) {
    pc.xp -= xpForNext(pc.level);
    pc.level++;
    gained++;
    if (pc.level >= 2) pc.points++; // one allocated point per level from level 2
    const growth = classById(pc.classId).growth;
    const max = pcMax(pc);
    pc.hp = Math.min(max.hp, pc.hp + (growth.hp ?? 0)); // growth HP arrives healed
    pc.sp = Math.min(max.sp, pc.sp + (growth.sp ?? 0));
  }
  if (pc.level >= LEVEL_CAP) pc.xp = 0; // no hoarding past the cap
  return { levels: gained };
}

/** Temple prices (plan M4). */
export const TEMPLE = {
  healCost: (pc: Pc) => 2 * pc.level,
  cureCost: 5,
  reviveCost: 25,
};

/** Spend gold. False when the party cannot pay; nothing is deducted then. */
export function pay(state: GameState, cost: number): boolean {
  if (state.gold < cost) return false;
  state.gold -= cost;
  return true;
}


/** Recruit a fresh level-1 PC of the class; false when party full or gold short. */
export function recruitPc(state: GameState, classId: ClassId): boolean {
  if (state.party.length >= 4 || !pay(state, RECRUIT_COST)) return false;
  const ordinal = state.party.filter((p) => p.classId === classId).length + 1;
  state.party.push(makePc(classId, ordinal));
  return true;
}

/** Spend one free point on the class's suggested stat. */
export function suggestAllocate(pc: Pc): boolean {
  if (pc.points < 1) return false;
  pc.alloc[classById(pc.classId).suggestStat]++;
  pc.points--;
  return true;
}
