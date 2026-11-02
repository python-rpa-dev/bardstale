import { describe, expect, it } from "vitest";
import { RECIPES } from "../../data/items";
import { newGame } from "../save";
import { brewPotion } from "../tavern";

describe("brewPotion - the tavern hearth kitchen", () => {
  const r = RECIPES[0]!; // potion-hp: 2 sprigs + 10 g

  it("trades herbs and gold for one bottled potion", () => {
    const s = newGame();
    s.gold = 50;
    s.inventory[r.out] = 0; // start from an empty bottle shelf regardless of the starting kit
    s.inventory.moonpetal = r.herbs;
    expect(brewPotion(s, r.out)).toBe(true);
    expect(s.gold).toBe(50 - r.gold);
    expect(s.inventory.moonpetal).toBe(0);
    expect(s.inventory[r.out]).toBe(1); // bottled goods join the pack like bought ones
  });

  it("refuses without herbs, gold, or a known recipe — and changes nothing", () => {
    const s = newGame();
    s.gold = 99;
    s.inventory[r.out] = 0; // the starting kit must not mask a phantom brew
    s.inventory.moonpetal = 0;
    expect(brewPotion(s, r.out)).toBe(false); // no sprigs in the pack
    expect(brewPotion(s, "moonpetal")).toBe(false); // raw herbs are not a recipe output
    expect(brewPotion(s, "no-such-potion")).toBe(false); // unknown recipe
    expect(s.gold).toBe(99);
    expect(s.inventory[r.out] ?? 0).toBe(0);
  });

  it("stacks bottles on top of existing stock", () => {
    const s = newGame();
    s.gold = 100;
    s.inventory.moonpetal = r.herbs * 2;
    s.inventory[r.out] = 3;
    expect(brewPotion(s, r.out)).toBe(true);
    expect(s.inventory[r.out]).toBe(4);
    expect(s.inventory.moonpetal).toBe(r.herbs); // enough for one more brew
    expect(brewPotion(s, r.out)).toBe(true);
    expect(s.inventory[r.out]).toBe(5);
  });
});
