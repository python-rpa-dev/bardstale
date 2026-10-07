import { describe, expect, it } from "vitest";
import { BESTIARY, monsterById } from "../bestiary";
import { GATES } from "../gates";
import { ITEMS } from "../items";
import { SPELLS, SPELL_UNLOCKS } from "../spells";

/**
 * Cross-table integrity: the game reads these tables dynamically (spawn pools,
 * bounty badges, shop stock, cast menus), so a dangling id or an empty band is
 * a runtime crash, not a type error. These tests are the contract.
 */

function uniq(ids: string[]): void {
  expect(new Set(ids).size).toBe(ids.length);
}

describe("data integrity", () => {
  it("ids are unique across every table", () => {
    uniq(BESTIARY.map((m) => m.id));
    uniq(GATES.map((g) => g.id));
    uniq(ITEMS.map((i) => i.id));
    uniq(SPELLS.map((s) => s.id));
  });

  it("every gate names a boss that exists, is flagged, and sits just above its band", () => {
    for (const g of GATES) {
      expect(g.boss, `${g.id} has no boss`).toBeTruthy();
      const b = monsterById(g.boss!);
      expect(b.boss, `${g.boss} missing boss flag`).toBe(true);
      // gate lords may lead their band but never run away from it by more than 2 levels
      expect(b.lvl).toBeGreaterThanOrEqual(g.levels[0]);
      expect(b.lvl).toBeLessThanOrEqual(g.levels[1] + 2);
    }
  });

  it("every gate has a non-empty random spawn pool inside its level band", () => {
    for (const g of GATES) {
      const [lo, hi] = g.levels;
      // mirrors expedition.ts: bosses are excluded from the roll pool
      const pool = BESTIARY.filter((m) => !m.boss && m.lvl >= lo && m.lvl <= hi);
      expect(pool.length, `${g.id} spawn pool`).toBeGreaterThanOrEqual(3);
    }
  });

  it("monsters have sane stat shapes", () => {
    for (const m of BESTIARY) {
      expect(m.hp).toBeGreaterThan(0);
      expect(m.atk).toBeGreaterThan(0);
      const [gLo, gHi] = m.gold;
      expect(gLo).toBeLessThanOrEqual(gHi);
      expect(gLo).toBeGreaterThanOrEqual(0);
    }
  });

  it("spell unlocks reference real spells of the same class at strictly rising levels", () => {
    for (const [cls, rows] of Object.entries(SPELL_UNLOCKS)) {
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].lvl).toBeGreaterThan(rows[i - 1].lvl);
      }
      for (const r of rows) {
        const s = SPELLS.find((x) => x.id === r.spell);
        expect(s, `unknown spell ${r.spell}`).toBeTruthy();
        expect(s!.class).toBe(cls);
      }
    }
  });

  it("all-foes and all-allies spells are handled by the combat core", () => {
    // mirrors the pcCast dispatch: these ids must stay wired or casts silently no-op
    const multi = SPELLS.filter((s) => s.target === "all-foes" || s.target === "all-allies");
    for (const s of multi) expect(s.effect.length).toBeGreaterThan(0);
    expect(multi.map((s) => s.id).sort()).toEqual(
      ["bless", "cleave", "flame-wave", "frost-nova", "mass-heal"].sort()
    );
  });
});
