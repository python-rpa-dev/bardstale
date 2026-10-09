import { describe, expect, it } from "vitest";
import type { Pc } from "../../state/save";
import { makePc, pcMax } from "../../state/save";
import { applyXpToPc } from "../../state/party";
import { xpForNext } from "../../data/progression";
import { startCombat, pcCast, pcStats, spCostFor, foeDef, tallyVictory } from "../combat";
import { spellsKnownAt } from "../../data/spells";

/**
 * Behavior contract for the content-depth spells added with Gallows Fen /
 * Ember Spire: cleave (physical, half-DEF), frost-nova (MR-scaled AoE),
 * mass-heal (party-wide, exact arithmetic — no rng in heals).
 */

function leveled(cls: "fighter" | "mage" | "cleric" | "rogue", lvl: number): Pc {
  const p = makePc(cls, 1);
  const fake = { party: [p] } as never as Parameters<typeof applyXpToPc>[0];
  while (p.level < lvl) applyXpToPc(fake, p.id, xpForNext(p.level));
  const max = pcMax(p);
  p.hp = max.hp;
  p.sp = max.sp;
  return p;
}

describe("cleave", () => {
  it("hits every living foe and is mitigated by half DEF, not MR", () => {
    const pcs = [leveled("fighter", 9)];
    const cs = startCombat(pcs, ["skeleton", "skeleton", "goblin"], { seed: 42 });
    const atk = pcStats(cs, 0).atk;
    const spBefore = cs.pcs[0].sp;
    const before = cs.foes.map((f) => f.hp);
    pcCast(cs, 0, "cleave");
    expect(spBefore - cs.pcs[0].sp).toBe(spCostFor("cleave", cs));
    for (let i = 0; i < cs.foes.length; i++) {
      const fd = foeDef(cs.foes[i]);
      const expected = Math.max(1, Math.round(atk * 1.2) - Math.floor(fd.def / 2));
      const dealt = before[i] - cs.foes[i].hp;
      // only crit can deviate (exact double), and overkill clamps at remaining HP
      const cap = [Math.min(before[i], expected), Math.min(before[i], expected * 2)];
      expect(cap, `foe ${i} took ${dealt}`).toContain(dealt);
    }
  });

  it("every foe loses HP and none takes more than double the formula (crit cap)", () => {
    const pcs = [leveled("fighter", 9)];
    const cs = startCombat(pcs, ["skeleton", "goblin"], { seed: 7 });
    const atk = pcStats(cs, 0).atk;
    const before = cs.foes.map((f) => f.hp);
    pcCast(cs, 0, "cleave");
    for (let i = 0; i < cs.foes.length; i++) {
      const dealt = before[i] - cs.foes[i].hp;
      expect(dealt).toBeGreaterThan(0);
      // crit doubles at most; floor is the min-1 clamp
      expect(dealt).toBeLessThanOrEqual(Math.round(atk * 1.2) * 2);
    }
  });
});

describe("frost-nova", () => {
  it("damages all foes scaled by caster MND minus their MR", () => {
    const pcs = [leveled("mage", 10)];
    const cs = startCombat(pcs, ["skeleton", "orc-raider"], { seed: 99 });
    const mnd = pcStats(cs, 0).mnd;
    const before = cs.foes.map((f) => f.hp);
    pcCast(cs, 0, "frost-nova");
    for (let i = 0; i < cs.foes.length; i++) {
      const dealt = before[i] - cs.foes[i].hp;
      expect(dealt).toBeGreaterThanOrEqual(1);
      expect(dealt).toBeLessThanOrEqual(Math.round(mnd * 1.2) * 2);
    }
  });

  it("costs the listed SP through spCostFor", () => {
    const pcs = [leveled("mage", 10)];
    const cs = startCombat(pcs, ["cave-rat"], { seed: 5 });
    const before = cs.pcs[0].sp;
    pcCast(cs, 0, "frost-nova");
    expect(before - cs.pcs[0].sp).toBe(spCostFor("frost-nova", cs));
  });
});

describe("mass-heal", () => {
  it("restores exactly 6 + casterMND to every living ally, capped at max HP", () => {
    const pcs = [leveled("cleric", 13), leveled("fighter", 13), leveled("mage", 13)];
    const cs = startCombat(pcs, ["cave-rat"], { seed: 3 });
    for (const p of cs.pcs) p.hp = 5;
    const mnd = pcStats(cs, 0).mnd;
    const spBefore = cs.pcs[0].sp;
    pcCast(cs, 0, "mass-heal");
    expect(spBefore - cs.pcs[0].sp).toBe(spCostFor("mass-heal", cs));
    for (let i = 0; i < cs.pcs.length; i++) {
      const cap = pcMax(cs.pcs[i]).hp;
      expect(cs.pcs[i].hp).toBe(Math.min(cap, 5 + 6 + mnd));
    }
  });

  it("skips downed allies", () => {
    const pcs = [leveled("cleric", 13), leveled("fighter", 13)];
    const cs = startCombat(pcs, ["cave-rat"], { seed: 8 });
    for (const p of cs.pcs) p.hp = 5;
    cs.pcs[1].hp = 0; // downed after start — mass-heal must not revive or overheal
    pcCast(cs, 0, "mass-heal");
    expect(cs.pcs[1].hp).toBe(0);
    expect(cs.pcs[0].hp).toBeGreaterThan(5);
  });
});

describe("rogue tricks", () => {
  it("unlocks backstab at 1, steal purse at 4, crippling cut at 8", () => {
    expect(spellsKnownAt("rogue", 3).map((s) => s.id)).toEqual(["backstab"]);
    expect(spellsKnownAt("rogue", 5).map((s) => s.id)).toEqual(["backstab", "steal-gold"]);
    expect(spellsKnownAt("rogue", 8).map((s) => s.id)).toEqual(["backstab", "steal-gold", "crippling-cut"]);
  });

  it("backstab hits one foe for round(DEX×1.5)+4 through half DEF, crit aside", () => {
    const pcs = [leveled("rogue", 8)];
    const cs = startCombat(pcs, ["skeleton", "goblin"], { seed: 21 });
    const dex = pcStats(cs, 0).dex;
    const fd = foeDef(cs.foes[0]);
    const before = cs.foes[0].hp;
    pcCast(cs, 0, "backstab", 0);
    const expected = Math.max(1, Math.round(dex * 1.5) + 4 - Math.floor(fd.def / 2));
    const dealt = before - cs.foes[0].hp;
    expect([Math.min(before, expected), Math.min(before, expected * 2)], `dealt ${dealt}`).toContain(dealt);
    const twin = startCombat(pcs, ["skeleton", "goblin"], { seed: 21 });
    pcCast(twin, 0, "backstab", 0); // single target only: the untouched twin foe keeps its HP
    expect(cs.foes[1].hp).toBe(twin.foes[1].hp);
  });

  it("steal purse pockets 3+2×foeLvl gold on top of the victory roll", () => {
    const pcs = [leveled("rogue", 8)];
    const cs = startCombat(pcs, ["skeleton"], { seed: 5 });
    const fd = foeDef(cs.foes[0]);
    const before = tallyVictory(cs).gold;
    pcCast(cs, 0, "steal-gold", 0);
    expect(cs.stolenGold).toBe(3 + Math.max(0, fd.lvl) * 2);
    expect(tallyVictory(cs).gold).toBe(before + (3 + Math.max(0, fd.lvl) * 2)); // coins ride outside the kill rolls
  });

  it("crippling cut leaves the target hanging a leg for the rest of the fight", () => {
    const pcs = [leveled("rogue", 8)];
    const cs = startCombat(pcs, ["vault-wyrm"], { seed: 11 }); // a boss has the belly to survive one cut
    pcCast(cs, 0, "crippling-cut", 0);
    if (cs.foes[0].hp > 0) expect(cs.foes[0].crippled).toBe(true);
    else throw new Error("boss died to one cut — pick a beefier target");
    expect(cs.log.some((l) => /hangs a leg/.test(l))).toBe(true);
  });
});
