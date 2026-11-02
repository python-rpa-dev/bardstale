import { el, button } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { itemById, rareUnlocked, RARE_UNLOCK_GOLD, sellPrice, stallPrice, stallStock, STALLS, type ItemDef } from "../data/items";
import { pay, earn } from "../state/party";
import { perkMult } from "../data/trophies";

export function useText(def: ItemDef): string {
  const u = def.use!;
  switch (u.kind) {
    case "restore-hp":
      return `Restores ${u.amount} HP`;
    case "restore-sp":
      return `Restores ${u.amount} SP`;
    case "combat-atk-buff":
      return `+${u.amount} ATK for this combat`;
    case "party-heal":
      return `Heals the whole party for ${u.amount} HP each`;
    case "light": {
      const perk = u.smoke ? " Greasy smoke dulls ambushes while lit." : u.reveal ? ` Cold light uncovers hidden things within ${u.reveal}.` : "";
      return `Lights your way for ${u.amount} more steps.${perk}`;
    }
  }
}

function effectText(def: ItemDef): string {
  if (def.use) return useText(def);
  const parts = Object.entries(def.bonus ?? {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k.toUpperCase()}`);
  if (def.critChanceBonus) parts.push(`+${Math.round(def.critChanceBonus * 100)}% crit`);
  return parts.join(", ") || "No bonus.";
}

export function renderShop(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  const stocks = STALLS.map((_, i) => stallStock(s.dayKey, i));
  const card = (def: ItemDef, stallIndex: number) => {
    const price = Math.floor(stallPrice(def, stocks[1 - stallIndex]) * perkMult(s.trophies, "shop")); // Wyrm Hoard: the Row haggles for you
    const deal = price < def.price;
    const locked = def.rarity === "rare" && !rareUnlocked(s.chronicle?.goldEarned ?? 0);
    return el(
      "div",
      { class: locked ? "shop-card locked" : "shop-card" },
      slotImg(`item.${def.id}`, 32),
      el("span", { class: `item-name rar-${def.rarity}`, text: def.name }),
      el("span", { class: "muted", text: effectText(def) }),
      deal && !locked
        ? el(
            "span",
            { class: "price" },
            el("s", { text: `${def.price} g` }),
            ` ${price} g`,
            el("span", { class: "deal", text: "rivalry deal" }),
          )
        : el("span", { class: "price", text: `${price} g` }),
      locked
        ? el("span", { class: "muted lock-line", text: `Locked — earn ${RARE_UNLOCK_GOLD} career gold to trade rare wares.` })
        : button("Buy", {
            hint: deal
              ? `Buy ${def.name} (${effectText(def)}) for ${price} gold — the rival cart doesn't stock it today, so this one slashes the price.`
              : `Buy ${def.name} (${effectText(def)}) for ${price} gold.`,
            disabled: s.gold < price,
            onClick: () => {
              let paid = false;
              ctx.commit((st) => {
                paid = pay(st, price);
                if (paid) st.inventory[def.id] = (st.inventory[def.id] ?? 0) + 1;
              });
              if (paid) ctx.sfx.coin();
              ctx.refresh();
            },
          }),
    );
  };
  host.append(
    el("h1", { text: "Merchants' Row" }),
    el(
      "p",
      { class: "muted", text: `Gold in hand: ${s.gold} g. Two rivals, one street — each cuts prices on goods the other doesn't carry today. Sell prices are half.` },
    ),
    ...STALLS.map((stall, i) =>
      el(
        "div",
        { class: "stall" },
        el("h2", { text: stall.name }),
        el("p", { class: "muted stall-tagline", text: stall.tagline }),
        el("div", { class: "shop-grid" }, ...stocks[i].map((def) => card(def, i))),
      ),
    ),
  );
  const sellable = Object.entries(s.inventory).filter(([, n]) => n > 0);
  host.append(
    el("h2", { text: "Sell" }),
    el("p", { class: "muted", text: "Only the party inventory can be sold — unequip gear on the Guild sheet first." }),
    sellable.length === 0
      ? el("p", { class: "muted", text: "The pack mule is empty." })
      : el(
          "div",
          { class: "sell-list" },
          ...sellable.map(([iid, n]) => {
            const def = itemById(iid);
            return el(
              "div",
              { class: "sell-row" },
              slotImg(`item.${def.id}`, 24),
              el("span", { class: `item-name rar-${def.rarity}`, text: `${def.name} ×${n}` }),
              button(`Sell — ${sellPrice(def)} g`, {
                hint: `Sell one ${def.name} for ${sellPrice(def)} gold.`,
                onClick: () => {
                  ctx.commit((st) => {
                    st.inventory[iid] = (st.inventory[iid] ?? 0) - 1;
                    if ((st.inventory[iid] ?? 0) <= 0) delete st.inventory[iid];
                    earn(st, sellPrice(def));
                  });
                  ctx.sfx.coin();
                  ctx.refresh();
                },
              }),
            );
          }),
        ),
    button("← Town", { hint: "Back to the town square", onClick: () => ctx.navigate("#/town") }),
  );
}
