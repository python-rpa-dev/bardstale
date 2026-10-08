import { el, button } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { maybeStartTour } from "../ui/tour";

interface Service {
  route: string;
  label: string;
  hint: string;
  /** Building anchor in the hub art (viewBox 1600×900). */
  x: number;
}

const SERVICES: Service[] = [
  { route: "party", label: "Guild", hint: "Recruit heroes, manage party and gear", x: 200 },
  { route: "temple", label: "Temple", hint: "Heal wounds, cure status, revive the fallen — your heroes never die forever", x: 480 },
  { route: "shop", label: "Shop", hint: "Buy and sell arms, armor and potions", x: 730 },
  { route: "tavern", label: "Tavern", hint: "Bounty board, today's rumors, free rest", x: 980 },
  { route: "gate", label: "Gate of Adventures", hint: "Begin an expedition into the mazes", x: 1230 },
  { route: "codex", label: "Codex", hint: "Bestiary pages and family medals", x: 1450 },
];

export function renderTown(host: HTMLElement, ctx: RouteCtx): void {
  const scene = el("div", { class: "town-scene", role: "group", "aria-label": "Town of Hollow Vale" });
  scene.append(slotImg("town.hub"));
  for (const s of SERVICES) {
    scene.append(
      button("", {
        cls: "hotspot",
        hint: `${s.label} — ${s.hint}`,
        onClick: () => {
          ctx.sfx.click();
          ctx.navigate(`#/${s.route}`);
        },
      }),
    );
    const spot = scene.lastElementChild as HTMLElement;
    spot.setAttribute("aria-label", s.label);
    spot.setAttribute("data-cap", s.label);
    spot.style.left = `${(s.x / 1600) * 100}%`;
  }

  host.append(
    el("h2", { class: "sr-only", text: "Hollow Vale" }),
    scene,
    el("div", { class: "service-row" },
      ...SERVICES.map((s) =>
        button(s.label, {
          hint: s.hint,
          onClick: () => {
            ctx.sfx.click();
            ctx.navigate(`#/${s.route}`);
          },
        }),
      ),
    ),
  );
  // The Chronicle is a ledger, not a building — linked under the services, no hotspot on the art.
  host.append(
    el("div", { class: "service-row" },
      button("Chronicle", {
        hint: "Lifetime deeds of your party",
        onClick: () => {
          ctx.sfx.click();
          ctx.navigate("#/chronicle");
        },
      }),
    ),
  );
  // first-run coach marks; no-op once the save records tourSeen
  maybeStartTour(ctx);
}
