import type { GameState } from "./save";

/**
 * The Ferryman's Ledger — town's loan shark. Borrow against tomorrow at fixed
 * tiers; every day the day rolls over, interest compounds onto the debt; and
 * while any coin is owed, half of everything earned is auto-tithe straight to
 * the Ferryman (hooked into the `earn()` chokepoint). Debt outlives runs —
 * the Ferryman is patient, and follows heroes back to town.
 */
export interface Ledger {
  debt: number; // what is owed right now
  borrowed: number; // lifetime principal taken — the Ferryman keeps receipts
}

export const BORROW_TIERS = [50, 150, 400];
export const MAX_DEBT = 500; // new principal stops here; interest may carry the debt past it
export const INTEREST_RATE = 0.2; // daily, compounded on the day roll
export const TITHE_SHARE = 0.5; // of every earn() while in debt

export function ledgerOf(state: GameState): Ledger {
  return (state.ledger ??= { debt: 0, borrowed: 0 });
}

/** Take a loan. False when the tier is not on the board or the cap would break. */
export function borrow(state: GameState, amount: number): boolean {
  const l = ledgerOf(state);
  if (!BORROW_TIERS.includes(amount) || l.debt + amount > MAX_DEBT) return false;
  l.debt += amount;
  l.borrowed += amount;
  state.gold += amount; // a loan is not income — the chronicle never counts the Ferryman's coin
  return true;
}

/** Pay coin back. Capped by purse and debt; returns what actually landed. */
export function repay(state: GameState, amount: number): number {
  const l = ledgerOf(state);
  const paid = Math.max(0, Math.min(Math.floor(amount), state.gold, l.debt));
  l.debt -= paid;
  state.gold -= paid;
  return paid;
}

/** One day's interest, floored. Called from rotateDaily; returns the added interest. */
export function accrueInterest(state: GameState): number {
  const l = ledgerOf(state);
  const interest = Math.floor(l.debt * INTEREST_RATE);
  l.debt += interest;
  return interest;
}
