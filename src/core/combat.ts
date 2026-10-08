/** Turn-based combat simulation. Pure: no DOM, rng passed in as (seed, calls) so the
 *  stream survives reloads and Quick Resolve replays the exact same rolls. */

import { monsterById, type MonsterDef } from "../data/bestiary";
import { itemById } from "../data/items";
import { spellById } from "../data/spells";
import { xpMult } from "../data/progression";
import { randInt, type Rng } from "./rng";
import { critChanceBonus, effectiveStats } from "../state/party";
import type { Pc, StatusMark } from "../state/save";
import { pcMax } from "../state/save";

// ---------- Persisted combat state ----------

export interface CombatFoe {
  mid: string; // bestiary id
  hp: number;
  lastBreathRound: number; // wyrm-whelp breath bookkeeping (0 = never)
  lvlShift?: number; // "hollows" modifier: undead +1 / vermin −1 effective level
  elite?: boolean; // pack alpha: +1 effective level, ×1.5 XP, ×2 gold, guaranteed drop
  boss?: boolean; // gate lord: enrages below 30% max HP (see enraged)
  maxHp?: number; // starting HP for bosses — the enrage threshold reference
  enraged?: boolean; // one-time trigger at ≤30% HP: +50% damage dealt
}

/** Effective def view for a foe with the "hollows" ±1 level shift: hp/atk scale ±12% per level. */
export function foeDef(f: Pick<CombatFoe, "mid" | "lvlShift">): MonsterDef {
  const d = monsterById(f.mid);
  if (!f.lvlShift) return d;
  const k = 1 + 0.12 * f.lvlShift;
  return {
    ...d,
    lvl: Math.max(1, d.lvl + f.lvlShift),
    hp: Math.max(1, Math.round(d.hp * k)),
    atk: Math.max(1, Math.round(d.atk * k)),
  };
}

/** A party member snapshot plus combat-only flags. The Pc fields are the source of
 *  truth while a fight runs; they sync back to state.party on every commit. */
export interface CombatPc extends Pc {
  guard: boolean; // halves incoming damage until this PC's next turn
  guardedFree: boolean; // giant-medal perk: first hit taken is halved, once per combat
  atkBuff: number; // elixir-might: +ATK for this combat
}

export type CombatSide = "pc" | "foe";

export interface CombatState {
  seed: number; // fight rng stream seed
  calls: number; // rng values consumed so far — resume the stream after reloads
  round: number; // 1-based
  order: [CombatSide, number][]; // initiative queue (DEX + 0..5 at start)
  turnPtr: number; // index into order for the combatant acting now
  foesActed: boolean; // false until any foe has taken a turn (rogue first-strike window)
  frantic: boolean; // "frantic" modifier: foes act before PCs during round 1
  critFoe: number; // enemy crit chance ("cursed" raises 0.06 → 0.12)
  spellCostMod: number; // "storm": −2 SP per cast (applied via spCostFor)
  riches: boolean; // +50% gold on victory rolls
  pocketLuck: boolean; // living rogue: +3 gold per kill
  healDiscount: boolean; // undead medal: heal costs −2 SP
  fleeGuaranteed: boolean; // humanoid medal: escape always succeeds (won-fight gold is already claimed)
  blessDef: number; // party-wide DEF bonus for the combat (bless)
  tauntPc: number | null; // fighter who taunted: highest-ATK foe must target them
  pcs: CombatPc[];
  foes: CombatFoe[];
  phase: "input" | "won" | "lost" | "fled";
  victory?: VictoryTally;
  log: string[]; // capped ticker, persisted so a reload restores the fight story
}

export interface VictoryTally {
  xpByPc: Record<string, number>; // per-PC XP after the level-difference tax
  gold: number; // rolled kill gold (riches/pocket-luck applied)
  tooWeak: boolean; // any mob taxed below 0.5 — UI shows the "too weak" warning
}

// ---------- Events for the UI layer (floaters, sfx) ----------

export interface CombatEvent {
  kind: "hit" | "crit" | "miss" | "spell" | "heal" | "status" | "drain" | "breath" | "death";
  src?: [CombatSide, number];
  dst?: [CombatSide, number];
  amount?: number;
  text: string;
}

// ---------- rng stream ----------

/** A mulberry32 stream that counts its own draws so persistence can resume it. */
export interface CountedRng extends Rng {
  calls(): number;
}

export function countedStream(mulberrySeed: number, alreadyConsumed = 0): CountedRng {
  let a = mulberrySeed | 0;
  const step = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 * t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < alreadyConsumed; i++) step(); // resume a persisted stream
  let n = alreadyConsumed;
  const next = (() => {
    n++;
    return step();
  }) as CountedRng;
  next.calls = () => n;
  return next;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Hit chance per plan M6: 0.8 + 3%·ΔDEX + 2%·Δlevel, clamped to [0.25, 0.97]. */
export function hitChance(aDex: number, dDex: number, aLvl: number, dLvl: number): number {
  return clamp(0.8 + 0.03 * (aDex - dDex) + 0.02 * (aLvl - dLvl), 0.25, 0.97);
}

/** Flee chance per plan M6: 0.5 + 3%·(partyAvgDex − foeAvgDex), floor 0.1. */
export function fleeChance(partyAvgDex: number, foeAvgDex: number): number {
  return clamp(0.5 + 0.03 * (partyAvgDex - foeAvgDex), 0.1, 1);
}

/** SP cost after "storm" and the undead-medal heal discount (both floor at 1). */
export function spCostFor(spellId: string, cs: Pick<CombatState, "spellCostMod" | "healDiscount">): number {
  const def = spellById(spellId);
  let cost = def.sp - cs.spellCostMod;
  if (cs.healDiscount && spellId === "heal") cost -= 2;
  return Math.max(1, cost);
}

/** Effective stats for a combat PC: gear + poison −DEX via the shared party helper. */
export function pcStats(cs: CombatState, idx: number): { atk: number; def: number; dex: number; mnd: number } {
  const p = cs.pcs[idx];
  const s = effectiveStats(p); // Pc-shaped snapshot → base+gear−poison
  return { ...s, atk: s.atk + p.atkBuff };
}

const pcAlive = (p: CombatPc): boolean => p.hp > 0;
const foeAlive = (f: CombatFoe): boolean => f.hp > 0;

function alivePcIdxs(cs: CombatState): number[] {
  return cs.pcs.map((p, i) => (pcAlive(p) ? i : -1)).filter((i) => i >= 0);
}
function aliveFoeIdxs(cs: CombatState): number[] {
  return cs.foes.map((f, i) => (foeAlive(f) ? i : -1)).filter((i) => i >= 0);
}

const titleCase = (id: string): string =>
  id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function pushLog(cs: CombatState, line: string): void {
  cs.log.push(line);
  if (cs.log.length > 80) cs.log.shift();
}

// ---------- setup ----------

export interface StartOpts {
  seed: number;
  frantic?: boolean;
  critFoe?: number; // default 0.06; "cursed" passes 0.12
  spellCostMod?: number; // "storm": 2
  riches?: boolean;
  hollows?: boolean; // "hollows": undead +1 level, vermin −1 (see foeDef)
  healDiscount?: boolean; // undead medal
  guardedStart?: boolean; // giant medal: every PC starts with a free half-hit
  fleeGuaranteed?: boolean; // humanoid medal
  elites?: number[]; // indices into foeIds that spawn as elites (+1 lvl via lvlShift)
  boss?: boolean; // single-foe gate-lord fight: sets boss/maxHp for enrage
}

export function startCombat(pcs: Pc[], foeIds: string[], opts: StartOpts): CombatState {
  const rng = countedStream(opts.seed);
  const cs: CombatState = {
    seed: opts.seed,
    calls: 0,
    round: 1,
    order: [],
    turnPtr: 0,
    foesActed: false,
    frantic: !!opts.frantic,
    critFoe: opts.critFoe ?? 0.06,
    spellCostMod: opts.spellCostMod ?? 0,
    riches: !!opts.riches,
    pocketLuck: pcs.some((p) => p.classId === "rogue"),
    healDiscount: !!opts.healDiscount,
    blessDef: 0,
    tauntPc: null,
    fleeGuaranteed: !!opts.fleeGuaranteed,
    pcs: pcs.map((p) => ({ ...p, statuses: [...p.statuses], guard: false, guardedFree: !!opts.guardedStart, atkBuff: 0 })),
    foes: foeIds.map((mid, i) => {
      const fam = monsterById(mid).family;
      let shift = opts.hollows ? (fam === "undead" ? 1 : fam === "vermin" ? -1 : 0) : 0;
      const elite = opts.elites?.includes(i) ?? false;
      if (elite) shift += 1; // elites stack a level on top of hollows
      const hp = Math.max(1, Math.round(monsterById(mid).hp * (1 + 0.12 * shift)));
      const boss = !!opts.boss && foeIds.length === 1;
      return { mid, hp, lastBreathRound: 0, lvlShift: shift || undefined, elite: elite || undefined, boss: boss || undefined, maxHp: boss ? hp : undefined };
    }),
    phase: "input",
    log: [],
  };
  // Initiative once at start: DEX + rng(0..5); ties favor PCs (stable by side then index).
  const entries: { side: CombatSide; idx: number; init: number }[] = [
    ...cs.pcs.map((p, i) => ({ side: "pc" as CombatSide, idx: i, init: effectiveStats(p).dex + randInt(rng, 0, 5) })),
    ...cs.foes.map((f, i) => ({ side: "foe" as CombatSide, idx: i, init: foeDef(f).dex + randInt(rng, 0, 5) })),
  ];
  entries.sort((a, b) => b.init - a.init || (a.side === b.side ? 0 : a.side === "pc" ? -1 : 1));
  cs.order = entries.map((e) => [e.side, e.idx]);
  cs.calls = rng.calls();
  const names = foeIds.map((id, i) => `${opts.elites?.includes(i) ? "Elite " : ""}${titleCase(id)}${foeIds.filter((x) => x === id).length > 1 ? ` ${i + 1}` : ""}`);
  pushLog(cs, opts.boss && foeIds.length === 1 ? `The ${names[0]} lifts its head from the hoard — the gate lord has noticed you.` : foeIds.length === 1 ? `A ${names[0]} blocks the way!` : `${names.join(", ")} block the way!`);
   normalizeActiveTurn(cs);
   return cs;
}

// ---------- damage application (shared by foes and breath) ----------

/** Apply physical/spell damage to a PC honoring guard and the giant-medal free half-hit. */
function hurtPc(cs: CombatState, idx: number, dmg: number): number {
  const p = cs.pcs[idx];
  let d = dmg;
  if (p.guard) d = Math.floor(d / 2);
  if (p.guardedFree) {
    d = Math.floor(d / 2);
    p.guardedFree = false;
  }
  d = Math.max(1, d); // guard never fully negates a hit that landed
  p.hp = Math.max(0, p.hp - d);
  return d;
}

// ---------- PC actions ----------

export function pcAttack(cs: CombatState, pcIdx: number, foeIdx: number): CombatEvent[] {
  const evs: CombatEvent[] = [];
  if (cs.phase !== "input") return evs;
  const p = cs.pcs[pcIdx];
  const f = cs.foes[foeIdx];
  if (!p || !f || !pcAlive(p) || !foeAlive(f)) return evs;
  const rng = countedStream(cs.seed, cs.calls);
  const a = pcStats(cs, pcIdx);
  const fd = foeDef(f);
  // Rogue first-strike: during round 1 before any foe has acted, rogue attacks auto-crit.
  const firstStrike = p.classId === "rogue" && cs.round === 1 && !cs.foesActed;
  const critRoll = rng();
  const isCrit = firstStrike || critRoll < 0.06 + critChanceBonus(p);
  if (rng() >= hitChance(a.dex, fd.dex, p.level, fd.lvl)) {
    cs.calls = rng.calls();
    pushLog(cs, `${p.name} swings at the ${titleCase(f.mid)} — misses.`);
    evs.push({ kind: "miss", src: ["pc", pcIdx], dst: ["foe", foeIdx], text: "miss" });
    return evs;
  }
  let dmg = Math.max(1, Math.round(a.atk * (0.85 + rng() * 0.3)) - Math.floor(fd.def / 2));
  if (isCrit) dmg *= 2;
  f.hp = Math.max(0, f.hp - dmg);
  cs.calls = rng.calls();
  pushLog(cs, isCrit ? `${p.name} CRITS the ${titleCase(f.mid)} for ${dmg}!` : `${p.name} hits the ${titleCase(f.mid)} for ${dmg}.`);
  evs.push({ kind: isCrit ? "crit" : "hit", src: ["pc", pcIdx], dst: ["foe", foeIdx], amount: dmg, text: String(dmg) });
  if (!foeAlive(f)) {
    pushLog(cs, `The ${titleCase(f.mid)} falls!`);
    evs.push({ kind: "death", dst: ["foe", foeIdx], text: "" });
  }
  return finishTurn(cs, evs);
}

export function pcCast(cs: CombatState, pcIdx: number, spellId: string, targetIdx = -1): CombatEvent[] {
  const evs: CombatEvent[] = [];
  if (cs.phase !== "input") return evs;
  const p = cs.pcs[pcIdx];
  const cost = spCostFor(spellId, cs);
  if (!p || !pcAlive(p) || p.sp < cost) return evs;
  const rng = countedStream(cs.seed, cs.calls);
  p.sp -= cost;
  const mnd = pcStats(cs, pcIdx).mnd;
  const def = spellById(spellId);

  if (spellId === "heal") {
    const t = targetIdx >= 0 && pcAlive(cs.pcs[targetIdx]) ? targetIdx : alivePcIdxs(cs)[0];
    const amt = 8 + mnd;
    const before = cs.pcs[t].hp;
    cs.pcs[t].hp = Math.min(pcMax(cs.pcs[t]).hp, cs.pcs[t].hp + amt);
    pushLog(cs, `${p.name} heals ${cs.pcs[t].name} for ${cs.pcs[t].hp - before}.`);
    evs.push({ kind: "heal", src: ["pc", pcIdx], dst: ["pc", t], amount: cs.pcs[t].hp - before, text: `+${cs.pcs[t].hp - before}` });
  } else if (spellId === "bless") {
    cs.blessDef += 3;
    pushLog(cs, `${p.name} blesses the party — DEF +3 for this fight.`);
    evs.push({ kind: "status", src: ["pc", pcIdx], text: "DEF+3" });
  } else if (spellId === "purify") {
    const t = targetIdx >= 0 && pcAlive(cs.pcs[targetIdx]) ? targetIdx : alivePcIdxs(cs)[0];
    cs.pcs[t].statuses = [];
    pushLog(cs, `${p.name} purifies ${cs.pcs[t].name}.`);
    evs.push({ kind: "status", src: ["pc", pcIdx], dst: ["pc", t], text: "cleanse" });
  } else if (spellId === "taunt") {
    cs.tauntPc = pcIdx;
    pushLog(cs, `${p.name} taunts the monsters — the biggest one will come for them.`);
    evs.push({ kind: "status", src: ["pc", pcIdx], text: "taunt" });
  } else if (spellId === "mass-heal") {
    for (const t of alivePcIdxs(cs)) {
      const amt = 6 + mnd;
      const before = cs.pcs[t].hp;
      cs.pcs[t].hp = Math.min(pcMax(cs.pcs[t]).hp, cs.pcs[t].hp + amt);
      pushLog(cs, `${p.name} mends ${cs.pcs[t].name} for ${cs.pcs[t].hp - before}.`);
      evs.push({ kind: "heal", src: ["pc", pcIdx], dst: ["pc", t], amount: cs.pcs[t].hp - before, text: `+${cs.pcs[t].hp - before}` });
    }
  } else {
    // damage spells always hit; reduced by target MR (min 1)
    const targets = def.target === "all-foes" ? aliveFoeIdxs(cs) : [targetIdx >= 0 && foeAlive(cs.foes[targetIdx]) ? targetIdx : aliveFoeIdxs(cs)[0]];
    for (const t of targets) {
      if (!targets.length || t === undefined) continue;
      const f = cs.foes[t];
      const fd = foeDef(f);
      let base: number;
      let critChance = 0.06;
      if (spellId === "magic-missile") base = 6 + mnd;
      else if (spellId === "flame-wave") base = Math.round(mnd * 0.8);
      else if (spellId === "lightning") { base = mnd + randInt(rng, 0, 8); critChance += 0.1; }
      else if (spellId === "power-strike") base = Math.round(pcStats(cs, pcIdx).atk * 1.8);
      else if (spellId === "cleave") base = Math.round(pcStats(cs, pcIdx).atk * 1.2);
      else if (spellId === "frost-nova") base = Math.round(mnd * 1.2);
      else throw new Error(`unhandled damage spell ${spellId}`);
      let dmg = Math.max(1, base - fd.mr);
      // power-strike ignores half DEF: normal formula subtracts floor(DEF/2), this subtracts a quarter; cleave is physical — full half-DEF
      if (spellId === "power-strike") dmg = Math.max(1, base - Math.floor(fd.def / 4));
      else if (spellId === "cleave") dmg = Math.max(1, base - Math.floor(fd.def / 2));
      const crit = rng() < critChance;
      if (crit) dmg *= 2;
      f.hp = Math.max(0, f.hp - dmg);
      pushLog(cs, crit ? `${def.name} CRITS the ${titleCase(f.mid)} for ${dmg}!` : `${def.name} ${spellId === "cleave" ? "slashes" : "sears"} the ${titleCase(f.mid)} for ${dmg}.`);
      evs.push({ kind: crit ? "crit" : "spell", src: ["pc", pcIdx], dst: ["foe", t], amount: dmg, text: String(dmg) });
      if (!foeAlive(f)) {
        pushLog(cs, `The ${titleCase(f.mid)} falls!`);
        evs.push({ kind: "death", dst: ["foe", t], text: "" });
      }
    }
  }
  cs.calls = rng.calls();
  return finishTurn(cs, evs);
}

export function pcGuard(cs: CombatState, pcIdx: number): CombatEvent[] {
  const evs: CombatEvent[] = [];
  if (cs.phase !== "input") return evs;
  const p = cs.pcs[pcIdx];
  if (!p || !pcAlive(p)) return evs;
  p.guard = true;
  pushLog(cs, `${p.name} raises their guard.`);
  evs.push({ kind: "status", src: ["pc", pcIdx], text: "guard" });
  return finishTurn(cs, evs);
}

export function pcUse(cs: CombatState, pcIdx: number, itemId: string, targetIdx = -1): { events: CombatEvent[]; consumed: boolean } {
  const evs: CombatEvent[] = [];
  if (cs.phase !== "input") return { events: evs, consumed: false };
  const p = cs.pcs[pcIdx];
  if (!p || !pcAlive(p)) return { events: evs, consumed: false };
  const item = itemById(itemId);
  if (!item.use || item.use.kind === "light") return { events: evs, consumed: false }; // torches are for walking, not fighting
  switch (item.use.kind) {
    case "restore-hp": {
      const before = p.hp;
      p.hp = Math.min(pcMax(p).hp, p.hp + item.use.amount);
      pushLog(cs, `${p.name} drinks a Health Potion (+${p.hp - before} HP).`);
      evs.push({ kind: "heal", src: ["pc", pcIdx], dst: ["pc", pcIdx], amount: p.hp - before, text: `+${p.hp - before}` });
      break;
    }
    case "restore-sp": {
      const before = p.sp;
      p.sp = Math.min(pcMax(p).sp, p.sp + item.use.amount);
      pushLog(cs, `${p.name} drinks a Mana Potion (+${p.sp - before} SP).`);
      evs.push({ kind: "heal", src: ["pc", pcIdx], dst: ["pc", pcIdx], amount: p.sp - before, text: `+${p.sp - before}` });
      break;
    }
    case "combat-atk-buff": {
      p.atkBuff += item.use.amount;
      pushLog(cs, `${p.name} quaffs an Elixir of Might (ATK +${item.use.amount} this fight).`);
      evs.push({ kind: "status", src: ["pc", pcIdx], text: `ATK+${item.use.amount}` });
      break;
    }
    case "party-heal": {
      for (const i of alivePcIdxs(cs)) {
        const before = cs.pcs[i].hp;
        cs.pcs[i].hp = Math.min(pcMax(cs.pcs[i]).hp, cs.pcs[i].hp + item.use.amount);
        evs.push({ kind: "heal", dst: ["pc", i], amount: cs.pcs[i].hp - before, text: `+${cs.pcs[i].hp - before}` });
      }
      pushLog(cs, `${p.name} reads a Scroll of Healing — the party mends.`);
      break;
    }
  }
  void targetIdx;
  return { events: finishTurn(cs, evs), consumed: true };
}

// ---------- turn / round machinery ----------

/** Effective initiative order for this moment (frantic shuffles round 1 only). */
export function effectiveOrder(cs: CombatState): [CombatSide, number][] {
  if (cs.frantic && cs.round === 1) {
    return [...cs.order.filter((e) => e[0] === "foe"), ...cs.order.filter((e) => e[0] === "pc")];
  }
  return cs.order;
}

/** Advance to the next living combatant; wrap = end of round. Clears guard at owner's turn start. */
function finishTurn(cs: CombatState, evs: CombatEvent[]): CombatEvent[] {
  checkEnd(cs);
  if (cs.phase !== "input") return evs;
  const order = effectiveOrder(cs);
  let ptr = cs.turnPtr + 1;
  for (;;) {
    if (ptr >= order.length) {
      endOfRound(cs);
      ptr = 0;
      if (cs.phase !== "input") return evs;
    }
    const [side, idx] = order[ptr];
    const alive = side === "pc" ? pcAlive(cs.pcs[idx]) : foeAlive(cs.foes[idx]);
    if (!alive) { ptr++; continue; }
    if (side === "pc") cs.pcs[idx].guard = false; // guard lasts exactly until their next turn
    break;
  }
  cs.turnPtr = ptr;
  return evs;
}

/** Invariant repair: while phase is "input", turnPtr must point to a living combatant.
 *  A party member already downed in the dungeon can hold initiative at fight start;
 *  without this, every verb and quickResolve would spin forever on their empty turn. */
export function normalizeActiveTurn(cs: CombatState): void {
  if (cs.phase !== "input") return;
  checkEnd(cs); // a fully downed party entering the fight loses immediately
  if (cs.phase !== "input") return;
  const order = effectiveOrder(cs);
  for (let ptr = 0; ptr < order.length; ptr++) {
    const [side, idx] = order[ptr];
    if (side === "pc" ? pcAlive(cs.pcs[idx]) : foeAlive(cs.foes[idx])) {
      cs.turnPtr = ptr;
      return;
    }
  }
}

function endOfRound(cs: CombatState): void {
  const rng = countedStream(cs.seed, cs.calls);
  // status ticks
  for (const p of cs.pcs) {
    if (!pcAlive(p)) continue;
    for (const s of p.statuses) s.roundsLeft--;
    const before = p.statuses.length;
    p.statuses = p.statuses.filter((s) => s.roundsLeft > 0);
    if (p.statuses.length !== before) pushLog(cs, `${p.name} shrugs off a lingering ailment.`);
  }
  // troll regen
  for (const f of cs.foes) {
    const fd = foeDef(f);
    if (foeAlive(f) && fd.special?.kind === "regen") {
      f.hp = Math.min(fd.hp, f.hp + fd.special.hpPerRound);
    }
  }
  // wraith drain: each living wraith siphons SP from a random living PC
  for (const f of cs.foes) {
    const fd = foeDef(f);
    if (!foeAlive(f) || fd.special?.kind !== "drain") continue;
    const victims = alivePcIdxs(cs);
    if (!victims.length) break;
    const t = victims[randInt(rng, 0, victims.length - 1)];
    const drained = Math.min(fd.special.spPerTurn, cs.pcs[t].sp);
    cs.pcs[t].sp -= drained;
    pushLog(cs, `The wraith siphons ${drained} SP from ${cs.pcs[t].name}.`);
  }
  cs.calls = rng.calls();
  cs.round++;
  // clear taunt each round boundary — it only binds "next round"
  if (cs.tauntPc !== null) cs.tauntPc = null;
}

function checkEnd(cs: CombatState): void {
  const foesLeft = aliveFoeIdxs(cs).length;
  const pcsLeft = alivePcIdxs(cs).length;
  if (!foesLeft) {
    cs.phase = "won";
    cs.victory = tallyVictory(cs);
    pushLog(cs, "The last foe falls. Victory!");
  } else if (!pcsLeft) {
    cs.phase = "lost";
    pushLog(cs, "The party falls…");
  }
}

/** XP after the level-difference tax + gold roll (riches ×1.5, pocket-luck +3/kill). */
export function tallyVictory(cs: CombatState): VictoryTally {
  const avg = cs.pcs.reduce((a, p) => a + p.level, 0) / Math.max(1, cs.pcs.length);
  let tooWeak = false;
  const xpByPc: Record<string, number> = {};
  for (const p of cs.pcs) {
    let xp = 0;
    for (const f of cs.foes) {
      const fd = foeDef(f);
      const mult = xpMult(fd.lvl, avg);
      if (mult < 0.5) tooWeak = true;
      xp += fd.xp * mult * (f.elite ? 1.5 : 1);
    }
    xpByPc[p.id] = Math.round(xp);
  }
  const rng = countedStream(cs.seed ^ 0x9e3779b9, 0); // gold rolls use a separate stream: victory math must not shift the fight stream
  let gold = 0;
  const rogueAlive = cs.pocketLuck && cs.pcs.some((p) => p.classId === "rogue" && pcAlive(p));
  for (const f of cs.foes) {
    const fd = foeDef(f);
    let g = randInt(rng, fd.gold[0], fd.gold[1]);
    if (cs.riches) g = Math.floor(g * 1.5);
    if (rogueAlive) g += 3;
    gold += f.elite ? g * 2 : g; // elites pay double
  }
  return { xpByPc, gold, tooWeak };
}

// ---------- foe turn ----------

export function foeAct(cs: CombatState, foeIdx: number): CombatEvent[] {
  const evs: CombatEvent[] = [];
  if (cs.phase !== "input") return evs;
  const rng = countedStream(cs.seed, cs.calls);
  const f = cs.foes[foeIdx];
  if (!f || !foeAlive(f)) return finishTurn(cs, evs);
  const fd = foeDef(f);
  // gate-lord enrage: one-time at ≤30% max HP, +50% damage from then on (breath included)
  if (f.boss && !f.enraged && f.maxHp && f.hp <= Math.ceil(0.3 * f.maxHp)) {
    f.enraged = true;
    pushLog(cs, `The ${titleCase(f.mid)} swells with fury — its eyes burn!`);
  }
  const fury = f.enraged ? 1.5 : 1;

  // wyrm breath: every `everyRounds` rounds instead of a bite
  const br = fd.special?.kind === "breath" ? fd.special : null;
  if (br && cs.round - f.lastBreathRound >= br.everyRounds) {
    f.lastBreathRound = cs.round;
    for (const t of alivePcIdxs(cs)) {
      const mnd = pcStats(cs, t).mnd;
      const dmg = hurtPc(cs, t, Math.max(1, Math.round((br.base - mnd) * fury)));
      pushLog(cs, `The ${titleCase(f.mid)} breathes fire on ${cs.pcs[t].name} for ${dmg}.`);
      evs.push({ kind: "breath", src: ["foe", foeIdx], dst: ["pc", t], amount: dmg, text: String(dmg) });
    }
    cs.calls = rng.calls();
    for (const [pi, pv] of cs.pcs.entries()) {
      if (!pcAlive(pv) && !evs.some((e) => e.kind === "death" && e.dst?.[0] === "pc" && e.dst[1] === pi)) {
        pushLog(cs, `${pv.name} falls!`);
        evs.push({ kind: "death", dst: ["pc", pi], text: "" });
      }
    }
    return finishTurn(cs, evs);
  }

  // target: taunt binds the highest-ATK foe; otherwise random living PC
  const victims = alivePcIdxs(cs);
  if (!victims.length) return finishTurn(cs, evs);
  let t: number;
  if (cs.tauntPc !== null && pcAlive(cs.pcs[cs.tauntPc]) && fd.atk === Math.max(...aliveFoeIdxs(cs).map((i) => monsterById(cs.foes[i].mid).atk))) {
    t = cs.tauntPc;
  } else {
    t = victims[randInt(rng, 0, victims.length - 1)];
  }
  const p = cs.pcs[t];
  const d = pcStats(cs, t);
  if (rng() >= hitChance(fd.dex, d.dex, fd.lvl, p.level)) {
    cs.calls = rng.calls();
    pushLog(cs, `The ${titleCase(f.mid)} snaps at ${p.name} — misses.`);
    evs.push({ kind: "miss", src: ["foe", foeIdx], dst: ["pc", t], text: "miss" });
    return finishTurn(cs, evs);
  }
  let dmg = Math.max(1, Math.round(fd.atk * (0.85 + rng() * 0.3)) - Math.floor((d.def + cs.blessDef) / 2));
  const crit = rng() < cs.critFoe;
  if (crit) dmg *= 2;
  if (f.enraged) dmg = Math.round(dmg * 1.5);
  const applied = hurtPc(cs, t, dmg);
  cs.calls = rng.calls();
  pushLog(cs, crit ? `The ${titleCase(f.mid)} CRITS ${p.name} for ${applied}!` : `The ${titleCase(f.mid)} hits ${p.name} for ${applied}.`);
  evs.push({ kind: crit ? "crit" : "hit", src: ["foe", foeIdx], dst: ["pc", t], amount: applied, text: String(applied) });
  // spider poison on a damaging hit refreshes the mark
  if (fd.special?.kind === "poison") {
    const mark = p.statuses.find((s) => s.kind === "poison");
    if (mark) mark.roundsLeft = fd.special.rounds;
    else p.statuses.push({ kind: "poison", roundsLeft: fd.special.rounds } as StatusMark);
    pushLog(cs, `${p.name} is poisoned! (−1 DEX, ${fd.special.rounds} rounds)`);
    evs.push({ kind: "status", dst: ["pc", t], text: "poison" });
  }
  if (!pcAlive(p)) {
    pushLog(cs, `${p.name} falls!`);
    evs.push({ kind: "death", dst: ["pc", t], text: "" });
  }
  cs.foesActed = true;
  return finishTurn(cs, evs);
}

// ---------- flee ----------

export function tryFlee(cs: CombatState): { events: CombatEvent[]; escaped: boolean } {
  if (cs.fleeGuaranteed) {
    cs.phase = "fled";
    pushLog(cs, "The party melts into the shadows — nothing can hold them.");
    return { events: [{ kind: "status", text: "fled" }], escaped: true };
  }
  const rng = countedStream(cs.seed, cs.calls);
  const partyAvgDex = avg(alivePcIdxs(cs).map((i) => pcStats(cs, i).dex));
  const foeAvgDex = avg(aliveFoeIdxs(cs).map((i) => monsterById(cs.foes[i].mid).dex));
  const chance = fleeChance(partyAvgDex, foeAvgDex);
  const escaped = rng() < chance;
  cs.calls = rng.calls();
  if (escaped) {
    cs.phase = "fled";
    pushLog(cs, "The party slips away into the dark.");
    return { events: [{ kind: "status", text: "fled" }], escaped };
  }
  pushLog(cs, "No escape — the foes cut them off!");
  // fleeing costs the whole round's initiative: advance to next combatant normally
  const evs = [{ kind: "miss" as const, text: "fail" }];
  return { events: finishTurn(cs, evs), escaped: false };
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ---------- quick resolve ----------

/** Run the rest of the fight headlessly on the same rng stream. PCs auto-attack;
 *  returns every event so the UI can fast-forward floaters/log. */
export function quickResolve(cs: CombatState): CombatEvent[] {
  const all: CombatEvent[] = [];
  let guardCap = 600; // hard stop for degenerate stalemates (all miss forever)
  while (cs.phase === "input" && guardCap-- > 0) {
    const [side, idx] = effectiveOrder(cs)[cs.turnPtr];
    if (side === "pc" ? !pcAlive(cs.pcs[idx]) : !foeAlive(cs.foes[idx])) {
      finishTurn(cs, []); // stale pointer onto a downed combatant — advance, never stall
      continue;
    }
    if (side === "pc") {
      const target = aliveFoeIdxs(cs)[0];
      all.push(...(target !== undefined ? pcAttack(cs, idx, target) : finishTurn(cs, [])));
    } else {
      all.push(...foeAct(cs, idx));
    }
  }
  return all;
}
