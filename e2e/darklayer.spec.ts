import { expect, test, type Page } from "@playwright/test";

// Dark-layer proof: the drone fades in as torchlight drops below DARK_WARN, a relit torch mutes it,
// and leaving the dungeon gates it off entirely — asserted through the __music inspection seam.
test.setTimeout(120_000);

const FIXED_DAY = Date.UTC(2026, 0, 5, 12); // same pinned day as fullrun: deterministic ambient omen

type MusicState = { track: string | null; dark: number };

async function music(page: Page): Promise<MusicState> {
  return page.evaluate(() => {
    const m = (window as unknown as { __music: { current(): string | null; dark(): number } }).__music;
    return { track: m.current(), dark: m.dark() };
  });
}

test("the dark layer breathes with the flame and never leaves the dungeon", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_DAY);
  await page.goto("/#/town");
  const skip = page.getByRole("button", { name: "Skip tour" });
  await skip.click().catch(() => {}); // first commit flushes the debounced writer and creates the save

  await expect
    .poll(
      async () => page.evaluate(() => JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}").party?.length ?? 0),
      { timeout: 3000 },
    )
    .toBeGreaterThan(2);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}");
    d.tourSeen = true;
    for (const p of d.party) {
      p.level = 9; // veterans: combat never threatens the walk while we watch the flame
      p.hp = 300;
    }
    d.inventory = Object.assign({}, d.inventory, { torch: 2 });
    localStorage.setItem("bardstale.save.v1", JSON.stringify(d));
  });
  await page.reload();

  await page.goto("/#/gate");
  await page.getByRole("button", { name: "Enter the Gate" }).first().click();
  await page.locator(".omen-list button").first().click(); // ambient omen under the pinned clock
  await expect(page).toHaveURL(/#\/dungeon/);

  // Lit flame (30 turns): dungeon track plays, drone silent.
  const lit = await music(page);
  expect(lit.track).toBe("dungeon");
  expect(lit.dark).toBe(0); // full flame — silent
  // the gate entry is only in memory until the debounced save lands — wait for it before editing storage
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}").activeGate?.lightTurns ?? 0), { timeout: 3000 })
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}");
    d.activeGate.lightTurns = 12;
    localStorage.setItem("bardstale.save.v1", JSON.stringify(d));
  });
  await page.reload(); // rehydrate the low-flame run; mount syncs the drone from state

  const deadline = Date.now() + 60_000;
  for (;;) {
    const m = await music(page);
    if (m.dark > 0) break;
    expect(Date.now(), "drone never faded in despite walking below DARK_WARN").toBeLessThan(deadline);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")] as HTMLButtonElement[];
      const enabled = (re: RegExp) => btns.find((b) => !b.disabled && re.test(b.textContent ?? ""));
      const qr = enabled(/Quick Resolve/);
      if (qr) return void qr.click();
      const modalBtn = [...document.querySelectorAll(".modal-card button")].find(
        (b) => !(b as HTMLButtonElement).disabled,
      ) as HTMLButtonElement | undefined;
      if (modalBtn) return void modalBtn.click(); // claim / boon picks
      const auto = document.querySelector(".auto-btn") as HTMLButtonElement | null;
      if (auto && auto.textContent?.trim() === "Auto-Walk") {
        const look = btns.find((b) => b.textContent?.trim() === "Look");
        if (look) {
          look.click();
          look.click(); // chest-ahead halt: double-Look opens, then resume
        }
        auto.click();
      }
    });
    await page.waitForTimeout(300);
  }

  const danger = await music(page);
  expect(danger.track).toBe("dungeon");
  expect(danger.dark).toBeGreaterThan(0); // intensity × volume — the drone is audible
  expect(danger.dark).toBeLessThan(1);

  // Track gating: town mutes it even while the flame down there is still dying…
  await page.goto("/#/town");
  const inTown = await music(page);
  expect(inTown.track).toBe("town");
  expect(inTown.dark).toBe(0);
  // …and re-entering reapplies the stored intensity without another step.
  await page.goto("/#/dungeon");
  const backDown = await music(page);
  expect(backDown.track).toBe("dungeon");
  expect(backDown.dark).toBeGreaterThan(0);

  // Relight: a torch restores the flame, and the drone breathes back out to silence.
  await page.getByRole("button", { name: "Item" }).click();
  const row = page.locator(".sell-row", { hasText: "Torch" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Use" }).click();
  const relit = await music(page);
  expect(relit.track).toBe("dungeon");
  expect(relit.dark).toBe(0);
});
