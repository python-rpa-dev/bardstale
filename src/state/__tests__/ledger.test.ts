import { describe, expect, it } from "vitest";
import { BORROW_TIERS, accrueInterest, borrow, ledgerOf, repay } from "../ledger";
import { earn } from "../party";
import { newGame, rotateDaily, type GameState } from "../save";

const clock = () => new Date("2026-10-13T12:00:00Z");
const fresh = (): GameState => newGame(clock);
const nextDay = (n = 1) => () => new Date(`2026-10-${13 + n}T12:00:00Z`);

describe("the Ferryman's Ledger — borrowing", () => {
  it("newGame starts clear and newGame carries a fresh ledger", () => {
    const s = fresh();
    expect(s.ledger).toEqual({ debt: 0, borrowed: 0 });
  });

  it("borrow lands coin in the purse without touching the chronicle", () => {
    const s = fresh();
    expect(borrow(s, 150)).toBe(true);
    expect(s.gold).toBe(50 + 150);
    expect(s.chronicle!.goldEarned).toBe(0); // a loan is not income
    expect(ledgerOf(s)).toEqual({ debt: 150, borrowed: 150 });
  });

  it("only posted tiers borrow, and the cap refuses principal past MAX_DEBT", () => {
    const s = fresh();
    expect(borrow(s, 75)).toBe(false); // not a tier
    expect(borrow(s, BORROW_TIERS[2])).toBe(true); // 400
    expect(borrow(s, BORROW_TIERS[1])).toBe(false); // 400 + 150 > 500
    expect(borrow(s, BORROW_TIERS[0])).toBe(true); // 400 + 50 ≤ 500
    expect(ledgerOf(s).debt).toBe(450);
    expect(borrow(s, BORROW_TIERS[0])).toBe(true); // 450 + 50 = 500, the cap itself passes
    expect(borrow(s, BORROW_TIERS[0])).toBe(false); // one copper past the cap
  });
});

describe("the Ferryman's Ledger — interest", () => {
  it("the day roll compounds a fifth of the debt onto it", () => {
    const s = fresh();
    borrow(s, 150);
    expect(rotateDaily(s, nextDay(1))).toBe(true);
    expect(ledgerOf(s).debt).toBe(180);
    rotateDaily(s, nextDay(2));
    expect(ledgerOf(s).debt).toBe(216); // compounds on the new principal
  });

  it("a clear ledger accrues nothing and same-day rolls bill nobody", () => {
    const s = fresh();
    expect(rotateDaily(s, nextDay(1))).toBe(true);
    expect(ledgerOf(s).debt).toBe(0);
    expect(accrueInterest(s)).toBe(0);
  });
});

describe("the Ferryman's Ledger — the tithe", () => {
  it("half of every earn() goes to the debt while it stands; the chronicle counts the whole", () => {
    const s = fresh();
    borrow(s, 150);
    const gold0 = s.gold;
    earn(s, 60);
    expect(s.gold).toBe(gold0 + 30); // half to the Ferryman
    expect(ledgerOf(s).debt).toBe(120);
    expect(s.chronicle!.goldEarned).toBe(60); // career tally sees the full earning
  });

  it("the tithe caps at the remaining debt and stops when clear", () => {
    const s = fresh();
    borrow(s, 50);
    earn(s, 100);
    expect(ledgerOf(s).debt).toBe(0);
    expect(s.gold).toBe(50 + 50 + 50); // only the 50 owed was held back
    earn(s, 100);
    expect(s.gold).toBe(50 + 50 + 50 + 100); // clear purse keeps everything
  });

  it("odd earnings floor the tithe", () => {
    const s = fresh();
    borrow(s, 50);
    earn(s, 15); // floor(7.5) = 7
    expect(ledgerOf(s).debt).toBe(43);
  });
});

describe("the Ferryman's Ledger — repayment", () => {
  it("repay is capped by purse and debt, and clears exactly", () => {
    const s = fresh();
    borrow(s, 150);
    expect(repay(s, 50)).toBe(50);
    expect(s.gold).toBe(50 + 150 - 50);
    expect(repay(s, 10_000)).toBe(100); // purse holds 150, debt holds 100 → 100 lands
    expect(ledgerOf(s).debt).toBe(0);
    expect(repay(s, 50)).toBe(0); // nothing owed, nothing paid
  });
});
