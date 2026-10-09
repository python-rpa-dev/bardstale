import { dailySeed, mulberry32 } from "../core/rng";
export type ItemSlot = "weapon" | "armor" | "trinket" | "consumable";
export type Rarity = "common" | "uncommon" | "rare";

/** Equipment bonuses; consumables carry `use` instead. */
export interface ItemDef {
  id: string;
  name: string;
  slot: ItemSlot;
  price: number;
  rarity: Rarity;
  /** Equipped-item stat deltas (weapon/armor/trinket). */
  bonus?: Partial<{ atk: number; def: number; dex: number; mnd: number }>;
  critChanceBonus?: number; // lucky-charm: +6% (fraction)
  use?:
    | { kind: "restore-hp" | "restore-sp" | "combat-atk-buff" | "party-heal"; amount: number }
    | { kind: "light"; amount: number; smoke?: boolean; reveal?: number };
  /** Brewing material (moonpetal): never stocked by merchants, only brewed at the tavern. */
  material?: boolean;
}

export const ITEMS: ItemDef[] = [
  { id: "dagger", name: "Dagger", slot: "weapon", price: 8, rarity: "common", bonus: { atk: 2, dex: 1 } },
  { id: "sword", name: "Sword", slot: "weapon", price: 40, rarity: "common", bonus: { atk: 4 } },
  { id: "axe", name: "Axe", slot: "weapon", price: 70, rarity: "uncommon", bonus: { atk: 6, dex: -1 } },
  { id: "staff", name: "Staff", slot: "weapon", price: 35, rarity: "common", bonus: { atk: 2, mnd: 3 } },
  { id: "leather-armor", name: "Leather Armor", slot: "armor", price: 30, rarity: "common", bonus: { def: 3 } },
  { id: "chain-mail", name: "Chain Mail", slot: "armor", price: 90, rarity: "uncommon", bonus: { def: 6, dex: -1 } },
  { id: "mages-robe", name: "Mage's Robe", slot: "armor", price: 50, rarity: "uncommon", bonus: { def: 2, mnd: 4 } },
  { id: "lucky-charm", name: "Lucky Charm", slot: "trinket", price: 80, rarity: "rare", critChanceBonus: 0.06 },
  { id: "potion-hp", name: "Health Potion", slot: "consumable", price: 30, rarity: "common", use: { kind: "restore-hp", amount: 25 } },
  { id: "potion-sp", name: "Mana Potion", slot: "consumable", price: 40, rarity: "common", use: { kind: "restore-sp", amount: 15 } },
  { id: "elixir-might", name: "Elixir of Might", slot: "consumable", price: 60, rarity: "uncommon", use: { kind: "combat-atk-buff", amount: 4 } },
  { id: "scroll-heal-all", name: "Scroll of Healing", slot: "consumable", price: 70, rarity: "uncommon", use: { kind: "party-heal", amount: 15 } },
  { id: "warhammer", name: "Warhammer", slot: "weapon", price: 85, rarity: "uncommon", bonus: { atk: 5, def: 1 } },
  { id: "crystal-wand", name: "Crystal Wand", slot: "weapon", price: 95, rarity: "uncommon", bonus: { atk: 3, mnd: 5 } },
  { id: "runed-blade", name: "Runed Blade", slot: "weapon", price: 230, rarity: "rare", bonus: { atk: 8, dex: 1 } },
  { id: "bone-scale", name: "Bone Scale", slot: "armor", price: 125, rarity: "uncommon", bonus: { def: 7 } },
  { id: "wyrmscale-mail", name: "Wyrm-Scale Mail", slot: "armor", price: 260, rarity: "rare", bonus: { def: 9, dex: -1 } },
  { id: "ember-sigil", name: "Ember Sigil", slot: "trinket", price: 200, rarity: "rare", bonus: { atk: 2, mnd: 2 } },
  { id: "potion-greater-hp", name: "Greater Health Potion", slot: "consumable", price: 75, rarity: "uncommon", use: { kind: "restore-hp", amount: 60 } },
  { id: "torch", name: "Torch", slot: "consumable", price: 12, rarity: "common", use: { kind: "light", amount: 40 } },
  { id: "tallow-torch", name: "Tallow Torch", slot: "consumable", price: 26, rarity: "common", use: { kind: "light", amount: 60, smoke: true } },
  { id: "witchlight", name: "Witchlight", slot: "consumable", price: 34, rarity: "uncommon", use: { kind: "light", amount: 45, reveal: 2 } },
  { id: "moonpetal", name: "Moonpetal Sprig", slot: "consumable", price: 8, rarity: "common", material: true },
];

/** Career gold (chronicle) the merchant requires before stocking rare wares. Pure for tests. */
export const RARE_UNLOCK_GOLD = 300;
export function rareUnlocked(goldEarned: number): boolean {
  return goldEarned >= RARE_UNLOCK_GOLD;
}

/** Hearth Kitchen recipe: gathered herbs + coin brewed into one potion at the tavern. */
export interface Recipe {
  out: string; // potion item id
  herbs: number; // moonpetal sprigs consumed
  gold: number; // kettle fuel
}

/** Brewing beats buying — that is the whole point of carrying sprigs back up. */
export const RECIPES: Recipe[] = [
  { out: "potion-hp", herbs: 2, gold: 10 }, // buys for 30
  { out: "potion-sp", herbs: 3, gold: 15 }, // buys for 40
];

/** Two merchants who despise each other share the street; every dawn they roll out overlapping but different carts. */
export const STALLS = [
  { id: "mira", name: "Mira's Wares", tagline: "Best prices in town — ask Bram why." },
  { id: "bram", name: "Bram & Sons", tagline: "Old forge, honest steel, cheaper than *her*." },
] as const;

/** Price cut on goods the rival merchant does not carry today. */
export const RIVALRY_DISCOUNT = 0.25;

const STALL_SHARE = 0.7; // each cart holds ~70% of the catalogue, so the two carts always cover it all

/**
 * Daily cart contents: shuffle the catalogue with mulberry32(dailySeed(dayKey)), then stall 0 takes
 * the first ceil(70%) and stall 1 the last ceil(70%). The overlap is full-price goods; both ends
 * are exclusives. Pure — nothing to persist, save-compatible by construction.
 */
export function stallStock(dayKey: string, stallIndex: number): ItemDef[] {
  const pool = ITEMS.filter((it) => !it.material); // brewing herbs are never sold — shrines grow them
  const rnd = mulberry32(dailySeed(dayKey));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const take = Math.ceil(pool.length * STALL_SHARE);
  return stallIndex === 0 ? pool.slice(0, take) : pool.slice(pool.length - take);
}

/** Exclusive goods (absent from the rival's cart today) carry the rivalry discount. */
export function stallPrice(def: ItemDef, rivalStock: readonly ItemDef[]): number {
  if (rivalStock.some((d) => d.id === def.id)) return def.price;
  return Math.max(1, Math.round(def.price * (1 - RIVALRY_DISCOUNT)));
}

export function itemById(id: string): ItemDef {
  const def = ITEMS.find((i) => i.id === id);
  if (!def) throw new Error(`unknown item ${id}`);
  return def;
}

/** Salvage buys at half of base price — rivalry discounts never apply to selling. */
export function sellPrice(def: ItemDef): number {
  return Math.floor(def.price / 2);
}
