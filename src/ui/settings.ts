import { el, button, modal } from "./dom";
import type { RouteCtx } from "./router";

function checkRow(labelText: string, hint: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el("input", { type: "checkbox", class: "set-check" }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return el(
    "label",
    { class: "settings-row" },
    el("span", {}, el("b", { text: labelText }), el("small", { class: "dim", text: ` ${hint}` })),
    input,
  );
}

function rangeRow(
  labelText: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onInput: (v: number) => void,
  onChange?: (v: number) => void,
): HTMLElement {
  const out = el("output", { class: "set-out", text: format(value) });
  const input = el("input", {
    type: "range",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    class: "set-range",
  }) as HTMLInputElement;
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onInput(v);
  });
  input.addEventListener("change", () => onChange?.(Number(input.value)));
  return el("label", { class: "settings-row" }, el("span", {}, el("b", { text: labelText })), input, out);
}

/** Settings dialog bound to the live store; every change commits immediately. */
export function openSettings(ctx: RouteCtx): void {
  const st = ctx.state().settings;
  const panel = el("div", { class: "settings" });
  let close: () => void;

  panel.append(
    checkRow("Quick Battle", "auto-attack each round until you intervene", st.quickBattle, (v) =>
      ctx.commit((s) => {
        s.settings.quickBattle = v;
      }),
    ),
    checkRow("Reduce Motion", "no screen shake or floating numbers", st.reduceMotion, (v) =>
      ctx.commit((s) => {
        s.settings.reduceMotion = v;
      }),
    ),
    checkRow("Colorblind Palette", "blue/orange meters with shape glyphs", st.colorblind, (v) =>
      ctx.commit((s) => {
        s.settings.colorblind = v;
      }),
    ),
    rangeRow(
      "Font Scale",
      0.9,
      1.4,
      0.05,
      st.fontScale,
      (v) => `${v.toFixed(2)}×`,
      (v) =>
        ctx.commit((s) => {
          s.settings.fontScale = v;
        }),
    ),
    rangeRow(
      "SFX Volume",
      0,
      1,
      0.05,
      st.sfxMuted ? 0 : st.sfxVolume,
      (v) => `${Math.round(v * 100)}%`,
      (v) =>
        ctx.commit((s) => {
          s.settings.sfxVolume = v;
          if (v > 0) s.settings.sfxMuted = false;
        }),
      // Audible feedback at the new level once the drag settles.
      () => ctx.sfx.click(),
    ),
    checkRow("Mute", "silence all sound effects", st.sfxMuted, (v) =>
      ctx.commit((s) => {
        s.settings.sfxMuted = v;
      }),
    ),
    el(
      "div",
      { class: "modal-actions" },
      button("Done", { onClick: () => close() }),
    ),
  );

  close = modal("Settings", panel);
}

/** Header gear — opens the settings dialog. */
export function settingsGear(ctx: RouteCtx): HTMLElement {
  return el("button", {
    class: "btn gear",
    type: "button",
    title: "Settings",
    "aria-label": "Open settings",
    text: "⚙",
    onclick: () => openSettings(ctx),
  } as Parameters<typeof el>[1]);
}
