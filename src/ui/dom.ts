/** Tiny component helpers — the whole "framework" this game ships with. */
import { iconEl } from "./icons";
import type { IconName } from "./icons";

type Child = Node | string | null | false | undefined;

interface Props {
  class?: string;
  text?: string;
  [attr: string]: unknown; // string → setAttribute, on* → addEventListener
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else node.setAttribute(k, String(v));
  }
  addChildren(node, children);
  return node;
}
export function addChildren(parent: ParentNode, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    parent.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

export interface ButtonOpts {
  hint?: string; // tooltip text quoting exact numbers/effects
  onClick?: () => void;
  disabled?: boolean;
  cls?: string;
  icon?: IconName; // renders the glyph + an sr-only label instead of visible text
}

export function button(label: string, opts: ButtonOpts = {}): HTMLButtonElement {
  const b = el("button", {
    class: `btn ${opts.cls ?? ""}`.trim(),
    type: "button",
    title: opts.hint ?? label,
    "data-hint": opts.hint ?? "",
    disabled: opts.disabled ? true : undefined,
    onclick: () => opts.onClick?.(),
  } as Props);
  if (opts.icon) b.append(iconEl(opts.icon), el("span", { class: "sr-only", text: label }));
  else b.textContent = label;
  return b;
}

/** HP/SP-style meter. Glyph appears in colorblind mode so state never relies on hue. */
export function bar(value: number, max: number, color: string, glyph = "", label = ""): HTMLElement {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return el(
    "div",
    {
      class: "bar",
      role: "progressbar",
      "aria-valuenow": String(Math.round(value)),
      "aria-valuemin": "0",
      "aria-valuemax": String(max),
      "aria-label": label || undefined,
    },
    el("span", { class: "bar-glyph", "aria-hidden": "true", text: glyph }),
    el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: `width:${pct}%;background:${color}` })),
    el("span", { class: "bar-num", text: `${Math.round(value)}/${max}` }),
  );
}

let modalOpen: (() => void) | null = null; // close() of the one open modal, if any

/** Modal dialog. Returns a close() handle; Esc and the card's buttons can call it.
 *  Opening while one is shown replaces it — never stack (Tab can reach triggers behind the backdrop). */
export function modal(title: string, node: Node): () => void {
  modalOpen?.();
  const backdrop = el("div", { class: "modal-backdrop" });
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    previous?.focus();
    if (modalOpen === close) modalOpen = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const previous = document.activeElement as HTMLElement | null;
  const card = el(
    "div",
    { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": title },
    el("h2", { text: title }),
    node,
  );
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.append(card);
  document.body.append(backdrop);
  document.addEventListener("keydown", onKey);
  modalOpen = close;
  (card.querySelector(".btn") as HTMLElement | null)?.focus();
  return close;
}

let toastRegion: HTMLElement | null = null;

/** aria-live polite announcement, auto-dismissed. */
export function toast(text: string): void {
  if (!toastRegion) {
    toastRegion = el("div", { id: "toasts", "aria-live": "polite" });
    document.body.append(toastRegion);
  }
  const t = el("div", { class: "toast", text });
  toastRegion.append(t);
  setTimeout(() => t.remove(), 3500);
}
