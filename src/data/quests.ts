import type { Family } from "./bestiary";
import { gateById } from "./gates";
import type { Rng } from "../core/rng";

/**
 * One link of a quest chain. `recover` is satisfied by opening any chest in
 * the named gate (the `what` is the story object); `deliver` is a town visit.
 */
export type QuestStep =
  | { kind: "slay"; family: Family; count: number }
  | { kind: "recover"; gateId: string; what: string }
  | { kind: "deliver"; npc: string };

/** A chain pays out once, when its last link closes. `deliver` is always last. */
export interface QuestDef {
  id: string;
  name: string;
  flavor: string;
  steps: QuestStep[];
  gold: number;
}

export const QUEST_POOL: QuestDef[] = [
  {
    id: "caravan-ledger",
    name: "The Last Caravan",
    flavor: "Bandits took the ledger with the accounts. Mira wants her name out of it.",
    steps: [
      { kind: "slay", family: "humanoid", count: 3 },
      { kind: "recover", gateId: "hollow-roots", what: "caravan ledger" },
      { kind: "deliver", npc: "Mira" },
    ],
    gold: 180,
  },
  {
    id: "bone-orchard",
    name: "Bone Orchard",
    flavor: "The dead under Bryn's chapel keep replanting themselves. Four of them, she says, will learn better.",
    steps: [
      { kind: "slay", family: "undead", count: 4 },
      { kind: "deliver", npc: "Bryn" },
    ],
    gold: 150,
  },
  {
    id: "drowned-strongbox",
    name: "The Drowned Strongbox",
    flavor: "Bram's cousin drowned with a strongbox in the Cloister. The vermin have nested in it since.",
    steps: [
      { kind: "recover", gateId: "sunken-cloister", what: "waterlogged strongbox" },
      { kind: "slay", family: "vermin", count: 3 },
      { kind: "deliver", npc: "Bram" },
    ],
    gold: 220,
  },
  {
    id: "fen-tithe",
    name: "The Fen Tithe",
    flavor: "Something in the Fen collects a tithe of vermin. Bryn would like the casket that holds the tally.",
    steps: [
      { kind: "slay", family: "vermin", count: 5 },
      { kind: "recover", gateId: "gallows-fen", what: "tithe casket" },
    ],
    gold: 170,
  },
  {
    id: "wyrm-debt",
    name: "Debt to the Wyrm",
    flavor: "A scale of stamped gold, Bram swears, is payment for a debt nobody living remembers owing. Two giants guard the vault that holds it.",
    steps: [
      { kind: "recover", gateId: "wyrm-vault", what: "stamped gold scale" },
      { kind: "slay", family: "giant", count: 2 },
      { kind: "deliver", npc: "Bram" },
    ],
    gold: 340,
  },
];

export function questById(id: string): QuestDef {
  const q = QUEST_POOL.find((x) => x.id === id);
  if (!q) throw new Error(`unknown quest: ${id}`);
  return q;
}

/** Fisher–Yates on a copy, driven by the injected rng. */
function shuffled<T>(a: T[], rng: Rng): T[] {
  const c = a.slice();
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

/** The board posts exactly two chains a day, skipping anything already completed. */
export function questOffersForDay(rng: Rng, completed: string[]): QuestDef[] {
  const done = new Set(completed);
  return shuffled(QUEST_POOL, rng).filter((q) => !done.has(q.id)).slice(0, 2);
}

/** One-line label for a step, gate names resolved. */
export function stepLabel(step: QuestStep): string {
  switch (step.kind) {
    case "slay":
      return `Slay ${step.count} × ${step.family}`;
    case "recover":
      return `Recover the ${step.what} — open a chest in ${gateById(step.gateId).name}`;
    case "deliver":
      return `Deliver to ${step.npc} (tavern)`;
  }
}
