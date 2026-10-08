import "../styles/main.css";
import { el, toast } from "./ui/dom";
import { maybeBoonModal } from "./ui/boons";
import { createRouter, navigateTo, type RouteCtx, type Router, type Screen } from "./ui/router";
import { createStore } from "./state/save";
import { createSfx } from "./core/sfx";
import { createMusic } from "./core/music";
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
import { renderChronicle } from "./screens/chronicle";

const store = createStore();
const sfx = createSfx(store.state.settings.sfxVolume);
const music = createMusic(store.state.settings.musicVolume);
// Debug/inspection seam: lets browser smokes assert which track is live.
(window as unknown as { __music?: typeof music }).__music = music;

// One source of truth for the compact sidebar tier (was a pure max-height media query):
// large fonts inflate rem-sized cards past the viewport just like short windows do, so both
// triggers live here. Permanent app-lifetime listener — no teardown needed. 704px = old 44rem edge.
const compactSide = () => document.documentElement.classList.toggle("compact-side", store.state.settings.fontScale > 1 || innerHeight <= 704);
addEventListener("resize", compactSide);

let lastFs: number | null = null;
function applySettings(): void {
  const st = store.state.settings;
  document.body.classList.toggle("cb", st.colorblind);
  document.body.classList.toggle("reduce-motion", st.reduceMotion);
  document.body.classList.toggle("hc", st.highContrast);
  document.body.classList.toggle("no-tooltips", !st.tooltips);
  document.documentElement.style.setProperty("--fs", String(st.fontScale));
  compactSide();
  if (st.fontScale !== lastFs) {
    // --fs changes fire no native resize; screens that measure layout (dungeon fitShell/fitCanvas) must refit.
    lastFs = st.fontScale;
    dispatchEvent(new Event("resize"));
  }
   sfx.setVolume(st.sfxMuted ? 0 : st.sfxVolume);
  music.setVolume(st.sfxMuted ? 0 : st.musicVolume);
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
  chronicle: "The Chronicle",
  gate: "Gate of Adventures",
  dungeon: "The Depths",
  combat: "Battle!",
};

const announcer = el("div", { id: "sr-announcer", class: "sr-only", "aria-live": "polite" });
const locLabel = el("span", { class: "loc" });
const goldLabel = el("span", { class: "gold" });
const screenHost = el("main", { id: "screen" });
document.querySelector("#app")!.append(
  el("header", { class: "hdr" }, locLabel, goldLabel, settingsGear(ctx)),
  screenHost,
  announcer,
);

let lastAnnounced = "";
function updateHeader(route: string): void {
  music.playFor(route); // BGM follows the screen; idempotent per track
  const locName = LOC_NAMES[route] ?? "Hollow Vale";
  locLabel.textContent = locName;
  if (locName !== lastAnnounced) {
    // screen readers announce the new location on route change (polite live region)
    lastAnnounced = locName;
    announcer.textContent = locName;
  }
  const s = store.state;
  goldLabel.replaceChildren(
    document.createTextNode("Gold "),
    el("b", { text: String(s.gold) }),
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
  chronicle: renderChronicle,
  gate: renderGate,
  dungeon: renderDungeon,
  combat: renderCombat,
};

const wrapped: Record<string, Screen> = {};
for (const [name, fn] of Object.entries(routes)) {
  wrapped[name] = (host, c) => {
    updateHeader(name);
    fn(host, c);
    setTimeout(() => maybeBoonModal(c), 0); // level-up picks surface after the screen paints
  };
}

const router = createRouter(wrapped, ctx, screenHost);
routerRef = router;

await loadManifest();
applySettings();
router.start();
if (store.rotatedDay) toast("A new day dawns — today's bounties and gate omens have turned.");
