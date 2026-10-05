import { classById, type ClassId } from "../data/classes";
import { bountyId, offersForDay, shuffledPool, type BountyDef } from "../data/bounties";
import { dailySeed, dayKey, hashStr, mulberry32 } from "../core/rng";
import type { CombatState } from "../core/combat";

export const SAVE_KEY = "bardstale.save.v1";

// ---------- Party model ----------

export interface Pc {
  id: string; // instance id, e.g. "fighter-1"
  classId: ClassId;
  name: string;
  level: number;
  xp: number; // XP earned at current level (xpForNext(level) to advance)
  hp: number; // current HP (town truth; mirrored into activeGate.partyHpSp during a run)
  sp: number;
  points: number; // unallocated stat points (from level 2)
  alloc: { atk: number; def: number; dex: number; mnd: number };
  gear: { weapon?: string; armor?: string; trinket?: string }; // item ids
  statuses: StatusMark[]; // lingering conditions carried out of combat (poison/wound)
}

/** A lingering condition on a PC; rounds tick only during combat. */
export interface StatusMark {
  kind: "poison" | "wound";
  roundsLeft: number;
}

/** Effective maxima from class formula + growth (gear handled separately). */
export function pcMax(pc: Pc): { hp: number; sp: number } {
  const def = classById(pc.classId);
  return {
    hp: def.start.hp + (def.growth.hp ?? 0) * (pc.level - 1),
    sp: def.start.sp + (def.growth.sp ?? 0) * (pc.level - 1),
  };
}

/** Base stats before gear. */
export function pcBase(pc: Pc): { atk: number; def: number; dex: number; mnd: number } {
  const d = classById(pc.classId);
  return {
    atk: d.start.atk + (d.growth.atk ?? 0) * (pc.level - 1) + pc.alloc.atk,
    def: d.start.def + (d.growth.def ?? 0) * (pc.level - 1) + pc.alloc.def,
    dex: d.start.dex + (d.growth.dex ?? 0) * (pc.level - 1) + pc.alloc.dex,
    mnd: d.start.mnd + (d.growth.mnd ?? 0) * (pc.level - 1) + pc.alloc.mnd,
  };
}

// ---------- Bounty offers ----------

export interface BountyOffer extends BountyDef {
  kills: number; // progress this offer's lifetime
  done: boolean;
}

// ---------- Active expedition ----------

export interface FloorMapSave {
  w: number;
  h: number;
  cells: string; // row-major "0"/"1", 1 = wall
  entities: [number, string][]; // cellId → kind ("stairs"|"chest"|"shrine"|"trap"|"secret")
}

/** One-off expedition event rolled at run start (8% chance). */
export type RareKind = "merchant" | "hermit" | "villager";

export interface ActiveGate {
  gateId: string;
  runNumber: number;
  seed: number;
  modifier: string; // ModifierId at run start
  floor: number; // 0-based
  map: FloorMapSave;
  pos: { x: number; y: number };
  dir: 0 | 1 | 2 | 3; // N/E/S/W
  visited: number[]; // cell ids revealed on minimap
  partyHpSp: { id: string; hp: number; sp: number }[];
  chests: { cell: number; opened: boolean }[];
  flags: Record<string, boolean>; // shrine-f<N>, merchant, hermit, villager…
  steps: number; // per-floor event counter — seeds deterministic trap/encounter rolls, survives reloads
  loot: { gold: number; items: Record<string, number> }; // this run's tally for the end-of-run summary
  rareSpawn?: RareKind; // one-off event present for this whole run (see screens/dungeon event card)
  pendingMonsters?: string[]; // encounter awaiting combat resolution (see core/combat)
}

// ---------- Root state ----------

export interface Settings {
  quickBattle: boolean;
  reduceMotion: boolean;
  colorblind: boolean;
  fontScale: number;
  sfxVolume: number;
}

/** itemId → count. Equipment and consumables both stack by id. */
export type Inventory = Record<string, number>;

export interface GameState {
  version: 1;
  seed: string;
  gold: number; // town purse (spendable)
  bank: number; // safe reserve — expedition gold banks here, never lost on wipe
  party: Pc[];
  inventory: Inventory;
  codex: string[]; // stamped bestiary ids
  medals: string[]; // family ids with completed codex
  bounties: { offers: BountyOffer[]; completed: string[]; active?: string }; // active = accepted bountyId
  dayKey: string;
  runs: Record<string, number>; // gateId → expedition count
  reviveToken?: boolean; // villager-rescue token; consumed instead of the temple revive fee
  settings: Settings;
  activeGate?: ActiveGate;
  activeCombat?: CombatState; // fight in progress — rng stream survives reloads via seed + calls
}

export const STARTING_GOLD = 50;

const CLASS_NAMES: Record<ClassId, string> = {
  fighter: "Aldric",
  mage: "Sera",
  cleric: "Bryn",
  rogue: "Tamsin",
};

export function makePc(classId: ClassId, ordinal: number): Pc {
  const def = classById(classId);
  return {
    id: `${classId}-${ordinal}`,
    classId,
    name: ordinal === 1 ? CLASS_NAMES[classId] : `${CLASS_NAMES[classId]} ${"II III IV".split(" ")[ordinal - 2] ?? ordinal}`,
    level: 1,
    xp: 0,
    hp: def.start.hp,
    sp: def.start.sp,
    points: 0,
    alloc: { atk: 0, def: 0, dex: 0, mnd: 0 },
    gear: {},
    statuses: [],
  };
}

/** Fresh state. `now` injectable for deterministic dayKey in tests. */
export function newGame(now: () => Date = () => new Date()): GameState {
  const seed = String(hashStr(`new:${Date.now()}`));
  const rng = mulberry32(dailySeed(dayKey(now())));
  return {
    version: 1,
    seed,
    gold: STARTING_GOLD,
    bank: 0,
    party: (["fighter", "mage", "cleric", "rogue"] as ClassId[]).map((c) => makePc(c, 1)),
    inventory: { "potion-hp": 2 },
    codex: [],
    medals: [],
    bounties: { offers: offersForDay(rng).map((b) => ({ ...b, kills: 0, done: false })), completed: [] },
    dayKey: dayKey(now()),
    runs: {},
    settings: { quickBattle: false, reduceMotion: false, colorblind: false, fontScale: 1, sfxVolume: 0.5 },
};
}

/**
 * Daily rotation: when `dayKey` differs from today, rebuild the board from
 * today's seeded shuffle (skipping completed ids) and stamp the new dayKey.
 * Offers live one local day; a completed offer's slot is replaced by the next
 * unoffered entry of the fresh shuffle. Mutates in place.
 */
export function rotateDaily(state: GameState, now: () => Date): void {
  const today = dayKey(now());
  if (state.dayKey === today) return;
  state.dayKey = today;
  const rng = mulberry32(dailySeed(today));
  const pool = shuffledPool(rng);
  const taken = new Set([...state.bounties.completed]);
  const fresh: BountyOffer[] = [];
  for (const b of pool) {
    if (fresh.length >= 3) break;
    const id = bountyId(b);
    if (taken.has(id)) continue;
    taken.add(id);
    fresh.push({ ...b, kills: 0, done: false });
  }
  state.bounties.offers = fresh;
}

// ---------- Persistence ----------

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Version switch for future migrations; only v1 exists today. */
function migrate(save: GameState & { version: number }): GameState | null {
  switch (save.version) {
    case 1: {
      const s = save as unknown as GameState;
      for (const pc of s.party) pc.statuses ??= []; // v1 saves predate statuses
      return s;
    }
    default:
      return null; // unknown/corrupt → caller starts a new game, never throws
  }
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Parse + migrate. Returns null on absent/corrupt/unknown-version saves. */
export function deserialize(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState & { version: number };
    if (typeof parsed !== "object" || parsed === null || typeof parsed.version !== "number") return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

export interface Store {
  get state(): GameState;
  /** Single entry point for every mutation; schedules the debounced write. */
  commit(mutator: (s: GameState) => void): void;
  saveNow(): void;
  deleteSave(): void;
  hasSave(): boolean;
}

export interface StoreOptions {
  storage?: StorageLike;
  now?: () => Date;
}

const NOOP_STORAGE: StorageLike = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

export function createStore(opts: StoreOptions = {}): Store {
  const storage = opts.storage ?? (globalThis.localStorage as StorageLike | undefined) ?? NOOP_STORAGE;
  const now = opts.now ?? (() => new Date());

  let state = deserialize(storage.getItem(SAVE_KEY)) ?? newGame(now);
  rotateDaily(state, now);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const saveNow = () => {
    clearTimeout(timer);
    timer = undefined;
    storage.setItem(SAVE_KEY, serialize(state));
  };

  return {
    get state() {
      return state;
    },
    commit(mutator) {
      mutator(state);
      clearTimeout(timer);
      timer = setTimeout(saveNow, 300); // debounced 300 ms after every mutation
    },
    saveNow,
    deleteSave() {
      storage.removeItem(SAVE_KEY);
      state = newGame(now);
    },
    hasSave: () => deserialize(storage.getItem(SAVE_KEY)) !== null,
  };
}
