import { describe, expect, it } from "vitest";
import {
  attackHitChance,
  BLIND_PENALTY,
  BURN_DMG,
  foeAct,
  hitChance,
  pcAttack,
  startCombat,
  type CombatState,
} from "../combat";
import { makePc } from "../../state/save";
import { claimVictory } from "../../state/combat";
import { newGame } from "../../state/save";
import { startExpedition } from "../../state/expedition";

const party = () => [makePc("fighter", 0), makePc("cleric", 1)];

/** Advance exactly one unit of the turn order, returning its events. */
function driveTurn(cs: CombatState) {
  const [side, idx] = cs.order[cs.turnPtr];
  if (side !== "pc") return foeAct(cs, idx);
  const target = cs.foes.findIndex((f) => f.hp > 0); // PCs always swing at the first living foe
  return pcAttack(cs, idx, target === -1 ? 0 : target);
}

describe("attackHitChance (blind penalty)", () => {
  it("equals the raw formula unmarked, minus exactly BLIND_PENALTY when blind", () => {
    const base = hitChance(12, 8, 5, 5);
    expect(attackHitChance(12, 8, 5, 5, [])).toBe(base);
    expect(attackHitChance(12, 8, 5, 5, [{ kind: "blind", roundsLeft: 2 }])).toBeCloseTo(base - BLIND_PENALTY, 10);
  });

  it("keeps a floor of hope for hopeless odds", () => {
    for (let dDex = 30; dDex <= 45; dDex++) {
      expect(attackHitChance(3, dDex, 1, 20, [{ kind: "blind", roundsLeft: 1 }])).toBeGreaterThanOrEqual(0.05);
    }
  });
});

describe("ash-wight blind gaze", () => {
  it("a damaging hit lands a 3-round mark; refreshes never stack", () => {
    const cs = startCombat(party(), ["ash-wight"], { seed: 3 });
    for (const p of cs.pcs) p.hp = 999; // keep the fight alive while we fish for hits

    let appliedRounds = 0;
    for (let i = 0; i < 80 && !appliedRounds; i++) {
      const evs = foeAct(cs, 0);
      const blindEv = evs.find((e) => e.kind === "status" && e.text === "blind");
      if (blindEv?.dst?.[0] === "pc") appliedRounds = cs.pcs[blindEv.dst[1]].statuses.find((s) => s.kind === "blind")!.roundsLeft;
    }
    expect(appliedRounds).toBeGreaterThanOrEqual(2); // stamped at 3, at most one round-end tick since

    const target = cs.pcs.find((p) => p.statuses.some((s) => s.kind === "blind"))!;
    // force a refresh: drop to 1 round, then fish for the next gaze hit
    target.statuses = [{ kind: "blind", roundsLeft: 1 }];
    let refreshed = false;
    for (let i = 0; i < 80 && !refreshed; i++) {
      const evs = foeAct(cs, 0);
      if (evs.some((e) => e.kind === "status" && e.text === "blind")) refreshed = true;
    }
    expect(refreshed).toBe(true);
    const marks = target.statuses.filter((s) => s.kind === "blind");
    expect(marks.length).toBe(1); // refresh extends, never stacks
    expect(marks[0].roundsLeft).toBeGreaterThanOrEqual(2);
  });
});

describe("burning breath", () => {
  it("breath sets a fresh burn on every living PC and announces it once", () => {
    const cs = startCombat(party(), ["vault-wyrm"], { seed: 11, boss: true });
    for (const p of cs.pcs) p.hp = 999;
    cs.round = 3; // everyRounds = 3 — the cadence round (same setup as the breath test in expedition.test)
    const evs = foeAct(cs, 0);
    expect(evs.filter((e) => e.kind === "breath").length).toBe(2);
    for (const p of cs.pcs) {
      expect(p.statuses.some((s) => s.kind === "burn")).toBe(true);
    }
    expect(cs.log.some((l) => l.includes("is burning!"))).toBe(true);
  });

  it("end of round sears each burning hero for BURN_DMG", () => {
    const cs = startCombat(party(), ["vault-wyrm"], { seed: 7, boss: true }); // a foe that survives to see round 2
    for (const p of cs.pcs) p.hp = 999;
    cs.pcs[0].statuses.push({ kind: "burn", roundsLeft: 2 });
    let sawSear = false;
    let sawLogLine = false;
    for (let guard = 0; guard < 60 && !sawSear && cs.phase === "input"; guard++) {
      const evs = driveTurn(cs);
      if (evs.some((e) => e.kind === "hit" && e.dst?.[0] === "pc" && e.amount === BURN_DMG)) {
        sawSear = true;
        sawLogLine = cs.log.some((l) => l.includes("flames sear")); // check now — the log ring buffer evicts old lines
      }
    }
    expect(sawSear).toBe(true);
    expect(sawLogLine).toBe(true);
  });

  it("a full wipe to burn damage loses the fight with a 'succumbs' line", () => {
    const cs = startCombat(party(), ["vault-wyrm"], { seed: 7, boss: true }); // too beefy for the PCs to end early
    for (const p of cs.pcs) {
      p.hp = BURN_DMG; // the next tick kills them all
      p.statuses.push({ kind: "burn", roundsLeft: 1 });
    }
    cs.order = [
      ["pc", 0],
      ["pc", 1],
    ]; // isolate the round-end from the wyrm's fangs
    cs.turnPtr = 0;
    driveTurn(cs);
    const evs = driveTurn(cs); // ptr wraps here → endOfRound burns both down
    expect(evs.some((e) => e.kind === "death" && e.dst?.[0] === "pc")).toBe(true);
    expect(cs.phase).toBe("lost");
    expect(cs.log.filter((l) => l.includes("succumbs to the burns")).length).toBe(2);
  });
});

describe("deed ledger (bestHit / crits)", () => {
  it("tracks the biggest PC hit and crit count across a whole fight", () => {
    const cs = startCombat(party(), ["goblin", "goblin"], { seed: 13 });
    let maxSeen = 0;
    let critSeen = 0;
    for (let guard = 0; guard < 200 && cs.phase === "input"; guard++) {
      for (const e of driveTurn(cs)) {
        if ((e.kind === "hit" || e.kind === "crit") && e.dst?.[0] === "foe") {
          maxSeen = Math.max(maxSeen, e.amount ?? 0);
          if (e.kind === "crit") critSeen++;
        }
      }
    }
    expect(cs.phase).toBe("won");
    expect(cs.bestHit).toBe(maxSeen);
    expect(cs.crits).toBe(critSeen);
  });

  it("claimVictory syncs the ledger to the chronicle, keeping the lifetime max", () => {
    const s = newGame();
    startExpedition(s, "hollow-roots");
    s.activeCombat = startCombat(s.party, ["cave-rat"], { seed: 9 });
    for (let guard = 0; guard < 120 && s.activeCombat.phase === "input"; guard++) driveTurn(s.activeCombat);
    const cs = s.activeCombat;
    expect(cs.phase).toBe("won");
    expect(cs.bestHit).toBeGreaterThan(0);

    claimVictory(s);
    expect(s.chronicle!.bestHit).toBe(cs.bestHit!);
    expect(s.chronicle!.crits).toBe(cs.crits ?? 0);

    // a weaker second victory must not lower the record, but crits still add up
    s.activeCombat = startCombat(s.party, ["cave-rat"], { seed: 9 });
    for (let guard = 0; guard < 120 && s.activeCombat.phase === "input"; guard++) driveTurn(s.activeCombat);
    expect(s.activeCombat.phase).toBe("won"); // claimVictory needs the real victory tally
    s.activeCombat.bestHit = 1;
    s.activeCombat.crits = 4;
    claimVictory(s);
    expect(s.chronicle!.bestHit).toBe(cs.bestHit!);
    expect(s.chronicle!.crits).toBe((cs.crits ?? 0) + 4);
  });
});
