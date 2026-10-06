/** Gate of Adventures: pick a gate and start (or resume) an expedition. */

import { el, button, modal, toast } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { GATES, gateById, gateIndex } from "../data/gates";
import { dayNumber, modifierForGate } from "../data/modifiers";
import { bountyId } from "../data/bounties";
import { BESTIARY } from "../data/bestiary";
import { describeRare, endExpedition, startExpedition } from "../state/expedition";

export function renderGate(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  const ag = s.activeGate;

  host.append(el("h2", { class: "sr-only", text: "Gate of Adventures" }));

  if (ag) {
    const def = gateById(ag.gateId);
    host.append(
      el("div", { class: "panel" },
        el("p", {},
          el("b", { text: `Expedition in progress — ${def.name}` }),
          document.createTextNode(` · Floor ${ag.floor + 1} of ${def.floors}, run #${ag.runNumber}`),
        ),
        el("div", { class: "sheet-actions" },
          button("Resume Expedition", { hint: "Return to the depths", onClick: () => ctx.navigate("#/dungeon") }),
          button("Abandon Run", {
            hint: "Leave the maze empty-handed (gold and items already taken are kept)",
            onClick: () => {
              const close = modal(
                "Abandon this run?",
                el("div", {},
                  el("p", { text: `Your party withdraws from ${def.name}. Gold and items already taken are kept.` }),
                  el("div", { class: "modal-actions" },
                    button("Withdraw", {
                      onClick: () => {
                        close();
                        const rare = ctx.state().activeGate?.rareSpawn; // return toast names the run's event
                        ctx.commit((d) => endExpedition(d));
                        toast(rare ? `You slip out of the maze. ${describeRare(rare)}` : "You slip out of the maze.");
                        ctx.navigate("#/town");
                      },
                    }),
                    button("Keep Delving", { onClick: () => close() }),
                  ),
                ),
              );
            },
          }),
        ),
      ),
    );
  }

  const avg = s.party.length ? Math.round((s.party.reduce((a, p) => a + p.level, 0) / s.party.length) * 10) / 10 : 0;
  host.append(
    el("p", { class: "muted", text: `Party average level ${avg}. The gates do not scale — choose your depth.` }),
  );

  const cards = GATES.map((g) => {
    const mod = modifierForGate(gateIndex(g.id), dayNumber());
    const runs = s.runs[g.id] ?? 0;
    const offer = s.bounties.offers.find((o) => bountyId(o) === s.bounties.active) ?? null;
    // Bounty badge only lights up when the gate's level band actually contains bounty game.
    const bountyHere =
      offer && BESTIARY.some((m) => m.family === offer.family && m.lvl >= g.levels[0] && m.lvl <= g.levels[1]) ? offer : null;
    return el("div", { class: "panel gate-card" },
      el("h3", { text: g.name }),
      el("p", { class: "muted", text: `Monsters level ${g.levels[0]}–${g.levels[1]} · ${g.floors} floors` }),
      el("p", {},
        el("span", {
          class: mod.id === "none" ? "chip dim" : "chip",
          text: mod.id === "none" ? "Fair Weather today" : `${mod.name} stirs ${g.name} today`,
        }),
      ),
      el("p", { class: "muted", text: runs > 0 ? `Runs completed: ${runs}` : "You have never entered." }),
      button(ag ? "Resume Current Run First" : "Enter the Gate", {
        hint: ag
          ? "Finish or abandon your current expedition before starting a new one"
          : `Begin run #${runs + 1} of ${g.name}`,
        disabled: !!ag,
        onClick: () => {
          ctx.sfx.click();
          const close = modal(
            `Enter ${g.name}?`,
            el("div", {},
              el("p", { text: `Monsters level ${g.levels[0]}–${g.levels[1]} · ${g.floors} floors · run #${runs + 1}.` }),
              el("p", { class: "muted", text: mod.id === "none" ? "Fair Weather — no tricks below." : mod.rumor.replace("{gate}", g.name) }),
              bountyHere
                ? el("p", {}, el("span", { class: "badge badge-mod", text: `Bounty here: ${bountyHere.count} × ${bountyHere.family} for ${bountyHere.gold} g` }))
                : null,
              el("div", { class: "modal-actions" },
                button("Descend", {
                  onClick: () => {
                    close();
                    ctx.commit((d) => startExpedition(d, g.id));
                    const n = ctx.state().activeGate?.runNumber ?? 1;
                    toast(`Run #${n} begins. Steel yourselves.`);
                    ctx.sfx.descend();
                    ctx.navigate("#/dungeon");
                  },
                }),
                button("Not Yet", { onClick: () => close() }),
              ),
            ),
          );
        },
      }),
    );
  });

  host.append(el("div", { class: "grid-cards" }, ...cards));
}
