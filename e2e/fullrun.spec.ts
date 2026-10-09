import { expect, test, type Page } from "@playwright/test";

// Full-loop proof: a seeded veteran party auto-walks Hollow Roots floor after floor,
// quick-resolves every encounter, surfaces with the loot, and banks more than it carried in.
// The clock is pinned so dayKey, ambient omen and daily offers are deterministic forever.
test.setTimeout(300_000);

const FIXED_DAY = Date.UTC(2026, 0, 5, 12); // a Monday; Hollow Roots' ambient omen is fixed by (day + gateIdx) % 6

async function partyCount(page: Page): Promise<number> {
  const raw = await page.evaluate(() => localStorage.getItem("bardstale.save.v1"));
  return raw ? ((JSON.parse(raw).party as unknown[] | undefined)?.length ?? 0) : 0;
}

type Step = { at: string; auto: string | null; action: string };

async function step(page: Page): Promise<Step> {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")] as HTMLButtonElement[];
    const enabled = (re: RegExp) => btns.find((b) => !b.disabled && re.test(b.textContent ?? ""));
    const auto = document.querySelector(".auto-btn") as HTMLButtonElement | null;
    const at = location.hash.replace("#/", "");
    // priority: finish modal > defeat (must never fire for a seeded party) > combat > claim > boon-ish modal > stuck walker
    const back = enabled(/^Back to Town/);
    if (back) { back.click(); return { at, auto: null, action: "back-to-town" }; }
    const stumble = enabled(/^Stumble Home/);
    if (stumble) { stumble.click(); return { at, auto: null, action: "DEFEAT" }; }
    const qr = enabled(/Quick Resolve/);
    if (qr) { qr.click(); return { at, auto: null, action: "quick-resolve" }; }
    const claim = enabled(/^Claim and Continue/);
    if (claim) { claim.click(); return { at, auto: null, action: "claim" }; }
    const modalBtn = [...document.querySelectorAll(".modal-card button")].find((b) => !(b as HTMLButtonElement).disabled) as HTMLButtonElement | undefined;
    if (modalBtn && !/Back to Town|Stumble Home/.test(modalBtn.textContent ?? "")) {
      const label = (modalBtn.textContent ?? "").trim().slice(0, 24);
      modalBtn.click(); // e.g. a boon pick — first card is deterministic under the pinned clock
      return { at, auto: null, action: "modal:" + label };
    }
    if (at === "dungeon" && auto && auto.textContent?.trim() === "Auto-Walk") {
      const look = btns.find((b) => b.textContent?.trim() === "Look"); // chest-ahead halt: double-Look opens, then resume
      if (look) { look.click(); look.click(); }
      auto.click();
      return { at, auto: "resumed", action: "unstick" };
    }
    return { at, auto: auto?.textContent?.trim() ?? null, action: "wait" };
  });
}

test("seeded full loop: descend under the ambient omen, auto-walk to the surface, bank the loot", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_DAY);
  await page.goto("/#/town"); // boots a fresh save from the app's own newGame() — in memory only until something commits
  const skip = page.getByRole("button", { name: "Skip tour" });
  await skip.click().catch(() => {}); // skipping the welcome tour is the first commit; it flushes the debounced writer
  try {
    await expect.poll(async () => partyCount(page), { timeout: 3000 }).toBeGreaterThan(2);
  } catch {
    // no tour was shown (nothing committed yet): flip a setting twice to force the write through
    await page.getByRole("button", { name: "Open settings" }).click();
    const hc = page.getByRole("checkbox", { name: /High Contrast/ });
    await hc.click();
    await hc.click();
    await expect.poll(async () => partyCount(page), { timeout: 3000 }).toBeGreaterThan(2);
  }

  const partySize = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}");
    d.tourSeen = true;
    for (const p of d.party) { p.level = 9; p.hp = 300; } // veterans with deep HP pools: Hollow Roots must be survivable with zero tactics
    localStorage.setItem("bardstale.save.v1", JSON.stringify(d));
    return (d.party as unknown[]).length;
  });
  expect(partySize).toBeGreaterThanOrEqual(3);

  await page.reload(); // app rehydrates the seeded save and recomputes max HP/SP from level
  const before = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}");
    return { total: (d.gold ?? 0) + (d.bank ?? 0), runs: d.runs?.["hollow-roots"] ?? 0 };
  });

  await page.goto("/#/gate");
  await page.getByRole("button", { name: "Enter the Gate" }).first().click();
  const cards = page.locator(".omen-list button");
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".omen-badge")).toHaveCount(1); // the tavern-promised ambient card is marked
  await cards.first().click(); // always the ambient omen — deterministic under the pinned clock
  await expect(page).toHaveURL(/#\/dungeon/);

  await page.locator(".auto-btn").click();
  const actions: string[] = [];
  const deadline = Date.now() + 240_000;
  for (;;) {
    const s = await step(page);
    if (s.action !== "wait") actions.push(s.action);
    if (s.action === "back-to-town") break;
    expect(s.action, `party was wiped despite level-9 seeding: ${actions.join(",")}`).not.toBe("DEFEAT");
    expect(Date.now(), `run never surfaced after 240s of walking: ${actions.join(",")}`).toBeLessThan(deadline);
    await page.waitForTimeout(350);
  }

  await expect(page).toHaveURL(/#\/town/);
  const after = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}");
    return { total: (d.gold ?? 0) + (d.bank ?? 0), runs: d.runs?.["hollow-roots"] ?? 0, hps: (d.party as { hp: number }[]).map((p) => p.hp) };
  });
  expect(after.runs).toBe(before.runs + 1); // the completion counter ticked exactly once
  expect(after.total).toBeGreaterThan(before.total); // loot beat any gate fee — a surfaced run always nets gold
  expect(after.hps.some((hp) => hp > 0)).toBe(true); // partial knockdowns are legal mid-run; a full wipe ends at Stumble Home, never here

  // the loop's fingerprints: it fought, claimed, and had to re-arm the walker at least once
  expect(actions.filter((a) => a === "quick-resolve").length).toBeGreaterThan(0);
  expect(actions.filter((a) => a === "claim").length).toBeGreaterThan(0);
});
