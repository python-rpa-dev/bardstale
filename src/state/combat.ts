/** Combat ↔ GameState glue: start fights from pending encounters, sync hp/sp back,
 *  and resolve victory / defeat / flee. All mutators take a draft GameState. */

import { startCombat } from "../core/combat";
import { hashStr, mulberry32 } from "../core/rng";
import { BESTIARY, monsterById } from "../data/bestiary";
import { bountyId } from "../data/bounties";
import { gateById } from "../data/gates";
import { ITEMS } from "../data/items";
import type { Family } from "../data/bestiary";
import { perkMult } from "../data/trophies";
import { applyXpToPc, earn } from "./party";
import { endExpedition, isDarkFloor, relicMods } from "./expedition";
import { questKillTick } from "./quests";
import { emptyChronicle, FALLEN_SIZE } from "./save";
import type { GameState } from "./save";

/** Kick off the fight for the encounter waiting in activeGate.pendingMonsters. */
export function beginCombat(d: GameState): void {
  const ag = d.activeGate;
  if (!ag?.pendingMonsters || !ag.pendingMonsters.length) return;
  // deterministic per-encounter seed: same run/floor/step always yields the same fight rolls
  const seed = hashStr(`${ag.seed}:${ag.floor}:${ag.steps}:combat`);
  const m = ag.modifier;
  const def = gateById(ag.gateId);
  const bossFight = !!def.boss && ag.pendingMonsters.length === 1 && ag.pendingMonsters[0] === def.boss;
  d.activeCombat = startCombat(d.party, [...ag.pendingMonsters], {
    seed,
    frantic: m === "frantic",
    critFoe: m === "cursed" ? 0.12 : 0.06, // cursed: enemy crits 6% → 12%
    spellCostMod: m === "storm" ? 2 : 0, // storm: −2 SP per cast (floor 1)
    riches: m === "riches",
    hollows: m === "hollows", // undead +1 level, vermin −1 (foeDef scaling)
    oath: ag.oathDepth, // altar Deep Bargain: foes +1 level, kill gold ×1.5 — all run long
    atkBonus: relicMods(ag).dmgBonus, // Butcher's Hook: every blow, both sides, lands heavier
    healDiscount: d.medals.includes("undead"), // undead medal: heal −2 SP
    guardedStart: d.medals.includes("giant"), // giant medal: start Guarded
    fleeGuaranteed: d.medals.includes("humanoid"), // humanoid medal: always escape intact
    elites: ag.pendingElites,
    boss: bossFight,
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
  eliteLoot?: string[]; // item names granted by elite kills (guaranteed uncommons)
  questNote?: string; // quest-chain link closed by this fight's kills
  trophies?: string[]; // gate ids whose lord's trophy was raised by this kill
}

/** Claim a won fight: XP, gold, codex stamps, bounty kills + medals. */
export function claimVictory(d: GameState): VictorySummary | null {
  const cs = d.activeCombat;
  if (!cs || cs.phase !== "won" || !cs.victory) return null;
  const v = cs.victory;

  const levelsByPc: Record<string, number> = {};
  for (const [pcId, xp] of Object.entries(v.xpByPc)) {
    const res = applyXpToPc(d, pcId, xp);
    if (res.levels > 0) levelsByPc[pcId] = res.levels;
  }

  const gold = Math.floor(v.gold * relicMods(d.activeGate).goldMult); // Grave Coin takes the dead's tithe
  earn(d, gold); // combat gold is claimed immediately, like chest gold — safe from a wipe
  if (d.activeGate) d.activeGate.loot.gold += gold;

  // codex stamps → family medals when a page set completes
  const newMedals: Family[] = [];
  const chron = (d.chronicle ??= emptyChronicle()); // lifetime tally
  for (const f of cs.foes) {
    const def = monsterById(f.mid);
    if (!d.codex.includes(def.id)) d.codex.push(def.id);
    chron.killsByFoe[def.id] = (chron.killsByFoe[def.id] ?? 0) + 1;
    if (d.activeGate) d.activeGate.killsThisRun = (d.activeGate.killsThisRun ?? 0) + 1; // Hall of Runs tally
    const members = BESTIARY.filter((x) => x.family === def.family);
    if (!d.medals.includes(def.family) && members.every((m) => d.codex.includes(m.id))) {
      d.medals.push(def.family);
      newMedals.push(def.family);
      if (d.activeGate) d.activeGate.medalsThisRun = (d.activeGate.medalsThisRun ?? 0) + 1; // trophy line fodder
    }
  }
  chron.battlesWon++;
  chron.bestHit = Math.max(chron.bestHit ?? 0, cs.bestHit ?? 0); // fight ledger → lifetime record
  chron.crits += cs.crits ?? 0;

  // elite kills guarantee an equipment drop, one rarity tier up on black floors (deterministic per fight/slot)
  const eliteLoot: string[] = [];
  // black floors hoard richer spoils: elites there drop rare gear instead of uncommon
  const dark = !!d.activeGate && isDarkFloor(d.activeGate.floor);
  const drops = ITEMS.filter((it) => it.slot !== "consumable" && it.rarity === (dark ? "rare" : "uncommon"));
  cs.foes.forEach((f, i) => {
    if (!f.elite || !drops.length) return;
    const pick = drops[Math.floor(mulberry32(hashStr(`${cs.seed}:elite:${i}`))() * drops.length)];
    d.inventory[pick.id] = (d.inventory[pick.id] ?? 0) + 1;
    if (d.activeGate) d.activeGate.loot.items[pick.id] = (d.activeGate.loot.items[pick.id] ?? 0) + 1;
    eliteLoot.push(pick.name);
  });

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
        payout = Math.floor(payout * perkMult(d.trophies, "bounty")); // Spinner's Idol swells the purse
        earn(d, payout);
        d.bounties.completed.push(activeId);
        d.bounties.active = undefined;
        bountyDone = { family: offer.family, gold: payout };
      }
    }
  }

  // quest-chain slay steps count the same kills, one link at a time
  let questNote: string | undefined;
  for (const f of cs.foes) {
    const note = questKillTick(d, monsterById(f.mid).family);
    if (note) questNote = note;
  }

  // gate lord slain: the final floor is cleared, stairs finish the run next step
  const newTrophies: string[] = [];
  const gateDef = d.activeGate ? gateById(d.activeGate.gateId) : null;
  if (gateDef?.boss && cs.foes.some((f) => f.mid === gateDef.boss)) {
    d.activeGate!.flags["boss"] = true;
    const gid = d.activeGate!.gateId; // the trophy outlives the run — a permanent town perk
    if (!(d.trophies ??= []).includes(gid)) {
      d.trophies.push(gid);
      newTrophies.push(gid);
    }
  }

  syncPartyFromCombat(d);
  if (d.activeGate) {
    delete d.activeGate.pendingMonsters;
    delete d.activeGate.pendingElites;
  }
  delete d.activeCombat;
  return { gold: v.gold, tooWeak: v.tooWeak, levelsByPc, newMedals, bountyDone, questNote, eliteLoot: eliteLoot.length ? eliteLoot : undefined, trophies: newTrophies.length ? newTrophies : undefined };
}

/** Wipe: everyone crawls home at 1 HP and unbanked loot items are forfeited (gold stays banked). */
export function applyDefeat(d: GameState): void {
  (d.chronicle ??= emptyChronicle()).partyWipes++; // the Vale remembers this too
  const ag = d.activeGate;
  if (ag) {
    for (const [id, n] of Object.entries(ag.loot.items)) {
      d.inventory[id] = Math.max(0, (d.inventory[id] ?? 0) - n); // items picked up this run are lost
    }
    ag.loot.items = {};
    // display names follow the same title-case convention as the combat log (see core/combat)
    const killers = [...new Set((ag.pendingMonsters ?? []).map((id) => id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())))];
    (d.fallen ??= []).unshift({
      dayKey: d.dayKey,
      gateId: ag.gateId,
      depth: ag.floor + 1,
      crew: d.party.map((p) => ({ name: p.name, level: p.level })),
      cause: killers.length ? `overwhelmed by ${killers.join(", ")}` : "lost in the dark",
    });
    if (d.fallen.length > FALLEN_SIZE) d.fallen.length = FALLEN_SIZE; // the memorial forgets its oldest name
  }
  for (const p of d.party) p.hp = 1;
  delete d.activeCombat;
  endExpedition(d); // deletes activeGate — the run is over
}

/** Successful flee: the fight dissolves, party stays in the dungeon where it stands. */
export function resolveFlee(d: GameState): void {
  (d.chronicle ??= emptyChronicle()).battlesFled++;
  if (d.activeGate) {
    delete d.activeGate.pendingMonsters;
    delete d.activeGate.pendingElites; // stale elite indices must not leak into the next fight
  }
  delete d.activeCombat;
}
