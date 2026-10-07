import { describe, expect, it } from "vitest";
import type { ActiveGate, GameState } from "../save";
import { newGame, serialize } from "../save";
import { importSave } from "../saveio";

const clock = () => new Date("2026-10-04T12:00:00Z");

const sampleGate = (party: { id: string; hp: number; sp: number }[]): ActiveGate => ({
  gateId: "hollow-roots",
  runNumber: 1,
  seed: 42,
  modifier: "none",
  floor: 2,
  map: { w: 21, h: 21, cells: "1".repeat(441), entities: [[12, "stairs"]] },
  pos: { x: 3, y: 7 },
  dir: 2,
  visited: [1, 23],
  partyHpSp: party.map((p) => ({ ...p })),
  chests: [{ cell: 500, opened: false }],
  flags: { "shrine-f2": true },
  steps: 7,
  loot: { gold: 12, items: { "potion-hp": 1 } },
});

const okState = () => {
  const s = newGame(clock);
  s.gold = 87;
  return s;
};

/** Serialize, then tamper with the plain JSON object — tests feed hostile codes. */
function tampered(s: GameState, fn: (raw: Record<string, any>) => void): string {
  const raw = JSON.parse(serialize(s)) as Record<string, any>; // named boundary cast for fixture edits
  fn(raw);
  return JSON.stringify(raw);
}

describe("importSave", () => {
  it("round-trips a fresh game unchanged", () => {
    const s = okState();
    const res = importSave(serialize(s));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toEqual(s);
  });

  it("preserves boons and clamps a forged boonQueue to levels earned", () => {
    const s = okState();
    s.party[0].boons = ["iron-vitality", "killer-instinct"];
    s.party[0].boonQueue = 1;
    const kept = importSave(serialize(s));
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.state.party[0].boons).toEqual(["iron-vitality", "killer-instinct"]);
      expect(kept.state.party[0].boonQueue).toBe(1);
    }
    // forged: 999 owed picks and a bogus id on a level-1 hero
    const raw = JSON.parse(serialize(s)) as { party: Record<string, unknown>[] };
    raw.party[0].boons = ["iron-vitality", "not-a-boon"];
    raw.party[0].boonQueue = 999;
    const forged = importSave(JSON.stringify(raw));
    expect(forged.ok).toBe(true);
    if (forged.ok) {
      expect(forged.state.party[0].boons).toEqual(["iron-vitality"]); // unknown id dropped
      expect(forged.state.party[0].boonQueue).toBe(1); // clamped to level 1
    }
  });

  it("keeps a structurally valid active expedition", () => {
    const s = okState();
    s.activeGate = sampleGate(s.party.map((p) => ({ id: p.id, hp: p.hp, sp: p.sp })));
    const res = importSave(serialize(s));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.activeGate?.floor).toBe(2);
  });

  it("rejects an expedition with a bad facing direction", () => {
    const s = okState();
    s.activeGate = sampleGate(s.party.map((p) => ({ id: p.id, hp: p.hp, sp: p.sp })));
    const res = importSave(tampered(s, (r) => (r.activeGate.dir = 9)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/expedition/i);
  });

  it("rejects non-JSON, scalars and arrays with a readable reason", () => {
    for (const junk of ["{not json!!", "42", '"a string"', "[1,2,3]", "", "null"]) {
      const res = importSave(junk);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown save versions", () => {
    const res = importSave(tampered(okState(), (r) => (r.version = 2)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/version/i);
  });

  it("rejects negative gold, empty party and oversized parties", () => {
    const neg = okState();
    neg.gold = -5;
    expect(importSave(serialize(neg)).ok).toBe(false);

    const noParty = okState();
    noParty.party = [];
    expect(importSave(serialize(noParty)).ok).toBe(false);

    const big = okState();
    big.party = big.party.slice(0, 2);
    while (big.party.length < 4) big.party.push({ ...big.party[0], id: `dup-${big.party.length}` });
    expect(importSave(serialize(big)).ok).toBe(true); // 4 is the guild cap — legal
    big.party.push({ ...big.party[0], id: "fifth" });
    expect(importSave(serialize(big)).ok).toBe(false);
  });

  it("merges a legacy v1 code's separate bank reserve into gold", () => {
    const res = importSave(tampered(okState(), (r) => { delete r.gold; r.gold = 80; r.bank = 40; }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.gold).toBe(120);
      expect("bank" in res.state).toBe(false);
    }
  });

  it("rejects a legacy bank that is not a whole non-negative number", () => {
    const res = importSave(tampered(okState(), (r) => (r.bank = -3)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/bank/i);
  });

  it("rejects a hero with an unknown class", () => {
    const res = importSave(tampered(okState(), (r) => (r.party[1].classId = "necromancer")));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/member 2/);
  });

  it("strips unknown top-level keys instead of importing them", () => {
    const code = tampered(okState(), (r) => {
      r.evilFn = "() => steal()";
      r.__extra = { nested: true };
    });
    const res = importSave(code);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.state as unknown as Record<string, unknown>; // whitelist check: junk keys must be gone
      expect(out.evilFn).toBeUndefined();
      expect(out.__extra).toBeUndefined();
    }
  });

  it("defaults missing settings rather than rejecting", () => {
    const code = tampered(okState(), (r) => delete r.settings);
    const res = importSave(code);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.settings.sfxVolume).toBe(0.5);
      expect(res.state.settings.quickBattle).toBe(false);
    }
  });

  it("drops negative inventory counts but keeps valid stacks", () => {
    const s = okState();
    s.inventory["potion-hp"] = 3;
    s.inventory["cursed-thing"] = -2;
    const res = importSave(serialize(s));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.inventory["potion-hp"]).toBe(3);
      expect("cursed-thing" in res.state.inventory).toBe(false);
    }
  });

  it("drops a mid-fight combat stream from another machine", () => {
    const code = tampered(okState(), (r) => (r.activeCombat = { monsters: [], round: 1 }));
    const res = importSave(code);
    expect(res.ok).toBe(true);
    if (res.ok) expect("activeCombat" in res.state).toBe(false);
  });

  it("rejects a malformed day key", () => {
    const s = okState();
    s.dayKey = "yesterday";
    const res = importSave(serialize(s));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/day key/i);
  });
  it("normalizes junk fields on bounty offers instead of trusting them", () => {
    const code = tampered(okState(), (r) => {
      r.bounties.offers[0] = { family: "undead", count: 5, gold: 20, kills: "many", done: "yes", junk: [1] };
    });
    const res = importSave(code);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.bounties.offers[0]).toEqual({ family: "undead", count: 5, gold: 20, kills: 0, done: false });
    }
  });

  it("rejects an offer whose family is not in the bestiary", () => {
    const code = tampered(okState(), (r) => {
      r.bounties.offers[1].family = "dragons";
    });
    expect(importSave(code).ok).toBe(false);
  });
});
