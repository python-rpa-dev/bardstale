import { describe, expect, it } from "vitest";
import { foeDef, startCombat } from "../../core/combat";
import { BESTIARY, monsterById } from "../../data/bestiary";
import { itemById } from "../../data/items";
import { makePc } from "../save";
import { hermitGift, merchantWares, RARE_CHANCE, rollRare } from "../expedition";

const party = () => [makePc("fighter", 0), makePc("cleric", 1)];

describe('"hollows" modifier (foeDef level shift)', () => {
  it("undead rise stronger: +1 level, hp/atk ×1.12; vermin wither −1", () => {
    const cs = startCombat(party(), ["skeleton", "cave-rat", "goblin"], { seed: 7, hollows: true });
    expect(cs.foes[0].lvlShift).toBe(1);
    expect(cs.foes[0].hp).toBe(Math.round(20 * 1.12)); // snapshot scaled at spawn
    const sk = foeDef(cs.foes[0]);
    expect(sk.lvl).toBe(4);
    expect(sk.atk).toBe(Math.round(9 * 1.12));

    expect(cs.foes[1].lvlShift).toBe(-1);
    const rat = foeDef(cs.foes[1]);
    expect(rat.hp).toBe(Math.round(8 * 0.88));
    expect(rat.lvl).toBeGreaterThanOrEqual(1);

    // humanoids ignore the hollows entirely
    expect(cs.foes[2].lvlShift).toBeUndefined();
    expect(foeDef(cs.foes[2])).toEqual(monsterById("goblin"));
  });

  it("without the modifier, foe stats are the raw table", () => {
    const cs = startCombat(party(), ["skeleton"], { seed: 7 });
    expect(cs.foes[0].hp).toBe(20);
    expect(foeDef(cs.foes[0])).toEqual(monsterById("skeleton"));
  });
});

describe("rare spawns", () => {
  it("rollRare is deterministic per run seed", () => {
    for (const seed of [1, 42, 9999]) expect(rollRare(seed)).toBe(rollRare(seed));
  });

  it("fires on ~8% of runs and only with known kinds", () => {
    const kinds = new Set(["merchant", "hermit", "villager"]);
    let hits = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const r = rollRare(seed);
      if (r === null) continue;
      expect(kinds.has(r)).toBe(true);
      hits++;
    }
    // deterministic stream: assert the observed rate brackets the nominal 8%
    expect(hits).toBeGreaterThanOrEqual(40);
    expect(hits).toBeLessThanOrEqual(130);
    expect(RARE_CHANCE).toBe(0.08);
  });

  it("merchant stock is stable, three uncommon/rare goods at −25%", () => {
    const a = merchantWares({ seed: 123 });
    expect(a).toEqual(merchantWares({ seed: 123 }));
    expect(a.length).toBe(3);
    for (const w of a) {
      const def = itemById(w.id);
      expect(def.rarity).not.toBe("common");
      expect(w.price).toBe(Math.max(1, Math.floor(def.price * 0.75)));
    }
  });

  it("hermit gift names an unseen codex member; null when the book is full", () => {
    const all = BESTIARY.map((m) => m.id);
    const seen = all.slice(0, 3);
    const gift = hermitGift({ seed: 9 }, seen);
    expect(gift).not.toBeNull();
    expect(seen.includes(gift!.id)).toBe(false);
    expect(hermitGift({ seed: 9 }, seen)!.id).toBe(gift!.id); // deterministic
    expect(hermitGift({ seed: 9 }, all)).toBeNull();
  });
});
