/** The Depths: split view (raycast + minimap/party/log), grid movement, traps, encounters, chests. */

import { el, button, bar, modal, toast } from "../ui/dom";
import { iconEl } from "../ui/icons";
import type { IconName } from "../ui/icons";
import type { RouteCtx } from "../ui/router";
import { DIR_VECS, MAP_W, bfsPath, cellId, idToXY, openDegree } from "../core/mapgen";
import { randInt } from "../core/rng";
import { gateById } from "../data/gates";
import { itemById } from "../data/items";
import { pcBase, pcMax } from "../state/save";
import type { GameState } from "../state/save";
import {
  activeBountyFamily,
  descendFloor,
  describeRare,
  endExpedition,
  entityAt,
  gridFromSave,
  hermitGift,
  merchantWares,
  reveal,
  rollEncounter,
  stepRng,
} from "../state/expedition";
import { loadGateTextures, renderView, VIEW_H, VIEW_W, type ViewTextures } from "../render/raycaster";
import { renderMinimap } from "../render/minimap";

const CHEST_CONSUMABLES = ["potion-hp", "potion-sp"];

/** "cave-rat" → "Cave Rat" (monsters have no display-name field). */
function titleCase(id: string): string {
  return id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function renderDungeon(host: HTMLElement, ctx: RouteCtx): void {
  if (!ctx.state().activeGate) {
    host.append(
      el("div", { class: "panel" },
        el("p", { text: "No expedition is underway." }),
        button("To the Gate", { onClick: () => ctx.navigate("#/gate") }),
      ),
    );
    return;
  }

  // A live fight owns the screen (covers reloads mid-battle and fresh ambushes).
  if (ctx.state().activeCombat) {
    ctx.navigate("#/combat");
    return;
  }

  let tex: ViewTextures = { wall: null, floorTint: null, ceilTint: null };
  const viewCanvas = el("canvas", { class: "view-canvas", "aria-label": "First-person dungeon view" });
  const viewStage = el("div", { class: "view-stage" }, viewCanvas);
  const miniCanvas = el("canvas", { class: "minimap-canvas", "aria-label": "Minimap of explored cells" });
  const logEl = el("div", { class: "dlog", "aria-live": "polite" });
  const partyHost = el("div", { class: "party-grid" });

  let autoTimer: number | null = null;
  let lastLookCell = -1; // double-Look opens chests / reveals secrets

  loadGateTextures(ctx.state().activeGate!.gateId).then((t) => {
    tex = t;
    drawView();
  });

  const agOf = (d: GameState) => d.activeGate!;

  function log(msg: string): void {
    const stuck = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 16; // at the tail (tolerance must stay under one line so a real scroll-up always escapes)
    logEl.append(el("p", { text: msg }));
    while (logEl.children.length > 24) logEl.removeChild(logEl.firstChild!);
    if (stuck) logEl.scrollTop = logEl.scrollHeight; // follow new lines unless they scrolled up to read history
  }

  function drawView(): void {
    const ag = ctx.state().activeGate;
    if (!ag || !viewCanvas.isConnected) return;
    renderView(viewCanvas, gridFromSave(ag.map), ag.map.w, ag.map.h, ag.pos, ag.dir, tex);
    renderMinimap(miniCanvas, { map: ag.map, visited: ag.visited, pos: ag.pos, dir: ag.dir, chests: ag.chests });
  }

  function refreshParty(): void {
    const s = ctx.state();
    partyHost.replaceChildren(
      ...s.party.map((p) => {
        const max = pcMax(p);
        return el("div", { class: `pc-card${p.hp <= 0 ? " downed" : ""}` },
          el("div", { class: "pc-id" }, el("b", { text: p.name }), document.createTextNode(` ${titleCase(p.classId)} · Lv ${p.level}`)),
          bar(p.hp, max.hp, "var(--hp)", "✚", `${p.name} HP`),
          bar(p.sp, max.sp, "var(--sp)", "✦", `${p.name} SP`),
        );
      }),
    );
  }

  function shake(): void {
    if (ctx.state().settings.reduceMotion) return;
    viewCanvas.classList.add("shake");
    setTimeout(() => viewCanvas.classList.remove("shake"), 120);
  }

  /** End the run and show the loot summary. */
  function finishRun(loot: { gold: number; items: Record<string, number> }, gateName: string): void {
    stopAuto();
    const rare = ctx.state().activeGate?.rareSpawn; // read before endExpedition clears the run
    ctx.sfx.victory();
    ctx.commit((d) => endExpedition(d));
    const rows = Object.entries(loot.items).map(([id, n]) => `${itemById(id).name} ×${n}`);
    const close = modal(
      "Expedition Complete",
      el("div", {},
        el("p", { text: `You emerge from ${gateName}, blinking at the sun.` }),
        el("ul", {},
          el("li", { text: `${loot.gold} gold claimed` }),
          ...(rows.length ? rows.map((r) => el("li", { text: r })) : [el("li", { class: "muted", text: "No items recovered" })]),
        ),
        rare ? el("p", { class: "muted rare-line", text: describeRare(rare) }) : null,
        button("Back to Town", { onClick: () => { close(); if (rare) toast(describeRare(rare)); ctx.navigate("#/town"); } }),
      ),
    );
  }

  interface MoveOutcome {
    bump?: boolean;
    encounter?: string[]; // display names, deduped with counts
    trapMsg?: string;
    descended?: boolean; // a new floor was generated
    avoided?: string; // trap detected and stilled before springing
    finished?: { loot: { gold: number; items: Record<string, number> }; gateName: string };
  }

  /** One grid step in the facing direction (or straight back). Traps spring and encounters roll here. */
  function tryMove(back = false): MoveOutcome {
    const out: MoveOutcome = {};
    ctx.commit((d) => {
      const ag = agOf(d);
      const def = gateById(ag.gateId);
      const [fdx, fdy] = DIR_VECS[ag.dir];
      const [dx, dy] = back ? [-fdx, -fdy] : [fdx, fdy];
      const nx = ag.pos.x + dx;
      const ny = ag.pos.y + dy;
      const grid = gridFromSave(ag.map);
      if (nx < 0 || ny < 0 || nx >= ag.map.w || ny >= ag.map.h || grid[ny * MAP_W + nx] === 1) {
        out.bump = true;
        return;
      }
      ag.pos = { x: nx, y: ny };
      lastLookCell = -1; // a new vantage changes what "look again" means
      const cell = cellId(nx, ny);
      reveal(ag);

      // Traps spring when stepped on, once per cell.
      if (entityAt(ag, cell) === "trap" && !ag.flags[`trap${cell}`]) {
        ag.flags[`trap${cell}`] = true;
        const rng = stepRng(ag);
        // Trap lore (rogue passive): a rogue detects the trap and halves its damage.
        // Detection: d20 + DEX vs DC 12 (+10). Damage: half the gate's level-band width.
        const rogues = d.party.filter((p) => p.classId === "rogue").sort((a, b) => pcBase(b).dex - pcBase(a).dex);
        const others = d.party.filter((p) => p.classId !== "rogue").sort((a, b) => pcBase(b).dex - pcBase(a).dex);
        const detector = rogues[0] ?? others[0];
        const roll = randInt(rng, 1, 20);
        if (detector && roll + pcBase(detector).dex >= 22) {
          out.avoided = rogues[0]
            ? `${rogues[0].name} stills the trap's teeth a finger's breadth from your ribs.`
            : "You nearly don't notice the trigger. This time.";
        } else {
          let dmg = Math.floor((def.levels[1] - def.levels[0] + 1) / 2); // half the level-band width
          if (rogues[0]) dmg = Math.floor(dmg / 2);
          const victim = d.party[randInt(rng, 0, d.party.length - 1)];
          victim.hp = Math.max(0, victim.hp - dmg);
          out.trapMsg = `${victim.name} triggers a hidden blade — ${dmg} damage${rogues[0] ? " (halved by trap lore)" : ""}.`;
        }
      }

      // Encounters roll only on empty corridor cells.
      const kind = entityAt(ag, cell);
      if (!kind && openDegree(gridFromSave(ag.map), cell) === 2 && stepRng(ag)() < 0.18) {
        const mobs = rollEncounter(ag, activeBountyFamily(d));
        ag.pendingMonsters = mobs.map((m) => m.id);
        const counts = new Map<string, number>();
        for (const m of mobs) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
        out.encounter = [...counts].map(([id, n]) => (n > 1 ? `${titleCase(id)} ×${n}` : titleCase(id)));
      }

      if (kind === "stairs") {
        if (ag.floor + 1 >= def.floors) {
          out.finished = { loot: structuredClone(ag.loot), gateName: def.name };
        } else {
          descendFloor(d);
          out.descended = true;
        }
      }
    });

    // Side effects outside the mutation.
    if (out.bump) {
      ctx.sfx.thud();
      shake();
    }
    if (out.avoided) ctx.sfx.avoided();
    else if (out.trapMsg) ctx.sfx.trap();
    if (out.encounter) ctx.sfx.encounter(); // foes drop in before the screen flips
    if (out.descended) ctx.sfx.descend();
    return out;
  }

  /** Look / Use on what you face — walls included, so secret alcoves are findable. */
  function look(interact = false): void {
    const msgs: string[] = [];
    const sfxKinds: ("heal" | "chest" | "coin" | "secret")[] = [];
    ctx.commit((d) => {
      const ag = agOf(d);
      const [dx, dy] = DIR_VECS[ag.dir];
      const fx = ag.pos.x + dx;
      const fy = ag.pos.y + dy;
      const inMap = fx >= 0 && fy >= 0 && fx < ag.map.w && fy < ag.map.h;
      const grid = gridFromSave(ag.map);
      const faceCell = cellId(Math.max(0, Math.min(ag.map.w - 1, fx)), Math.max(0, Math.min(ag.map.h - 1, fy)));
      const facingOpen = inMap && grid[fy * MAP_W + fx] === 0;

      // Secret wall: the alcove mouth is a sealed wall directly ahead.
      if (entityAt(ag, faceCell) === "secret" && !facingOpen) {
        if (interact || lastLookCell === faceCell) {
          const idx = ag.map.entities.findIndex(([id]) => id === faceCell);
          if (idx >= 0) ag.map.entities.splice(idx, 1);
          const cells = ag.map.cells.split("");
          cells[faceCell] = "0"; // carve the alcove open
          ag.map.cells = cells.join("");
          reveal(ag);
          lastLookCell = -1;
          d.inventory["lucky-charm"] = (d.inventory["lucky-charm"] ?? 0) + 1;
          ag.loot.items["lucky-charm"] = (ag.loot.items["lucky-charm"] ?? 0) + 1;
          msgs.push("A hollow stone swings aside. In the alcove: a Lucky Charm!");
          sfxKinds.push("secret");
        } else {
          lastLookCell = faceCell;
          msgs.push("The stonework here sounds hollow. (Look again — or press E — to feel along the seams.)");
        }
        return;
      }

      const targetCell = facingOpen ? faceCell : cellId(ag.pos.x, ag.pos.y);
      const kind = entityAt(ag, targetCell);

      if (kind === "chest") {
        const chest = ag.chests.find((c) => c.cell === targetCell);
        if (!chest || chest.opened) {
          msgs.push("An empty chest, lid splintered.");
          return;
        }
        if (interact || lastLookCell === targetCell) {
          chest.opened = true;
          lastLookCell = -1;
          const rng = stepRng(ag);
          const gold = randInt(rng, 6 + ag.floor * 4, 12 + ag.floor * 8);
          d.gold += gold; // expedition gold is safe from a wipe — only unclaimed items are forfeited
          ag.loot.gold += gold;
          msgs.push(`The chest yields ${gold} gold.`);
          sfxKinds.push("chest", "coin");
          if (rng() < 0.25) {
            const drop = CHEST_CONSUMABLES[randInt(rng, 0, CHEST_CONSUMABLES.length - 1)];
            d.inventory[drop] = (d.inventory[drop] ?? 0) + 1;
            ag.loot.items[drop] = (ag.loot.items[drop] ?? 0) + 1;
            msgs.push(`Also: ${itemById(drop).name}.`);
          }
          // sound handled via sfxKinds above
        } else {
          lastLookCell = targetCell;
          msgs.push("A chest, iron-bound. (Look again — or press E — to open it.)");
        }
        return;
      }

      if (kind === "shrine") {
        const flag = `shrine-f${ag.floor}`;
        if (!ag.flags[flag]) {
          ag.flags[flag] = true;
          for (const p of d.party) {
            if (p.hp <= 0) continue; // shrines heal the living; the temple revives the dead
            const m = pcMax(p);
            p.hp = m.hp;
            p.sp = m.sp;
          }
          sfxKinds.push("heal");
          msgs.push("The shrine's quiet light knits flesh and spirit. Fully restored — its power now sleeps on this floor.");
        } else {
          msgs.push("The shrine is dark. Its power sleeps until you descend deeper.");
        }
        return;
      }

      if (kind === "stairs") {
        msgs.push("Stairs bore down into darker air. Step onto them to descend.");
        return;
      }

      lastLookCell = -1;
      msgs.push(facingOpen ? "Damp flagstones. Nothing here." : "Cold stone, weeping somewhere in the dark.");
    });

    for (const m of msgs) log(m);
    for (const k of sfxKinds) ctx.sfx[k]();
  }

  /** Swap the Auto-Walk button between its two states; textContent stays "Auto-Walk"/"Halt" for any reader. */
  function setAutoLabel(running: boolean): void {
    const btn = host.querySelector<HTMLButtonElement>(".auto-btn");
    if (!btn) return;
    btn.replaceChildren(iconEl(running ? "pause" : "fast-forward"), el("span", { class: "sr-only", text: running ? "Halt" : "Auto-Walk" }));
    btn.setAttribute("aria-pressed", String(running));
  }

  function stopAuto(): void {
    if (autoTimer !== null) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    setAutoLabel(false);
  }

  /** BFS to the stairs at 8 steps/sec; halts on encounter, trap or an unopened chest ahead. Descends and keeps walking across floors. */
  function toggleAuto(): void {
    const wasRunning = autoTimer !== null;
    stopAuto(); // a Halt click cancels and does not restart
    if (wasRunning) return;
    const ag = ctx.state().activeGate;
    if (!ag) return;

    log("You set off toward the stair.");
    setAutoLabel(true);
    autoTimer = window.setInterval(() => {
      if (!viewCanvas.isConnected || !ctx.state().activeGate || ctx.state().activeGate!.pendingMonsters) {
        stopAuto();
        return;
      }
      const cur = ctx.state().activeGate!;
      let stairsNow = -1;
      for (const [id, kind] of cur.map.entities) if (kind === "stairs") stairsNow = id;
      const next = bfsPath(gridFromSave(cur.map), cellId(cur.pos.x, cur.pos.y), stairsNow)?.[0];
      if (next === undefined) {
        stopAuto(); // standing on the stair — tryMove already handled it
        return;
      }
      const nxy = idToXY(next);
      ctx.commit((d) => {
        d.activeGate!.dir = dirFor(Math.sign(nxy.x - cur.pos.x), Math.sign(nxy.y - cur.pos.y));
      });
      // Face an unopened chest ahead instead of walking over to it.
      if (entityAt(cur, next) === "chest" && !cur.chests.find((c) => c.cell === next)?.opened) {
        stopAuto();
        log("A chest squats in the corridor. Look (L) to open it.");
        drawView();
        return;
      }
      const out = tryMove(false);
      refreshParty();
      drawView();
      if (out.trapMsg || out.avoided) toast(out.trapMsg ?? out.avoided!);
      if (out.encounter) {
        toast(`Ambush! ${out.encounter.join(", ")} bar the way.`);
        log(`Shadows detach from the walls — ${out.encounter.join(", ")}.`);
        stopAuto();
        ctx.navigate("#/combat");
        return;
      }
      if (out.descended) log("You descend. The air changes."); // cross-floor auto-walk: next tick re-paths on the new floor
      if (out.finished || out.trapMsg || out.avoided || out.encounter) {
        stopAuto();
        if (out.finished) finishRun(out.finished.loot, out.finished.gateName);
      }
    }, 125); // 8 steps per second
  }

  function dirFor(dx: number, dy: number): 0 | 1 | 2 | 3 {
    if (dy === -1) return 0;
    if (dx === 1) return 1;
    if (dy === 1) return 2;
    return 3;
  }

  function turn(delta: number): void {
    stopAuto();
    ctx.commit((d) => {
      const ag = agOf(d);
      ag.dir = (((ag.dir + delta) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
    });
    lastLookCell = -1;
    ctx.sfx.click();
    drawView();
  }

  function leave(): void {
    stopAuto();
    const close = modal(
      "Leave the maze?",
      el("div", {},
        el("p", { text: "Your party withdraws. Gold and items already taken are kept." }),
        el("div", { class: "modal-actions" },
          button("Leave", {
            onClick: () => {
              close();
              const rare = ctx.state().activeGate?.rareSpawn; // toast the run's event on abandon too
              ctx.commit((d) => endExpedition(d));
              toast(rare ? `You leave the depths behind. ${describeRare(rare)}` : "You leave the depths behind.");
              ctx.navigate("#/town");
            },
          }),
          button("Stay", { onClick: () => close() }),
        ),
      ),
    );
  }

  /** Out-of-combat consumables. Potions auto-target whoever needs them most; the dead stay dead. */
  function openItems(): void {
    stopAuto();
    const s = ctx.state();
    const usable = Object.entries(s.inventory).filter(([id, n]) => n > 0 && itemById(id).slot === "consumable");
    if (!usable.length) {
      toast("Your packs hold nothing you can use down here.");
      return;
    }
    const close = modal(
      "Use an Item",
      el("div", {},
        ...usable.map(([id, n]) => {
          const def = itemById(id);
          const combatOnly = def.use?.kind === "combat-atk-buff";
          return el("div", { class: "sell-row" },
            el("span", { class: "temple-id", text: `${def.name} ×${n}` }),
            button(combatOnly ? "Battle Only" : "Use", {
              disabled: combatOnly,
              hint: combatOnly
                ? "Elixirs sharpen blades mid-fight"
                : def.use?.kind === "party-heal"
                  ? `Heals every living party member ${def.use.amount}`
                  : `Restores ${def.use?.amount} — auto-targets whoever needs it most`,
              onClick: () => {
                ctx.commit((d) => {
                  d.inventory[id] -= 1;
                  if (def.use?.kind === "restore-hp") {
                    const p = [...d.party].filter((q) => q.hp > 0).sort((a, b) => a.hp / pcMax(a).hp - b.hp / pcMax(b).hp)[0];
                    if (p) {
                      p.hp = Math.min(pcMax(p).hp, p.hp + def.use.amount);
                      toast(`${p.name} drinks deep. HP restored.`);
                    }
                  } else if (def.use?.kind === "restore-sp") {
                    const p = [...d.party]
                      .filter((q) => q.sp < pcMax(q).sp)
                      .sort((a, b) => a.sp / pcMax(a).sp - b.sp / pcMax(b).sp)[0];
                    if (p) {
                      p.sp = Math.min(pcMax(p).sp, p.sp + def.use.amount);
                      toast(`${p.name} drinks deep. SP restored.`);
                    }
                  } else if (def.use?.kind === "party-heal") {
                    for (const p of d.party) {
                      if (p.hp > 0) p.hp = Math.min(pcMax(p).hp, p.hp + def.use!.amount);
                    }
                    toast("Warm light passes through the party.");
                  }
                });
                ctx.sfx.heal();
                refreshParty();
                close();
              },
            }),
          );
        }),
      ),
    );
  }

  function doMove(back: boolean): void {
    stopAuto();
    const out = tryMove(back);
    if (out.trapMsg || out.avoided) toast(out.trapMsg ?? out.avoided!);
    if (out.encounter) {
      ctx.sfx.hit();
      toast(`Ambush! ${out.encounter.join(", ")} bar the way.`);
      log(`Shadows detach from the walls — ${out.encounter.join(", ")}.`);
      refreshParty();
      drawView();
      ctx.navigate("#/combat");
      return;
    }
    refreshParty();
    drawView();
    if (out.descended) log("You descend. The air changes.");
    if (out.finished) finishRun(out.finished.loot, out.finished.gateName);
  }

  function doLook(interact = false): void {
    stopAuto();
    look(interact);
    refreshParty(); // shrine heals land while looking
    drawView();
  }

  // ---------- Rare spawns (M7): one-off run events surfaced as a card ----------
  const rareHost = el("div", { class: "rare-host" });

  /** Merchant cart: three uncommon/rare goods at −25%, paid in gold, each buyable once. */
  function openMerchant(): void {
    stopAuto();
    const s = ctx.state();
    const ag = s.activeGate!;
    const wares = merchantWares(ag);
    const close = modal(
      "The Wandering Merchant",
      el("div", {},
        el("p", { class: "muted", text: "Rare goods at a quarter off. The cart leaves when the expedition does." }),
        ...wares.map((w) => {
          const def = itemById(w.id);
          const bought = !!ag.flags[`ware-${w.id}`];
          return el("div", { class: "sell-row" },
            el("span", { class: "temple-id", text: `${def.name} — ${w.price} g` }),
            button(bought ? "Sold" : "Buy", {
              disabled: bought || s.gold < w.price,
              hint: bought ? "Already in your packs" : `Pay ${w.price} g (${s.gold} g in hand)`,
              onClick: () => {
                ctx.commit((d) => {
                  const a = d.activeGate!;
                  if (a.flags[`ware-${w.id}`] || d.gold < w.price) return;
                  d.gold -= w.price;
                  d.inventory[w.id] = (d.inventory[w.id] ?? 0) + 1;
                  a.flags[`ware-${w.id}`] = true;
                });
                ctx.sfx.click();
                refreshParty();
                toast(`Bought ${def.name} for ${w.price} g.`);
                close(); // rebuild affordability on reopen
              },
            }),
          );
        }),
      ),
    );
  }

  function rareCard(): HTMLElement | null {
    const s = ctx.state();
    const ag = s.activeGate;
    if (!ag?.rareSpawn || ag.flags["rare-done"]) return null;
    if (ag.rareSpawn === "merchant") {
      return el("div", { class: "panel rare-card" },
        el("p", { text: "A wandering merchant waits among the pillars, lantern swaying." }),
        button("Trade", { hint: "Three rare goods at −25%; closes when the expedition ends", onClick: () => openMerchant() }),
      );
    }
    if (ag.rareSpawn === "hermit") {
      return el("div", { class: "panel rare-card" },
        el("p", { text: "A hermit beckons from a shadowed alcove, finger to lips." }),
        button("Listen", {
          hint: "Free identify — one unknown creature joins the codex",
          onClick: () => {
            stopAuto();
            let giftName = "";
            ctx.commit((d) => {
              const a = d.activeGate!;
              const gift = hermitGift(a, d.codex);
              if (gift && !d.codex.includes(gift.id)) d.codex.push(gift.id);
              a.flags["rare-done"] = true;
              giftName = gift ? titleCase(gift.id) : "";
            });
            ctx.sfx.heal();
            toast(giftName ? `The hermit whispers of ${giftName} — the codex grows by one page.` : "The hermit studies you, then waves you on; the book holds no secrets from you.");
            drawRare();
            fitShell(); // banner removal shrinks `top` - re-measure the shell or it stays short until a manual resize
          },
        }),
      );
    }
    return el("div", { class: "panel rare-card" },
      el("p", { text: "A villager is trapped beneath fallen rubble, calling for help." }),
      button("Dig Them Out", {
        hint: "Their kin keep a temple token — one revive on the house",
        onClick: () => {
          stopAuto();
          ctx.commit((d) => {
            d.activeGate!.flags["rare-done"] = true;
            d.reviveToken = true;
          });
          ctx.sfx.levelup();
          toast("The villager gasps free. The temple will remember this.");
          drawRare();
          fitShell(); // banner removal shrinks `top` - re-measure the shell or it stays short until a manual resize
        },
      }),
    );
  }

  function drawRare(): void {
    rareHost.replaceChildren();
    const card = rareCard();
    if (card) rareHost.append(card);
  }

  // ---------- layout ----------
  const autoBtn = button("Auto-Walk", { cls: "auto-btn", icon: "fast-forward", hint: "Walks to the stairs and descends automatically, floor after floor; halts on foes, traps, chests", onClick: () => toggleAuto() });
  autoBtn.setAttribute("aria-pressed", "false");
  const cmdBar = el("div", { class: "cmd-bar" },
    button("Forward", { icon: "forward", hint: "W / ↑ — step ahead (traps spring, encounters roll)", onClick: () => doMove(false) }),
    button("Back", { icon: "back", hint: "S / ↓ — step back without turning", onClick: () => doMove(true) }),
    button("Turn L", { icon: "turn-l", hint: "A — turn 90° left", onClick: () => turn(3) }),
    button("Turn R", { icon: "turn-r", hint: "D — turn 90° right", onClick: () => turn(1) }),
    button("Look", { icon: "look", hint: "L — describe what you face; again to open chests / reveal secrets", onClick: () => doLook() }),
    autoBtn,
    button("Item", { icon: "flask", hint: "Use a consumable outside combat", onClick: () => openItems() }),
    button("Spell", { icon: "spark", hint: "No foes in sight — save your spells for battle", onClick: () => toast("Save your spells for battle.") }),
    button("Leave", { cls: "danger", icon: "door", hint: "Withdraw the party; loot already taken is kept", onClick: () => leave() }),
  );

  host.append(el("h2", { class: "sr-only", text: "The Depths" }));
  host.append(rareHost);
  drawRare();
  const ag = ctx.state().activeGate!;
  const def = gateById(ag.gateId);
  // On-screen movement pad; CSS reveals it only on touch (coarse pointer) devices.
  const padBtn = (aria: string, icon: IconName, fn: () => void): HTMLElement => button(aria, { icon, onClick: () => fn() });
  const dpad = el(
    "div",
    { class: "dpad", role: "group", "aria-label": "Movement controls" },
    padBtn("Move forward", "forward", () => doMove(false)),
    padBtn("Turn left", "turn-l", () => turn(3)),
    padBtn("Look at what is ahead", "look", () => doLook(false)),
    padBtn("Turn right", "turn-r", () => turn(1)),
    padBtn("Step back", "back", () => doMove(true)),
  );
  const dungeonGrid = el("div", { class: "dungeon-grid" },
    el("div", { class: "view-col" }, viewStage, cmdBar, dpad),
    el("div", { class: "side-col" },
      el("div", { class: "panel mini-card" },
        el("p", { class: "muted", text: `${def.name} · Floor ${ag.floor + 1}/${def.floors}` }),
        miniCanvas,
        el("p", { class: "muted legend", text: "■ stairs · ? chest · ✚ shrine — explored cells only" }),
      ),
      partyHost,
      logEl,
    ),
  );
  host.append(dungeonGrid);

  // Desktop: lock the screen to the viewport so buttons and the log never need page scroll.
  // The grid height is measured (not guessed) so header/font-scale changes can't push it over;
  // the canvas then scales inside its stage at the largest size that fits, aspect preserved.
  const mqDesktop = matchMedia("(min-width: 62rem)");
  function fitShell(): void {
    if (!viewCanvas.isConnected) return;
    const avail = mqDesktop.matches
      ? document.documentElement.clientHeight - (dungeonGrid.getBoundingClientRect().top + scrollY) - 20 // #app bottom padding + slack
      : -1;
    if (avail < 360) {
      // Not desktop, or too cramped to lock: natural flow beats forcing a shell taller than the viewport.
      dungeonGrid.style.height = "";
      viewCanvas.style.width = "";
      viewCanvas.style.height = "";
      return;
    }
    dungeonGrid.style.height = `${avail}px`;
    fitCanvas();
  }
  function fitCanvas(): void {
    if (!mqDesktop.matches || !viewStage.isConnected) return;
    const r = viewStage.getBoundingClientRect();
    const s = Math.min(r.width / VIEW_W, r.height / VIEW_H);
    if (s <= 0) return;
    viewCanvas.style.width = `${Math.floor(VIEW_W * s)}px`;
    viewCanvas.style.height = `${Math.floor(VIEW_H * s)}px`;
  }
  // Screens have no router teardown hook; every guard event tears down the whole listener set,
  // so a navigation away can't strand closures (esp. the mq "change" one until the next resize).
  const cleanup = () => {
    removeEventListener("resize", onResize);
    removeEventListener("keydown", onKey);
    mqDesktop.removeEventListener("change", onMq);
  };
  const onResize = () => {
    if (!viewCanvas.isConnected) {
      cleanup();
      return;
    }
    fitShell();
  };
  // No ResizeObserver: every dungeon entry remounts this screen, and observers left on the
  // detached stage would pile up. Mount-time fit + window/mq listeners cover every real change.
  addEventListener("resize", onResize);
  const onMq = () => {
    if (!viewCanvas.isConnected) {
      cleanup(); // an mq change after navigation must detach too - bare fitShell early-returns and leaks the set
      return;
    }
    fitShell();
  };
  mqDesktop.addEventListener("change", onMq);
  fitShell();

  // Keyboard controls live as long as this screen's canvas is mounted.
  const onKey = (e: KeyboardEvent) => {
    if (!viewCanvas.isConnected) {
      cleanup();
      return;
    }
    if (document.querySelector(".modal-backdrop")) return; // modal owns keys while open - focus can escape the card, so containment checks fail
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") {
      e.preventDefault();
      doMove(false);
    } else if (k === "s" || k === "arrowdown") {
      e.preventDefault();
      doMove(true);
    } else if (k === "a" || k === "arrowleft") {
      e.preventDefault();
      turn(3);
    } else if (k === "d" || k === "arrowright") {
      e.preventDefault();
      turn(1);
    } else if (k === "l") {
      doLook(false);
    } else if (k === "e") {
      doLook(true); // Use: open chest / reveal secret directly
    }
  };
  addEventListener("keydown", onKey);

  log(`You step into ${def.name}. Run #${ag.runNumber}, floor ${ag.floor + 1}.`);
  refreshParty();
  drawView();
}
