import "../styles/main.css";
import { el, button } from "./ui/dom";
import { createRouter, navigateTo, type RouteCtx, type Router, type Screen } from "./ui/router";
import { createStore } from "./state/save";
import { createSfx } from "./core/sfx";
import { loadManifest } from "./render/art";
import { renderTitle } from "./screens/title";
import { renderTown } from "./screens/town";
import { renderGuild } from "./screens/guild";
import { renderTemple } from "./screens/temple";
import { renderShop } from "./screens/shop";
import { renderTavern } from "./screens/tavern";
import { renderCodex } from "./screens/codex";

const store = createStore();
const sfx = createSfx(store.state.settings.sfxVolume);

function applySettings(): void {
  const st = store.state.settings;
  document.body.classList.toggle("cb", st.colorblind);
  document.body.classList.toggle("reduce-motion", st.reduceMotion);
  document.documentElement.style.setProperty("--fs", String(st.fontScale));
  sfx.setVolume(st.sfxVolume);
}

let routerRef: Router | null = null;

const ctx: RouteCtx = {
  state: () => store.state,
  commit(mutator) {
    store.commit(mutator);
    applySettings(); // settings may have changed in this mutation
  },
  sfx,
  navigate: navigateTo,
  refresh: () => routerRef?.refresh(),
  newGame() {
    store.deleteSave();
    store.saveNow();
    applySettings();
  },
  hasSave: () => store.hasSave(),
};

/** Placeholder for milestones not yet implemented (M5–M6 fill these in). */
const underConstruction: Screen = (host, c) => {
  host.append(
    el("div", { class: "panel" },
      el("p", { text: "The builders are at work on this part of town." }),
      button("Back to Town", { hint: "Return to Hollow Vale", onClick: () => c.navigate("#/town") }),
    ),
  );
};

const LOC_NAMES: Record<string, string> = {
  title: "Hollow Vale",
  town: "Town Square",
  party: "Adventurers' Guild",
  shop: "General Store",
  temple: "Temple of the Quiet Light",
  tavern: "The Broken Antler",
  codex: "Codex Library",
  gate: "Gate of Adventures",
  dungeon: "The Depths",
  combat: "Battle!",
};

const locLabel = el("span", { class: "loc" });
const purseLabel = el("span", { class: "purse" });
const screenHost = el("main", { id: "screen" });
document.querySelector("#app")!.append(
  el("header", { class: "hdr" }, locLabel, purseLabel),
  screenHost,
);

function updateHeader(route: string): void {
  locLabel.textContent = LOC_NAMES[route] ?? "Hollow Vale";
  const s = store.state;
  purseLabel.replaceChildren(
    document.createTextNode("Purse "),
    el("b", { text: String(s.gold) }),
    document.createTextNode(` · Bank ${s.bank}`),
  );
}

const routes: Record<string, Screen> = {
  title: renderTitle,
  town: renderTown,
  party: renderGuild,
  shop: renderShop,
  temple: renderTemple,
  tavern: renderTavern,
  codex: renderCodex,
  gate: underConstruction,
  dungeon: underConstruction,
  combat: underConstruction,
};

const wrapped: Record<string, Screen> = {};
for (const [name, fn] of Object.entries(routes)) {
  wrapped[name] = (host, c) => {
    updateHeader(name);
    fn(host, c);
  };
}

const router = createRouter(wrapped, ctx, screenHost);
routerRef = router;

await loadManifest();
applySettings();
router.start();
