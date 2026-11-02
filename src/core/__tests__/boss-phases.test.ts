import { describe, expect, it } from "vitest";
import { foeAct, startCombat } from "../combat";
import { makePc } from "../../state/save";

const party = () => [makePc("fighter", 0), makePc("cleric", 1)];
const bossFight = (mid: string, seed: number) => startCombat(party(), [mid], { seed, boss: true });

describe("gate-lord phase cycle", () => {
  it("the lord rears back on round 3 harmlessly, then Root Grasp seizes every hero", () => {
    const cs = bossFight("bark-thrall", 7);
    cs.round = 3;
    const before = cs.pcs.map((p) => p.hp);
    foeAct(cs, 0);
    expect(cs.foes[0].telegraph).toBe(true);
    expect(cs.pcs.map((p) => p.hp)).toEqual(before); // the rear-up itself draws no blood

    foeAct(cs, 0); // its next action unleashes — no dodge roll exists for a telegraphed AoE
    expect(cs.foes[0].telegraph).toBe(false);
    cs.pcs.forEach((p, i) => expect(p.hp).toBeLessThan(before[i]));
  });

  it("Death Rime drains one hero and the lich drinks half the damage back", () => {
    const cs = bossFight("cloister-lich", 3);
    cs.round = 3;
    foeAct(cs, 0); // telegraph
    expect(cs.foes[0].telegraph).toBe(true);
    for (const p of cs.pcs) p.hp = 150; // survive the hit so lost HP equals damage dealt
    cs.foes[0].hp = 10; // wounded lord so the heal is visible below its cap
    const before = cs.pcs.map((p) => p.hp);
    foeAct(cs, 0);
    const dealt = before.reduce((sum, hp, i) => sum + (hp - cs.pcs[i].hp), 0);
    expect(dealt).toBeGreaterThan(0); // single-target special: only one hero bleeds
    expect(before.filter((hp, i) => cs.pcs[i].hp < hp).length).toBe(1);
    expect(cs.foes[0].hp).toBe(10 + Math.floor(dealt / 2));
  });

  it("Brood Cry sprays every hero and leaves them poisoned", () => {
    const cs = bossFight("fen-matriarch", 4);
    cs.round = 3;
    foeAct(cs, 0); // telegraph
    expect(cs.foes[0].telegraph).toBe(true);
    for (const p of cs.pcs) p.hp = 150; // survive the spray so marks are checkable
    const before = cs.pcs.map((p) => p.hp);
    foeAct(cs, 0);
    cs.pcs.forEach((p, i) => {
      expect(p.hp).toBeLessThan(before[i]);
      expect(p.statuses.some((s) => s.kind === "poison")).toBe(true);
    });
  });

  it("Guard halves a telegraphed special", () => {
    const guard = bossFight("bark-thrall", 7);
    guard.round = 3;
    foeAct(guard, 0); // rear-up
    for (const p of guard.pcs) p.guard = true;
    const before = guard.pcs.map((p) => p.hp);
    foeAct(guard, 0);
    const guardedDmg = before.map((hp, i) => hp - guard.pcs[i].hp);

    const raw = bossFight("bark-thrall", 7); // same seed: identical specials without Guard
    raw.round = 3;
    foeAct(raw, 0);
    const beforeRaw = raw.pcs.map((p) => p.hp);
    foeAct(raw, 0);
    const rawDmg = beforeRaw.map((hp, i) => hp - raw.pcs[i].hp);

    expect(guardedDmg.every((d, i) => d <= Math.ceil(rawDmg[i] / 2))).toBe(true);
    expect(rawDmg.some((d) => d > 1)).toBe(true); // the specials actually bite unguarded
  });

  it("rank-and-file monsters never telegraph", () => {
    const cs = startCombat(party(), ["skeleton"], { seed: 2 });
    cs.round = 3;
    for (let i = 0; i < 4 && cs.phase === "input" && cs.foes[0].hp > 0; i++) foeAct(cs, 0);
    expect(cs.foes[0].telegraph).toBeUndefined();
  });

  it("the vault-wyrm answers the cadence with fire, not a rear-up", () => {
    const cs = bossFight("vault-wyrm", 6);
    cs.round = 3;
    foeAct(cs, 0);
    expect(cs.foes[0].telegraph).toBeUndefined(); // breath is its signature — no double special
    expect(cs.foes[0].lastBreathRound).toBe(3);
  });
});
