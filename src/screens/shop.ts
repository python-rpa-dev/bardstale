import { el, button } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { ITEMS, itemById, sellPrice, type ItemDef } from "../data/items";
import { payFromPurseOrBank } from "../state/party";

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
  host.append(
    el("h1", { text: "General Store" }),
    el("p", { class: "muted", text: "Purse and bank are spent in that order. Sell prices are half." }),
    el(
      "div",
      { class: "shop-grid" },
      ...ITEMS.map((def) =>
        el(
          "div",
          { class: "shop-card" },
          slotImg(`item.${def.id}`, 32),
          el("span", { class: `item-name rar-${def.rarity}`, text: def.name }),
          el("span", { class: "muted", text: effectText(def) }),
          el("span", { class: "price", text: `${def.price} g` }),
          button("Buy", {
            hint: `Buy ${def.name} (${effectText(def)}) for ${def.price} gold.`,
            disabled: s.gold + s.bank < def.price,
            onClick: () => {
              let paid = false;
              ctx.commit((st) => {
                paid = payFromPurseOrBank(st, def.price);
                if (paid) st.inventory[def.id] = (st.inventory[def.id] ?? 0) + 1;
              });
              if (paid) ctx.sfx.coin();
              ctx.refresh();
            },
          }),
        ),
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
                    st.gold += sellPrice(def);
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
