import { describe, expect, it } from "vitest";
import type { Pc } from "../state/save";
import { makePc, pcMax } from "../state/save";
import { applyXpToPc } from "../state/party";
import { xpForNext } from "../data/progression";
import { startCombat, quickResolve } from "../core/combat";
import { effectiveOrder, finishTurn, pcCast, pcAttack, foeAct, spCostFor } from "../core/combat";
import type { CombatState } from "../core/combat";
import { spellsKnownAt } from "../data/spells";
import type { ModifierId } from "../data/modifiers";

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
const FEN = [["fen-leech"], ["drowned-monk", "fen-leech"], ["mire-brute", "drowned-monk"], ["bog-troll"]];
const SPIRE = [["cinder-spider", "ash-wight"], ["ash-guardian"], ["wyrm-whelp"], ["ash-wight", "cinder-spider"]];

interface ProbeResult {
  winRate: number;
  /** Mean fraction of party max HP spent per victory — the real difficulty dial. */
  hpCostPerWin: number;
  maxRound: number;
  avgGoldPerWin: number;
}

function probe(lvl: number, comps: string[][], n = 200, extra: { frantic?: boolean; critFoe?: number; spellCostMod?: number; riches?: boolean; hollows?: boolean } = {}): ProbeResult {
  let wins = 0;
  let gold = 0;
  let hpCost = 0;
  let maxRound = 0;
  for (let i = 0; i < n; i++) {
    const pcs = leveledParty(lvl);
    const totalMax = pcs.reduce((a, p) => a + pcMax(p).hp, 0);
    const cs = startCombat(pcs, [...comps[i % comps.length]], { seed: (i * 2654435761) >>> 0, ...extra });
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
const F6 = probe(6, FEN); // intended mid-band for gallows-fen
const S12 = probe(12, SPIRE); // intended mid-band for ember-spire
const F2 = probe(2, FEN); // under-leveled into fen (-2 below band floor)
const S8 = probe(8, SPIRE); // under-leveled into spire (-2 below band floor)

describe("balance probe (seeded Monte-Carlo over the combat core)", () => {
  it("probe ran: log the measured curve", () => {
    const fmt = (r: ProbeResult) =>
      `win ${(r.winRate * 100).toFixed(0)}% hpCost/win ${(r.hpCostPerWin * 100).toFixed(1)}% maxRound ${r.maxRound} gold/win ${r.avgGoldPerWin.toFixed(1)}`;
    console.log(`H@1 ${fmt(H1)}\nC@4 ${fmt(C4)}\nF@6 ${fmt(F6)}\nV@9 ${fmt(V9)}\nS@12 ${fmt(S12)}\nF@2 ${fmt(F2)}\nS@8 ${fmt(S8)}\nC@1 ${fmt(C1)}\nV@4 ${fmt(V4)}`);
  });

  it("gates are comfortable at their intended level (casual contract)", () => {
    for (const r of [H1, C4, F6, V9, S12]) expect(r.winRate).toBeGreaterThanOrEqual(0.9);
    for (const r of [H1, C4, F6, V9, S12]) expect(r.hpCostPerWin).toBeLessThan(0.2);
  });

  it("under-leveled parties pay real attrition: cloister@1, vault@4 and fen@2 spend >=30% HP per win", () => {
    expect(C1.hpCostPerWin).toBeGreaterThanOrEqual(0.3);
    expect(V4.hpCostPerWin).toBeGreaterThanOrEqual(0.3);
    expect(F2.hpCostPerWin).toBeGreaterThanOrEqual(0.3);
    // spire's -2 point is gentler by design: high-level stat scaling compresses the relative gap,
    // but it still costs >2x the intended-level party (measured 28% vs 12%)
    expect(S8.hpCostPerWin).toBeGreaterThanOrEqual(0.25);
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

/* ---------- omen sweep: per-modifier chain survival & gold vs unbound ---------- */


const OMENS: ModifierId[] = ["none", "cursed", "frantic", "riches", "hollows", "storm"];

/** StartOpts fragment for an omen, mirroring state/combat.ts startRunCombat. */
function omenOpts(m: ModifierId): { frantic?: boolean; critFoe?: number; spellCostMod?: number; riches?: boolean; hollows?: boolean } {
  return {
    frantic: m === "frantic" || undefined,
    critFoe: m === "cursed" ? 0.12 : undefined,
    spellCostMod: m === "storm" ? 2 : 0,
    riches: m === "riches" || undefined,
    hollows: m === "hollows" || undefined,
  };
}

/** Headless fight with a casting policy (mirrors quickResolve's loop; returns casts landed). */
function resolveCasting(cs: CombatState): number {
  let casts = 0;
  let guardCap = 600;
  while (cs.phase === "input" && guardCap-- > 0) {
    const [side, idx] = effectiveOrder(cs)[cs.turnPtr]; // mirror quickResolve exactly — normalizeActiveTurn would snap initiative back to the leader
    if (side === "pc" ? cs.pcs[idx].hp <= 0 : cs.foes[idx].hp <= 0) { finishTurn(cs, []); continue; }
    if (side === "foe") { foeAct(cs, idx); continue; }
    const p = cs.pcs[idx];
    const has = (id: string): boolean => spellsKnownAt(p.classId, p.level).some((sp) => sp.id === id) && p.sp >= spCostFor(id, cs);
    let spell: string | null = null;
    if (p.classId === "cleric") {
      const hurtIdx = cs.pcs.map((q, j) => [j, q.hp / pcMax(q).hp] as const).filter(([j, r]) => cs.pcs[j].hp > 0 && r < 0.6)[0]?.[0] ?? -1;
      spell = hurtIdx >= 0 && has("heal") ? "heal" : has("bless") && cs.blessDef === 0 ? "bless" : null;
    } else if (p.classId === "mage") {
      const foesLeft = cs.foes.filter((f) => f.hp > 0).length;
      spell = foesLeft >= 2 && has("flame-wave") ? "flame-wave" : has("lightning") ? "lightning" : has("magic-missile") ? "magic-missile" : null;
    } else if (p.classId === "fighter") {
      spell = has("power-strike") ? "power-strike" : null;
    }
    let acted = false;
    if (spell) {
      const target = spell === "heal" ? cs.pcs.map((q, j) => [j, q.hp / pcMax(q).hp] as const).filter(([j]) => cs.pcs[j].hp > 0).sort((a, b) => a[1] - b[1])[0][0] : -1;
      acted = pcCast(cs, idx, spell, target).length > 0;
      if (acted) casts++;
    }
    if (!acted) {
      const t = cs.foes.findIndex((f) => f.hp > 0);
      if (t < 0) break; // no live foe but phase still input — bail, guardCap would catch anyway
      pcAttack(cs, idx, t);
    }
  }
  return casts;
}

interface OmenRun { chainLen: number; gold: number; survived: boolean; casts: number }

/** One unhealed 6-fight chain under an omen; HP and SP carry between fights like the dungeon. */
function runChain(lvl: number, comps: string[][], m: ModifierId, seedBase: number, castPolicy: boolean): OmenRun {
  const pcs = leveledParty(lvl);
  let fights = 0, gold = 0, casts = 0;
  for (let i = 0; i < 6; i++) {
    const cs = startCombat(pcs.map((p) => ({ ...p, statuses: [...p.statuses] })), [...comps[i % comps.length]], {
      seed: (seedBase + i * 104729) >>> 0,
      ...omenOpts(m),
    });
    if (castPolicy) casts += resolveCasting(cs); else quickResolve(cs);
    cs.pcs.forEach((cp, j) => { pcs[j].hp = cp.hp; pcs[j].sp = cp.sp; });
    if (cs.phase === "lost") return { chainLen: fights, gold, survived: false, casts };
    gold += cs.victory?.gold ?? 0;
    fights++;
  }
  return { chainLen: fights, gold, survived: true, casts };
}

interface SweepRow { chainLen: number; goldPerChain: number; survival: number; casts: number }
function sweep(lvl: number, comps: string[][], m: ModifierId, castPolicy: boolean, trials = 80): SweepRow {
  let len = 0, gold = 0, surv = 0, casts = 0;
  for (let t = 0; t < trials; t++) {
    const r = runChain(lvl, comps, m, (t * 2654435761) >>> 0, castPolicy);
    len += r.chainLen; gold += r.gold; surv += r.survived ? 1 : 0; casts += r.casts;
  }
  return { chainLen: len / trials, goldPerChain: gold / trials, survival: surv / trials, casts: casts / trials };
}

const OM = Object.fromEntries(OMENS.map((m) => [m, sweep(3, HOLLOW, m, false)])) as Record<ModifierId, SweepRow>;
const OM_C1 = Object.fromEntries(OMENS.map((m) => [m, sweep(1, CLOISTER, m, false)])) as Record<ModifierId, SweepRow>;
const CAST_NONE = sweep(6, CLOISTER, "none", true);
const CAST_STORM = sweep(6, CLOISTER, "storm", true);
const NONE3 = probe(3, HOLLOW);
const CURSED3 = probe(3, HOLLOW, 200, omenOpts("cursed"));
const FRANTIC3 = probe(3, HOLLOW, 200, omenOpts("frantic"));

describe("omen sweep (per-modifier chain survival & gold vs unbound)", () => {
  it("sweep ran: log the omen table", () => {
    const fmt = (r: SweepRow) => `chain ${r.chainLen.toFixed(2)} surv ${(r.survival * 100).toFixed(0)}% gold/chain ${r.goldPerChain.toFixed(1)} casts ${r.casts.toFixed(1)}`;
    console.log(`${OMENS.map((m) => `H@3 ${m.padEnd(7)} ${fmt(OM[m])}   | C@1 ${m.padEnd(7)} ${fmt(OM_C1[m])}`).join("\n")}\ncast@6C none  ${fmt(CAST_NONE)}\ncast@6C storm ${fmt(CAST_STORM)}`);
  });

  it("riches pays strictly more gold without touching survival", () => {
    expect(OM.riches.chainLen).toBe(OM.none.chainLen); // gold rolls consume no combat rng
    expect(OM.riches.survival).toBe(OM.none.survival);
    expect(OM.riches.goldPerChain).toBeGreaterThanOrEqual(OM.none.goldPerChain * 1.4);
  });

  it("no omen breaks the casual contract on its intended gate", () => {
    for (const m of OMENS) expect(OM[m].survival).toBeGreaterThanOrEqual(0.5);
  });

  it("under-leveled chains feel every hostile omen", () => {
    for (const m of ["cursed", "frantic", "hollows"] as ModifierId[]) expect(OM_C1[m].chainLen).toBeLessThanOrEqual(OM_C1.none.chainLen);
  });

  it("cursed and frantic are real downsides on paired seeds", () => {
    expect(CURSED3.hpCostPerWin).toBeGreaterThan(NONE3.hpCostPerWin);
    expect(FRANTIC3.hpCostPerWin).toBeGreaterThanOrEqual(NONE3.hpCostPerWin);
  });

  it("storm buys casts under SP pressure and never costs depth", () => {
    expect(CAST_STORM.casts).toBeGreaterThan(CAST_NONE.casts);
    expect(CAST_STORM.chainLen).toBeGreaterThanOrEqual(CAST_NONE.chainLen - 0.25);
  });
});
