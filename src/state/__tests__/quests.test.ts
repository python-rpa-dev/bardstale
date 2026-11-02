import { describe, expect, it } from "vitest";
import { QUEST_POOL, questOffersForDay, stepLabel } from "../../data/quests";
import { acceptQuest, deliverQuest, questChestTick, questKillTick } from "../quests";
import { newGame, rotateDaily, type GameState } from "../save";
import { hashStr, mulberry32 } from "../../core/rng";
import { startCombat, tallyVictory } from "../../core/combat";
import { claimVictory } from "../combat";

const clock = () => new Date("2026-10-13T12:00:00Z");
const fresh = (): GameState => newGame(clock);
const dayRng = (day = "2026-10-13") => mulberry32(hashStr(`quests:${day}`));

/** Pin the board to one chain and accept it. */
function pin(s: GameState, id: string): void {
  s.quests!.offers = [id];
  expect(acceptQuest(s, id)).toBe(true);
}

describe("quest chains — offers", () => {
  it("posts the same two chains for the same day seed, skipping completed ones", () => {
    const a = questOffersForDay(dayRng(), []).map((q) => q.id);
    const b = questOffersForDay(dayRng(), []).map((q) => q.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    const skipped = questOffersForDay(dayRng(), a).map((q) => q.id);
    expect(skipped.every((id) => !a.includes(id))).toBe(true);
    expect(skipped).toHaveLength(2);
  });

  it("every pool chain is well-formed: 2–3 links, deliver only ever last", () => {
    for (const q of QUEST_POOL) {
      expect(q.steps.length).toBeGreaterThanOrEqual(2);
      expect(q.steps.length).toBeLessThanOrEqual(3);
      expect(q.gold).toBeGreaterThan(0);
      q.steps.forEach((st, i) => {
        if (st.kind === "deliver") expect(i).toBe(q.steps.length - 1);
      });
      expect(stepLabel(q.steps[0]).length).toBeGreaterThan(0);
    }
  });

  it("newGame posts two offers; rotateDaily re-posts tomorrow's pair excluding completed", () => {
    const s = fresh();
    expect(s.quests!.offers).toHaveLength(2);
    s.quests!.completed.push(s.quests!.offers[0]);
    const rotated = rotateDaily(s, () => new Date("2026-10-14T12:00:00Z"));
    expect(rotated).toBe(true);
    expect(s.quests!.offers).toHaveLength(2);
    expect(s.quests!.offers).not.toContain(s.quests!.completed[0]);
  });
});

describe("quest chains — accept rule", () => {
  it("accepts only today's uncompleted offers, one chain at a time", () => {
    const s = fresh();
    expect(acceptQuest(s, "not-on-the-board")).toBe(false);
    const [first, second] = s.quests!.offers;
    expect(acceptQuest(s, first)).toBe(true);
    expect(s.quests!.active).toEqual({ id: first, step: 0, progress: 0 });
    expect(acceptQuest(s, second)).toBe(true); // replace
    expect(s.quests!.active!.id).toBe(second);
    s.quests!.completed.push(first);
    expect(acceptQuest(s, first)).toBe(false); // completed never re-accepted
  });
});

describe("quest chains — link progression", () => {
  it("slay steps count only the matching family and complete on the final kill", () => {
    const s = fresh();
    pin(s, "bone-orchard"); // slay 4 undead → deliver to Bryn (150 g)
    const gold0 = s.gold;
    expect(questKillTick(s, "vermin")).toBeUndefined();
    expect(s.quests!.active!.progress).toBe(0);
    expect(questKillTick(s, "undead")).toBeUndefined();
    expect(questKillTick(s, "undead")).toBeUndefined();
    expect(questKillTick(s, "undead")).toBeUndefined();
    expect(s.quests!.active!.progress).toBe(3);
    const note = questKillTick(s, "undead");
    expect(note).toContain("Bone Orchard");
    expect(s.quests!.active!.step).toBe(1); // deliver link now open, no payout yet
    expect(s.gold).toBe(gold0);
  });

  it("deliver pays once, completes the chain, and then yields nothing", () => {
    const s = fresh();
    pin(s, "bone-orchard");
    for (let i = 0; i < 4; i++) questKillTick(s, "undead");
    const res = deliverQuest(s);
    expect(res).toEqual({ name: "Bone Orchard", gold: 150 });
    expect(s.gold).toBe(50 + 150); // STARTING_GOLD + payout
    expect(s.chronicle!.goldEarned).toBe(150); // paid through the earn() chokepoint
    expect(s.quests!.completed).toContain("bone-orchard");
    expect(s.quests!.active).toBeUndefined();
    expect(deliverQuest(s)).toBeNull();
  });

  it("deliver refuses while an earlier link is still open", () => {
    const s = fresh();
    pin(s, "caravan-ledger"); // slay → recover → deliver
    expect(deliverQuest(s)).toBeNull();
  });

  it("recover links fire only on a chest in the named gate", () => {
    const s = fresh();
    pin(s, "caravan-ledger");
    s.quests!.active = { id: "caravan-ledger", step: 1, progress: 0 }; // slay link already closed
    expect(questChestTick(s, "gallows-fen")).toBeUndefined();
    expect(s.quests!.active!.step).toBe(1);
    const note = questChestTick(s, "hollow-roots");
    expect(note).toContain("caravan ledger");
    expect(s.quests!.active!.step).toBe(2);
    const res = deliverQuest(s);
    expect(res).toEqual({ name: "The Last Caravan", gold: 180 });
    expect(s.gold).toBe(50 + 180);
  });

  it("a chain ending on recover completes without any town visit", () => {
    const s = fresh();
    pin(s, "fen-tithe"); // slay 5 vermin → recover in Gallows Fen (170 g)
    s.quests!.active = { id: "fen-tithe", step: 1, progress: 0 };
    const note = questChestTick(s, "gallows-fen");
    expect(note).toContain("Quest complete");
    expect(s.gold).toBe(50 + 170);
    expect(s.quests!.active).toBeUndefined();
    expect(s.quests!.completed).toContain("fen-tithe");
  });
});

describe("quest chains — victory hook", () => {
  it("claimVictory counts slain foes toward the open slay link and notes the close", () => {
    const s = fresh();
    pin(s, "bone-orchard");
    const fight = () => {
      s.activeCombat = startCombat(s.party, ["skeleton", "skeleton"], { seed: 7 });
      for (const f of s.activeCombat.foes) f.hp = 0;
      s.activeCombat.phase = "won";
      s.activeCombat.victory = tallyVictory(s.activeCombat);
      return claimVictory(s)!;
    };
    const first = fight();
    expect(s.quests!.active!.progress).toBe(2); // two undead, mid-link
    expect(first.questNote).toBeUndefined();
    const second = fight();
    expect(second.questNote).toContain("Bone Orchard");
    expect(s.quests!.active!.step).toBe(1);
  });
});
