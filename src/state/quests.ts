import type { Family } from "../data/bestiary";
import { questById } from "../data/quests";
import { earn } from "./party";
import type { GameState } from "./save";

/** Accepted chain: `step` indexes QuestDef.steps, `progress` counts the current slay step. */
import { stepLabel } from "../data/quests";
export interface QuestProgress {
  id: string;
  step: number;
  progress: number;
}

export interface QuestBoard {
  offers: string[]; // quest ids posted today
  active?: QuestProgress; // one chain at a time
  completed: string[];
}

function board(d: GameState): QuestBoard | null {
  return d.quests ?? null;
}

/** Close the current link; complete the chain (and pay) when the last one closes. Returns a log line on completion. */
function advance(d: GameState, b: QuestBoard): string | undefined {
  const act = b.active!;
  const q = questById(act.id);
  act.step++;
  act.progress = 0;
  if (act.step >= q.steps.length) {
    b.completed.push(q.id);
    b.active = undefined;
    earn(d, q.gold);
    return `Quest complete: ${q.name} — +${q.gold} g.`;
  }
  return undefined;
}

/** Accept (replacing any active chain). Only today's uncompleted offers are acceptable. */
export function acceptQuest(d: GameState, id: string): boolean {
  const b = board(d);
  if (!b || !b.offers.includes(id) || b.completed.includes(id)) return false;
  b.active = { id, step: 0, progress: 0 };
  return true;
}

/** One slain foe of `family` counts toward an active slay step. Returns a log line when a link closes. */
export function questKillTick(d: GameState, family: Family): string | undefined {
  const b = board(d);
  const act = b?.active;
  if (!b || !act) return undefined;
  const step = questById(act.id).steps[act.step];
  if (step.kind !== "slay" || step.family !== family) return undefined;
  act.progress++;
  if (act.progress < step.count) return undefined;
  const q = questById(act.id);
  const done = advance(d, b);
  return done ?? `Quest: ${q.name} — next, ${stepLabel(q.steps[act.step]).toLowerCase()}.`;
}

/** Opening a chest in `gateId` satisfies an active recover step. Returns a log line. */
export function questChestTick(d: GameState, gateId: string): string | undefined {
  const b = board(d);
  const act = b?.active;
  if (!b || !act) return undefined;
  const q = questById(act.id);
  const step = q.steps[act.step];
  if (step.kind !== "recover" || step.gateId !== gateId) return undefined;
  const done = advance(d, b);
  return done ?? `The ${step.what} is recovered — ${q.name} moves on.`;
}

/** Close a deliver step at the tavern. Nonzero payout only when the chain actually finishes. */
export function deliverQuest(d: GameState): { name: string; gold: number } | null {
  const b = board(d);
  const act = b?.active;
  if (!b || !act) return null;
  const q = questById(act.id);
  if (q.steps[act.step]?.kind !== "deliver") return null;
  const done = advance(d, b);
  return done ? { name: q.name, gold: q.gold } : null;
}
