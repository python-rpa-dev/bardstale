import { describe, expect, it } from "vitest";
import { expeditionSeed, hashStr, mulberry32 } from "../rng";
import { xpForNext, xpMult, xpTaxWarn } from "../../data/progression";
import { MODIFIERS, modifierForGate } from "../../data/modifiers";

describe("progression", () => {
  it("xpForNext(1) = 50", () => {
    expect(xpForNext(1)).toBe(50);
  });

  it("xpMult floors at 0.05 for trivially weak foes", () => {
    expect(xpMult(2, 10)).toBe(0.05);
  });

  it("xpMult rewards tougher foes up to 1.5x cap", () => {
    expect(Math.round(xpMult(13, 10) * 100)).toBe(124); // 1 + 0.08*3 = 1.24
    expect(xpMult(99, 1)).toBe(1.5);
  });

  it("tax warning fires below 0.5x", () => {
    expect(xpTaxWarn(6, 10)).toBe(true); // 1 - 0.15*4 = 0.4 < 0.5 → warn
    expect(xpTaxWarn(7, 10)).toBe(false); // 0.55 ≥ 0.5 → no warn
  });
});

describe("rng", () => {
  it("mulberry32 is deterministic for seed 42 (first value stable across runs)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    // Pinned first output of mulberry32(42).
    expect(mulberry32(42)()).toBeCloseTo(0.6011037519201636, 15);
  });

  it("hashStr is FNV-1a (empty string = offset basis)", () => {
    expect(hashStr("")).toBe(2166136261);
  });

  it("expeditionSeed is stable per save/gate/run", () => {
    const s1 = expeditionSeed("abc", "hollow-roots", 1);
    expect(expeditionSeed("abc", "hollow-roots", 1)).toBe(s1);
    expect(expeditionSeed("abc", "hollow-roots", 2)).not.toBe(s1);
  });
});

describe("modifier rotation", () => {
  it("gate 0 walks the ordered list as dayNumber advances", () => {
    for (let d = 0; d < MODIFIERS.length; d++) {
      expect(modifierForGate(0, d).id).toBe(MODIFIERS[d].id);
    }
  });

  it("gate index shifts the rotation by one per gate", () => {
    const day = 12345; // arbitrary epoch day
    for (let g = 0; g < 6; g++) {
      expect(modifierForGate(g, day).id).toBe(MODIFIERS[(day + g) % MODIFIERS.length].id);
    }
  });
});
