import { el, bar, button } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg, slotSrc } from "../render/art";
import { BESTIARY, FAMILIES, type Behavior, type MonsterDef, type Special } from "../data/bestiary";
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
    case "blind":
      return `Blind: soul-gaze dims a hero's eyes — −15% to hit for ${s.rounds} rounds`;
    case "breath":
      return `Breath: hits the whole party for ~${s.base}, once every ${s.everyRounds} rounds`;
    case "wound":
      return `Rending claws: +${s.stacks} Wound stack per hit (max 5) — each stack bleeds 1 damage at the end of the afflicted's turn; one stack knits per rest, healing magic seals the wound`;
    case "mark":
      return `Omen-mark: the seer reads a living ally's fate — its next action is announced before it resolves, and blows against it land +25% deeper until it acts`;
  }
}

function behaviorText(b: Behavior | undefined): string | null {
  if (!b) return null;
  switch (b.kind) {
    case "flee":
      return `Skittish: breaks off below ${Math.round(b.hpPct * 100)}% HP — half XP, no gold`;
    case "guard":
      return `Guardian: the dead bar the way — no escape while it stands`;
    case "captain":
      return `Captain: living allies deal +${Math.round(b.auraPct * 100)}% damage`;
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
      ...(behaviorText(m.behavior) ? [behaviorText(m.behavior)!] : []),
    ].map((line) => el("li", { text: line }))),
  );
}

