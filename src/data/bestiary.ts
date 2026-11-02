export type Family = "vermin" | "humanoid" | "undead" | "giant";

export const FAMILIES: Family[] = ["vermin", "humanoid", "undead", "giant"];

/** Per-species combat tactics (see core/combat.ts): vermin break, undead bar escape, captains rally. */
export type Behavior =
  | { kind: "flee"; hpPct: number } // breaks off below this fraction of max HP: half XP, no gold
  | { kind: "guard" } // bars the way: while one lives, the party cannot flee
  | { kind: "captain"; auraPct: number }; // living allies gain +auraPct damage dealt

export type Special =
  | { kind: "poison"; dex: number; rounds: number } // spider: −1 DEX, 5 rounds on target
  | { kind: "drain"; spPerTurn: number } // wraith: −3 SP/turn to target
  | { kind: "regen"; hpPerRound: number } // troll: +3 HP/round
  | { kind: "breath"; base: number; everyRounds: number } // wyrm-whelp: all PCs, MND-equivalent 8, once / 3 rounds; also sets them burning (2 rounds, see core/combat.ts)
  | { kind: "blind"; rounds: number } // ash-wight: soul-gaze dims the eyes — −15% to hit for N rounds
  | { kind: "wound"; stacks: number } // rending claws (cave-rat, mire-brute): +stacks Wound per hit (max 5); each stack bleeds 1 dmg at the end of the afflicted's turn, decays 1 per rest, heals seal it (see core/combat.ts)
  | { kind: "mark" }; // fen seer: a damaging hit omen-marks a living ally — its next action is telegraphed in the log and takes +25% damage until it acts

export interface MonsterDef {
  id: string;
  lvl: number;
  hp: number;
  atk: number;
  def: number;
  dex: number;
  mr: number;
  xp: number;
  gold: [number, number];
  family: Family;
  special?: Special; // spider poison, wraith drain, troll regen, wyrms breath
  behavior?: Behavior; // flee / guard-lock / captain aura — see the Behavior union above
  /** Gate lord guarding the final floor; excluded from random spawn pools. */
  boss?: boolean;
}

export const BESTIARY: MonsterDef[] = [
  { id: "cave-rat", lvl: 1, hp: 8, atk: 5, def: 2, dex: 8, mr: 0, xp: 6, gold: [0, 3], family: "vermin", special: { kind: "wound", stacks: 1 }, behavior: { kind: "flee", hpPct: 0.25 } },
  { id: "goblin", lvl: 2, hp: 14, atk: 7, def: 4, dex: 9, mr: 1, xp: 12, gold: [2, 8], family: "humanoid", behavior: { kind: "captain", auraPct: 0.1 } },
  { id: "spider", lvl: 3, hp: 16, atk: 8, def: 3, dex: 10, mr: 1, xp: 16, gold: [0, 4], family: "vermin", special: { kind: "poison", dex: -1, rounds: 5 }, behavior: { kind: "flee", hpPct: 0.25 } },
  { id: "skeleton", lvl: 3, hp: 20, atk: 9, def: 6, dex: 6, mr: 2, xp: 18, gold: [3, 10], family: "undead", behavior: { kind: "guard" } },
  { id: "orc-raider", lvl: 5, hp: 34, atk: 12, def: 8, dex: 8, mr: 3, xp: 32, gold: [8, 20], family: "humanoid", behavior: { kind: "captain", auraPct: 0.15 } },
  { id: "wraith", lvl: 7, hp: 40, atk: 14, def: 6, dex: 11, mr: 8, xp: 52, gold: [10, 30], family: "undead", special: { kind: "drain", spPerTurn: 3 }, behavior: { kind: "guard" } },
  { id: "troll", lvl: 9, hp: 70, atk: 17, def: 12, dex: 7, mr: 5, xp: 84, gold: [20, 50], family: "giant", special: { kind: "regen", hpPerRound: 3 } },
  { id: "wyrm-whelp", lvl: 12, hp: 110, atk: 21, def: 14, dex: 9, mr: 10, xp: 150, gold: [40, 90], family: "giant", special: { kind: "breath", base: 8, everyRounds: 3 } },
  { id: "fen-leech", lvl: 4, hp: 24, atk: 11, def: 4, dex: 10, mr: 2, xp: 24, gold: [3, 8], family: "vermin", special: { kind: "poison", dex: -1, rounds: 4 }, behavior: { kind: "flee", hpPct: 0.25 } },
  { id: "drowned-monk", lvl: 5, hp: 34, atk: 13, def: 7, dex: 8, mr: 7, xp: 32, gold: [7, 20], family: "undead", special: { kind: "drain", spPerTurn: 2 }, behavior: { kind: "guard" } },
  { id: "mire-brute", lvl: 6, hp: 52, atk: 16, def: 10, dex: 7, mr: 3, xp: 44, gold: [11, 26], family: "humanoid", special: { kind: "wound", stacks: 1 } },
  { id: "fen-seer", lvl: 7, hp: 30, atk: 12, def: 5, dex: 12, mr: 8, xp: 36, gold: [8, 22], family: "humanoid", special: { kind: "mark" } },
  { id: "bog-troll", lvl: 8, hp: 74, atk: 18, def: 12, dex: 6, mr: 4, xp: 70, gold: [18, 44], family: "giant", special: { kind: "regen", hpPerRound: 2 } },
  { id: "cinder-spider", lvl: 10, hp: 64, atk: 22, def: 9, dex: 14, mr: 5, xp: 88, gold: [16, 38], family: "vermin", special: { kind: "poison", dex: -2, rounds: 5 }, behavior: { kind: "flee", hpPct: 0.25 } },
  { id: "ash-guardian", lvl: 11, hp: 105, atk: 25, def: 15, dex: 8, mr: 8, xp: 110, gold: [30, 64], family: "humanoid" },
  { id: "ash-wight", lvl: 13, hp: 88, atk: 24, def: 10, dex: 10, mr: 11, xp: 118, gold: [26, 56], family: "undead", special: { kind: "blind", rounds: 3 }, behavior: { kind: "guard" } },
  // gate lords — final-floor guardians (see gates.ts); never roll in random encounters
  { id: "bark-thrall", lvl: 5, hp: 60, atk: 13, def: 9, dex: 6, mr: 4, xp: 55, gold: [25, 55], family: "giant", boss: true },
  { id: "cloister-lich", lvl: 8, hp: 55, atk: 15, def: 8, dex: 7, mr: 12, xp: 70, gold: [30, 70], family: "undead", special: { kind: "drain", spPerTurn: 4 }, boss: true },
  { id: "vault-wyrm", lvl: 14, hp: 160, atk: 24, def: 16, dex: 9, mr: 12, xp: 200, gold: [80, 160], family: "giant", special: { kind: "breath", base: 10, everyRounds: 3 }, boss: true },
  { id: "fen-matriarch", lvl: 9, hp: 110, atk: 18, def: 12, dex: 8, mr: 7, xp: 120, gold: [50, 105], family: "giant", special: { kind: "poison", dex: -2, rounds: 5 }, boss: true },
  { id: "ashfiend", lvl: 16, hp: 245, atk: 30, def: 18, dex: 10, mr: 14, xp: 300, gold: [120, 240], family: "giant", special: { kind: "breath", base: 12, everyRounds: 3 }, boss: true },
];

export function monsterById(id: string): MonsterDef {
  const def = BESTIARY.find((m) => m.id === id);
  if (!def) throw new Error(`unknown monster ${id}`);
  return def;
}
