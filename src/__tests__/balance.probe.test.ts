import { describe, expect, it } from "vitest";
import type { Pc } from "../state/save";
import { makePc, pcMax } from "../state/save";
import { applyXpToPc } from "../state/party";
import { xpForNext } from "../data/progression";
import { startCombat, quickResolve } from "../core/combat";

/**
 * P8 balance probe: seeded Monte-Carlo over the DOM-free combat core using
 * Quick Resolve (PCs auto-attack — the casual player's default path).
 *
 * Measured design shape (200 fights per scenario): the game is deliberately
 * forgiving in single fights — at a gate's intended level every fight is won,
 * and difficulty lives in HP attrition across a chain of unhealed fights plus
 * temple gold costs. Bands below lock that shape as a regression guard:
 *  - intended-level parties win ~always and spend <20% party HP per fight;
 *  - under-leveled parties bleed 30–45% HP per "win" — chains kill them;
 *  - deeper gates cost strictly more at the same level (monotonic gradient);
 *  - no stalemates, gold scales with danger, XP tax bites end-to-end.
 */

const CLASSES = ["fighter", "mage", "cleric", "rogue"] as const;

/** Default 4-class party leveled to `lvl` via real XP growth, at full HP/SP. */
function leveledParty(lvl: number): Pc[] {
  const pcs = CLASSES.map((c) => makePc(c, 1));
  const fake = { party: pcs } as never as Parameters<typeof applyXpToPc>[0];
  for (const p of pcs) {
    while (p.level < lvl) applyXpToPc(fake, p.id, xpForNext(p.level));
    const max = pcMax(p);
    p.hp = max.hp;
    p.sp = max.sp;
  }
  return pcs;
}

// Representative 1–3 monster encounters drawn from each gate's level band.
const HOLLOW = [["cave-rat"], ["goblin", "cave-rat"], ["spider", "goblin"], ["skeleton", "spider"]];
const CLOISTER = [["skeleton"], ["orc-raider", "skeleton"], ["wraith", "spider"], ["orc-raider", "wraith"]];
const VAULT = [["wraith", "troll"], ["troll"], ["wyrm-whelp"], ["wraith", "wraith", "orc-raider"]];

interface ProbeResult {
  winRate: number;
  /** Mean fraction of party max HP spent per victory — the real difficulty dial. */
  hpCostPerWin: number;
  maxRound: number;
  avgGoldPerWin: number;
}

function probe(lvl: number, comps: string[][], n = 200): ProbeResult {
  let wins = 0;
  let gold = 0;
  let hpCost = 0;
  let maxRound = 0;
  for (let i = 0; i < n; i++) {
    const pcs = leveledParty(lvl);
    const totalMax = pcs.reduce((a, p) => a + pcMax(p).hp, 0);
    const cs = startCombat(pcs, [...comps[i % comps.length]], { seed: (i * 2654435761) >>> 0 });
    quickResolve(cs);
    maxRound = Math.max(maxRound, cs.round);
    if (cs.phase === "won") {
      wins++;
      hpCost += (totalMax - cs.pcs.reduce((a, p) => a + p.hp, 0)) / totalMax;
      gold += cs.victory?.gold ?? 0;
    }
  }
  return { winRate: wins / n, hpCostPerWin: wins ? hpCost / wins : 1, maxRound, avgGoldPerWin: wins ? gold / wins : 0 };
}

const H1 = probe(1, HOLLOW);
const C4 = probe(4, CLOISTER);
const V9 = probe(9, VAULT);
const C1 = probe(1, CLOISTER); // under-leveled into cloister
const V4 = probe(4, VAULT); // badly under-leveled into vault

describe("balance probe (seeded Monte-Carlo over the combat core)", () => {
  it("probe ran: log the measured curve", () => {
    const fmt = (r: ProbeResult) =>
      `win ${(r.winRate * 100).toFixed(0)}% hpCost/win ${(r.hpCostPerWin * 100).toFixed(1)}% maxRound ${r.maxRound} gold/win ${r.avgGoldPerWin.toFixed(1)}`;
    console.log(`H@1 ${fmt(H1)}\nC@4 ${fmt(C4)}\nV@9 ${fmt(V9)}\nC@1 ${fmt(C1)}\nV@4 ${fmt(V4)}`);
  });

  it("gates are comfortable at their intended level (casual contract)", () => {
    for (const r of [H1, C4, V9]) expect(r.winRate).toBeGreaterThanOrEqual(0.9);
    for (const r of [H1, C4, V9]) expect(r.hpCostPerWin).toBeLessThan(0.2);
  });

  it("under-leveled parties pay real attrition: cloister@1 and vault@4 spend >=30% HP per win", () => {
    expect(C1.hpCostPerWin).toBeGreaterThanOrEqual(0.3);
    expect(V4.hpCostPerWin).toBeGreaterThanOrEqual(0.3);
  });

  it("difficulty gradient is monotonic: same table costs more the weaker you are", () => {
    const v6 = probe(6, VAULT, 120);
    const v7 = probe(7, VAULT, 120);
    expect(V4.hpCostPerWin).toBeGreaterThan(v6.hpCostPerWin);
    expect(v6.hpCostPerWin).toBeGreaterThanOrEqual(v7.hpCostPerWin);
    expect(v7.hpCostPerWin).toBeGreaterThan(V9.hpCostPerWin * 0.5); // lvl9 still not free relative to mid levels
  });

  it("a stronger party never does worse against the same table", () => {
    const winRateAt = (lvl: number): number => {
      let wins = 0;
      for (let i = 0; i < 150; i++) {
        const cs = startCombat(leveledParty(lvl), [...VAULT[i % VAULT.length]], { seed: (i * 40503) >>> 0 });
        quickResolve(cs);
        if (cs.phase === "won") wins++;
      }
      return wins / 150;
    };
    expect(winRateAt(12)).toBeGreaterThanOrEqual(winRateAt(9));
  });

  it("no degenerate stalemates: every fight ends well inside the guard cap", () => {
    for (const r of [H1, C4, V9, C1, V4]) expect(r.maxRound).toBeLessThan(60);
  });

  it("gold scales with gate danger", () => {
    expect(V9.avgGoldPerWin).toBeGreaterThan(H1.avgGoldPerWin * 3);
  });

  it("XP tax bites end-to-end: a lvl-10 party reaping rats earns almost nothing", () => {
    let total = 0;
    for (let i = 0; i < 25; i++) {
      const cs = startCombat(leveledParty(10), ["cave-rat", "cave-rat"], { seed: i * 7919 + 3 });
      quickResolve(cs);
      expect(cs.phase).toBe("won");
      expect(cs.victory?.tooWeak).toBe(true);
      for (const xp of Object.values(cs.victory!.xpByPc)) total += xp;
    }
    // 2 rats × 6 XP × 0.05 tax = 0.6 → ≤1 XP per PC per fight on average
    expect(total / 25).toBeLessThanOrEqual(4);
  });

  it("a fresh party averages at least a 4-fight Hollow Roots chain before resting", () => {
    let total = 0;
    const trials = 60;
    for (let t = 0; t < trials; t++) {
      const pcs = leveledParty(1);
      let fights = 0;
      for (let i = 0; i < 8 && fights < 6; i++) {
        const comp = HOLLOW[(t + i) % HOLLOW.length];
        const cs = startCombat(pcs.map((p) => ({ ...p, statuses: [...p.statuses] })), [...comp], {
          seed: (t * 104729 + i) >>> 0,
        });
        quickResolve(cs);
        // carry HP forward — the dungeon does not heal between fights; downed stays downed
        cs.pcs.forEach((cp, j) => (pcs[j].hp = cp.hp));
        if (cs.phase === "lost") break;
        fights++;
      }
      total += fights;
    }
    const meanChain = total / trials;
    expect(meanChain).toBeGreaterThanOrEqual(4);
  });

  it("an under-leveled chain collapses: lvl-1 in cloister tables wipes within 6 unhealed fights", () => {
    let wiped = 0;
    for (let t = 0; t < 40; t++) {
      const pcs = leveledParty(1);
      for (let i = 0; i < 6; i++) {
        const cs = startCombat(pcs.map((p) => ({ ...p, statuses: [...p.statuses] })), [...CLOISTER[(t + i) % CLOISTER.length]], {
          seed: (t * 15485863 + i) >>> 0,
        });
        quickResolve(cs);
        cs.pcs.forEach((cp, j) => (pcs[j].hp = cp.hp));
        if (cs.phase === "lost") {
          wiped++;
          break;
        }
      }
    }
    expect(wiped / 40).toBeGreaterThanOrEqual(0.5); // attrition punishes, even though single fights mostly win
  });
});
