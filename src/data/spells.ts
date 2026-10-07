import type { ClassId } from "./classes";

export type SpellTarget = "one-foe" | "all-foes" | "self-caster" | "one-ally" | "all-allies";

export interface SpellDef {
  id: string;
  name: string;
  class: ClassId;
  sp: number;
  target: SpellTarget;
  /** Tooltip text quoting the exact effect. */
  effect: string;
}

export const SPELLS: SpellDef[] = [
  { id: "magic-missile", name: "Magic Missile", class: "mage", sp: 4, target: "one-foe", effect: "Hit one foe for 6 + casterMND" },
  { id: "flame-wave", name: "Flame Wave", class: "mage", sp: 10, target: "all-foes", effect: "All foes take round(casterMND×0.8)" },
  { id: "lightning", name: "Lightning", class: "mage", sp: 7, target: "one-foe", effect: "One foe takes casterMND + 0–8; crit chance +10%" },
  { id: "heal", name: "Heal", class: "cleric", sp: 5, target: "one-ally", effect: "Restore 8 + casterMND HP to one ally" },
  { id: "bless", name: "Bless", class: "cleric", sp: 6, target: "all-allies", effect: "Party DEF +3 for this combat" },
  { id: "purify", name: "Purify", class: "cleric", sp: 4, target: "one-ally", effect: "Cure all statuses on one ally" },
  { id: "power-strike", name: "Power Strike", class: "fighter", sp: 4, target: "one-foe", effect: "One foe takes round(ATK×1.8), ignores half DEF" },
  { id: "taunt", name: "Taunt", class: "fighter", sp: 2, target: "self-caster", effect: "Highest-ATK enemy must target this PC next round" },
  { id: "cleave", name: "Cleave", class: "fighter", sp: 7, target: "all-foes", effect: "All foes take round(ATK×1.2), halved by their DEF" },
  { id: "frost-nova", name: "Frost Nova", class: "mage", sp: 14, target: "all-foes", effect: "All foes take round(casterMND×1.2) − MR" },
  { id: "mass-heal", name: "Mass Heal", class: "cleric", sp: 12, target: "all-allies", effect: "Restore 6 + casterMND HP to every ally" },
];

export function spellById(id: string): SpellDef {
  const def = SPELLS.find((s) => s.id === id);
  if (!def) throw new Error(`unknown spell ${id}`);
  return def;
}

/** Level-unlock table: class → level → spell id. Rogue has no spells (passives instead). */
export const SPELL_UNLOCKS: Record<ClassId, { lvl: number; spell: string }[]> = {
  mage: [
    { lvl: 1, spell: "magic-missile" },
    { lvl: 3, spell: "flame-wave" },
    { lvl: 6, spell: "lightning" },
    { lvl: 10, spell: "frost-nova" },
  ],
  cleric: [
    { lvl: 1, spell: "heal" },
    { lvl: 4, spell: "bless" },
    { lvl: 9, spell: "purify" },
    { lvl: 13, spell: "mass-heal" },
  ],
  fighter: [
    { lvl: 1, spell: "power-strike" },
    { lvl: 5, spell: "taunt" },
    { lvl: 9, spell: "cleave" },
  ],
  rogue: [],
};

export function spellsKnownAt(classId: ClassId, level: number): SpellDef[] {
  return SPELL_UNLOCKS[classId]
    .filter((u) => u.lvl <= level)
    .map((u) => spellById(u.spell));
}

/** Rogue passives — no SP, always on while the rogue lives. */
export const ROGUE_PASSIVES = [
  { id: "trap-lore", name: "Trap Lore", effect: "Rogue in party → trap damage halved; detection roll uses rogue DEX" },
  { id: "pocket-luck", name: "Pocket Luck", effect: "+3 gold per kill" },
] as const;
