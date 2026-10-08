import { el, button, bar } from "../ui/dom";
import type { RouteCtx } from "../ui/router";
import { slotImg } from "../render/art";
import { CLASSES, RECRUIT_COST, classById } from "../data/classes";
import { itemById } from "../data/items";
import { useText } from "./shop";
import { xpForNext, LEVEL_CAP } from "../data/progression";
import type { Pc } from "../state/save";
import { pcMax, statusLabel } from "../state/save";
import {
  effectiveStats,
  equipFromInventory,
  unequipSlot,
  recruitPc,
  suggestAllocate,
} from "../state/party";

// Selection survives ctx.refresh() re-renders (module scope on purpose).
let selectedId: string | null = null;
let openGearSlot: "weapon" | "armor" | "trinket" | null = null;

const STAT_KEYS = ["atk", "def", "dex", "mnd"] as const;

function statusChips(pc: Pc): HTMLElement {
  return el(
    "div",
    { class: "status-chips" },
    ...pc.statuses.map((s) =>
      el("span", { class: `chip chip-${s.kind}`, text: `${statusLabel(s.kind)} ${s.roundsLeft}` }),
    ),
  );
}

function pcCard(pc: Pc, ctx: RouteCtx): HTMLElement {
  const max = pcMax(pc);
  return el(
    "div",
    {
      class: `pc-card${selectedId === pc.id ? " selected" : ""}${pc.hp <= 0 ? " downed" : ""}`,
      onclick: () => {
        selectedId = selectedId === pc.id ? null : pc.id;
        openGearSlot = null;
        ctx.refresh();
      },
    },
    slotImg(`class.${pc.classId}`, 64),
    el("div", { class: "pc-id" }, el("b", { text: pc.name }), el("span", { text: ` ${classById(pc.classId).name} Lv ${pc.level}` })),
    bar(pc.hp, max.hp, "var(--hp)", "♥", `${pc.name} HP`),
    bar(pc.sp, max.sp, "var(--sp)", "✦", `${pc.name} SP`),
    statusChips(pc),
    pc.points > 0 ? el("span", { class: "points-badge", text: `+${pc.points} pts`, title: "Unallocated stat points" }) : null,
  );
}

function gearSlot(pc: Pc, slot: "weapon" | "armor" | "trinket", ctx: RouteCtx): HTMLElement {
  const id = pc.gear[slot];
  const def = id ? itemById(id) : null;
  const options = Object.entries(ctx.state().inventory)
    .filter(([iid, n]) => n > 0 && itemById(iid).slot === slot)
    .map(([iid, n]) => [itemById(iid), n] as const);
  const picker =
    openGearSlot === slot
      ? el(
          "div",
          { class: "gear-picker" },
          ...(options.length
            ? options.map(([opt, n]) =>
                button(`${opt.name} ×${n}`, {
                  hint: bonusText(opt),
                  onClick: () => {
                    ctx.commit((s) => equipFromInventory(s, pc.id, opt.id));
                    openGearSlot = null;
                    ctx.refresh();
                  },
                }),
              )
            : [el("p", { class: "muted", text: `No ${slot} in the party inventory.` })]),
        )
      : null;
  return el(
    "div",
    { class: "gear-slot" },
    el("span", { class: "slot-name", text: slot }),
    def
      ? el(
          "span",
          {},
          el("span", { class: `item-name rar-${def.rarity}`, text: def.name }),
          button("Unequip", {
            hint: `Return ${def.name} to the party inventory`,
            onClick: () => {
              ctx.commit((s) => unequipSlot(s, pc.id, slot));
              openGearSlot = null;
              ctx.refresh();
            },
          }),
        )
      : el("span", { class: "slot-empty", text: "empty" }),
    button(def ? "Change" : "Equip", {
      hint: def ? `Swap ${def.name} for another ${slot}` : `Choose a ${slot} from the party inventory`,
      onClick: () => {
        openGearSlot = openGearSlot === slot ? null : slot;
        ctx.refresh();
      },
    }),
    picker,
  );
}

function bonusText(def: ReturnType<typeof itemById>): string {
  if (def.use) return useText(def);
  const parts = Object.entries(def.bonus ?? {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k.toUpperCase()}`);
  if (def.critChanceBonus) parts.push(`+${Math.round(def.critChanceBonus * 100)}% crit`);
  return parts.join(", ") || "No bonus.";
}

function detailSheet(pc: Pc, ctx: RouteCtx): HTMLElement {
  const eff = effectiveStats(pc);
  const max = pcMax(pc);
  const atCap = pc.level >= LEVEL_CAP;
  return el(
    "div",
    { class: "detail-sheet" },
    el("h2", { text: `${pc.name} — ${classById(pc.classId).name}` }),
    el(
      "div",
      { class: "sheet-top" },
      slotImg(`class.${pc.classId}`, 96),
      el(
        "div",
        {},
        el("p", { text: `Level ${pc.level}${atCap ? " (cap)" : ""}` }),
        atCap
          ? el("p", { class: "muted", text: "Experience no longer accrues." })
          : bar(pc.xp, xpForNext(pc.level), "var(--gold)", "", `XP to level ${pc.level + 1}`),
      ),
    ),
    bar(pc.hp, max.hp, "var(--hp)", "♥", "HP"),
    bar(pc.sp, max.sp, "var(--sp)", "✦", "SP"),
    statusChips(pc),
    el(
      "div",
      { class: "stat-rows" },
      ...STAT_KEYS.map((k) =>
        el(
          "div",
          { class: "stat-row" },
          el("span", { text: k.toUpperCase() }),
          el("b", { text: String(eff[k]) }),
          pc.alloc[k] > 0 ? el("span", { class: "muted", text: `(alloc +${pc.alloc[k]})` }) : null,
          pc.points > 0 && pc.hp > 0
            ? button("+", {
                hint: `Spend one point on ${k.toUpperCase()} (effective ${eff[k]} → ${eff[k] + 1})`,
                onClick: () => {
                  ctx.commit((s) => {
                    const p = s.party.find((x) => x.id === pc.id);
                    if (p && p.points > 0) {
                      p.alloc[k]++;
                      p.points--;
                    }
                  });
                  ctx.refresh();
                },
              })
            : null,
        ),
      ),
    ),
    el(
      "div",
      { class: "sheet-actions" },
      button("Suggest", {
        hint: `Spend one point on ${classById(pc.classId).suggestStat.toUpperCase()} (class recommendation)`,
        disabled: pc.points < 1,
        onClick: () => {
          ctx.commit((s) => {
            const p = s.party.find((x) => x.id === pc.id);
            if (p) suggestAllocate(p);
          });
          ctx.refresh();
        },
      }),
    ),
    el(
      "div",
      { class: "gear-slots" },
      ...(["weapon", "armor", "trinket"] as const).map((slot) => gearSlot(pc, slot, ctx)),
    ),
  );
}

export function renderGuild(host: HTMLElement, ctx: RouteCtx): void {
  const s = ctx.state();
  if (selectedId && !s.party.some((p) => p.id === selectedId)) selectedId = null;
  const selected = s.party.find((p) => p.id === selectedId);

  host.append(
    el("h1", { text: "The Guild" }),
    el("p", { class: "muted", text: `Hire a sellsword for ${RECRUIT_COST} gold. Click an adventurer to open their sheet.` }),
    el("div", { class: "party-grid" }, ...s.party.map((pc) => pcCard(pc, ctx))),
  );

  if (selected) host.append(detailSheet(selected, ctx));

  const recruit = el("div", { class: "recruit-row" });
  for (const cls of CLASSES) {
    recruit.append(
      button(`Recruit ${cls.name}`, {
        hint: `Level 1 ${cls.name} — ${RECRUIT_COST} gold. Starts with ${cls.start.hp} HP, ${cls.start.sp} SP.`,
        disabled: s.party.length >= 4 || s.gold < RECRUIT_COST,
        onClick: () => {
          ctx.commit((st) => recruitPc(st, cls.id));
          ctx.refresh();
        },
      }),
    );
  }
  host.append(
    el("div", {}, recruit),
    button("← Town", { hint: "Back to the town square", onClick: () => ctx.navigate("#/town") }),
  );
}
