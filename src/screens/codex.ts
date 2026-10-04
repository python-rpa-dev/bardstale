import { el, bar, button } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg, slotSrc } from "../render/art";
import { BESTIARY, FAMILIES, type MonsterDef, type Special } from "../data/bestiary";
import { medalForFamily } from "../data/medals";

function specialText(s: Special | undefined): string {
  if (!s) return "—";
  switch (s.kind) {
    case "poison":
      return `Poison: −${-s.dex} DEX for ${s.rounds} rounds`;
    case "drain":
      return `Drain: −${s.spPerTurn} SP per turn to target`;
    case "regen":
      return `Regeneration: +${s.hpPerRound} HP per round`;
    case "breath":
      return `Breath: hits the whole party for 8, once every 3 rounds`;
  }
}

export function renderCodex(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  host.append(
    el("h1", { text: "The Codex" }),
    el("p", { class: "muted", text: "First kills stamp a page. Completing a family earns its medal — permanent perks." }),
  );

  for (const family of FAMILIES) {
    const members = BESTIARY.filter((m) => m.family === family);
    const stamped = members.filter((m) => s.codex.includes(m.id));
    const medal = medalForFamily(family);
    const earned = s.medals.includes(family);
    host.append(
      el(
        "div",
        { class: "family-block" },
        el(
          "div",
          { class: "family-head" },
          slotImg(`family.${family}`, 32),
          el("h2", { text: family[0].toUpperCase() + family.slice(1) }),
          bar(stamped.length, members.length, "var(--gold)", "", `${stamped.length}/${members.length} stamped`),
          earned
            ? el("span", { class: "badge badge-medal", text: medal.name, title: medal.perkText })
            : el("span", { class: "muted", text: `Medal: ${medal.name} — ${medal.perkText}` }),
        ),
        el(
          "div",
          { class: "codex-grid" },
          ...members.map((m) => monsterCard(m, s.codex.includes(m.id))),
        ),
      ),
    );
  }

  host.append(button("← Town", { hint: "Back to the town square", onClick: () => ctx.navigate("#/town") }));
}

function monsterCard(m: MonsterDef, stamped: boolean): HTMLElement {
  if (!stamped) {
    return el(
      "div",
      { class: "codex-card unstamped" },
      el("img", { src: slotSrc(`monster.${m.id}`), class: "silhouette", alt: "" }),
      el("span", { class: "unknown", text: "???" }),
    );
  }
  return el(
    "div",
    { class: "codex-card" },
    slotImg(`monster.${m.id}`, 96),
    el("b", { text: m.id.replace(/-/g, " ") }),
    el("span", { class: "muted", text: `Lvl ${m.lvl}` }),
    el("ul", {}, ...[
      `HP ${m.hp} · ATK ${m.atk} · DEF ${m.def}`,
      `DEX ${m.dex} · MR ${m.mr} · XP ${m.xp}`,
      `Gold ${m.gold[0]}–${m.gold[1]}`,
      specialText(m.special),
    ].map((line) => el("li", { text: line }))),
  );
}

