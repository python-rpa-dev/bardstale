import { button, el, modal } from "../ui/dom";
import type { RouteCtx } from "../ui/router";

export function renderTitle(host: HTMLElement, ctx: RouteCtx): void {
  const hasSave = ctx.hasSave();

  const confirmModal = (title: string, body: string, actionLabel: string, action: () => void) => {
    const closeRef = { close: () => {} };
    closeRef.close = modal(title, el("div", {},
      el("p", { text: body }),
      el("div", { class: "modal-actions" },
        button(actionLabel, {
          hint: actionLabel,
          onClick: () => {
            closeRef.close();
            action();
          },
        }),
        button("Cancel", { hint: "Go back", onClick: () => closeRef.close() }),
      ),
    ));
  };

  host.append(
    el("div", { class: "title-screen" },
      el("h1", { class: "game-title", text: "Hollow Vale" }),
      el("p", { class: "subtitle", text: "A dungeon crawl in the old style — town, maze, and monster." }),
      el("div", { class: "title-buttons" },
        button("New Game", {
          hint: hasSave ? "Overwrite your save with a fresh party" : "Begin a new tale",
          onClick: () => {
            if (hasSave) {
              confirmModal("Start over?", "Your current heroes, gold and medals will be lost.", "Start Over", () => {
                ctx.newGame();
                ctx.navigate("#/town");
              });
            } else {
              ctx.newGame();
              ctx.navigate("#/town");
            }
          },
        }),
        button("Continue", {
          hint: hasSave ? "Resume your saved party" : "No save found yet",
          disabled: !hasSave,
          onClick: () => ctx.navigate("#/town"),
        }),
        button("Delete Save", {
          hint: "Erase the saved game",
          disabled: !hasSave,
          onClick: () =>
            confirmModal("Delete save?", "The saved game will be erased. This cannot be undone.", "Delete", () => {
              ctx.newGame(); // wipes storage and resets in-memory state
              ctx.refresh();
            }),
        }),
      ),
    ),
  );
}
