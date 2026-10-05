/** Combat ↔ GameState glue: start fights from pending encounters, sync hp/sp back,
 *  and resolve victory / defeat / flee. All mutators take a draft GameState. */

import { startCombat } from "../core/combat";
import { hashStr } from "../core/rng";
import { BESTIARY, monsterById } from "../data/bestiary";
import { bountyId } from "../data/bounties";
import type { Family } from "../data/bestiary";
import { applyXpToPc } from "./party";
import { endExpedition } from "./expedition";
import type { GameState } from "./save";

/** Kick off the fight for the encounter waiting in activeGate.pendingMonsters. */
export function beginCombat(d: GameState): void {
  const ag = d.activeGate;
  if (!ag?.pendingMonsters || !ag.pendingMonsters.length) return;
  // deterministic per-encounter seed: same run/floor/step always yields the same fight rolls
  const seed = hashStr(`${ag.seed}:${ag.floor}:${ag.steps}:combat`);
  const m = ag.modifier;
  d.activeCombat = startCombat(d.party, [...ag.pendingMonsters], {
    seed,
    frantic: m === "frantic",
    critFoe: m === "cursed" ? 0.12 : 0.06, // cursed: enemy crits 6% → 12%
    spellCostMod: m === "storm" ? 2 : 0, // storm: −2 SP per cast (floor 1)
    riches: m === "riches",
    hollows: m === "hollows", // undead +1 level, vermin −1 (foeDef scaling)
    healDiscount: d.medals.includes("undead"), // undead medal: heal −2 SP
    guardedStart: d.medals.includes("giant"), // giant medal: start Guarded
    fleeGuaranteed: d.medals.includes("humanoid"), // humanoid medal: always escape intact
  });
}

/** Copy mutable fight fields back to the party + dungeon mirror after every action. */
export function syncPartyFromCombat(d: GameState): void {
  const cs = d.activeCombat;
  if (!cs) return;
  for (const c of cs.pcs) {
    const p = d.party.find((x) => x.id === c.id);
    if (!p) continue;
    p.hp = c.hp;
    p.sp = c.sp;
    p.statuses = c.statuses.map((s) => ({ ...s }));
  }
  if (d.activeGate) {
    d.activeGate.partyHpSp = d.party.map((p) => ({ id: p.id, hp: p.hp, sp: p.sp }));
  }
}

export interface VictorySummary {
  gold: number;
  tooWeak: boolean;
  levelsByPc: Record<string, number>; // pcId → level-ups gained (for sfx/celebration)
  newMedals: Family[]; // families whose codex just completed
  bountyDone?: { family: Family; gold: number }; // active bounty finished by this fight's kills
}

/** Claim a won fight: XP, banked gold, codex stamps, bounty kills + medals. */
export function claimVictory(d: GameState): VictorySummary | null {
  const cs = d.activeCombat;
  if (!cs || cs.phase !== "won" || !cs.victory) return null;
  const v = cs.victory;

  const levelsByPc: Record<string, number> = {};
  for (const [pcId, xp] of Object.entries(v.xpByPc)) {
    const res = applyXpToPc(d, pcId, xp);
    if (res.levels > 0) levelsByPc[pcId] = res.levels;
  }

  // combat gold banks immediately, like chest gold
  d.bank += v.gold;
  if (d.activeGate) d.activeGate.loot.gold += v.gold;

  // codex stamps → family medals when a page set completes
  const newMedals: Family[] = [];
  for (const f of cs.foes) {
    const def = monsterById(f.mid);
    if (!d.codex.includes(def.id)) d.codex.push(def.id);
    const members = BESTIARY.filter((x) => x.family === def.family);
    if (!d.medals.includes(def.family) && members.every((m) => d.codex.includes(m.id))) {
      d.medals.push(def.family);
      newMedals.push(def.family);
    }
  }

  // bounty kill accounting on the accepted offer
  let bountyDone: VictorySummary["bountyDone"];
  const activeId = d.bounties.active;
  if (activeId) {
    const offer = d.bounties.offers.find((o) => bountyId(o) === activeId);
    if (offer && !offer.done) {
      for (const f of cs.foes) {
        if (monsterById(f.mid).family === offer.family) offer.kills++;
      }
      if (offer.kills >= offer.count) {
        offer.done = true;
        let payout = offer.gold;
        if (d.medals.includes("vermin")) payout = Math.floor(payout * 1.1); // vermin medal: +10% bounty gold
        d.bank += payout;
        d.bounties.completed.push(activeId);
        d.bounties.active = undefined;
        bountyDone = { family: offer.family, gold: payout };
      }
    }
  }

  syncPartyFromCombat(d);
  if (d.activeGate) delete d.activeGate.pendingMonsters;
  delete d.activeCombat;
  return { gold: v.gold, tooWeak: v.tooWeak, levelsByPc, newMedals, bountyDone };
}

/** Wipe: everyone crawls home at 1 HP and unbanked loot items are forfeited (gold stays banked). */
export function applyDefeat(d: GameState): void {
  const ag = d.activeGate;
  if (ag) {
    for (const [id, n] of Object.entries(ag.loot.items)) {
      d.inventory[id] = Math.max(0, (d.inventory[id] ?? 0) - n); // items picked up this run are lost
    }
    ag.loot.items = {};
  }
  for (const p of d.party) p.hp = 1;
  delete d.activeCombat;
  endExpedition(d); // deletes activeGate — the run is over
}

/** Successful flee: the fight dissolves, party stays in the dungeon where it stands. */
export function resolveFlee(d: GameState): void {
  if (d.activeGate) delete d.activeGate.pendingMonsters;
  delete d.activeCombat;
}
