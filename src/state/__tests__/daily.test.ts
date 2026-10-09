import { describe, expect, it } from "vitest";
import { dailyChallenge, dailyShare, DAILY_BOARD_SIZE, endExpedition, startDailyRun, startExpedition } from "../expedition";
import { newGame } from "../save";
import { importSave } from "../saveio";
import { serialize } from "../save";

const clock = () => new Date("2026-10-05T12:00:00Z");

describe("daily challenge", () => {
  it("picks the same gate, omen and seed for every call on one date", () => {
    expect(dailyChallenge("2026-10-05")).toEqual(dailyChallenge("2026-10-05"));
  });

  it("rotates the challenge as the date turns", () => {
    const days = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map(dailyChallenge);
    const seen = new Set(days.map((d) => `${d.gateId}|${d.omen}|${d.seed}`));
    expect(seen.size).toBe(4); // no two adjacent days share the full configuration
  });

  it("deals every player on a date the same maze", () => {
    const a = newGame(clock);
    const b = newGame(clock);
    startDailyRun(a);
    startDailyRun(b);
    expect(a.activeGate!.daily).toBe(true);
    expect(JSON.stringify(a.activeGate!.map)).toEqual(JSON.stringify(b.activeGate!.map));
    expect(a.activeGate!.seed).toBe(b.activeGate!.seed);
    expect(a.activeGate!.modifier).toBe(b.activeGate!.modifier);
  });

  it("the shared seed overrides the per-save derivation", () => {
    const s = newGame(clock);
    startDailyRun(s);
    const daily = s.activeGate!;
    delete s.activeGate;
    startExpedition(s, daily.gateId); // same gate, ordinary run — different seed unless proven otherwise
    expect(s.activeGate!.seed).not.toBe(daily.seed);
  });

  it("scores a surfaced daily as depth·100 + kills·10 + gold and shares it", () => {
    const s = newGame(clock);
    startDailyRun(s);
    const ag = s.activeGate!;
    ag.floor = 2;
    ag.killsThisRun = 41;
    ag.loot.gold = 912;
    const rec = endExpedition(s, true);
    expect(rec).toBeDefined();
    expect(rec!.score).toBe(3 * 100 + 41 * 10 + 912);
    expect(dailyShare(rec!)).toBe("HV-2026-10-05 #1: 3F/41 kills/912 g");
    expect(s.dailyBests![0].score).toBe(3 * 100 + 41 * 10 + 912);
    expect(s.activeGate).toBeUndefined();
  });

  it("records wipes too — every exit path counts", () => {
    const s = newGame(clock);
    startDailyRun(s);
    s.activeGate!.floor = 1;
    endExpedition(s, false); // the party fell on floor 2
    expect(s.dailyBests).toHaveLength(1);
    expect(s.dailyBests![0].depth).toBe(2);
  });

  it("ordinary runs never touch the leaderboard", () => {
    const s = newGame(clock);
    startExpedition(s, "hollow-roots");
    endExpedition(s, true);
    expect(s.dailyBests ?? []).toHaveLength(0);
  });

  it("keeps only the best ten attempts, highest score first", () => {
    const s = newGame(clock);
    for (let i = 0; i < DAILY_BOARD_SIZE + 2; i++) {
      startDailyRun(s);
      s.activeGate!.floor = i; // each attempt goes one floor deeper than the last
      endExpedition(s, false);
    }
    const board = s.dailyBests!;
    expect(board).toHaveLength(DAILY_BOARD_SIZE);
    for (let i = 1; i < board.length; i++) expect(board[i - 1].score).toBeGreaterThanOrEqual(board[i].score);
    expect(board[0].depth).toBe(DAILY_BOARD_SIZE + 2); // the deepest run still tops the board
  });

  it("survives an export/import round-trip, junk entries filtered", () => {
    const s = newGame(clock);
    startDailyRun(s);
    s.activeGate!.floor = 4;
    endExpedition(s, true);
    const raw = JSON.parse(serialize(s));
    raw.dailyBests.push({ dayKey: "2026-10-05", gateId: "hollow-roots" } as never); // no score — junk
    const res = importSave(JSON.stringify(raw));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.dailyBests).toHaveLength(1);
      expect(res.state.dailyBests![0].score).toBe(5 * 100);
    }
  });
});
