export type ClassId = "fighter" | "mage" | "cleric" | "rogue";

/** Stat block; HP/SP are maxima, the rest are modifiers. */
export interface Stats {
  hp: number;
  sp: number;
  atk: number;
  def: number;
  dex: number;
  mnd: number;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  start: Stats;
  /** Auto-growth applied on each level-up from level 2. */
  growth: Partial<Stats>;
  /** "Suggest" allocates the free point here (from level 2). */
  suggestStat: keyof Omit<Stats, "hp" | "sp">;
}

export const CLASSES: ClassDef[] = [
  {
    id: "fighter",
    name: "Fighter",
    start: { hp: 32, sp: 6, atk: 9, def: 8, dex: 7, mnd: 4 },
    growth: { hp: 9, sp: 2, atk: 2, def: 1 },
    suggestStat: "atk",
  },
  {
    id: "mage",
    name: "Mage",
    start: { hp: 18, sp: 24, atk: 4, def: 4, dex: 6, mnd: 12 },
    growth: { hp: 5, sp: 6, mnd: 2 },
    suggestStat: "mnd",
  },
  {
    id: "cleric",
    name: "Cleric",
    start: { hp: 24, sp: 18, atk: 6, def: 7, dex: 5, mnd: 10 },
    growth: { hp: 7, sp: 4, mnd: 1, def: 1 },
    suggestStat: "mnd",
  },
  {
    id: "rogue",
    name: "Rogue",
    start: { hp: 24, sp: 10, atk: 8, def: 5, dex: 12, mnd: 5 },
    growth: { hp: 6, sp: 3, dex: 2, atk: 1 },
    suggestStat: "dex",
  },
];

export function classById(id: ClassId): ClassDef {
  const def = CLASSES.find((c) => c.id === id);
  if (!def) throw new Error(`unknown class ${id}`);
  return def;
}

/** Recruit cost in gold (New Game seeds one of each class free). */
export const RECRUIT_COST = 30;
