import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your kitchen, collected." }),
  ).toBeVisible();
});

test("works without the newer clone and UUID APIs used by early iOS 15", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.structuredClone = undefined;
    crypto.randomUUID = undefined;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your kitchen, collected." }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Shop", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Add an everyday item" })
    .fill("Oats");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Oats Added by you" }),
  ).toBeVisible();
});

const nav = (page, name) =>
  page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name, exact: true });
async function saved(page) {
  await page.getByRole("button", { name: "Settings and backups" }).click();
  await expect(page.locator("[data-storage-label]")).toHaveText(
    "Saved on this device",
  );
}

test("add a recipe with original text and equipment, scale it, then reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add recipe", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Paste a recipe" })
    .fill(
      "Family rice\nServes 2\n\nIngredients\n100 g rice\n200 ml water\n\nMethod\n1. Rinse the rice.\n2. Simmer gently for 12 minutes.",
    );
  await page.getByRole("button", { name: "Review recipe" }).click();
  await page
    .getByRole("textbox", { name: "Required tools" })
    .fill("Saucepan\nSieve");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(
    page.getByRole("heading", { name: "Family rice" }),
  ).toBeVisible();
  await expect(page.getByText("Saucepan", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "More servings", exact: true })
    .click();
  await expect(page.getByText("150 g", { exact: true })).toBeVisible();
  await saved(page);
  await page.reload();
  await nav(page, "Recipes").click();
  await page
    .getByRole("button", { name: /Your collection Family rice/ })
    .click();
  await expect(page.getByText("150 g", { exact: true })).toBeVisible();
  await expect(page.getByText("Sieve", { exact: true })).toBeVisible();
  await page.getByText("Original recipe", { exact: true }).click();
  await expect(page.locator("pre")).toContainText("100 g rice");
});

test("meal shopping merges contributions, remains idempotent, and unchecks changed quantities", async ({
  page,
}) => {
  await nav(page, "Meals").click();
  await page.getByRole("button", { name: "Open meal", exact: true }).click();
  await page.getByRole("button", { name: "Shop meal", exact: true }).click();
  await page.getByRole("button", { name: /Add \d+ items to list/ }).click();
  const oil = page.locator(".k-check-row").filter({ hasText: "Olive oil" });
  await expect(oil).toHaveCount(1);
  await expect(oil).toContainText("45 ml");
  await oil.getByRole("checkbox").check();
  await nav(page, "Meals").click();
  await page.getByRole("button", { name: "Open meal", exact: true }).click();
  await page.getByRole("button", { name: "Shop meal", exact: true }).click();
  await page.getByRole("button", { name: /Add \d+ items to list/ }).click();
  await expect(oil).toContainText("45 ml");
  await expect(oil.getByRole("checkbox")).toBeChecked();
  await nav(page, "Meals").click();
  await page.getByRole("button", { name: "Open meal", exact: true }).click();
  await page
    .getByRole("button", { name: "More portions of Lemon & chickpea orzo" })
    .click();
  await page
    .getByRole("button", { name: "More portions of Lemon & chickpea orzo" })
    .click();
  await page.getByRole("button", { name: "Shop meal", exact: true }).click();
  await page.getByRole("button", { name: /Add \d+ items to list/ }).click();
  await expect(oil).toContainText("60 ml");
  await expect(oil.getByRole("checkbox")).not.toBeChecked();
  await saved(page);
  await page.reload();
  await nav(page, "Shop").click();
  await expect(oil).toContainText("60 ml");
});

test("cooking progress and a paused timer survive navigation and reload", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: /Weeknight Lemon & chickpea orzo/ })
    .click();
  await page.getByRole("button", { name: "Start cooking" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Start 2-minute timer" }).click();
  await page
    .getByRole("button", { name: "Pause Toast the orzo timer" })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume Toast the orzo timer" }),
  ).toBeVisible();
  await saved(page);
  await page.reload();
  await nav(page, "Recipes").click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText("Step 2 of 4", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume Toast the orzo timer" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Toast the orzo timer" })
    .click();
  await expect(page.locator(".k-timer")).toHaveCount(0);
});

test("backup export and deliberate restore keep data, invalid files leave it intact", async ({
  page,
}) => {
  await nav(page, "Shop").click();
  await page
    .getByRole("textbox", { name: "Add an everyday item" })
    .fill("Coffee");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await saved(page);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadEvent;
  const file = await download.path();
  await page.locator("#k-restore-file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"state":{}}'),
  });
  await expect(page.getByRole("status")).toContainText(
    "not a valid Kooks mobile backup",
  );
  await page.locator("#k-restore-file").setInputFiles(file);
  await expect(page.getByText("Replace this device’s cookbook?")).toBeVisible();
  await page
    .getByRole("button", { name: "Replace cookbook", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Your cookbook has been restored.",
  );
  await nav(page, "Shop").click();
  await expect(
    page.getByRole("checkbox", { name: "Coffee Added by you" }),
  ).toBeVisible();
});

test("phone and tablet views fit the viewport, including settings and cooking", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Settings and backups" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
