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
  use?: { kind: "restore-hp" | "restore-sp" | "combat-atk-buff" | "party-heal" | "light"; amount: number };
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
];

export function itemById(id: string): ItemDef {
  const def = ITEMS.find((i) => i.id === id);
  if (!def) throw new Error(`unknown item ${id}`);
  return def;
}

/** Shop stock is the full table; sell price is half. */
export function sellPrice(def: ItemDef): number {
  return Math.floor(def.price / 2);
}
