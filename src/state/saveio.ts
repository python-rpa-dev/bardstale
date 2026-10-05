import { FAMILIES, type Family } from "../data/bestiary";
import { CLASSES, type ClassId } from "../data/classes";
import type { ActiveGate, GameState, Pc, Settings, StatusMark } from "./save";

/**
 * Save-code import. Export is just `serialize(state)` — the state carries its
 * own `version`, so a code is plain JSON. Import re-validates everything the
 * UI and simulation dereference, then rebuilds the object from whitelisted
 * fields only: junk keys can never ride into the live store.
 */

export type ImportResult = { ok: true; state: GameState } | { ok: false; error: string };

const CLASS_IDS = new Set<string>(CLASSES.map((c) => c.id));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FAMILY_SET = new Set<string>(FAMILIES);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function int(v: unknown): v is number {
  return num(v) && Number.isInteger(v);
}
function str(v: unknown): v is string {
  return typeof v === "string";
}
function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Membership guards so validated strings narrow to their union types — no casts on parsed data. */
function isClassId(v: string): v is ClassId {
  return CLASS_IDS.has(v);
}
function isFamily(v: string): v is Family {
  return FAMILY_SET.has(v);
}
const fail = (error: string): ImportResult => ({ ok: false, error });

/** A finite stat within sane bounds, or null — narrows without casting. */
function stat(v: unknown): number | null {
  return num(v) && v >= 0 && v <= 1_000_000 ? v : null;
}
function nonNegInt(v: unknown): number {
  return int(v) && v >= 0 ? v : 0;
}

function parsePc(raw: Record<string, unknown>): Pc | null {
  if (!str(raw.id) || !str(raw.name)) return null;
  if (!str(raw.classId) || !isClassId(raw.classId)) return null;
  const level = int(raw.level) && raw.level >= 1 && raw.level <= 99 ? raw.level : null;
  if (level === null) return null;
  const xp = stat(raw.xp);
  const hp = stat(raw.hp);
  const sp = stat(raw.sp);
  const points = stat(raw.points);
  if (xp === null || hp === null || sp === null || points === null) return null;
  const a = isObj(raw.alloc) ? raw.alloc : {};
  const alloc = { atk: nonNegInt(a.atk), def: nonNegInt(a.def), dex: nonNegInt(a.dex), mnd: nonNegInt(a.mnd) };
  const g = isObj(raw.gear) ? raw.gear : {};
  const gear: Pc["gear"] = {};
  for (const slot of ["weapon", "armor", "trinket"] as const) {
    if (str(g[slot])) gear[slot] = g[slot];
  }
  const statuses: StatusMark[] = [];
  if (Array.isArray(raw.statuses)) {
    for (const mark of raw.statuses) {
      if (!isObj(mark)) continue;
      const kind = mark.kind === "poison" || mark.kind === "wound" ? mark.kind : null;
      if (kind && int(mark.roundsLeft) && mark.roundsLeft >= 0) statuses.push({ kind, roundsLeft: mark.roundsLeft });
    }
  }
  return { id: raw.id, classId: raw.classId, name: raw.name.slice(0, 40), level, xp, hp, sp, points, alloc, gear, statuses };
}

/** Light structural check — enough that the dungeon screen can render it. */
function validGate(raw: unknown): boolean {
  if (!isObj(raw)) return false;
  const g = raw;
  return (
    str(g.gateId) &&
    int(g.floor) &&
    g.floor >= 0 &&
    num(g.seed) &&
    isObj(g.pos) &&
    int(g.pos.x) &&
    int(g.pos.y) &&
    (g.dir === 0 || g.dir === 1 || g.dir === 2 || g.dir === 3) &&
    Array.isArray(g.partyHpSp) &&
    Array.isArray(g.visited)
  );
}

/** Parse + validate a save code. Never throws; rejects with a readable reason. */
export function importSave(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("That is not valid JSON.");
  }
  if (!isObj(parsed)) return fail("A save code must be a single JSON object.");
  if (parsed.version !== 1) return fail(`Unknown save version (${String(parsed.version)}).`);

  if (!str(parsed.seed)) return fail("Save is missing its world seed.");
  if (!int(parsed.gold) || parsed.gold < 0 || !int(parsed.bank) || parsed.bank < 0) {
    return fail("Purse and bank must be whole numbers of at least 0 gold.");
  }
  if (!Array.isArray(parsed.party) || parsed.party.length < 1 || parsed.party.length > 4) {
    return fail("A party needs between 1 and 4 members.");
  }
  const party: Pc[] = [];
  for (let i = 0; i < parsed.party.length; i++) {
    const m = isObj(parsed.party[i]) ? parsePc(parsed.party[i] as Record<string, unknown>) : null;
    if (!m) return fail(`Party member ${i + 1} is not a valid hero.`);
    party.push(m);
  }

  if (!str(parsed.dayKey) || !DAY_RE.test(parsed.dayKey)) {
    return fail("Save has a malformed day key (expected YYYY-MM-DD).");
  }
  if (!isObj(parsed.bounties) || !Array.isArray(parsed.bounties.offers) || !Array.isArray(parsed.bounties.completed)) {
    return fail("Bounty board is missing or malformed.");
  }
  const offers: GameState["bounties"]["offers"] = [];
  for (const o of parsed.bounties.offers) {
    if (!isObj(o) || !str(o.family) || !isFamily(o.family) || !int(o.count) || o.count < 1 || !num(o.gold)) {
      return fail("A bounty offer is malformed.");
    }
    offers.push({
      family: o.family,
      count: o.count,
      gold: o.gold,
      kills: int(o.kills) && o.kills >= 0 ? o.kills : 0,
      done: boolOr(o.done, false),
    });
  }

  const inventory: GameState["inventory"] = {};
  if (isObj(parsed.inventory)) {
    for (const [k, v] of Object.entries(parsed.inventory)) {
      if (int(v) && v >= 0) inventory[k] = v;
    }
  }
  const runs: GameState["runs"] = {};
  if (isObj(parsed.runs)) {
    for (const [k, v] of Object.entries(parsed.runs)) {
      if (int(v) && v >= 0) runs[k] = v;
    }
  }

  const rs = isObj(parsed.settings) ? parsed.settings : {};
  const settings: Settings = {
    quickBattle: boolOr(rs.quickBattle, false),
    reduceMotion: boolOr(rs.reduceMotion, false),
    colorblind: boolOr(rs.colorblind, false),
    fontScale: num(rs.fontScale) && rs.fontScale >= 0.5 && rs.fontScale <= 2 ? rs.fontScale : 1,
    sfxVolume: num(rs.sfxVolume) && rs.sfxVolume >= 0 && rs.sfxVolume <= 1 ? rs.sfxVolume : 0.5,
    sfxMuted: boolOr(rs.sfxMuted, false),
  };

  let gate: ActiveGate | undefined; // pass-through after the structural check below
  if ("activeGate" in parsed) {
    if (!validGate(parsed.activeGate)) {
      return fail("The active expedition is corrupt — finish or abandon it before exporting.");
    }
    gate = parsed.activeGate as ActiveGate; // subtrees (map, flags, loot) are tolerated by screens via ??= defaults
  }

  const state: GameState = {
    version: 1,
    seed: parsed.seed,
    gold: parsed.gold,
    bank: parsed.bank,
    party,
    inventory,
    codex: Array.isArray(parsed.codex) ? parsed.codex.filter(str) : [],
    medals: Array.isArray(parsed.medals) ? parsed.medals.filter(str) : [],
    bounties: {
      offers,
      completed: parsed.bounties.completed.filter(str),
      ...(str(parsed.bounties.active) ? { active: parsed.bounties.active } : {}),
    },
    dayKey: parsed.dayKey,
    runs,
    settings,
    ...(boolOr(parsed.reviveToken, false) ? { reviveToken: true } : {}),
    ...(boolOr(parsed.tourSeen, false) ? { tourSeen: true } : {}),
    ...(gate ? { activeGate: gate } : {}),
    // activeCombat is intentionally dropped: a mid-fight RNG stream from
    // another machine can desync this one's screens; the fight resolves or ends.
  };
  return { ok: true, state };
}

/** Clipboard with a textarea fallback for non-secure origins. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

