import { expect, test, type Page } from "@playwright/test";

// Each test gets a fresh context, so localStorage starts empty: first boot shows the tour.
async function dismissTour(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Skip tour" });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await expect(page.locator(".tour-overlay")).toHaveCount(0);
  }
}

async function descend(page: Page): Promise<void> {
  await page.goto("/#/gate");
  await page.getByRole("button", { name: "Enter the Gate" }).first().click();
  await page.getByRole("button", { name: "Descend", exact: true }).click();
  await expect(page).toHaveURL(/#\/dungeon/);
}

test("fresh boot shows title, tour appears on New Game and stays dismissed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hollow Vale");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome tour" })).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.locator(".tour-overlay")).toHaveCount(0);

  // Skip commits tourSeen through the 300ms debounced writer; wait for the flush
  await expect
    .poll(async () => {
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}"));
      return saved.tourSeen === true;
    }, { timeout: 3000 })
    .toBe(true);

  await page.reload(); // with a save present the app boots straight into town
  await expect(page.locator(".tour-overlay")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Temple" }).first()).toBeVisible();
});

test("gate flow descends into the dungeon and exposes touch controls", async ({ page }) => {
  await page.goto("/#/town");
  await dismissTour(page);
  await descend(page);
  await expect(page.getByRole("heading", { name: "The Depths" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forward" })).toBeEnabled();
});

test("auto-walk button toggles between Auto-Walk and Halt", async ({ page }) => {
  await descend(page);
  const auto = page.locator(".auto-btn");
  await expect(auto).toHaveAccessibleName("Auto-Walk");
  await auto.click();
  // the click synchronously flips running=true; an early encounter may halt it again,
  // so poll for the pressed state having been observed rather than a stable end state.
  await expect
    .poll(async () => (await auto.getAttribute("aria-pressed")) === "true", { timeout: 2000 })
    .toBe(true);
});

test("run survives reload: dungeon route and active gate persist", async ({ page }) => {
  await descend(page);
  await page.getByRole("button", { name: "Forward" }).click();
  // persistence is debounced ~300ms; poll until the run hits localStorage
  await expect
    .poll(async () => {
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bardstale.save.v1") ?? "{}"));
      return !!saved.activeGate;
    }, { timeout: 3000 })
    .toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/#\/dungeon/);
  await expect(page.getByRole("heading", { name: "The Depths" })).toBeVisible();
});

test("settings modal toggles high contrast on the document body", async ({ page }) => {
  await page.goto("/#/town");
  await dismissTour(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  const hc = page.getByRole("checkbox", { name: /High Contrast/ });
  await expect(hc).toBeVisible();
  await hc.click();
  await expect(page.locator("body")).toHaveClass(/(^|\s)hc(\s|$)/);
});
