import { RECIPES } from "../data/items";
import type { GameState } from "./save";
import { perkMult } from "../data/trophies";

/** Coin the kettle asks for, after Ashbrand's brewing discount. */
export function brewCoinFor(s: GameState, recipeGold: number): number {
  return Math.floor(recipeGold * perkMult(s.trophies, "brew"));
}

/** Hearth Kitchen brewing: moonpetal sprigs + coin for one bottled potion. False when the recipe is unknown or materials fall short. */
export function brewPotion(s: GameState, outId: string): boolean {
  const r = RECIPES.find((x) => x.out === outId);
  if (!r || s.gold < brewCoinFor(s, r.gold) || (s.inventory.moonpetal ?? 0) < r.herbs) return false;
  s.gold -= brewCoinFor(s, r.gold);
  s.inventory.moonpetal = (s.inventory.moonpetal ?? 0) - r.herbs;
  s.inventory[outId] = (s.inventory[outId] ?? 0) + 1; // bottled goods join the pack like bought ones
  return true;
}
