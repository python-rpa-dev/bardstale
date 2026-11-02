import { el, button, bar, toast } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { itemById, RECIPES } from "../data/items";
import { brewPotion, brewCoinFor } from "../state/tavern";
import { BESTIARY, type Family } from "../data/bestiary";
import { bountyId } from "../data/bounties";
import { questById, stepLabel } from "../data/quests";
import { acceptQuest, deliverQuest } from "../state/quests";
import { GATES, gateById, gateIndex } from "../data/gates";
import { modifierForGate } from "../data/modifiers";
import { pcMax, restWoundDecay } from "../state/save";

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
        let knit = 0;
        ctx.commit((st) => {
          for (const p of st.party) {
            const max = pcMax(p);
            p.hp = max.hp;
            p.sp = max.sp;
            knit += restWoundDecay(p.statuses);
          }
        });
        ctx.sfx.heal();
        toast(knit ? "The party rests by the fire. HP and SP fully restored; an old bleed scabs over." : "The party rests by the fire. HP and SP fully restored.");
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

  host.append(el("h2", { text: "Quest Chains" }));
  const qb = s.quests;
  if (qb) {
    const act = qb.active;
    const actQ = act ? questById(act.id) : null;
    const renderCard = (q: ReturnType<typeof questById>, accepted: boolean) => {
      const step = act && actQ?.id === q.id ? q.steps[act.step] : undefined;
      host.append(
        el(
          "div",
          { class: `bounty-card${accepted ? " accepted" : ""}` },
          el(
            "span",
            {},
            el("b", { text: q.name }),
            el("span", { class: "price", text: ` — reward ${q.gold} g, paid at the last link` }),
            el("p", { class: "muted", text: q.flavor }),
            ...q.steps.map((st, i) => {
              const mark = accepted && act ? (act.step > i ? "✓" : act.step === i ? "▸" : "·") : "·";
              return el("p", { class: accepted && act && act.step > i ? "muted" : "", text: `${mark} ${stepLabel(st)}` });
            }),
            step && step.kind === "slay" && act
              ? bar(act.progress, step.count, "var(--gold)", "", `${act.progress}/${step.count} slain`)
              : null,
          ),
          accepted
            ? step && step.kind === "deliver"
              ? button(`Deliver to ${step.npc}`, {
                  hint: "Hand it over and close the chain — the reward is paid now.",
                  onClick: () => {
                    const out: { v: { name: string; gold: number } | null } = { v: null };
                    ctx.commit((d) => {
                      out.v = deliverQuest(d);
                    });
                    if (out.v) {
                      toast(`Quest complete: ${out.v.name} — +${out.v.gold} g.`);
                      ctx.sfx.levelup();
                    }
                    ctx.refresh();
                  },
                })
              : el("span", { class: "muted", text: "In progress." })
            : button(qb.active ? "Replace" : "Accept", {
                hint: `A chain of ${q.steps.length} links, paid once at the end.${qb.active ? " Replaces the current chain." : ""}`,
                onClick: () => {
                  ctx.commit((d) => {
                    acceptQuest(d, q.id);
                  });
                  toast(`Quest accepted: ${q.name}.`);
                  ctx.refresh();
                },
              }),
        ),
      );
    };
    if (actQ) renderCard(actQ, true);
    for (const id of qb.offers) {
      if (qb.completed.includes(id) || qb.active?.id === id) continue;
      renderCard(questById(id), false);
    }
    if (!actQ && qb.offers.every((id) => qb.completed.includes(id))) {
      host.append(el("p", { class: "muted", text: "No chains posted today — the board is clean." }));
    }
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
