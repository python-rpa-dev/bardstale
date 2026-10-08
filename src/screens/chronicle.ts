import { el, button } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { emptyChronicle } from "../state/save";

/** "cave-rat" → "Cave Rat" (monsters have no display-name field). */
function titleCase(id: string): string {
  return id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function deed(label: string, value: number | string): HTMLElement {
  return el(
    "div",
    { class: "deed-row" },
    el("span", { class: "muted", text: label }),
    el("b", { text: String(value) }),
  );
}

export function renderChronicle(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  const c = s.chronicle ?? emptyChronicle();
  const expeditions = Object.values(s.runs).reduce((a, n) => a + n, 0);

  host.append(
    el("h1", { text: "The Chronicle" }),
    el("p", { class: "muted", text: "Every deed is written down. The Vale remembers what your party survives." }),
  );

  const deeds = el(
    "div",
    { class: "panel" },
    el("h2", { text: "Deeds" }),
    deed("Battles won", c.battlesWon),
    deed("Battles fled", c.battlesFled),
    deed("Party wipes", c.partyWipes),
    deed("Deepest floor reached", c.deepestFloor),
    deed("Biggest single hit", c.bestHit),
    deed("Critical hits landed", c.crits),
    deed("Expeditions begun", expeditions),
    deed("Bounties completed", s.bounties.completed.length),
    deed("Medals earned", s.medals.length),
  );

  const kills = Object.entries(c.killsByFoe)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const foesPanel = el(
    "div",
    { class: "panel" },
    el("h2", { text: "Foes vanquished" }),
    ...(kills.length
      ? kills.map(([id, n]) => deed(titleCase(id), n))
      : [el("p", { class: "muted", text: "No foes have fallen yet. The first page waits." })]),
  );

  host.append(deeds, foesPanel);
  host.append(button("← Town", { hint: "Back to the town square", onClick: () => ctx.navigate("#/town") }));
}
