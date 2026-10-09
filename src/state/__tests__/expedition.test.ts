import { describe, expect, it } from "vitest";
import { foeAct, foeDef, normalizeActiveTurn, quickResolve, startCombat, tallyVictory } from "../../core/combat";
import { BESTIARY, monsterById } from "../../data/bestiary";
import { ITEMS, itemById } from "../../data/items";
import type { ActiveGate, GameState } from "../save";
import { HALL_SIZE, makePc, newGame, pcMax } from "../save";
import { activateShrine, answerRiddle, campRest, campScout, campTrophy, descendFloor, endExpedition, gridFromSave, hermitGift, LIGHT_PER_FLOOR, encounterChance, isLit, lightMods, witchReveal, merchantWares, RARE_CHANCE, rollRare, startExpedition, trySeal } from "../expedition";
import { allSeals, riddleFor, sealPuzzle } from "../../data/riddles";
import { claimVictory } from "../combat";

const party = () => [makePc("fighter", 0), makePc("cleric", 1)];

describe('"hollows" modifier (foeDef level shift)', () => {
  it("undead rise stronger: +1 level, hp/atk ×1.12; vermin wither −1", () => {
    const cs = startCombat(party(), ["skeleton", "cave-rat", "goblin"], { seed: 7, hollows: true });
    expect(cs.foes[0].lvlShift).toBe(1);
    expect(cs.foes[0].hp).toBe(Math.round(20 * 1.12)); // snapshot scaled at spawn
    const sk = foeDef(cs.foes[0]);
    expect(sk.lvl).toBe(4);
    expect(sk.atk).toBe(Math.round(9 * 1.12));

    expect(cs.foes[1].lvlShift).toBe(-1);
    const rat = foeDef(cs.foes[1]);
    expect(rat.hp).toBe(Math.round(8 * 0.88));
    expect(rat.lvl).toBeGreaterThanOrEqual(1);

    // humanoids ignore the hollows entirely
    expect(cs.foes[2].lvlShift).toBeUndefined();
    expect(foeDef(cs.foes[2])).toEqual(monsterById("goblin"));
  });

  it("without the modifier, foe stats are the raw table", () => {
    const cs = startCombat(party(), ["skeleton"], { seed: 7 });
    expect(cs.foes[0].hp).toBe(20);
    expect(foeDef(cs.foes[0])).toEqual(monsterById("skeleton"));
  });
});

describe("rare spawns", () => {
  it("rollRare is deterministic per run seed", () => {
    for (const seed of [1, 42, 9999]) expect(rollRare(seed)).toBe(rollRare(seed));
  });

  it("fires on ~8% of runs and only with known kinds", () => {
    const kinds = new Set(["merchant", "hermit", "villager"]);
    let hits = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const r = rollRare(seed);
      if (r === null) continue;
      expect(kinds.has(r)).toBe(true);
      hits++;
    }
    // deterministic stream: assert the observed rate brackets the nominal 8%
    expect(hits).toBeGreaterThanOrEqual(40);
    expect(hits).toBeLessThanOrEqual(130);
    expect(RARE_CHANCE).toBe(0.08);
  });

  it("merchant stock is stable, three uncommon/rare goods at −25%", () => {
    const a = merchantWares({ seed: 123 });
    expect(a).toEqual(merchantWares({ seed: 123 }));
    expect(a.length).toBe(3);
    for (const w of a) {
      const def = itemById(w.id);
      expect(def.rarity).not.toBe("common");
      expect(w.price).toBe(Math.max(1, Math.floor(def.price * 0.75)));
    }
  });

  it("hermit gift names an unseen codex member; null when the book is full", () => {
    const all = BESTIARY.map((m) => m.id);
    const seen = all.slice(0, 3);
    const gift = hermitGift({ seed: 9 }, seen);
    expect(gift).not.toBeNull();
    expect(seen.includes(gift!.id)).toBe(false);
    expect(hermitGift({ seed: 9 }, seen)!.id).toBe(gift!.id); // deterministic
    expect(hermitGift({ seed: 9 }, all)).toBeNull();
  });
});

describe("turn-pointer invariant (soft-lock regression)", () => {
  it("startCombat never leaves the turn on a combatant downed before the fight", () => {
    const down = makePc("fighter", 0);
    down.hp = 0; // carried into the next room already bleeding out
    let sawDownFirst = false;
    for (let seed = 0; seed < 24; seed++) {
      const cs = startCombat([down, makePc("cleric", 1)], ["cave-rat"], { seed });
      if (cs.order[0][0] === "pc" && cs.order[0][1] === 0) sawDownFirst = true;
      expect(cs.phase).toBe("input");
      const [side, idx] = cs.order[cs.turnPtr];
      expect(side === "pc" ? cs.pcs[idx].hp > 0 : cs.foes[idx].hp > 0).toBe(true);
    }
    expect(sawDownFirst).toBe(true); // the loop actually exercised the fixed path
  });

  it("a fully downed party entering a fight loses immediately", () => {
    const a = makePc("fighter", 0);
    a.hp = 0;
    const b = makePc("cleric", 1);
    b.hp = 0;
    expect(startCombat([a, b], ["cave-rat"], { seed: 3 }).phase).toBe("lost");
  });

  it("quickResolve repairs a stale pointer instead of spinning forever", () => {
    const cs = startCombat(party(), ["cave-rat", "spider"], { seed: 11 });
    // force the legacy stall state: turn sits on a PC who is downed — pre-fix this returned [] with phase stuck at "input"
    const ptr = cs.order.findIndex(([side]) => side === "pc");
    cs.pcs[cs.order[ptr][1]].hp = 0;
    cs.turnPtr = ptr;
    const evs = quickResolve(cs);
    expect(evs.length).toBeGreaterThan(0); // the fight moved: someone acted
    expect(cs.phase === "won" || cs.phase === "lost").toBe(true);
  });

  it("normalizeActiveTurn moves a stale pointer off a downed combatant", () => {
    const cs = startCombat(party(), ["cave-rat"], { seed: 5 });
    const ptr = cs.order.findIndex(([side]) => side === "pc");
    cs.pcs[cs.order[ptr][1]].hp = 0;
    cs.turnPtr = ptr;
    normalizeActiveTurn(cs);
    expect(cs.phase).toBe("input");
    const [side, idx] = cs.order[cs.turnPtr];
    expect(side === "pc" ? cs.pcs[idx].hp > 0 : cs.foes[idx].hp > 0).toBe(true);
  });
});

// ---------- campfire rest, gate lords, elite kills (P8 balance pass) ----------

const clock = () => new Date("2026-10-04T12:00:00Z");

const gateFor = (seed: number, floor = 0): ActiveGate => ({
  gateId: "hollow-roots",
  runNumber: 1,
  seed,
  modifier: "none",
  floor,
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

const runState = (seed = 42): GameState => {
  const s = newGame(clock);
  s.activeGate = gateFor(seed);
  return s;
};

/** Force the fight to won so claimVictory accepts it. */
function winFight(s: GameState): void {
  const cs = s.activeCombat!;
  for (const f of cs.foes) f.hp = 0;
  cs.phase = "won";
  cs.victory = tallyVictory(cs);
}

describe("campfire rest", () => {
  it("heals every living member by +25% of max HP/SP, clamped at the cap", () => {
    const s = runState(7);
    for (const p of s.party) {
      p.hp = 4;
      p.sp = 0;
    }
    const r = campRest(s);
    expect(r.healed).toBe(true);
    for (const p of s.party) {
      const max = pcMax(p);
      expect(p.hp).toBe(Math.min(max.hp, 4 + Math.ceil(max.hp * 0.25)));
      expect(p.sp).toBe(Math.ceil(max.sp * 0.25));
    }
    expect(s.activeGate!.flags["rested-f0"]).toBe(true);
  });

  it("blocks a second rest on the same floor without touching state", () => {
    const s = runState(7);
    campRest(s); // first fire lands (ambush or not is seed-decided)
    const hpBefore = s.party.map((p) => p.hp);
    const stepsBefore = s.activeGate!.steps;
    const r2 = campRest(s);
    expect(r2).toEqual({ healed: false, ambush: null });
    expect(s.party.map((p) => p.hp)).toEqual(hpBefore);
    expect(s.activeGate!.steps).toBe(stepsBefore); // blocked call must not burn the event rng
  });

  it("ambush branch: both outcomes occur across seeds, and ambushes match pendingMonsters", () => {
    let amb = 0;
    let safe = 0;
    for (let seed = 1; seed <= 80 && !(amb > 0 && safe > 0); seed++) {
      const s = runState(seed);
      const r = campRest(s);
      if (r.ambush) {
        amb++;
        const pend = s.activeGate!.pendingMonsters!;
        expect(pend).toHaveLength(r.ambush.length);
        for (const id of pend) expect(monsterById(id).id).toBe(id);
        for (const e of s.activeGate!.pendingElites ?? []) {
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThan(pend.length);
        }
      } else {
        safe++;
        expect(s.activeGate!.pendingMonsters).toBeUndefined();
      }
    }
    expect(amb).toBeGreaterThan(0);
    expect(safe).toBeGreaterThan(0);
    // determinism: the same seed yields the same ambush roster
    const a = runState(1);
    const b = runState(1);
    campRest(a);
    campRest(b);
    expect(a.activeGate!.pendingMonsters).toEqual(b.activeGate!.pendingMonsters);
  });
});

describe("campfire scout", () => {
  it("reveals every non-wall cell of the floor exactly once", () => {
    const s = runState(7);
    const ag = s.activeGate!;
    ag.visited = []; // pretend fresh eyes
    const r = campScout(s);
    expect(r.revealed).toBe(true);
    const nonWall: number[] = [];
    for (let id = 0; id < ag.map.cells.length; id++) if (ag.map.cells[id] !== "1") nonWall.push(id);
    expect(new Set(ag.visited)).toEqual(new Set(nonWall)); // walls stay hidden, everything else open
    const r2 = campScout(s);
    expect(r2).toEqual({ revealed: false, cellsRevealed: 0 });
    expect(ag.flags["scouted-f0"]).toBe(true);
  });
});

describe("campfire trophy", () => {
  it("pays 12g per floor depth into the run loot, once per floor", () => {
    const s = runState(7);
    const ag = s.activeGate!;
    const before = ag.loot.gold;
    const r = campTrophy(s);
    expect(r.gold).toBe(12 * (ag.floor + 1));
    expect(ag.loot.gold).toBe(before + r.gold);
    expect(ag.flags["trophy-f0"]).toBe(true);
    expect(campTrophy(s)).toEqual({ gold: 0, ambush: null }); // second cut pays nothing
    expect(ag.loot.gold).toBe(before + r.gold);
  });

  it("ambush is seed-deterministic and both outcomes occur (blood draws more than smoke)", () => {
    let amb = 0;
    let safe = 0;
    for (let seed = 1; seed <= 80 && !(amb > 0 && safe > 0); seed++) {
      const r = campTrophy(runState(seed));
      if (r.ambush) amb++;
      else safe++;
    }
    expect(amb).toBeGreaterThan(0);
    expect(safe).toBeGreaterThan(0);
    const a = runState(3);
    const b = runState(3);
    expect(campTrophy(a)).toEqual(campTrophy(b));
  });
});

describe("gate lords", () => {
  it("flags the single gate lord with boss + maxHp; packs never get the flag", () => {
    const boss = startCombat(party(), ["bark-thrall"], { seed: 5, boss: true });
    expect(boss.foes[0].boss).toBe(true);
    expect(boss.foes[0].maxHp).toBe(60);
    const pack = startCombat(party(), ["goblin", "goblin"], { seed: 5, boss: true });
    for (const f of pack.foes) expect(f.boss).toBeUndefined();
  });

  it("enrage fires once at ≤30% max HP and logs exactly one fury line", () => {
    const cs = startCombat(party(), ["bark-thrall"], { seed: 5, boss: true });
    for (const p of cs.pcs) p.hp = 999; // keep the fight alive regardless of rolls
    const f = cs.foes[0];
    f.hp = 19; // ceil(0.3·60) = 18 — still above the threshold
    foeAct(cs, 0);
    expect(f.enraged).toBeUndefined();
    f.hp = 18;
    foeAct(cs, 0);
    expect(f.enraged).toBe(true);
    expect(cs.log.filter((l) => l.includes("swells with fury"))).toHaveLength(1);
    f.hp = 40; // healed back above the line — must not re-trigger or double-log
    foeAct(cs, 0);
    expect(cs.log.filter((l) => l.includes("swells with fury"))).toHaveLength(1);
  });
  it("vault wyrm breathes on every living PC on the cadence round, then waits", () => {
    const cs = startCombat(party(), ["vault-wyrm"], { seed: 11, boss: true });
    for (const p of cs.pcs) p.hp = 999;
    cs.round = 3; // everyRounds = 3, lastBreathRound starts at 0
    const evs = foeAct(cs, 0);
    const breaths = evs.filter((e) => e.kind === "breath");
    expect(breaths).toHaveLength(cs.pcs.length); // whole living party hit
    for (const e of breaths) expect(e.dst?.[0]).toBe("pc");
    expect(cs.foes[0].lastBreathRound).toBe(3);
    const evs2 = foeAct(cs, 0); // same round — cadence not up again yet
    expect(evs2.some((e) => e.kind === "breath")).toBe(false);
  });

  it("slaying the gate lord sets flags.boss so the next stair step finishes the run", () => {
    const s = runState(4);
    s.activeCombat = startCombat(s.party, ["bark-thrall"], { seed: 4, boss: true });
    winFight(s);
    claimVictory(s);
    expect(s.activeGate!.flags["boss"]).toBe(true);
    expect(s.activeGate!.pendingMonsters).toBeUndefined();
  });
});

describe("elite kills", () => {
  it("each elite drop is exactly one uncommon item, banked into run loot and inventory", () => {
    const s = runState(3);
    s.activeCombat = startCombat(s.party, ["goblin", "goblin"], { seed: 3, elites: [1] });
    expect(s.activeCombat.foes[1].elite).toBe(true);
    expect(s.activeCombat.foes[0].elite).toBeUndefined();
    const invBefore = Object.entries(s.inventory);
    winFight(s);
    const sum = claimVictory(s)!;
    expect(sum.eliteLoot).toHaveLength(1); // one elite → exactly one drop
    const item = ITEMS.find((it) => it.name === sum.eliteLoot![0])!;
    expect(item.rarity).toBe("uncommon");
    const beforeCount = Object.fromEntries(invBefore)[item.id] ?? 0;
    expect(s.inventory[item.id]).toBe(beforeCount + 1);
    expect(s.activeGate!.loot.items[item.id]).toBe(1);
  });

  it("an elite pays exactly double gold at the same seed; plain packs drop nothing extra", () => {
    const plain = runState(3);
    plain.activeCombat = startCombat(plain.party, ["goblin"], { seed: 3 });
    winFight(plain);
    const sumPlain = claimVictory(plain)!;
    expect(sumPlain.eliteLoot).toBeUndefined();
    const elite = runState(3);
    elite.activeCombat = startCombat(elite.party, ["goblin"], { seed: 3, elites: [0] });
    winFight(elite);
    const sumElite = claimVictory(elite)!;
    expect(sumElite.gold).toBe(2 * sumPlain.gold); // same rng stream, the lone foe's gold doubled
  });
});


describe("riddle stones and rune-seal doors", () => {
  it("a correct answer pays 18g per depth into run loot, once per floor", () => {
    const s = runState(7);
    const view = riddleFor(7, 0);
    const res = answerRiddle(s, view.correctAt);
    expect(res.correct).toBe(true);
    expect(res.gold).toBe(18);
    expect(s.activeGate!.loot.gold).toBe(18);
    expect(s.activeGate!.flags["riddle-f0"]).toBe(true);
    const again = answerRiddle(s, view.correctAt); // stone dormant — no double-dipping
    expect(again).toEqual({ correct: false, gold: 0, ambush: null });
    expect(s.activeGate!.loot.gold).toBe(18);
  });

  it("a wrong answer wakes the guardian and burns the one chance", () => {
    const s = runState(7);
    const view = riddleFor(7, 0);
    const wrong = [0, 1, 2].find((i) => i !== view.correctAt)!;
    const res = answerRiddle(s, wrong);
    expect(res.correct).toBe(false);
    expect(res.ambush).not.toBeNull();
    expect(s.activeGate!.pendingMonsters).toEqual(res.ambush!.map((m) => m.id));
    const second = answerRiddle(s, view.correctAt); // spent even on failure
    expect(second.gold).toBe(0);
    expect(second.ambush).toBeNull();
  });

  it("the right triple opens the seal for deep gold and one guaranteed stash drop", () => {
    const s = runState(9);
    s.activeGate!.floor = 2;
    const { solution } = sealPuzzle(9, 2);
    const before = s.party.map((p) => p.hp);
    const res = trySeal(s, solution);
    expect(res.solved).toBe(true);
    expect(res.gold).toBe(75); // 25 × (floor+1)
    expect(s.activeGate!.loot.gold).toBe(75);
    const drop = itemById(res.item!);
    expect(drop.rarity).not.toBe("common");
    expect(drop.slot).not.toBe("consumable");
    expect(s.inventory[drop.id]).toBe(1);
    expect(s.activeGate!.loot.items[drop.id]).toBe(1);
    expect(s.party.map((p) => p.hp)).toEqual(before); // nobody hurt
    const after = trySeal(s, solution);
    expect(after.solved).toBe(false);
    expect(after.victim).toBeUndefined(); // an opened door never bites twice
  });

  it("a wrong triple costs 6+2×depth HP from one hero and stays retryable", () => {
    const s = runState(9);
    s.activeGate!.floor = 1;
    const { solution } = sealPuzzle(9, 1);
    const bad = allSeals().find((p) => p.join() !== solution.join())!;
    const before = s.party.map((p) => p.hp);
    const res = trySeal(s, bad);
    expect(res.solved).toBe(false);
    expect(res.damage).toBe(8); // 6 + 2×1
    const vi = s.party.findIndex((p) => p.name === res.victim);
    expect(vi).toBeGreaterThanOrEqual(0);
    s.party.forEach((p, i) => expect(p.hp).toBe(before[i] - (i === vi ? 8 : 0)));
    const ok = trySeal(s, solution); // no flag on failure — the door still yields
    expect(ok.solved).toBe(true);
  });

  it("the bolt floors a hero but never bites below zero", () => {
    const s = runState(9);
    for (const p of s.party) p.hp = 3;
    const { solution } = sealPuzzle(9, 0);
    const bad = allSeals().find((p) => p.join() !== solution.join())!;
    const res = trySeal(s, bad); // damage 6 > hp 3
    expect(res.damage).toBe(6);
    for (const p of s.party) expect(p.hp).toBeGreaterThanOrEqual(0);
    expect(s.party.some((p) => p.hp === 0)).toBe(true);
  });

  it("solving carves the door open — the wall face becomes walkable floor", () => {
    const s = runState(9);
    s.activeGate!.floor = 1;
    const ag = s.activeGate!;
    const cell = 5; // plant a wall face to serve as the door (fixture map is all floor)
    ag.map.cells = ag.map.cells.slice(0, cell) + "1" + ag.map.cells.slice(cell + 1);
    ag.map.entities.push([cell, "sealed"]);
    const { solution } = sealPuzzle(9, 1);
    expect(gridFromSave(ag.map)[cell]).toBe(1); // solid before
    expect(trySeal(s, solution).solved).toBe(true);
    expect(gridFromSave(ag.map)[cell]).toBe(0); // open after
    expect(ag.map.entities.some(([, k]) => k === "sealed")).toBe(false);
  });
});

describe("torchlight", () => {
  it("starts lit at LIGHT_PER_FLOOR; darkness only when the flame dies", () => {
    const s = newGame();
    startExpedition(s, "hollow-roots");
    const ag = s.activeGate!;
    expect(ag.lightTurns).toBe(LIGHT_PER_FLOOR);
    expect(isLit(ag)).toBe(true);
    ag.lightTurns = 0;
    expect(isLit(ag)).toBe(false);
    delete (ag as { lightTurns?: number }).lightTurns; // legacy saves read as lit — never punish old codes
    expect(isLit(ag)).toBe(true);
  });

  it("a new floor relights the torch even after a dark crawl", () => {
    const s = newGame();
    startExpedition(s, "hollow-roots");
    const ag = s.activeGate!;
    ag.lightTurns = 0;
    descendFloor(s);
    expect(ag.lightTurns).toBe(LIGHT_PER_FLOOR);
  });

  it("the dark emboldens foes: 0.18 lit vs 0.26 unlit", () => {
    expect(encounterChance(true)).toBe(0.18);
    expect(encounterChance(false)).toBe(0.26);
  });
});

// ---------- torch quality tiers + career gold (torch/shop batch) ----------

describe("torch quality tiers", () => {
  it("tallow smoke dulls lit encounter odds by a tenth; the dark is untouched", () => {
    expect(encounterChance(true)).toBe(0.18);
    expect(encounterChance(false, true)).toBe(0.26); // smoke means nothing in pitch dark
    expect(encounterChance(true, true)).toBeLessThan(encounterChance(true));
    expect(encounterChance(true, true)).toBeCloseTo(0.18 * 0.9, 10);
  });

  it("lightMods reads perks off the run's torch kind; absent or unknown kinds have none", () => {
    const ag = gateFor(7);
    expect(lightMods(ag)).toEqual({ smoke: false, reveal: 0 }); // plain flame by default
    ag.torchKind = "torch";
    expect(lightMods(ag)).toEqual({ smoke: false, reveal: 0 });
    ag.torchKind = "tallow-torch";
    expect(lightMods(ag)).toEqual({ smoke: true, reveal: 0 });
    ag.torchKind = "witchlight";
    expect(lightMods(ag)).toEqual({ smoke: false, reveal: 2 });
    ag.torchKind = "not-an-item";
    expect(lightMods(ag)).toEqual({ smoke: false, reveal: 0 });
  });

  it("witchlight marks hidden entities within radius 2 explored — once per cell", () => {
    const ag = gateFor(7); // pos (10,11) on a 21-wide grid → cell 241
    const near = 11 * 21 + 12; // (12,11): Chebyshev distance 2 — inside the glow
    const far = 8 * 21 + 15; // (15,8): distance 5 — outside it
    ag.map.entities = [
      [near, "trap"],
      [far, "secret"],
      [241, "sealed"],
    ];
    ag.lightTurns = 5;
    ag.torchKind = "witchlight";
    const found = witchReveal(ag);
    expect(found).toContain("trap");
    expect(found).toContain("sealed");
    expect(found).not.toContain("secret"); // out of radius stays hidden
    expect(ag.visited).toContain(near);
    expect(ag.visited).not.toContain(far);
    expect(witchReveal(ag)).toEqual([]); // once per cell — no re-logging
  });

  it("witchlight does nothing once the flame is out", () => {
    const ag = gateFor(7);
    ag.torchKind = "witchlight";
    ag.lightTurns = 0;
    ag.map.entities = [[243, "trap"]]; // a cell not already in the starting visited set
    expect(witchReveal(ag)).toEqual([]);
    expect(ag.visited).not.toContain(243);
  });

  it("tallow and witchlight carry the documented payloads", () => {
    expect(itemById("tallow-torch").use).toEqual({ kind: "light", amount: 60, smoke: true });
    expect(itemById("witchlight").use).toEqual({ kind: "light", amount: 45, reveal: 2 });
  });
});

describe("camp windfalls land in the purse (income regression)", () => {
  it("trophy gold hits d.gold and the chronicle once per floor", () => {
    const s = runState(7);
    const g0 = s.gold;
    const r = campTrophy(s);
    expect(r.gold).toBeGreaterThan(0);
    expect(s.gold).toBe(g0 + r.gold);
    expect(s.chronicle!.goldEarned).toBe(r.gold);
  });

  it("riddle gold hits the purse", () => {
    const s = runState(7);
    const ag = s.activeGate!;
    const view = riddleFor(ag.seed, ag.floor);
    const g0 = s.gold;
    expect(answerRiddle(s, view.correctAt).correct).toBe(true);
    expect(s.gold).toBe(g0 + 18 * (ag.floor + 1));
  });

  it("seal gold hits the purse", () => {
    const s = runState(7);
    const ag = s.activeGate!;
    const { solution } = sealPuzzle(ag.seed, ag.floor);
    const g0 = s.gold;
    expect(trySeal(s, [...solution]).solved).toBe(true);
    expect(s.gold).toBe(g0 + 25 * (ag.floor + 1));
  });
});

describe("torch kind lifecycle", () => {
  it("a fresh run strikes a plain torch; descending keeps an upgraded flame", () => {
    const s = newGame(clock);
    startExpedition(s, "hollow-roots");
    expect(s.activeGate!.torchKind).toBe("torch"); // the threshold torch is the cheap one
    s.activeGate!.torchKind = "witchlight";
    descendFloor(s);
    expect(s.activeGate!.torchKind).toBe("witchlight"); // the perk survives the new floor
    expect(s.activeGate!.lightTurns).toBe(LIGHT_PER_FLOOR); // but the flame is re-struck fresh
  });
});

describe("Hall of Runs", () => {
  it("a surfaced run pins its stats and crew to the Guild shelf", () => {
    const s = newGame();
    startExpedition(s, "hollow-roots");
    descendFloor(s); // depth 2 by the time the run surfaces
    const ag = s.activeGate!;
    ag.killsThisRun = 7;
    ag.medalsThisRun = 1;
    ag.loot.gold = 41;
    ag.loot.items["potion-hp"] = 2;
    endExpedition(s, true);
    expect(s.hall).toHaveLength(1);
    const rec = s.hall![0];
    expect(rec).toMatchObject({ gateId: "hollow-roots", dayKey: s.dayKey, runNumber: 1, depth: 2, kills: 7, medals: 1, gold: 41 });
    expect(rec.items["potion-hp"]).toBe(2);
    expect(rec.crew.map((c) => c.name)).toEqual(s.party.map((p) => p.name)); // crew as it walked out
  });

  it("retreats and abandons are not remembered — only surfacings", () => {
    const s = newGame();
    startExpedition(s, "hollow-roots");
    endExpedition(s); // leave() / abandon: no record
    expect(s.hall).toEqual([]);
  });

  it("the shelf keeps the newest eight first and forgets older runs", () => {
    const s = newGame();
    for (let i = 0; i < 10; i++) {
      startExpedition(s, "hollow-roots");
      endExpedition(s, true);
    }
    expect(s.hall).toHaveLength(HALL_SIZE);
    expect(s.hall!.map((r) => r.runNumber)).toEqual([10, 9, 8, 7, 6, 5, 4, 3]); // runs 1-2 forgotten
  });
});

describe("activateShrine - healing springs and brewing herbs", () => {
  it("fully heals the living, gifts exactly one moonpetal, then sleeps for this floor", () => {
    const s = newGame();
    startExpedition(s, "hollow-roots");
    const p0 = s.party[0]!;
    p0.hp = 1;
    p0.sp = 0;
    expect(activateShrine(s)).toBe(true);
    const max = pcMax(p0);
    expect(p0.hp).toBe(max.hp);
    expect(p0.sp).toBe(max.sp);
    expect(s.inventory.moonpetal).toBe(1); // one sprig per visit...
    expect(s.activeGate!.loot.items.moonpetal).toBe(1); // ...tallied, so a wipe takes it back
    expect(activateShrine(s)).toBe(false); // the spring sleeps until you descend deeper
    expect(s.inventory.moonpetal).toBe(1); // no double-dipping on the same floor
  });

  it("shrines heal the living and leave the dead to the temple", () => {
    const s = newGame();
    startExpedition(s, "hollow-roots");
    const fallen = s.party[0]!;
    fallen.hp = 0; // downed members are revived at the temple, not here
    expect(activateShrine(s)).toBe(true);
    expect(fallen.hp).toBe(0);
  });
});
