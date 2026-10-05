import type { GameState } from "../state/save";
import type { Sfx } from "../core/sfx";

export interface RouteCtx {
  state(): GameState;
  commit(mutator: (s: GameState) => void): void;
  sfx: Sfx;
  navigate(hash: string): void;
  refresh(): void;
  /** Wipe the save and start a fresh game (title screen). */
  newGame(): void;
  /** Replace the entire save state (import) and persist immediately. */
  replaceState(state: GameState): void;
  hasSave(): boolean;
}

/** A screen renders itself into the host element. */
export type Screen = (host: HTMLElement, ctx: RouteCtx) => void;

export interface Router {
  start(): void;
  currentRoute(): string;
  /** Re-render the current screen (used after state commits). */
  refresh(): void;
}
const DEFAULT_ROUTE = "title";

/**
 * Hash router: `#/town`, `#/party`, … Each route is a plain render function.
 * Screens re-render on ctx.refresh() (after commit) — cheap DOM rebuilds, no framework.
 */
export function createRouter(
  routes: Record<string, Screen>,
  ctx: RouteCtx,
  host: HTMLElement,
): Router {
  let current = "";

  const routeFromHash = (): string => {
    const h = location.hash.replace(/^#\//, "");
    return h && h in routes ? h : DEFAULT_ROUTE;
  };

  const render = () => {
    const next = routeFromHash();
    if (next === current) return;
    current = next;
    host.replaceChildren();
    routes[next](host, ctx);
    window.scrollTo(0, 0);
  };

  // refresh() must re-run even when the hash is unchanged.
  const fullRender = () => {
    current = "";
    render();
  };

  return {
    start() {
      addEventListener("hashchange", render);
      if (!location.hash) location.hash = `#/${DEFAULT_ROUTE}`;
      render();
    },
    currentRoute: () => current,
    refresh: fullRender,
  };
}

/** Route table keys per plan M3. */
export const ROUTE_NAMES = [
  "title",
  "town",
  "party",
  "shop",
  "temple",
  "tavern",
  "codex",
  "gate",
  "dungeon",
  "combat",
] as const;

export type RouteName = (typeof ROUTE_NAMES)[number];

/** ctx.navigate writes the hash; router listens. */
export function navigateTo(hash: string): void {
  location.hash = hash.startsWith("#") ? hash : `#/${hash}`;
}
