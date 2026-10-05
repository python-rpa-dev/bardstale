/** Battle screen: foe cards with floaters, party panel, action bar, aria-live log.
 *  Foe turns run on a paced timeout chain; every action commits to the save immediately. */

import { el, button, bar, modal, toast } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { ITEMS } from "../data/items";
import { pcMax } from "../state/save";
import { spellsKnownAt } from "../data/spells";
import { medalForFamily } from "../data/medals";
import {
  foeAct,
  foeDef,
  pcAttack,
  pcCast,
  pcGuard,
  pcUse,
  spCostFor,
  quickResolve,
  tryFlee,
  effectiveOrder,
  type CombatEvent,
  type CombatState,
} from "../core/combat";
import { applyDefeat, beginCombat, claimVictory, resolveFlee, syncPartyFromCombat } from "../state/combat";

/** Mount token: pending foe-turn timeouts die when the screen re-renders. */
let mountEpoch = 0;
let defeatSeedShown = Number.NaN; // one defeat modal per fight, survives re-renders

const titleCase = (id: string): string => id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export function renderCombat(host: HTMLElement, ctx: RouteCtx): void {
  const epoch = ++mountEpoch;
  const st = ctx.state();

  // A pending encounter with no live fight (e.g. reload between roll and mount) starts here.
  if (!st.activeCombat && st.activeGate?.pendingMonsters?.length) {
    ctx.commit((d) => beginCombat(d));
  }
  const cs = ctx.state().activeCombat;
  if (!cs) {
    toast("No battle to fight.");
    ctx.navigate("#/town");
    return;
  }

  let speed = 1; // 1× / 2× toggle for foe-turn pacing
  let selectedFoe = cs.foes.findIndex((f) => f.hp > 0);
  let pendingEvents: CombatEvent[] = []; // events from the action that triggered this render

  const turnEntry = effectiveOrder(cs)[cs.turnPtr];
  const activePcIdx = turnEntry?.[0] === "pc" ? turnEntry[1] : -1;
  const pcTurn = cs.phase === "input" && activePcIdx >= 0 && cs.pcs[activePcIdx].hp > 0;

  // ---------- rendering pieces ----------

  function foeCard(idx: number): HTMLElement {
    const f = cs!.foes[idx];
    const def = foeDef(f); // hollows-shifted level/hp when the modifier is up
    const dead = f.hp <= 0;
    const card = el(
      "div",
      {
        class: `foe-card${dead ? " dead" : ""}${idx === selectedFoe && !dead ? " targeted" : ""}`,
        "data-side": "foe",
        "data-idx": String(idx),
        role: dead ? undefined : "button",
        "aria-label": dead ? `${titleCase(f.mid)}, slain` : `Target the ${titleCase(f.mid)}, ${f.hp} of ${def.hp} HP`,
        onClick: () => {
          if (dead) return;
          selectedFoe = idx;
          ctx.refresh();
        },
      },
      slotImg(`monster.${f.mid}`, 96),
      el("b", { text: titleCase(f.mid) }),
      el("span", { class: "muted", text: `Lvl ${def.lvl}` }),
       bar(f.hp, def.hp, dead ? "var(--danger)" : "var(--hp)", "☠", `${titleCase(f.mid)} HP`)
    );
    return card;
  }

  function pcChip(idx: number): HTMLElement {
    const p = cs!.pcs[idx];
    const down = p.hp <= 0;
    const chip = el(
      "div",
      {
        class: `pc-chip${down ? " down" : ""}${idx === activePcIdx && pcTurn ? " active" : ""}`,
        "data-side": "pc",
        "data-idx": String(idx),
        "aria-current": idx === activePcIdx && pcTurn ? "step" : undefined,
      },
      el("b", { text: p.name }),
      el("span", { class: "muted", text: `${titleCase(p.classId)} L${p.level}` }),
       bar(p.hp, pcMax(p).hp, "var(--hp)", "♥", `${p.name} HP`),
       bar(p.sp, pcMax(p).sp, "var(--sp)", "✦", `${p.name} SP`),
      ...p.statuses.map((s) => el("span", { class: `status-chip ${s.kind}`, text: `${s.kind} ${s.roundsLeft}` })),
      p.guard ? el("span", { class: "status-chip guard", text: "guard" }) : null,
      down ? el("span", { class: "down-label", text: "down" }) : null
    );
    return chip;
  }

  const logRegion = el(
    "div",
    { class: "combat-log", role: "log", "aria-live": "polite" },
    ...cs.log.slice(-9).map((line) => el("p", { text: line }))
  );

  // ---------- actions ----------

  function runAction(fn: (c: CombatState) => CombatEvent[]): void {
    let evs: CombatEvent[] = [];
    ctx.commit((d) => {
      const c = d.activeCombat!;
      evs = fn(c);
      syncPartyFromCombat(d);
    });
    pendingEvents = evs;
    playEvents(evs);
    ctx.refresh();
  }

  function attack(): void {
    if (selectedFoe < 0 || cs!.foes[selectedFoe].hp <= 0) selectedFoe = cs!.foes.findIndex((f) => f.hp > 0);
    runAction((c) => pcAttack(c, activePcIdx, selectedFoe));
  }

  function openSpells(): void {
    const p = cs!.pcs[activePcIdx];
    const known = spellsKnownAt(p.classId, p.level);
    const list = el("div", { class: "spell-list" });
    if (!known.length) list.append(el("p", { class: "muted", text: "No spells learned yet." }));
    for (const sp of known) {
      const cost = spCostFor(sp.id, cs!);
      list.append(
        button(`${sp.name} — ${cost} SP`, {
          hint: `${sp.effect}. Target: ${sp.target.replace(/-/g, " ")}.`,
          disabled: p.sp < cost,
          onClick: () => {
            close();
            const needsTarget = sp.target === "one-foe";
            let t = selectedFoe;
            if (needsTarget && (t < 0 || cs!.foes[t].hp <= 0)) t = cs!.foes.findIndex((f) => f.hp > 0);
            runAction((c) => pcCast(c, activePcIdx, sp.id, needsTarget ? t : -1));
          },
        })
      );
    }
    const close = modal(`${p.name} — Cast a Spell`, list);
  }

  function openItems(): void {
    const inv = ctx.state().inventory;
    const usable = ITEMS.filter((it) => it.slot === "consumable" && (inv[it.id] ?? 0) > 0);
    const list = el("div", { class: "item-list" });
    if (!usable.length) list.append(el("p", { class: "muted", text: "Nothing usable in the pack." }));
    for (const it of usable) {
      list.append(
        button(`${it.name} ×${inv[it.id]}`, {
          hint: it.use ? `${it.use.kind.replace(/-/g, " ")} ${it.use.amount}` : "",
          onClick: () => {
            close();
            let evs: CombatEvent[] = [];
            ctx.commit((d) => {
              const r = pcUse(d.activeCombat!, activePcIdx, it.id);
              if (r.consumed) d.inventory[it.id] = Math.max(0, (d.inventory[it.id] ?? 1) - 1);
              evs = r.events;
              syncPartyFromCombat(d);
            });
            pendingEvents = evs;
            playEvents(evs);
            ctx.refresh();
          },
        })
      );
    }
    const close = modal("Use an Item", list);
  }


  function guard(): void {
    runAction((c) => pcGuard(c, activePcIdx));
  }

  function flee(): void {
    let escaped = false;
    ctx.commit((d) => {
      const r = tryFlee(d.activeCombat!);
      escaped = r.escaped;
      syncPartyFromCombat(d);
    });
    if (escaped) ctx.sfx.click();
    else ctx.sfx.thud();
    pendingEvents = [];
    ctx.refresh();
  }

  function quick(): void {
    ctx.commit((d) => {
      const c = d.activeCombat!;
      quickResolve(c);
      syncPartyFromCombat(d);
    });
    ctx.sfx.hit();
    ctx.refresh();
  }

  // ---------- pacing + automation ----------

  function schedule(): void {
    if (epoch !== mountEpoch) return;
    const c = ctx.state().activeCombat;
    if (!c || c.phase !== "input") return;
    const [side, idx] = effectiveOrder(c)[c.turnPtr];
    if (side === "foe") {
      window.setTimeout(() => {
        if (epoch !== mountEpoch) return;
        let evs: CombatEvent[] = [];
        ctx.commit((d) => {
          evs = foeAct(d.activeCombat!, idx);
          syncPartyFromCombat(d);
        });
        pendingEvents = evs;
        playEvents(evs);
        ctx.refresh(); // re-render reschedules the next combatant
      }, 900 / speed);
    } else if (ctx.state().settings.quickBattle && c.pcs[idx].hp > 0) {
      window.setTimeout(() => {
        if (epoch !== mountEpoch) return;
        const t = ctx.state().activeCombat!.foes.findIndex((f) => f.hp > 0);
        runAction((cc) => pcAttack(cc, idx, t));
      }, 350 / speed);
    }
  }

  function playEvents(evs: CombatEvent[]): void {
    for (const e of evs) {
      if (e.kind === "crit") ctx.sfx.crit();
      else if (e.kind === "hit" || e.kind === "spell" || e.kind === "breath") ctx.sfx.hit();
      else if (e.kind === "heal") ctx.sfx.heal();
      else if (e.kind === "death") ctx.sfx.thud();
    }
  }

  function floaters(): void {
    if (ctx.state().settings.reduceMotion) return;
    for (const e of pendingEvents) {
      if (!e.dst || !e.amount) continue;
      const card = host.querySelector<HTMLElement>(`.foe-card[data-side="${e.dst[0]}"][data-idx="${e.dst[1]}"], .pc-chip[data-side="${e.dst[0]}"][data-idx="${e.dst[1]}"]`);
      if (!card) continue;
      const num = el("span", { class: `float-num ${e.kind}`, text: e.kind === "heal" ? e.text : `-${e.amount}` });
      card.append(num);
      window.setTimeout(() => num.remove(), 950);
    }
    pendingEvents = [];
  }

  // ---------- end-of-fight panels ----------

  function victoryPanel(): HTMLElement {
    const v = cs!.victory!;
    const rows: HTMLElement[] = [];
    for (const p of cs!.pcs) {
      const xp = v.xpByPc[p.id] ?? 0;
      rows.push(el("li", {}, el("b", { text: p.name }), el("span", { text: ` +${xp} XP` })));
    }
    let summary: ReturnType<typeof claimVictory> = null;
    return el(
      "div",
      { class: "combat-end victory" },
      el("h2", { text: "Victory!" }),
      v.tooWeak ? el("p", { class: "warn", text: "These foes were far too weak — the XP tax bit hard." }) : null,
      el("ul", { class: "xp-list" }, ...rows),
      el("p", { class: "gold-line", text: `+${v.gold} gold (banked)` }),
      button("Claim and Continue", {
        hint: "Bank the gold, stamp the codex, count bounty kills.",
        onClick: () => {
          ctx.commit((d) => {
            summary = claimVictory(d);
          });
          if (summary && Object.keys(summary.levelsByPc).length) ctx.sfx.levelup();
          else ctx.sfx.click();
          if (summary?.bountyDone) toast(`Bounty complete! +${summary.bountyDone.gold} g.`);
          for (const fam of summary?.newMedals ?? []) {
            const med = medalForFamily(fam);
            modal(`${med.name} Earned!`, el("p", {}, `Codex complete for the ${fam}. Perk: `, el("b", { text: med.perkText })));
          }
          ctx.navigate("#/dungeon");
        },
      })
    );
  }

  function defeatPanel(): () => void {
    return modal(
      "The Party Falls…",
      el(
        "div",
        {},
        el("p", { text: "Darkness takes you. The temple bells will wake you at first light — everyone at 1 HP." }),
        el("p", { class: "warn", text: "Unbanked loot from this run is forfeited. Banked gold is safe." }),
        button("Stumble Home", {
          hint: "Return to town broken but breathing.",
          onClick: () => {
            ctx.commit((d) => applyDefeat(d));
            ctx.sfx.thud();
            ctx.navigate("#/town");
          },
        })
      )
    );
  }

  // fled: resolve immediately and drop back into the dungeon
  if (cs.phase === "fled") {
    ctx.commit((d) => resolveFlee(d));
    toast("You slip away — no XP, no loot.");
    ctx.navigate("#/dungeon");
    return;
  }

  // ---------- assemble ----------

  host.append(
    el("div", { class: "foe-row" }, ...cs.foes.map((_, i) => foeCard(i))),
    el("div", { class: "pc-row" }, ...cs.pcs.map((_, i) => pcChip(i))),
    logRegion
  );

  if (cs.phase === "input") {
    const cmdBar = el(
      "div",
      { class: "cmd-bar" },
      button("Attack", { hint: "Strike the targeted foe (click a card to retarget).", disabled: !pcTurn, onClick: attack }),
      button("Cast", { hint: "Spend SP on a known spell.", disabled: !pcTurn || spellsKnownAt(cs.pcs[activePcIdx].classId, cs.pcs[activePcIdx].level).length === 0, onClick: openSpells }),
      button("Use", { hint: "Drink or read a consumable.", disabled: !pcTurn, onClick: openItems }),
      button("Guard", { hint: "Halve damage until your next turn.", disabled: !pcTurn, onClick: guard }),
      button("Flee", { hint: "Escape chance scales with party DEX over foe DEX.", disabled: !pcTurn, onClick: flee }),
      button(`Speed ${speed}×`, { hint: "Foe-turn pacing.", onClick: () => { speed = speed === 1 ? 2 : 1; ctx.refresh(); } }),
      button("Quick Resolve", { hint: "Auto-run the rest of this fight on the same dice.", onClick: quick })
    );
    host.append(cmdBar);
    if (pcTurn) {
      const p = cs.pcs[activePcIdx];
      host.append(el("p", { class: "turn-hint", text: `${p.name}'s turn — choose an action.` }));
    } else {
      host.append(el("p", { class: "turn-hint muted", text: "The foes move…" }));
    }
  } else if (cs.phase === "won") {
    host.append(victoryPanel());
  } else if (cs.phase === "lost" && cs.seed !== defeatSeedShown) {
    defeatSeedShown = cs.seed;
    ctx.sfx.thud();
    defeatPanel();
  }

  floaters();
  schedule();
}
