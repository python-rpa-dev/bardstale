import "../styles/main.css";
import { el, toast } from "./ui/dom";
import { createRouter, navigateTo, type RouteCtx, type Router, type Screen } from "./ui/router";
import { createStore } from "./state/save";
import { createSfx } from "./core/sfx";
 import { settingsGear } from "./ui/settings";
import { loadManifest } from "./render/art";
import { renderTitle } from "./screens/title";
import { renderTown } from "./screens/town";
import { renderGuild } from "./screens/guild";
import { renderTemple } from "./screens/temple";
import { renderShop } from "./screens/shop";
import { renderTavern } from "./screens/tavern";
import { renderCodex } from "./screens/codex";
import { renderGate } from "./screens/gate";
import { renderDungeon } from "./screens/dungeon";
import { renderCombat } from "./screens/combat";

const store = createStore();
const sfx = createSfx(store.state.settings.sfxVolume);

function applySettings(): void {
  const st = store.state.settings;
  document.body.classList.toggle("cb", st.colorblind);
  document.body.classList.toggle("reduce-motion", st.reduceMotion);
  document.body.classList.toggle("hc", st.highContrast);
  document.documentElement.style.setProperty("--fs", String(st.fontScale));
   sfx.setVolume(st.sfxMuted ? 0 : st.sfxVolume);
}

let routerRef: Router | null = null;

const ctx: RouteCtx = {
  state: () => store.state,
  commit(mutator) {
    store.commit(mutator);
    applySettings(); // settings may have changed in this mutation
  },
  replaceState(next) {
    store.load(next); // cancels pending debounced writes so autosave cannot clobber an import
    applySettings();
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

const announcer = el("div", { id: "sr-announcer", class: "sr-only", "aria-live": "polite" });
const locLabel = el("span", { class: "loc" });
const purseLabel = el("span", { class: "purse" });
const screenHost = el("main", { id: "screen" });
document.querySelector("#app")!.append(
  el("header", { class: "hdr" }, locLabel, purseLabel, settingsGear(ctx)),
  screenHost,
  announcer,
);

let lastAnnounced = "";
function updateHeader(route: string): void {
  const locName = LOC_NAMES[route] ?? "Hollow Vale";
  locLabel.textContent = locName;
  if (locName !== lastAnnounced) {
    // screen readers announce the new location on route change (polite live region)
    lastAnnounced = locName;
    announcer.textContent = locName;
  }
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
  gate: renderGate,
  dungeon: renderDungeon,
  combat: renderCombat,
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
if (store.rotatedDay) toast("A new day dawns — today's bounties and gate omens have turned.");
