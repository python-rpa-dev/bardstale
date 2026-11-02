import { el, button, bar, toast } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { BORROW_TIERS, MAX_DEBT, ledgerOf, borrow, repay } from "../state/ledger";

/** The Ferryman's Ledger — town's patient loan shark. */
export function renderLedger(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  const l = ledgerOf(s);
  const inDebt = l.debt > 0;

  const doBorrow = (amount: number) => {
    let ok = false;
    ctx.commit((d) => {
      ok = borrow(d, amount);
    });
    if (ok) {
      toast(`You take ${amount} g. The Ferryman writes it down.`);
      ctx.sfx.coin();
    }
    ctx.refresh();
  };
  const doRepay = (amount: number) => {
    const owed = l.debt;
    let paid = 0;
    ctx.commit((d) => {
      paid = repay(d, amount);
    });
    if (paid > 0) {
      toast(owed - paid <= 0 ? "The last coin changes hands — the Ledger is clear." : `You press ${paid} g into the Ferryman's palm.`);
    }
    ctx.refresh();
  };

  host.append(
    el("h1", { text: "The Ferryman's Ledger" }),
    el("p", { class: "muted quote", text: "He does not hurry. Interest does." }),
    el("p", {
      class: "muted",
      text: "Coin borrowed here outlives the run it was taken for. Every dawn adds a fifth of the debt; while any coin is owed, half of everything you earn goes to him before it reaches your purse.",
    }),
  );

  const panel = el(
    "div",
    { class: "bounty-card" },
    el(
      "span",
      {},
      el("b", { text: inDebt ? `Owed: ${l.debt} g` : "The Ledger is clear" }),
      el("span", { class: "price", text: ` — lifetime borrowed ${l.borrowed} g` }),
      inDebt
        ? el(
            "p",
            { class: "muted", text: `Tomorrow's bill: ${l.debt + Math.floor(l.debt * 0.2)} g unless you pay first.` },
          )
        : null,
      inDebt ? bar(l.debt, MAX_DEBT, "var(--error)", "", `${l.debt} owed`) : null,
      inDebt
        ? el("p", { class: "muted", text: "Half of every coin you earn is his until this reads zero." })
        : el("p", { class: "muted", text: "Borrow against tomorrow — the Vale rarely lets you pay it back at the same rate." }),
    ),
    inDebt
      ? el(
          "span",
          {},
          button("Repay 50", {
            hint: "Hand over 50 g (or whatever the purse still holds).",
            disabled: s.gold <= 0,
            onClick: () => doRepay(50),
          }),
          button("Repay All", {
            hint: "Pay as much as purse and debt allow.",
            disabled: s.gold <= 0,
            onClick: () => doRepay(l.debt),
          }),
        )
      : null,
  );
  host.append(panel);

  host.append(el("h2", { text: "Today's Offerings" }));
  const offers = el("div", { class: "bounty-board" });
  for (const amount of BORROW_TIERS) {
    const fits = l.debt + amount <= MAX_DEBT;
    offers.append(
      el(
        "div",
        { class: "bounty-card" },
        el(
          "span",
          {},
          el("b", { text: `${amount} g now` }),
          el("span", {
            class: "price",
            text: ` — ${amount + Math.floor(amount * 0.2)} g by tomorrow`,
          }),
          el("p", {
            class: "muted",
            text: fits
              ? "The Ferryman extends a hand wrapped in fingerless gloves."
              : `The cap is ${MAX_DEBT} g of debt — he shakes his head. Interest may still carry you past it.`,
          }),
        ),
        button("Borrow", {
          hint: fits ? "Take the coin; sign nothing." : "Over the Ferryman's cap.",
          disabled: !fits,
          onClick: () => doBorrow(amount),
        }),
      ),
    );
  }
  host.append(offers);

  host.append(button("← Town", { hint: "Back to the town square", onClick: () => ctx.navigate("#/town") }));
}
