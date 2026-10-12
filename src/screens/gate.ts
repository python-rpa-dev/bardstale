/** Gate of Adventures: pick a gate and start (or resume) an expedition. */

import { el, button, modal, toast } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { GATES, gateById, gateIndex } from "../data/gates";
import { dayNumber, MODIFIERS, modifierForGate, omensFor, type ModifierId } from "../data/modifiers";
import { bountyId } from "../data/bounties";
import { BESTIARY } from "../data/bestiary";
import { dailyChallenge, dailyShare, describeRare, endExpedition, startDailyRun, startExpedition } from "../state/expedition";

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

  // Daily Challenge — one date means one gate, one omen and one seed for every player on earth.
  const dc = dailyChallenge(s.dayKey);
  const dcGate = gateById(dc.gateId);
  const dcOmen = MODIFIERS.find((m) => m.id === dc.omen)!;
  const todays = (s.dailyBests ?? []).filter((b) => b.dayKey === s.dayKey).slice(0, 3);
  host.append(
    el("div", { class: "panel daily-card" },
      el("h3", {}, document.createTextNode("Daily Challenge — "), el("b", { text: dcGate.name })),
      el("p", { class: "muted", text: `${dcOmen.rumor.replace("{gate}", dcGate.name)} Everyone who enters today walks the same maze.` }),
      todays.length
        ? el("ul", { class: "daily-board muted" }, ...todays.map((b) => el("li", { text: dailyShare(b) })))
        : el("p", { class: "muted", text: "No attempts yet today — set the first score." }),
      button(ag ? "Resume Current Run First" : "Enter the Daily", {
        hint: ag ? "Finish or abandon your current expedition before starting a new one" : `Today's shared maze under ${dcOmen.name}`,
        disabled: !!ag,
        onClick: () => {
          ctx.sfx.click();
          ctx.commit((d) => startDailyRun(d));
          toast(`The Daily Challenge opens — ${dcGate.name} under ${dcOmen.name}. The same maze awaits everyone today.`);
          ctx.sfx.descend();
          ctx.navigate("#/dungeon");
        },
      }),
    ),
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
      el("p", { class: "muted", text: `Monsters level ${g.levels[0]}–${g.levels[1]} · ${g.floors} floors${g.gimmick === "flood" ? " · flooded halls below — the water slows you and draws foes" : g.gimmick === "collapse" ? " · collapsing floors — the stairs will not wait" : ""}` }),
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
          const descend = (omenName: string | null, omenId?: ModifierId) => {
            close();
            ctx.commit((d) => startExpedition(d, g.id, omenId));
            const n = ctx.state().activeGate?.runNumber ?? 1;
            toast(omenName ? `Run #${n} begins under ${omenName}. Steel yourselves.` : `Run #${n} begins unbound. Steel yourselves.`);
            ctx.sfx.descend();
            ctx.navigate("#/dungeon");
          };
          const omens = omensFor(gateIndex(g.id), dayNumber(), runs + 1);
          const close = modal(
            `Enter ${g.name}?`,
            el("div", {},
              el("p", { text: `Monsters level ${g.levels[0]}–${g.levels[1]} · ${g.floors} floors · run #${runs + 1}.` }),
              bountyHere
                ? el("p", {}, el("span", { class: "badge badge-mod", text: `Bounty here: ${bountyHere.count} × ${bountyHere.family} for ${bountyHere.gold} g` }))
                : null,
              el("p", { class: "muted", text: "Choose the omen you carry below — today's sign is among them, as the tavern promised." }),
              el("div", { class: "omen-list" },
                ...omens.map((o, i) => {
                  const card = button(o.id === "none" ? "Fair Weather — no tricks below" : `Descend under ${o.name}`, {
                    hint: o.effect,
                    onClick: () => descend(o.id === "none" ? null : o.name, o.id),
                  });
                  if (i === 0) card.append(el("span", { class: "omen-badge", text: "today's sign" })); // omensFor() always lists the ambient omen first
                  return card;
                }),
              ),
              el("div", { class: "modal-actions" },
                button("Descend unbound — no omen", {
                  hint: "Refuse every sign and trust plain steel.",
                  onClick: () => descend(null),
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
