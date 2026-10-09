import { describe, expect, it } from "vitest";
import { BOONS, boonById, boonOffers } from "../../data/boons";
import { xpForNext } from "../../data/progression";
import { applyXpToPc, chooseBoon, critChanceBonus, effectiveStats } from "../party";
import { newGame, pcMax } from "../save";

const clock = () => new Date("2026-10-05T12:00:00Z");

describe("boons", () => {
  it("stack onto effective stats and crit chance", () => {
    const s = newGame(clock);
    const pc = s.party[0];
    const base = effectiveStats(pc);
    const baseCrit = critChanceBonus(pc);
    pc.boons = ["brutal-edge", "stoneflesh", "killer-instinct"];
    const after = effectiveStats(pc);
    expect(after.atk).toBe(base.atk + 1);
    expect(after.def).toBe(base.def + 1);
    expect(after.dex).toBe(base.dex);
    expect(critChanceBonus(pc)).toBeCloseTo(baseCrit + 0.06, 10);
  });

  it("max HP/SP boons raise pcMax", () => {
    const s = newGame(clock);
    const pc = s.party[0];
    const before = pcMax(pc);
    pc.boons = ["iron-vitality", "deep-reserves"];
    expect(pcMax(pc).hp).toBe(before.hp + 3);
    expect(pcMax(pc).sp).toBe(before.sp + 2);
  });

  it("level-ups queue one pick each; choosing spends the queue and heals max-HP boons now", () => {
    const s = newGame(clock);
    const pc = s.party[0];
    applyXpToPc(s, pc.id, xpForNext(pc.level) + xpForNext(pc.level + 1)); // two levels at once
    expect(pc.boonQueue).toBe(2);

    pc.hp = 5;
    expect(chooseBoon(s, pc.id, "iron-vitality")).toBe(true);
    expect(pc.boons).toEqual(["iron-vitality"]);
    expect(pc.boonQueue).toBe(1);
    expect(pc.hp).toBe(Math.min(pcMax(pc).hp, 5 + 3)); // new max includes the boon; heal lands

    expect(chooseBoon(s, pc.id, "swiftfoot")).toBe(true);
    expect(pc.boonQueue).toBe(0);
    expect(chooseBoon(s, pc.id, "stoneflesh")).toBe(false); // nothing owed
    expect(pc.boons).toEqual(["iron-vitality", "swiftfoot"]);
  });

  it("offers are deterministic per hero+held set and never repeat a held boon while fresh ones remain", () => {
    const a = boonOffers("fighter-1", []);
    const b = boonOffers("fighter-1", []);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id)); // reload-safe, no reroll exploit
    expect(new Set(a.map((x) => x.id)).size).toBe(3);
    for (const boon of a) expect(BOONS.some((x) => x.id === boon.id)).toBe(true);

    // greedy pick-everything run: no duplicates until the whole table is held
    const held: string[] = [];
    for (let i = 0; i < BOONS.length; i++) {
      const offers = boonOffers("fighter-1", held);
      const ids = offers.map((x) => x.id);
      expect(new Set(ids).size).toBe(3); // never the same card twice in one offer set
      const freshLeft = BOONS.filter((b) => !held.includes(b.id)).map((b) => b.id);
      if (freshLeft.length > 3) for (const id of ids) expect(held).not.toContain(id); // purely fresh views
      else for (const id of freshLeft) expect(ids).toContain(id); // every remaining new boon is on the table
      const pick = offers.find((o) => !held.includes(o.id)); // a player always has a fresh option
      expect(pick).toBeDefined();
      held.push(pick!.id);
    }
    expect(new Set(held).size).toBe(BOONS.length); // seven distinct perks collected, no stacking

    let differs = false;
    for (const other of ["cleric-2", "mage-3"]) {
      if (boonOffers(other, []).map((x) => x.id).join() !== a.map((x) => x.id).join()) differs = true;
    }
    expect(differs).toBe(true); // heroes don't all see the same three
  });

  it("every table entry is well-formed and resolvable", () => {
    for (const b of BOONS) {
      expect(boonById(b.id).name).toBe(b.name);
      expect(Object.keys(b.bonus).length).toBeGreaterThan(0);
    }
  });
});
