import { el, button, bar, toast } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { classById } from "../data/classes";
import { pcMax } from "../state/save";
import { TEMPLE, payFromPurseOrBank } from "../state/party";

export function renderTemple(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  host.append(
    el("h1", { text: "Temple of the Quiet Light" }),
    el("p", { class: "muted quote", text: "Your heroes never die forever." }),
    (() => {
      const hurt = s.party.filter((p) => p.hp > 0 && p.hp < pcMax(p).hp);
      const total = hurt.reduce((n, p) => n + TEMPLE.healCost(p), 0);
      return button(hurt.length ? `Heal All — ${total} g` : "Heal All", {
        hint: hurt.length
          ? `Restore the HP of all ${hurt.length} wounded heroes for ${total} gold.`
          : "Everyone is already at full HP.",
        disabled: hurt.length === 0 || s.gold + s.bank < total,
        onClick: () => {
          let paid = false;
          ctx.commit((st) => {
            paid = payFromPurseOrBank(st, total);
            if (paid) for (const p of st.party) if (p.hp > 0 && p.hp < pcMax(p).hp) p.hp = pcMax(p).hp;
          });
          if (paid) {
            ctx.sfx.coin();
            ctx.sfx.heal();
          }
          ctx.refresh();
        },
      });
    })(),
    el(
      "div",
      { class: "temple-rows" },
      ...s.party.map((pc) => {
        const max = pcMax(pc);
        const downed = pc.hp <= 0;
        const healCost = TEMPLE.healCost(pc);
        const affordable = s.gold + s.bank;
        return el(
          "div",
          { class: `temple-row${downed ? " downed" : ""}` },
          slotImg(`class.${pc.classId}`, 48),
          el(
            "div",
            { class: "temple-id" },
            el("b", { text: pc.name }),
            el("span", { text: ` ${classById(pc.classId).name} Lv ${pc.level}` }),
            bar(pc.hp, max.hp, "var(--hp)", "♥", `${pc.name} HP`),
            pc.statuses.length
              ? el(
                  "div",
                  { class: "status-chips" },
                  ...pc.statuses.map((st) =>
                    el("span", {
                      class: `chip chip-${st.kind}`,
                      text: `${st.kind === "poison" ? "Poison" : "Wound"} ${st.roundsLeft}`,
                    }),
                  ),
                )
              : null,
          ),
          el(
            "div",
            { class: "temple-actions" },
            downed
              ? s.reviveToken
                ? button("Revive — by token", {
                    hint: "A rescued villager's kin press a temple token into your hand. One revive on the house.",
                    onClick: () => {
                      let revived = false;
                      ctx.commit((st) => {
                        const p = st.party.find((x) => x.id === pc.id);
                        if (p && st.reviveToken) {
                          p.hp = 1;
                          st.reviveToken = false; // one token, one life
                          revived = true;
                        }
                      });
                      if (!revived) return;
                      toast("The temple accepts the rescue token — no fee.");
                      ctx.sfx.levelup();
                      ctx.refresh();
                    },
                  })
                : button(`Revive — ${TEMPLE.reviveCost} g`, {
                    hint: `Restore to 1 HP for ${TEMPLE.reviveCost} gold.`,
                    disabled: affordable < TEMPLE.reviveCost,
                    onClick: () => {
                      let revived = false;
                      ctx.commit((st) => {
                        const p = st.party.find((x) => x.id === pc.id);
                        if (p && payFromPurseOrBank(st, TEMPLE.reviveCost)) {
                          p.hp = 1;
                          revived = true;
                        }
                      });
                      if (!revived) return;
                      ctx.sfx.coin();
                      ctx.sfx.levelup();
                      ctx.refresh();
                    },
                  })
              : button(`Heal — ${healCost} g`, {
                  hint: `Restore HP to ${max.hp} for ${healCost} gold (2 × level).`,
                  disabled: pc.hp >= max.hp || affordable < healCost,
                  onClick: () => {
                    let healed = false;
                    ctx.commit((st) => {
                      const p = st.party.find((x) => x.id === pc.id);
                      if (p && payFromPurseOrBank(st, TEMPLE.healCost(p))) {
                        p.hp = pcMax(p).hp;
                        healed = true;
                      }
                    });
                    if (healed) {
                      ctx.sfx.coin();
                      ctx.sfx.heal();
                    }
                    ctx.refresh();
                  },
                }),
            button(`Cure Status — ${TEMPLE.cureCost} g`, {
              hint: `Remove all poison and wounds for ${TEMPLE.cureCost} gold.`,
              disabled: pc.statuses.length === 0 || affordable < TEMPLE.cureCost,
              onClick: () => {
                let cured = false;
                ctx.commit((st) => {
                  const p = st.party.find((x) => x.id === pc.id);
                  if (p && payFromPurseOrBank(st, TEMPLE.cureCost)) {
                    p.statuses = [];
                    cured = true;
                  }
                });
                if (cured) ctx.sfx.coin();
                ctx.refresh();
              },
            }),
          ),
        );
      }),
    ),
    button("← Town", { hint: "Back to the town square", onClick: () => ctx.navigate("#/town") }),
  );
}
