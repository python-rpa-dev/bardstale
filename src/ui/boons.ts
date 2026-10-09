import { boonOffers } from "../data/boons";
import { chooseBoon } from "../state/party";
import type { RouteCtx } from "./router";
import { el, modal, toast } from "./dom";

let active = false; // one pick modal at a time across route re-renders
let dismissedKey: string | null = null; // "pcId:held" — Escaping a pick silences that exact nag until it changes

/** Surface the next owed level-up boon pick, if any. Call after each screen render. */
export function maybeBoonModal(ctx: RouteCtx): void {
  if (active) return;
  const pc = ctx.state().party.find((p) => (p.boonQueue ?? 0) > 0);
  if (!pc) return;
  const held = pc.boons?.length ?? 0;
  const key = `${pc.id}:${held}`;
  if (key === dismissedKey) return;

  active = true;
  let picked = false;
  const list = el("div", { class: "boon-list" });
  const close = modal(`${pc.name} — a boon for level ${pc.level}`, list);
  const shut = () => {
    active = false;
    if (!picked) dismissedKey = key; // skipped this pick; don't re-nag the same one
    close();
  };
  for (const b of boonOffers(pc.id, pc.boons ?? [])) {
    const opt = el(
      "button",
      { type: "button", class: "btn boon-opt" },
      el("strong", { text: b.name }),
      el("div", { class: "muted", text: b.hint }),
    );
    opt.addEventListener("click", () => {
      ctx.sfx.levelup();
      ctx.commit((s) => chooseBoon(s, pc.id, b.id));
      shut();
      toast(`${pc.name} gains ${b.name}.`);
      ctx.refresh(); // re-render + maybeBoonModal re-fires for any remaining picks
    });
    list.append(opt);
  }
}
