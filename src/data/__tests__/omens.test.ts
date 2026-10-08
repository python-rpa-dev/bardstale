import { describe, expect, it } from "vitest";
import { MODIFIERS, modifierForGate, omensFor } from "../modifiers";
import { gateIndex } from "../gates";
import { newGame } from "../../state/save";
import { startExpedition } from "../../state/expedition";

describe("omensFor (gate-entry omen draft)", () => {
  it("deals three distinct cards with today's ambient sign leading the hand", () => {
    for (let gate = 0; gate < 3; gate++) {
      const hand = omensFor(gate, 7315, 1);
      expect(hand.length).toBe(3);
      expect(hand[0].id).toBe(modifierForGate(gate, 7315).id); // the tavern rumor promised it
      expect(new Set(hand.map((m) => m.id)).size).toBe(3);
    }
  });

  it("is deterministic per (day, gate, run) and varies across runs", () => {
    const a = omensFor(1, 7315, 2).map((m) => m.id);
    expect(omensFor(1, 7315, 2).map((m) => m.id)).toEqual(a);
    const hands = new Set<string>();
    for (let run = 1; run <= 12; run++) hands.add(omensFor(0, 7315, run).map((m) => m.id).join(","));
    expect(hands.size).toBeGreaterThan(1);
  });

  it("only Fair Weather may repeat as a card — real omens never do", () => {
    for (let day = 7300; day < 7340; day++) {
      for (let gate = 0; gate < 3; gate++) {
        const hand = omensFor(gate, day, 1);
        expect(hand.filter((m) => m.id === "none").length).toBeLessThanOrEqual(1);
        expect(hand.every((m) => MODIFIERS.some((d) => d.id === m.id))).toBe(true);
      }
    }
  });

  it("startExpedition carries the chosen omen; omitting it falls back to ambient", () => {
    const bound = newGame();
    startExpedition(bound, "hollow-roots", "cursed");
    expect(bound.activeGate!.modifier).toBe("cursed");

    const unbound = newGame();
    startExpedition(unbound, "hollow-roots");
    expect(unbound.activeGate!.modifier).toBe(modifierForGate(gateIndex("hollow-roots"), Math.floor(Date.now() / 86400000)).id);
  });
});
