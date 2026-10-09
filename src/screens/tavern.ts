import { el, button, bar, toast } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { itemById, RECIPES } from "../data/items";
import { brewPotion, brewCoinFor } from "../state/tavern";
import { BESTIARY, type Family } from "../data/bestiary";
import { bountyId } from "../data/bounties";
import { GATES, gateById, gateIndex } from "../data/gates";
import { modifierForGate } from "../data/modifiers";
import { pcMax } from "../state/save";

/** Epoch-day number matching modifiers.dayNumber for a stored dayKey. */
function dayNumFromKey(dayKey: string): number {
  return Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 86400000);
}

/** True when the gate's monster level band can spawn this family (plan M4 badge). */
function familyHostable(gateId: string, family: Family): boolean {
  const g = gateById(gateId);
  return BESTIARY.some((m) => m.family === family && m.lvl >= g.levels[0] && m.lvl <= g.levels[1]);
}

export function renderTavern(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  host.append(
    el("h1", { text: "The Broken Antler" }),
    button("Rest — free", {
      hint: "Restore every adventurer's HP and SP to full. No charge.",
      onClick: () => {
        ctx.commit((st) => {
          for (const p of st.party) {
            const max = pcMax(p);
            p.hp = max.hp;
            p.sp = max.sp;
          }
        });
        ctx.sfx.heal();
        toast("The party rests by the fire. HP and SP fully restored.");
        ctx.refresh();
      },
    }),
  );

  host.append(el("h2", { text: "Bounty Board" }));
  const activeGate = s.activeGate?.gateId;
  for (const offer of s.bounties.offers) {
    const id = bountyId(offer);
    const accepted = s.bounties.active === id;
    host.append(
      el(
        "div",
        { class: `bounty-card${accepted ? " accepted" : ""}` },
        slotImg(`family.${offer.family}`, 32),
        el(
          "span",
          {},
          el("b", { text: `Slay ${offer.count} × ${offer.family}` }),
          el("span", { class: "price", text: ` — reward ${offer.gold} g` }),
        ),
        accepted ? bar(offer.kills, offer.count, "var(--gold)", "", `${offer.kills}/${offer.count} slain`) : null,
        activeGate && familyHostable(activeGate, offer.family)
          ? el("span", { class: "badge", text: `matches ${gateById(activeGate).name}` })
          : null,
        accepted
          ? el("span", { class: "muted", text: "Accepted." })
          : button(s.bounties.active ? "Replace" : "Accept", {
              hint: `Track this bounty: slay ${offer.count} ${offer.family} for ${offer.gold} gold.${s.bounties.active ? " Replaces the current bounty." : ""}`,
              onClick: () => {
                ctx.commit((st) => {
                  st.bounties.active = id;
                });
                toast(`Bounty accepted: ${offer.count} × ${offer.family} for ${offer.gold} g.`);
                ctx.refresh();
              },
            }),
      ),
    );
  }

  host.append(el("h2", { text: "Hearth Kitchen" }));
  const herbs = s.inventory.moonpetal ?? 0;
  host.append(
    el("p", {
      class: "muted",
      text: `The cook trades shrine-grown moonpetal for bottled potions — cheaper than the Row. Sprigs in your pack: ${herbs}.`,
    }),
  );
  for (const r of RECIPES) {
    const out = itemById(r.out);
    const coin = brewCoinFor(s, r.gold); // Ashbrand keeps the kettle fuel cheap
    host.append(
      el(
        "div",
        { class: "shop-row" },
        el("span", { text: out.name }),
        el("span", { class: "muted", text: `${r.herbs} sprigs + ${coin} g` }),
        button("Brew", {
          hint: `Bottle one ${out.name} (buys for ${out.price} g) from shrine herbs and kettle fuel.`,
          disabled: herbs < r.herbs || s.gold < coin,
          onClick: () => {
            ctx.commit((st) => brewPotion(st, r.out));
            ctx.sfx.coin();
            toast(`Brewed: ${out.name}. The kettle sings.`);
            ctx.refresh();
          },
        }),
      ),
    );
  }

  host.append(el("h2", { text: "Rumors" }));
  const day = dayNumFromKey(s.dayKey);
  for (const g of GATES) {
    const mod = modifierForGate(gateIndex(g.id), day);
    host.append(
      el(
        "p",
        { class: "rumor" },
        el("span", { text: `${mod.rumor.replace("{gate}", g.name)}.` }),
        mod.id !== "none" ? el("span", { class: "badge badge-mod", text: mod.name }) : null,
      ),
    );
  }

  host.append(button("← Town", { hint: "Back to the town square", onClick: () => ctx.navigate("#/town") }));
}
