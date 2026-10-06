import { describe, expect, it, vi } from "vitest";
import { bountyId } from "../../data/bounties";
import { SAVE_KEY, createStore, deserialize, newGame, serialize, type ActiveGate } from "../save";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const clockFrom = (iso: string) => {
  const d = new Date(iso);
  return () => d;
};

describe("save round-trip", () => {
  it("serialize→parse equals the original state", () => {
    const s = newGame(clockFrom("2026-10-04T12:00:00Z"));
    s.gold = 137;
    s.party[0].level = 3;
    const back = deserialize(serialize(s));
    expect(back).toEqual(s);
  });

  it("backfills sfxMuted for v1 saves predating the mute control", () => {
    const s = newGame(clockFrom("2026-10-04T12:00:00Z"));
    const raw = JSON.parse(serialize(s)) as { settings: Record<string, unknown> };
    delete raw.settings.sfxMuted; // a pre-M8 save on disk
    const back = deserialize(JSON.stringify(raw));
    expect(back?.settings.sfxMuted).toBe(false);
    expect(back?.settings.sfxVolume).toBe(s.settings.sfxVolume);
  });

  it("merges a v1 save's separate bank reserve into gold on load", () => {
    const s = newGame(clockFrom("2026-10-04T12:00:00Z"));
    const raw = JSON.parse(serialize(s)) as Record<string, unknown> & { gold: number };
    raw.gold = 80;
    raw.bank = 40; // a pre-merge save on disk
    const back = deserialize(JSON.stringify(raw));
    expect(back?.gold).toBe(120);
    expect(back && "bank" in back).toBe(false);
  });

  it("active expedition survives the round-trip (JSON-safe map)", () => {
    const s = newGame(clockFrom("2026-10-04T12:00:00Z"));
    const gate: ActiveGate = {
      gateId: "hollow-roots",
      runNumber: 1,
      seed: 42,
      modifier: "none",
      floor: 0,
      map: { w: 21, h: 21, cells: "1".repeat(441), entities: [[12, "stairs"]], },
      pos: { x: 1, y: 1 },
      dir: 1,
      visited: [1, 23],
      partyHpSp: s.party.map((p) => ({ id: p.id, hp: p.hp, sp: p.sp })),
      chests: [{ cell: 500, opened: false }],
      flags: { "shrine-f0": true },
      steps: 7,
      loot: { gold: 12, items: { "potion-hp": 1 } },
    };
    s.activeGate = gate;
    expect(deserialize(serialize(s))?.activeGate).toEqual(gate);
  });

  it("corrupt save yields a fresh game and never throws", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, "{not json!!");
    const store = createStore({ storage, now: clockFrom("2026-10-04T12:00:00Z") });
    expect(store.state.version).toBe(1);
    expect(store.state.party).toHaveLength(4);
  });

  it("unknown version is rejected to a fresh game", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 99 }));
    const store = createStore({ storage, now: clockFrom("2026-10-04T12:00:00Z") });
    expect(store.state.party).toHaveLength(4);
  });

  it("commit + saveNow persists; reload restores gold and party HP", () => {
    const storage = new MemoryStorage();
    const clock = clockFrom("2026-10-04T12:00:00Z");
    const a = createStore({ storage, now: clock });
    a.commit((s) => {
      s.gold += 25;
      s.party[0].hp -= 7;
    });
    const goldAfter = a.state.gold;
    const hpAfter = a.state.party[0].hp;
    a.saveNow();
    const b = createStore({ storage, now: clock });
    expect(b.state.gold).toBe(goldAfter);
    expect(b.state.party[0].hp).toBe(hpAfter);
  });
});

describe("daily rotation", () => {
  it("rollover to a new day replaces the board with fresh offers", () => {
    const storage = new MemoryStorage();
    const a = createStore({ storage, now: clockFrom("2026-10-04T12:00:00Z") });
    const before = a.state.bounties.offers.map((o) => bountyId(o));
    a.saveNow();
    const b = createStore({ storage, now: clockFrom("2026-10-05T12:00:00Z") });
    const after = b.state.bounties.offers.map((o) => bountyId(o));
    expect(after).toHaveLength(3);
    expect(after).not.toEqual(before); // daily seed differs → board changed
    expect(b.state.dayKey).toBe("2026-10-05");
    expect(b.rotatedDay).toBe(true); // load detected the new day → boot toast hook fires
    const c = createStore({ storage, now: clockFrom("2026-10-05T18:00:00Z") });
    expect(c.rotatedDay).toBe(false); // already rolled today — no repeat toast
  });

  it("completed bounties are never re-offered after rollover", () => {
    const storage = new MemoryStorage();
    const a = createStore({ storage, now: clockFrom("2026-10-04T12:00:00Z") });
    const done = a.state.bounties.offers[0];
    a.commit((s) => {
      s.bounties.offers[0].done = true;
      s.bounties.completed.push(bountyId(done));
    });
    a.saveNow();
    const b = createStore({ storage, now: clockFrom("2026-10-05T12:00:00Z") });
    expect(b.state.bounties.offers.map((o) => bountyId(o))).not.toContain(bountyId(done));
  });

  it("same-day reload keeps the board", () => {
    const storage = new MemoryStorage();
    const a = createStore({ storage, now: clockFrom("2026-10-04T09:00:00Z") });
    const before = a.state.bounties.offers.map((o) => bountyId(o));
    a.saveNow();
    const b = createStore({ storage, now: clockFrom("2026-10-04T23:59:00Z") });
    expect(b.state.bounties.offers.map((o) => bountyId(o))).toEqual(before);
  });
});

describe("store load (import)", () => {
  it("replaces state and cancels a pending debounced write", () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      const store = createStore({ storage, now: clockFrom("2026-10-05T12:00:00Z") });
      store.commit((s) => {
        s.gold = 10;
      }); // schedules a save at +300 ms — the pre-import state
      const imported = newGame(clockFrom("2026-10-05T12:00:00Z"));
      imported.gold = 999;
      store.load(imported);
      expect((JSON.parse(storage.getItem(SAVE_KEY)!) as { gold: number }).gold).toBe(999);
      vi.advanceTimersByTime(500); // the old pending write must not resurrect over the import
      expect((JSON.parse(storage.getItem(SAVE_KEY)!) as { gold: number }).gold).toBe(999);
    } finally {
      vi.useRealTimers();
    }
  });
});
