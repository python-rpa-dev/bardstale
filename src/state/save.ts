import { classById, type ClassId } from "../data/classes";
import { boonById } from "../data/boons";
import { bountyId, offersForDay, shuffledPool, type BountyDef } from "../data/bounties";
import { questOffersForDay } from "../data/quests";
import type { QuestBoard } from "./quests";
import { accrueInterest, type Ledger } from "./ledger";
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
  statuses: StatusMark[]; // lingering conditions carried out of combat (poison/wound/blind/burn)
  boons?: string[]; // permanent level-up perk ids (see data/boons)
  boonQueue?: number; // level-ups whose boon pick is still owed
}

/** A lingering condition on a PC; rounds tick only during combat. */
export interface StatusMark {
  kind: "poison" | "wound" | "blind" | "burn";
  roundsLeft: number;
}

/** Display name for a status kind ("blind" → "Blind"). */
export const statusLabel = (kind: StatusMark["kind"]): string => kind[0].toUpperCase() + kind.slice(1);

/** Effective maxima from class formula + growth + boons (gear handled separately). */
export function pcMax(pc: Pc): { hp: number; sp: number } {
  const def = classById(pc.classId);
  let bonusHp = 0;
  let bonusSp = 0;
  for (const id of pc.boons ?? []) {
    bonusHp += boonById(id).bonus.maxHp ?? 0;
    bonusSp += boonById(id).bonus.maxSp ?? 0;
  }
  return {
    hp: def.start.hp + (def.growth.hp ?? 0) * (pc.level - 1) + bonusHp,
    sp: def.start.sp + (def.growth.sp ?? 0) * (pc.level - 1) + bonusSp,
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
  entities: [number, string][]; // cellId → kind ("stairs"|"chest"|"shrine"|"trap"|"secret"|"riddle"|"sealed")
  flood?: number[]; // flooded cell ids (gimmick gates); absent = bone-dry floors and pre-flood saves
}

/** One-off expedition event rolled at run start (8% chance). */
export type RareKind = "merchant" | "hermit" | "villager" | "altar";

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
  pendingElites?: number[]; // indices into pendingMonsters marked elite at roll time
  lightTurns?: number; // steps of torchlight left on this floor; absent (legacy) reads as lit
  torchKind?: string; // id of the last light item used this run — tallow smoke / witchlight reveal perks
  killsThisRun?: number; // monsters felled this run — feeds the Hall of Runs record
  medalsThisRun?: number; // family medals completed this run — the Hall's trophy line
  daily?: boolean; // today's shared Daily Challenge maze — scores land on the leaderboard
  oathDepth?: boolean; // the black altar's Deep Bargain: every foe this run runs +1 level, kills pay ×1.5
  collapseTurns?: number; // collapse-gimmick floors: steps until the stair relocates (see collapseTick)
  relic?: string; // claimed relic id for this run (see data/relics) — one per run, first vault offers the choice
}
// ---------- Chronicle (lifetime stats; rendered by screens/chronicle.ts) ----------

export interface Chronicle {
  killsByFoe: Record<string, number>; // bestiary id → lifetime kills
  battlesWon: number;
  battlesFled: number;
  partyWipes: number;
  deepestFloor: number; // deepest floor+1 ever reached on any run
  bestHit: number; // biggest single PC hit ever dealt (synced from CombatState.bestHit)
  crits: number; // lifetime critical hits landed by the party
  goldEarned: number; // lifetime gold taken into the purse (career earnings)
}

export function emptyChronicle(): Chronicle {
  return { killsByFoe: {}, battlesWon: 0, battlesFled: 0, partyWipes: 0, deepestFloor: 0, bestHit: 0, crits: 0, goldEarned: 0 };
}

// ---------- Hall of Runs (per-run memory; rendered on the Guild shelf) ----------

/** One surfaced expedition. The Chronicle is lifetime totals — this is memory per run, newest first. */
export interface RunRecord {
  gateId: string;
  dayKey: string; // in-world date at surfacing
  runNumber: number; // the gate's own expedition counter at start
  depth: number; // floors descended + 1 (deepest floor reached, 1-based)
  kills: number;
  medals: number; // family medals earned during this run
  gold: number; // loot tally carried to the surface
  items: Inventory;
  crew: { name: string; level: number }[]; // party as it walked out
}

/** One wiped expedition — who fell, how deep, and what was waiting for them. */
export interface FallenRun {
  dayKey: string; // in-world date at the wipe
  gateId: string;
  depth: number; // floor the party went down on (1-based)
  crew: { name: string; level: number }[]; // as they went in
  cause: string; // "overwhelmed by <foes>" — the pack standing over them
}

/** One daily-challenge attempt: score = depth·100 + kills·10 + gold. */
export interface DailyBest {
  dayKey: string; // ISO date of the challenge this was played on
  gateId: string;
  attempt: number; // the gate's own run counter at start — the #N in the share string
  score: number;
  depth: number; // deepest floor reached, 1-based
  kills: number;
  gold: number;
  crew: string; // hero names as they walked out (or fell)
}

/** The shelf holds this many memories; older runs are forgotten. */
export const HALL_SIZE = 8;
/** The memorial keeps this many wipes; older losses are forgotten. */
export const FALLEN_SIZE = 8;

// ---------- Root state ----------

export interface Settings {
  quickBattle: boolean;
  reduceMotion: boolean;
  /** Brighter text, stronger borders for low-vision readability. */
  highContrast: boolean;
  colorblind: boolean;
  /** Show styled hover/focus tooltips on buttons. */
  tooltips: boolean;
  fontScale: number;
   sfxVolume: number;
   /** Silence all SFX without losing the chosen volume. */
   sfxMuted: boolean;
  /** BGM volume 0..1; the mute toggle silences SFX and music together. */
  musicVolume: number;
}

/** itemId → count. Equipment and consumables both stack by id. */
export type Inventory = Record<string, number>;

export interface GameState {
  version: 1;
  seed: string;
  gold: number; // all-purpose coin — spendable anywhere, and safe from wipes (only unclaimed run loot is forfeited)
  party: Pc[];
  inventory: Inventory;
  codex: string[]; // stamped bestiary ids
  medals: string[]; // family ids with completed codex
  trophies?: string[]; // gate ids whose lord's trophy is raised — permanent town-wide perks
  bounties: { offers: BountyOffer[]; completed: string[]; active?: string }; // active = accepted bountyId
  quests?: QuestBoard; // quest chains — one active, two posted daily; migrate backfills older saves
  ledger?: Ledger; // the Ferryman's Ledger — debt compounds daily and tithes every earn(); migrate backfills
  dayKey: string;
  runs: Record<string, number>; // gateId → expedition count
  chronicle?: Chronicle; // lifetime accumulator; migrate backfills older saves
  reviveToken?: boolean; // villager-rescue token; consumed instead of the temple revive fee
  tourSeen?: boolean; // welcome coach-mark tour completed or skipped
  hall?: RunRecord[]; // Guild shelf — the last surfaced runs, newest first; migrate backfills older saves
  fallen?: FallenRun[]; // memorial shelf — wiped runs, newest first; migrate backfills older saves
  dailyBests?: DailyBest[]; // daily-challenge leaderboard — best ten attempts, highest score first
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
    boons: [],
    boonQueue: 0,
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
    party: (["fighter", "mage", "cleric", "rogue"] as ClassId[]).map((c) => makePc(c, 1)),
    inventory: { "potion-hp": 2 },
    codex: [],
    medals: [],
    bounties: { offers: offersForDay(rng).map((b) => ({ ...b, kills: 0, done: false })), completed: [] },
    quests: { offers: questOffersForDay(mulberry32(hashStr(`quests:${dayKey(now())}`)), []).map((q) => q.id), completed: [] },
    ledger: { debt: 0, borrowed: 0 },
    dayKey: dayKey(now()),
    runs: {},
    chronicle: emptyChronicle(),
    hall: [], // the Guild shelf starts empty
    fallen: [], // and so does the memorial
    settings: { quickBattle: false, reduceMotion: false, highContrast: false, colorblind: false, tooltips: true, fontScale: 1, sfxVolume: 0.5, musicVolume: 0.35, sfxMuted: false },
};
}

/**
 * Daily rotation: when `dayKey` differs from today, rebuild the board from
 * today's seeded shuffle (skipping completed ids) and stamp the new dayKey.
 * Offers live one local day; a completed offer's slot is replaced by the next
 * unoffered entry of the fresh shuffle. Mutates in place.
 */
export function rotateDaily(state: GameState, now: () => Date): boolean {
  const today = dayKey(now());
  if (state.dayKey === today) return false;
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
  const qBoard = (state.quests ??= { offers: [], completed: [] });
  qBoard.offers = questOffersForDay(mulberry32(hashStr(`quests:${today}`)), qBoard.completed).map((q) => q.id);
  if (qBoard.active && qBoard.completed.includes(qBoard.active.id)) qBoard.active = undefined;
  accrueInterest(state); // the Ferryman bills every morning, before breakfast
  return true;
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
      for (const pc of s.party) {
        pc.statuses ??= []; // v1 saves predate statuses
        pc.boons ??= []; // v1 saves predate boons
        pc.boonQueue ??= 0; // ditto — no picks owed
      }
       s.settings.sfxMuted ??= false; // v1 saves predate the mute control
      s.settings.highContrast ??= false; // v1 saves predate the contrast toggle
      s.settings.tooltips ??= true; // v1 saves predate the tooltip toggle — on by default
      s.chronicle ??= emptyChronicle(); // v1 saves predate the chronicle
      s.chronicle.goldEarned ??= 0; // chronicles predate the career-gold stat
      s.settings.musicVolume ??= 0.35; // v1 saves predate the music volume
      s.hall ??= []; // v1 saves predate the Hall of Runs
      s.fallen ??= []; // v1 saves predate the memorial shelf
      s.quests ??= { offers: questOffersForDay(mulberry32(hashStr(`quests:${s.dayKey}`)), []).map((q) => q.id), completed: [] }; // v1 saves predate quest chains
      s.ledger ??= { debt: 0, borrowed: 0 }; // v1 saves predate the Ferryman
      const legacyBank = (s as Partial<{ bank: number }>).bank; // v1 kept a separate reserve; one wallet now
      if (typeof legacyBank === "number" && Number.isFinite(legacyBank) && legacyBank > 0) s.gold += Math.floor(legacyBank);
      delete (s as Partial<{ bank: number }>).bank;
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
  /** Wholesale state replacement (save import): persists immediately, cancelling any pending debounced write. */
  load(next: GameState): void;
  saveNow(): void;
  deleteSave(): void;
  hasSave(): boolean;
  /** True when this load rolled the save into a new day — bounty board turned. */
  readonly rotatedDay: boolean;
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
  const rotatedDay = rotateDaily(state, now);
  if (rotatedDay) storage.setItem(SAVE_KEY, serialize(state)); // persist the rolled dayKey so a rollover isn't replayed every load

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
    load(next) {
      state = next;
      saveNow(); // clearTimeout kills a pending commit's timer — an import must never be clobbered by it
    },
    saveNow,
    deleteSave() {
      storage.removeItem(SAVE_KEY);
      state = newGame(now);
    },
    hasSave: () => deserialize(storage.getItem(SAVE_KEY)) !== null,
    rotatedDay,
  };
}
