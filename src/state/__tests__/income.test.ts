import { describe, expect, it } from "vitest";
import { startCombat, tallyVictory } from "../../core/combat";
import { rareUnlocked, RARE_UNLOCK_GOLD } from "../../data/items";
import { earn } from "../party";
import { claimVictory } from "../combat";
import { deserialize, emptyChronicle, newGame } from "../save";
import { importSave } from "../saveio";

const clock = () => new Date("2026-10-09T12:00:00Z");

describe("earn — the income chokepoint", () => {
  it("lands coins in the purse and the chronicle career tally together", () => {
    const s = newGame(clock);
    const g0 = s.gold;
    earn(s, 42);
    expect(s.gold).toBe(g0 + 42);
    expect(s.chronicle!.goldEarned).toBe(42);
    earn(s, 7.9); // fractional income floors down
    expect(s.gold).toBe(g0 + 49);
    expect(s.chronicle!.goldEarned).toBe(49);
  });

  it("ignores zero and negative amounts — the tally never shrinks", () => {
    const s = newGame(clock);
    earn(s, -10);
    earn(s, 0);
    expect(s.chronicle!.goldEarned).toBe(0);
  });

  it("victory gold counts toward career earnings through claimVictory", () => {
    const s = newGame(clock);
    s.activeCombat = startCombat(s.party, ["cave-rat"], { seed: 3 });
    for (const f of s.activeCombat.foes) f.hp = 0;
    s.activeCombat.phase = "won";
    s.activeCombat.victory = tallyVictory(s.activeCombat);
    const g0 = s.gold;
    const v = claimVictory(s);
    expect(v).not.toBeNull();
    expect(s.gold).toBe(g0 + v!.gold);
    expect(s.chronicle!.goldEarned).toBe(v!.gold);
  });
});

describe("shop stock tiers", () => {
  it("rare wares unlock exactly at the career-gold threshold", () => {
    expect(rareUnlocked(RARE_UNLOCK_GOLD - 1)).toBe(false);
    expect(rareUnlocked(RARE_UNLOCK_GOLD)).toBe(true);
    expect(rareUnlocked(0)).toBe(false);
  });
});

describe("save compatibility for the new fields", () => {
  it("chronicles without goldEarned migrate to 0 instead of NaN-ing the UI", () => {
    const s = structuredClone(newGame(clock));
    const legacy = { ...s, version: 1, chronicle: { killsByFoe: {}, battlesWon: 2 } }; // predates most deeds too
    const loaded = deserialize(JSON.stringify(legacy))!;
    expect(loaded.chronicle!.goldEarned).toBe(0);
  });

  it("import keeps activeGate.torchKind and clamps a hostile goldEarned", () => {
    const s = newGame(clock);
    s.activeGate = {
      gateId: "hollow-roots",
      runNumber: 1,
      seed: 5,
      modifier: "none",
      floor: 0,
      map: { w: 21, h: 21, cells: "0".repeat(441), entities: [] },
      pos: { x: 1, y: 1 },
      dir: 0,
      visited: [],
      partyHpSp: [],
      chests: [],
      flags: {},
      steps: 0,
      loot: { gold: 0, items: {} },
      torchKind: "witchlight",
    };
    const code = JSON.stringify({ ...s, version: 1 });
    const res = importSave(code);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.activeGate?.torchKind).toBe("witchlight");

    const hostile = JSON.stringify({ ...structuredClone(s), version: 1, chronicle: { ...emptyChronicle(), goldEarned: -999 } });
    const back = importSave(hostile);
    expect(back.ok && back.state.chronicle!.goldEarned).toBe(0); // clamped, never negative
  });
});
