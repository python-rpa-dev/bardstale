import { describe, expect, it } from "vitest";
import { BESTIARY, monsterById } from "../bestiary";
import { GATES } from "../gates";
import { ITEMS, RECIPES, stallPrice, stallStock } from "../items";
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

describe("merchant rivalry", () => {
  const iso = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10);
  const take = Math.ceil(ITEMS.filter((i) => !i.material).length * 0.7); // herbs are not merchandise

  it("carts are deterministic per day and rotate with the dawn", () => {
    const a1 = stallStock("2026-10-09", 0).map((d) => d.id);
    expect(stallStock("2026-10-09", 0).map((d) => d.id)).toEqual(a1);
    expect(stallStock("2026-10-10", 0).map((d) => d.id)).not.toEqual(a1);
  });

  it("each cart holds ~70%, the street covers the catalogue, and both rivals hold exclusives", () => {
    for (let d = 1; d <= 30; d++) {
      const dayKey = iso(d);
      const a = stallStock(dayKey, 0);
      const b = stallStock(dayKey, 1);
      expect(a.length).toBe(take);
      expect(b.length).toBe(take);
      const union = new Set([...a.map((x) => x.id), ...b.map((x) => x.id)]);
      for (const def of ITEMS) if (!def.material) expect(union.has(def.id)).toBe(true); // nothing sellable vanishes from the street
      const idsA = new Set(a.map((x) => x.id));
      const idsB = new Set(b.map((x) => x.id));
      expect(a.some((x) => !idsB.has(x.id))).toBe(true); // Mira always has something Bram lacks…
      expect(b.some((x) => !idsA.has(x.id))).toBe(true); // …and vice versa, so deals exist on both carts
    }
  });

  it("moonpetal never rides any cart, and every recipe bottles a real potion cheaper than buying", () => {
    for (let d = 1; d <= 30; d++) {
      expect(stallStock(iso(d), 0).some((x) => x.material)).toBe(false); // shrine herbs are gathered, not bought
      expect(stallStock(iso(d), 1).some((x) => x.material)).toBe(false);
    }
    for (const r of RECIPES) {
      const out = ITEMS.find((i) => i.id === r.out)!;
      expect(out.material).toBeFalsy(); // you cannot bottle a bundle of sprigs
      expect(r.gold).toBeLessThan(out.price); // brewing beats buying
      expect(r.herbs).toBeGreaterThan(0);
    }
  });

  it("exclusives carry the rivalry cut while shared goods stay at base price", () => {
    for (let d = 1; d <= 30; d++) {
      const dayKey = iso(d);
      const a = stallStock(dayKey, 0);
      const b = stallStock(dayKey, 1);
      let deals = 0;
      for (const def of a) {
        const p = stallPrice(def, b);
        if (b.some((x) => x.id === def.id)) expect(p).toBe(def.price); // shared: full price
        else {
          expect(p).toBe(Math.max(1, Math.round(def.price * 0.75)));
          expect(p).toBeLessThan(def.price);
          deals++;
        }
      }
      expect(deals).toBeGreaterThan(0); // every day offers at least one rivalry deal on Mira's cart
    }
  });
});
