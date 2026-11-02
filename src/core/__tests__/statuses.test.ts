import { describe, expect, it } from "vitest";
import {
  attackHitChance,
  BLIND_PENALTY,
  BURN_DMG,
  foeAct,
  focusCritBonus,
  hitChance,
  OMEN_DMG_MULT,
  pcAttack,
  pcCast,
  startCombat,
  WOUND_DMG_PER_STACK,
  type CombatState,
} from "../combat";
import {
  addStacks,
  clearAilments,
  clearStacks,
  FOCUS_MAX,
  makePc,
  restWoundDecay,
  stackOf,
  WOUND_MAX,
  type StatusMark,
} from "../../state/save";
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

// ---------- C1: wound / focus / omen-mark ----------

const w = (stacks: number): StatusMark => ({ kind: "wound", roundsLeft: stacks });
const fx = (stacks: number): StatusMark => ({ kind: "focus", roundsLeft: stacks });

describe("wound stack math (save helpers)", () => {
  it("addStacks clamps at WOUND_MAX, stackOf reads the mark", () => {
    const m: StatusMark[] = [];
    expect(stackOf(m, "wound")).toBe(0);
    expect(addStacks(m, "wound", 3)).toBe(3);
    expect(addStacks(m, "wound", 3)).toBe(WOUND_MAX); // 3+3 clamps to 5
    expect(m.filter((s) => s.kind === "wound").length).toBe(1);
    expect(stackOf(m, "wound")).toBe(WOUND_MAX);
    expect(clearStacks(m, "wound")).toBe(WOUND_MAX);
    expect(m.length).toBe(0);
  });

  it("hostile stack counts are clamped, never trusted", () => {
    expect(stackOf([w(99)], "wound")).toBe(WOUND_MAX);
    expect(stackOf([{ kind: "wound", roundsLeft: -7 }], "wound")).toBe(0);
    expect(stackOf([{ kind: "focus", roundsLeft: 99 }], "focus")).toBe(FOCUS_MAX);
  });

  it("rest knits exactly one stack and drops the mark with the last", () => {
    const m = [w(3)];
    expect(restWoundDecay(m)).toBe(1);
    expect(stackOf(m, "wound")).toBe(2);
    const one = [w(1)];
    expect(restWoundDecay(one)).toBe(1);
    expect(one.length).toBe(0);
    const none: StatusMark[] = [];
    expect(restWoundDecay(none)).toBe(0);
  });

  it("curing strips every ailment but spares focus — poise is not a disease", () => {
    const m: StatusMark[] = [{ kind: "poison", roundsLeft: 3 }, w(2), { kind: "blind", roundsLeft: 2 }, { kind: "burn", roundsLeft: 1 }, fx(3)];
    const left = clearAilments(m);
    expect(left).toEqual([fx(3)]);
  });
});

describe("wound in combat (rending claws)", () => {
  it("claw hits stack the wound up to the cap", () => {
    const cs = startCombat(party(), ["mire-brute"], { seed: 3 });
    for (const p of cs.pcs) p.hp = 999; // keep the fight alive while we fish for rakes
    let stacks = 0;
    for (let i = 0; i < 150 && stacks === 0; i++) {
      foeAct(cs, 0);
      stacks = Math.max(stacks, ...cs.pcs.map((p) => stackOf(p.statuses, "wound")));
    }
    expect(stacks).toBe(1); // mire-brute rakes +1 per hit
    // force a deep bleed, then rake a lot more — the clamp holds
    const victim = cs.pcs.find((p) => stackOf(p.statuses, "wound") > 0)!;
    addStacks(victim.statuses, "wound", WOUND_MAX);
    for (let i = 0; i < 60; i++) {
      foeAct(cs, 0);
      expect(stackOf(victim.statuses, "wound")).toBeLessThanOrEqual(WOUND_MAX);
    }
    expect(stackOf(victim.statuses, "wound")).toBe(WOUND_MAX);
  });

  it("bleeds 1 per stack at the end of the afflicted's own turn — and never disturbs focus", () => {
    let bled = false;
    for (let seed = 1; seed < 30 && !bled; seed++) {
      const cs = startCombat(party(), ["bog-troll"], { seed });
      const p = cs.pcs[0];
      p.statuses = [w(2), fx(3)];
      p.hp = 40;
      cs.turnPtr = cs.order.findIndex(([side, idx]) => side === "pc" && idx === 0); // make him the acting unit
      const evs = pcAttack(cs, 0, 0);
      if (!evs.some((e) => e.kind === "hit" || e.kind === "crit")) continue; // miss doesn't end the turn
      bled = true;
      expect(p.hp).toBe(40 - 2 * WOUND_DMG_PER_STACK);
      expect(stackOf(p.statuses, "focus")).toBe(4); // the landing blow sharpens it 3→4; bleeding never shatters
      expect(cs.log.some((l) => l.includes("bleeds"))).toBe(true);
    }
    expect(bled).toBe(true);
  });

  it("a bleed-out kills, and the fight ends before the turn scan", () => {
    let seen = false;
    for (let seed = 1; seed < 40 && !seen; seed++) {
      const cs = startCombat(party(), ["bog-troll"], { seed });
      cs.pcs[1].hp = 0; // one hero already down
      const p = cs.pcs[0];
      p.statuses = [w(2)];
      p.hp = 2; // the bleed is lethal
      cs.turnPtr = cs.order.findIndex(([side, idx]) => side === "pc" && idx === 0);
      const evs = pcAttack(cs, 0, 0);
      if (!evs.some((e) => e.kind === "hit" || e.kind === "crit")) continue;
      seen = true;
      expect(evs.some((e) => e.kind === "death" && e.dst?.[0] === "pc")).toBe(true);
      expect(cs.phase).toBe("lost");
      expect(cs.log.some((l) => l.includes("bleeds out"))).toBe(true);
    }
    expect(seen).toBe(true);
  });

  it("healing light seals the wound; purify takes ailments but spares focus", () => {
    const cs = startCombat(party(), ["bog-troll"], { seed: 5 });
    const cleric = cs.pcs[1];
    const fighter = cs.pcs[0];
    cleric.sp = 99;
    fighter.statuses = [w(4), fx(2), { kind: "burn", roundsLeft: 2 }];
    pcCast(cs, 1, "heal", 0);
    expect(stackOf(fighter.statuses, "wound")).toBe(0);
    expect(cs.log.some((l) => l.includes("knits shut"))).toBe(true);
    fighter.statuses = [w(3), fx(2), { kind: "blind", roundsLeft: 2 }];
    pcCast(cs, 1, "purify", 0);
    expect(stackOf(fighter.statuses, "wound")).toBe(0);
    expect(fighter.statuses.some((s) => s.kind === "blind")).toBe(false);
    expect(stackOf(fighter.statuses, "focus")).toBe(2); // purify cures, it does not calm
  });
});

describe("focus (consecutive-hit crit build)", () => {
  it("the bonus ramps +5% per stack and caps at +20%", () => {
    expect(focusCritBonus([])).toBe(0);
    for (let s = 1; s <= FOCUS_MAX; s++) expect(focusCritBonus([fx(s)])).toBeCloseTo(s * 0.05, 10);
    const m: StatusMark[] = [];
    expect(addStacks(m, "focus", FOCUS_MAX + 6)).toBe(FOCUS_MAX); // 10 attempts still cap at 4
    expect(focusCritBonus(m)).toBeCloseTo(0.2, 10);
  });

  it("each landed swing adds a stack; misses and blows that draw blood shatter it", () => {
    // fish for a seed where the fighter strings 5 consecutive hits — then the cap must hold at 4
    let sharpened = false;
    for (let seed = 1; seed < 60 && !sharpened; seed++) {
      const cs = startCombat(party(), ["cave-rat"], { seed });
      const p = cs.pcs[0];
      cs.foes[0].hp = 9999; // the rat is a sparring dummy
      let hits = 0;
      for (let i = 0; i < 5 && cs.phase === "input"; i++) {
        cs.foes[0].hp = 9999;
        const evs = pcAttack(cs, 0, 0);
        if (evs.some((e) => e.kind === "miss")) break;
        hits++;
      }
      if (hits < 5) continue;
      sharpened = true;
      expect(stackOf(p.statuses, "focus")).toBe(FOCUS_MAX); // 5 landings: 1,2,3,4, cap
      // a blow that draws blood resets the rail
      for (const q of cs.pcs) q.hp = 999;
      let struck = false;
      for (let i = 0; i < 80 && !struck; i++) {
        const evs = foeAct(cs, 0);
        if (evs.some((e) => (e.kind === "hit" || e.kind === "crit") && e.dst?.[0] === "pc" && stackOf(cs.pcs[e.dst[1]].statuses, "focus") === 0 && p.statuses === cs.pcs[e.dst[1]].statuses)) struck = true;
      }
      expect(struck).toBe(true);
      expect(stackOf(p.statuses, "focus")).toBe(0);
    }
    expect(sharpened).toBe(true);

    // and a wild swing breaks the rhythm too
    let missedOut = false;
    for (let seed = 1; seed < 60 && !missedOut; seed++) {
      const cs = startCombat(party(), ["cave-rat"], { seed });
      const p = cs.pcs[0];
      addStacks(p.statuses, "focus", 2);
      cs.foes[0].hp = 9999;
      for (let i = 0; i < 40; i++) {
        cs.foes[0].hp = 9999;
        const evs = pcAttack(cs, 0, 0);
        if (evs.some((e) => e.kind === "miss")) {
          expect(stackOf(p.statuses, "focus")).toBe(0);
          missedOut = true;
          break;
        }
        addStacks(p.statuses, "focus", 2); // keep the rail loaded between swings
      }
    }
    expect(missedOut).toBe(true);
  });

  it("the sharpened edge actually crits more: +20% rail vs bare attacks (paired seeds)", () => {
    const run = (stacks: number): number => {
      const cs = startCombat(party(), ["cave-rat"], { seed: 4242 });
      const p = cs.pcs[0];
      let crits = 0;
      for (let i = 0; i < 240 && cs.phase === "input"; i++) {
        cs.foes[0].hp = 9999;
        p.statuses = stacks ? [fx(stacks)] : [];
        const evs = pcAttack(cs, 0, 0);
        if (evs.some((e) => e.kind === "crit")) crits++;
      }
      return crits;
    };
    expect(run(FOCUS_MAX)).toBeGreaterThan(run(0));
  });
});

describe("omen-mark (fen seer)", () => {
  it("a damaging seer hit reads an ally's fate — the mark and the telegraph land together", () => {
    const cs = startCombat(party(), ["fen-seer", "bog-troll"], { seed: 5 });
    for (const p of cs.pcs) p.hp = 999;
    for (const f of cs.foes) f.hp = 9999;
    let marked = false;
    for (let i = 0; i < 150 && !marked; i++) {
      const evs = foeAct(cs, 0);
      const ev = evs.find((e) => e.kind === "status" && e.text === "omen");
      if (ev) {
        marked = true;
        const mi = ev.src![1];
        expect(cs.foes[mi].omenMarked).toBe(true);
        expect(cs.log.some((l) => l.includes("its next move is written"))).toBe(true);
      }
    }
    expect(marked).toBe(true);
  });

  it("blows against the mark land +25% deeper — guard or no guard — and dull when the mark acts", () => {
    const lightningOn = (mark: boolean, guard: boolean): number => {
      const cs = startCombat([makePc("mage", 0), makePc("fighter", 1)], ["wraith"], { seed: 77 });
      cs.pcs[0].sp = 99;
      cs.pcs[0].guard = guard;
      cs.foes[0].hp = 9999;
      if (mark) cs.foes[0].omenMarked = true;
      const evs = pcCast(cs, 0, "lightning", 0);
      const ev = evs.find((e) => (e.kind === "spell" || e.kind === "crit") && e.dst?.[0] === "foe");
      return ev!.amount!;
    };
    const bare = lightningOn(false, false);
    const marked = lightningOn(true, false);
    expect(marked).toBe(Math.round(bare * OMEN_DMG_MULT));
    // guard is a received-blow halving — it neither dilutes the caster's own marked hit
    // nor does the mark soften what the guard eats (checked below, paired seeds)
    expect(lightningOn(true, true)).toBe(marked);
    expect(lightningOn(false, true)).toBe(bare);
    // guard still halves the marked side's incoming: same foe, same rolls
    const bitten = (guard: boolean): number => {
      const cs = startCombat(party(), ["cave-rat"], { seed: 31 });
      for (const p of cs.pcs) { p.hp = 999; p.guard = guard; }
      cs.foes[0].omenMarked = true; // the mark must not change what the foe deals out
      for (let i = 0; i < 120; i++) {
        cs.foes[0].hp = 9999;
        const evs = foeAct(cs, 0);
        const ev = evs.find((e) => (e.kind === "hit" || e.kind === "crit") && e.dst?.[0] === "pc");
        if (ev) return ev.amount!;
      }
      throw new Error("no bite in 120 swings");
    };
    const raw = bitten(false);
    expect(bitten(true)).toBe(Math.max(1, Math.floor(raw / 2)));
  });

  it("the mark fulfils as the foe's next action resolves", () => {
    const cs = startCombat(party(), ["fen-seer", "bog-troll"], { seed: 5 });
    for (const p of cs.pcs) p.hp = 999;
    cs.foes[1].omenMarked = true;
    foeAct(cs, 1);
    expect(cs.foes[1].omenMarked).toBe(false);
    expect(cs.log.some((l) => l.includes("fulfils"))).toBe(true);
  });
});
