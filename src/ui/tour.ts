import { el, button } from "./dom";
import type { RouteCtx } from "./router";

/** One coach-mark step. `target` resolves at show-time; a missing target skips the step. */
interface Step {
  title: string;
  body: string;
  target?: () => Element | null;
}

const STEPS: Step[] = [
  {
    title: "Welcome to Hollow Vale",
    body: "A tiny dungeon crawler about a town that never quite sleeps. Five minutes of tour, then it is all yours — Skip works any time.",
  },
  {
    title: "The Vale itself",
    body: "Every building in the scene is a clickable hotspot, and the same places wait as big buttons below. Nothing is hidden from you.",
    target: () => document.querySelector(".town-scene"),
  },
  {
    title: "Everything on one row",
    body: "The Guild recruits heroes, the Temple heals (your heroes never die forever), the Shop sells steel, the Tavern posts daily bounties and free rest, and the Codex tracks medals.",
    target: () => document.querySelector(".service-row"),
  },
  {
    title: "Your expedition starts here",
    body: "Pick a gate, descend its floors, and grab Auto-Walk in the dungeon — it paths to the stairs, descends floor after floor, and halts only for foes, traps and chests.",
    target: () =>
      Array.from(document.querySelectorAll(".service-row button")).find((b) =>
        b.textContent?.includes("Gate"),
      ) ?? null,
  },
  {
    title: "Make it comfortable",
    body: "The gear opens settings: reduce motion, colorblind palette, font scale, sound. The tour can be replayed from there too. Vale you later.",
    target: () => document.querySelector(".gear"),
  },
];

let active = false; // at most one tour per page session unless explicitly replayed

/** Auto-start once per save (and never twice in a session). Call after the town screen mounts. */
export function maybeStartTour(ctx: RouteCtx): void {
  if (active || ctx.state().tourSeen) return;
  queueMicrotask(() => {
    if (!active && !ctx.state().tourSeen) startTour(ctx);
  });
}

/** Show the coach-mark tour. Overlay lives on <body> so screen re-renders never unmount it. */
export function startTour(ctx: RouteCtx): void {
  if (active) return;
  active = true;
  let i = -1; // advance() to 0

  const overlay = el("div", { class: "tour-overlay" });
  const spot = el("div", { class: "tour-spot" });
  const titleEl = el("h3");
  const bodyEl = el("p");
  const backBtn = button("Back", {});
  const nextBtn = button("Next →", { cls: "primary" });
  const skipBtn = button("Skip tour", {});
  const card = el(
    "div",
    { class: "tour-card", role: "dialog", "aria-modal": "true", "aria-label": "Welcome tour" },
    titleEl,
    bodyEl,
    el("div", { class: "modal-actions" }, skipBtn, backBtn, nextBtn),
  );
  overlay.append(spot, card);

  const reduceMotion = () => ctx.state().settings.reduceMotion;

  function finish(): void {
    cleanup();
    if (!ctx.state().tourSeen) ctx.commit((s) => { s.tourSeen = true; });
  }

  function show(next: number): void {
    // steps whose target vanished (e.g. replayed from another screen) are skipped
    while (next >= 0 && next < STEPS.length && STEPS[next].target && !STEPS[next].target!()) {
      next += next > i ? 1 : -1;
    }
    if (next < 0 || next >= STEPS.length) { finish(); return; }
    i = next;
    const step = STEPS[i];
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    backBtn.disabled = i === 0;
    nextBtn.textContent = i === STEPS.length - 1 ? "Finish" : "Next →";

    const t = step.target?.() ?? null;
    if (t) {
      t.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "nearest" });
      const r = t.getBoundingClientRect();
      spot.hidden = false;
      spot.style.left = `${r.left - 6}px`;
      spot.style.top = `${r.top - 6}px`;
      spot.style.width = `${r.width + 12}px`;
      spot.style.height = `${r.height + 12}px`;
    } else {
      spot.hidden = true;
      card.style.left = "";
      card.style.top = ""; // let .tour-center CSS own the centered layout
    }
    // place the card under the target when it fits, above otherwise, centered if no target
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    card.classList.toggle("tour-center", !t);
    if (t) {
      const r = t.getBoundingClientRect();
      card.style.visibility = "hidden";
      card.style.left = "0px";
      card.style.top = "0px"; // measure from a known origin first
      requestAnimationFrame(() => {
        const cr = card.getBoundingClientRect();
        let top = r.bottom + 14;
        if (top + cr.height > vh - 8) top = Math.max(8, r.top - cr.height - 14);
        if (top < 8) top = Math.max(8, (vh - cr.height) / 2);
        const left = Math.min(Math.max(8, r.left + r.width / 2 - cr.width / 2), vw - cr.width - 8);
        card.style.top = `${top}px`;
        card.style.left = `${Math.max(8, left)}px`;
        card.style.visibility = "";
      });
    }
    nextBtn.focus();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish();
    else if (e.key === "Enter" || e.key === "ArrowRight") show(i + 1);
    else if (e.key === "ArrowLeft") show(i - 1);
  };
  const onHash = () => finish(); // targets are town-only; a route change ends the tour
  const onResize = () => show(i);

  function cleanup(): void {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("resize", onResize);
    overlay.remove();
    active = false;
  }

  skipBtn.addEventListener("click", finish);
  backBtn.addEventListener("click", () => show(i - 1));
  nextBtn.addEventListener("click", () => show(i + 1));
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("hashchange", onHash);
  window.addEventListener("resize", onResize);

  document.body.append(overlay);
  show(0);
}
