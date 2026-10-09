import { el, button, modal } from "./dom";
import type { RouteCtx } from "./router";
import { startTour } from "./tour";
import { serialize } from "../state/save";
import { copyText, importSave } from "../state/saveio";

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

  const saveTa = el("textarea", {
    class: "save-code",
    rows: "4",
    spellcheck: "false",
    "aria-label": "Save code (JSON)",
  }) as HTMLTextAreaElement;
  saveTa.value = serialize(ctx.state());
  const saveMsg = el("p", { class: "save-msg", role: "status" });
  const say = (text: string, bad = false): void => {
    saveMsg.textContent = text;
    saveMsg.classList.toggle("err", bad);
  };

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
    checkRow("High Contrast", "brighter text and stronger panel borders", st.highContrast, (v) =>
      ctx.commit((s) => {
        s.settings.highContrast = v;
      }),
    ),
    checkRow("Colorblind Palette", "blue/orange meters with shape glyphs", st.colorblind, (v) =>
      ctx.commit((s) => {
        s.settings.colorblind = v;
      }),
    ),
    checkRow("Button Tooltips", "show keybinds and effects when you hover a button", st.tooltips, (v) =>
      ctx.commit((s) => {
        s.settings.tooltips = v;
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
    rangeRow(
      "Music Volume",
      0,
      1,
      0.05,
      st.sfxMuted ? 0 : st.musicVolume,
      (v) => `${Math.round(v * 100)}%`,
      (v) =>
        ctx.commit((s) => {
          s.settings.musicVolume = v;
          if (v > 0) s.settings.sfxMuted = false;
        }),
    ),
    checkRow("Mute", "silence all sound and music", st.sfxMuted, (v) =>
      ctx.commit((s) => {
        s.settings.sfxMuted = v;
      }),
    ),
    el(
      "div",
      {},
      el("b", { text: "Save Data" }),
      el("small", { class: "dim", text: " — copy this code as a backup, or paste one below and import" }),
      saveTa,
      saveMsg,
      el(
        "div",
        { class: "modal-actions" },
        button("Copy", {
          hint: "Put the save code on the clipboard",
          onClick: () => {
            void copyText(saveTa.value).then((ok) =>
              say(ok ? "Code copied to clipboard." : "Clipboard blocked — select the code and press Ctrl+C.", !ok),
            );
          },
        }),
        button("Download", {
          hint: "Save the code as a .json file",
          onClick: () => {
            const url = URL.createObjectURL(new Blob([saveTa.value], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `hollowvale-${ctx.state().dayKey}.json`;
            a.click();
            URL.revokeObjectURL(url);
          },
        }),
        button("Import", {
          hint: "Replace the current save with the pasted code",
          onClick: () => {
            const res = importSave(saveTa.value.trim());
            if (!res.ok) {
              say(res.error, true);
              return;
            }
            // wholesale state swap → full re-init beats diffing every screen
            ctx.replaceState(res.state);
            say("Save loaded — reloading…");
            setTimeout(() => location.reload(), 150);
          },
        }),
      ),
    ),
    el(
      "div",
      { class: "modal-actions" },
      button("Replay Welcome Tour", {
        hint: "Show the five-step town tour again",
        onClick: () => {
          close();
          ctx.navigate("#/town");
          // let the hashchange re-render settle before anchoring coach marks
          setTimeout(() => startTour(ctx), 80);
        },
      }),
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
