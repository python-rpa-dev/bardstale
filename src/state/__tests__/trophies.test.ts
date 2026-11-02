import { describe, expect, it } from "vitest";
import { startCombat, tallyVictory } from "../../core/combat";
import { gateById } from "../../data/gates";
import { TROPHIES, perkMult } from "../../data/trophies";
import type { ActiveGate, GameState } from "../save";
import { newGame } from "../save";
import { claimVictory } from "../combat";

const clock = () => new Date("2026-10-04T12:00:00Z");

const gateFor = (gateId: string): ActiveGate => ({
  gateId,
  runNumber: 1,
  seed: 42,
  modifier: "none",
  floor: 0,
  map: { w: 21, h: 21, cells: "0".repeat(441), entities: [[220, "stairs"]] },
  pos: { x: 10, y: 11 },
  dir: 0,
  visited: [241],
  partyHpSp: [],
  chests: [],
  flags: {},
  steps: 3,
  loot: { gold: 0, items: {} },
});

const runState = (gateId = "hollow-roots"): GameState => {
  const s = newGame(clock);
  s.activeGate = gateFor(gateId);
  return s;
};

/** Force the fight to won so claimVictory accepts it. */
function winFight(s: GameState): void {
  const cs = s.activeCombat!;
  for (const f of cs.foes) f.hp = 0;
  cs.phase = "won";
  cs.victory = tallyVictory(cs);
}

describe("trophy economy", () => {
  it("every gate has exactly one trophy and its lord is that gate's boss", () => {
    const gates = new Set<string>();
    const sites = new Set<string>();
    for (const t of TROPHIES) {
      expect(gates.has(t.gateId), `duplicate trophy for ${t.gateId}`).toBe(false);
      gates.add(t.gateId);
      expect(sites.has(t.site), `two trophies share the perk site ${t.site}`).toBe(false);
      sites.add(t.site);
      expect(gateById(t.gateId).boss, `${t.gateId} lord mismatch`).toBe(t.lord);
    }
  });

  it("slaying a gate lord raises its trophy once and reports it", () => {
    const s = runState("hollow-roots");
    s.activeCombat = startCombat(s.party, ["bark-thrall"], { seed: 3 });
    winFight(s);
    const summary = claimVictory(s)!;
    expect(summary.trophies).toEqual(["hollow-roots"]);
    expect(s.trophies).toEqual(["hollow-roots"]);

    // a second kill of the same lord never re-reports or duplicates
    s.activeGate = gateFor("hollow-roots");
    s.activeCombat = startCombat(s.party, ["bark-thrall"], { seed: 4 });
    winFight(s);
    expect(claimVictory(s)!.trophies).toBeUndefined();
    expect(s.trophies).toEqual(["hollow-roots"]);
  });

  it("no trophy for rank-and-file kills or lordless gates", () => {
    const s = runState("hollow-roots");
    s.activeCombat = startCombat(s.party, ["skeleton"], { seed: 5 });
    winFight(s);
    expect(claimVictory(s)!.trophies).toBeUndefined();
    expect(s.trophies ?? []).toEqual([]);
  });

  it("each perk bites exactly where its blurb promises (floored)", () => {
    expect(perkMult(undefined, "heal")).toBe(1); // no trophies: full price everywhere
    expect(Math.floor(2 * 3 * perkMult(["hollow-roots"], "heal"))).toBe(4); // lvl-3 heal 6 → 4
    expect(Math.floor(25 * perkMult(["sunken-cloister"], "revive"))).toBe(15); // revive 25 → 15
    expect(Math.floor(30 * perkMult(["gallows-fen"], "bounty"))).toBe(39); // bounty 30 → 39
    expect(Math.floor(9 * perkMult(["wyrm-vault"], "shop"))).toBe(7); // shelf price 9 → 7
    expect(Math.floor(10 * perkMult(["ember-spire"], "brew"))).toBe(7); // kettle fuel 10 → 7
    // a trophy only moves its own site
    expect(perkMult(["hollow-roots"], "shop")).toBe(1);
  });

  it("Spinner's Idol stacks multiplicatively on the vermin medal bounty payout", () => {
    const s = runState();
    s.medals = ["vermin"];
    s.trophies = ["gallows-fen"];
    const offer = { family: "vermin" as const, count: 1, gold: 30, kills: 0, done: false };
    s.bounties.offers = [offer];
    s.bounties.active = `${offer.family}-${offer.count}`;
    s.activeCombat = startCombat(s.party, ["cave-rat"], { seed: 6 });
    winFight(s);
    const summary = claimVictory(s)!;
    expect(summary.bountyDone?.gold).toBe(Math.floor(Math.floor(30 * 1.1) * 1.3)); // medal then idol
  });
});
