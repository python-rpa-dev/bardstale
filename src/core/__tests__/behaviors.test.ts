import { describe, expect, it } from "vitest";
import { captainAura, foeAct, quickResolve, startCombat, tryFlee } from "../combat";
import { makePc } from "../../state/save";
import { monsterById } from "../../data/bestiary";

const party = () => [makePc("fighter", 0), makePc("cleric", 1)];
const ratThreshold = Math.ceil(0.25 * monsterById("cave-rat").hp); // 8 HP → routs at ≤ 2

describe("foe behaviors", () => {
  it("vermin rout at the HP threshold and stand above it", () => {
    const low = startCombat(party(), ["cave-rat"], { seed: 5 });
    low.foes[0].hp = ratThreshold; // exactly at the break point
    foeAct(low, 0);
    expect(low.foes[0].fled).toBe(true);

    const high = startCombat(party(), ["cave-rat"], { seed: 5 });
    high.foes[0].hp = ratThreshold + 1; // one above → fights on
    foeAct(high, 0);
    expect(high.foes[0].fled).toBeUndefined();
  });

  it("a routed vermin pays half XP and no gold", () => {
    const cs = startCombat(party(), ["cave-rat"], { seed: 9 });
    cs.foes[0].hp = ratThreshold;
    foeAct(cs, 0);
    expect(cs.phase).toBe("won"); // driving every foe off still wins the fight
    const t = cs.victory!;
    expect(t.gold).toBe(0); // the purse escapes with the rat
    for (const p of cs.pcs) {
      // lvl-1 rat vs level-1 PCs: tax mult 1 → half of its 6 XP
      expect(t.xpByPc[p.id]).toBe(Math.round(6 * 0.5));
    }
  });

  it("guard-lock: the dead bar every escape attempt, deterministically", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const cs = startCombat(party(), ["skeleton"], { seed });
      expect(tryFlee(cs).escaped).toBe(false);
      expect(cs.phase).toBe("input"); // the failed attempt only costs initiative
    }
    const cs = startCombat(party(), ["skeleton"], { seed: 1 });
    tryFlee(cs);
    expect(cs.log.some((l) => /bar the way/.test(l))).toBe(true);
  });

  it("without a guardian, escape remains possible (guard-lock control)", () => {
    let anyEscape = false;
    for (let seed = 0; seed < 30 && !anyEscape; seed++) {
      const cs = startCombat(party(), ["goblin"], { seed });
      if (tryFlee(cs).escaped) anyEscape = true;
    }
    expect(anyEscape).toBe(true);
  });

  it("captain aura comes from living allied captains only, never self", () => {
    const solo = startCombat(party(), ["orc-raider"], { seed: 4 });
    expect(captainAura(solo, 0)).toBe(0); // no allies → no rally, even for a captain itself

    const pack = startCombat(party(), ["orc-raider", "goblin"], { seed: 4 });
    expect(captainAura(pack, 0)).toBeCloseTo(0.1, 10); // the goblin rallies the orc
    expect(captainAura(pack, 1)).toBeCloseTo(0.15, 10); // the orc rallies the goblin harder
    pack.foes[1].hp = 0; // down goes the goblin
    expect(captainAura(pack, 0)).toBe(0);
  });

  it("the rally aura rides on actual foe damage", () => {
    // same seed → identical hit/damage/crit draws; only the aura factor differs
    let found = false;
    for (let seed = 0; seed < 60 && !found; seed++) {
      const solo = startCombat(party(), ["orc-raider"], { seed });
      const pack = startCombat(party(), ["orc-raider", "goblin"], { seed });
      const a = foeAct(solo, 0).find((e) => e.kind === "hit" || e.kind === "crit");
      const b = foeAct(pack, 0).find((e) => e.kind === "hit" || e.kind === "crit");
      if (a && b && (a.amount ?? 0) >= 2) {
        expect(b.amount ?? 0).toBeGreaterThan(a.amount ?? 0); // ×1.1 goblin rally beats the same roll unbuffed
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("quickResolve terminates cleanly when every foe routs", () => {
    const cs = startCombat(party(), ["cave-rat", "cave-rat"], { seed: 21 });
    quickResolve(cs); // PCs auto-attack; cornered rats break below threshold
    expect(["won", "lost"]).toContain(cs.phase); // no stalemate, no infinite loop
  });
});
