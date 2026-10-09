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
    .getByRole("button", { name: /Main Lemon & chickpea orzo/ })
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

test("links and videos save with a recipe, play on request and survive a reload", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: /Main Lemon & chickpea orzo/ })
    .click();
  await page.getByRole("button", { name: "Edit recipe" }).click();
  const links = page.getByRole("textbox", { name: "Links and videos" });
  await links.fill("just words");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.locator("#k-editor-error")).toContainText("just words");
  await links.fill(
    "https://youtu.be/dQw4w9WgXcQ Watch the method\nexample.com/orzo The written version",
  );
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(
    page.getByRole("heading", { name: "Lemon & chickpea orzo" }),
  ).toBeVisible();
  const play = page.getByRole("button", {
    name: "Play Watch the method on YouTube",
  });
  await expect(play).toBeVisible();
  await expect(
    page.getByRole("link", { name: "The written version" }),
  ).toHaveAttribute("href", "https://example.com/orzo");
  await expect(page.locator(".k-embed iframe")).toHaveCount(0);
  await play.click();
  await expect(page.locator(".k-embed iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
  );
  await saved(page);
  await page.reload();
  await nav(page, "Recipes").click();
  await page
    .getByRole("button", { name: /Main Lemon & chickpea orzo/ })
    .click();
  await expect(play).toBeVisible();
  await page.getByRole("button", { name: "Start cooking" }).click();
  await expect(
    page.getByRole("link", { name: "Watch the method" }),
  ).toHaveAttribute("href", "https://youtu.be/dQw4w9WgXcQ");
});

test("course, diet and tag filters narrow the library and the editor keeps the facets", async ({
  page,
}) => {
  const card = (name) => page.locator(".k-recipe-card", { hasText: name });
  const row = (label) => page.locator(".k-facet-row", { hasText: label });
  await expect(card("Lemon & chickpea orzo")).toContainText("Mediterranean");
  await row("Course")
    .getByRole("button", { name: "Main", exact: true })
    .click();
  await expect(card("Lemon & chickpea orzo")).toHaveCount(1);
  await expect(card("Roasted tomato pasta")).toHaveCount(1);
  await expect(card("Red lentil soup")).toHaveCount(0);
  await row("Tags")
    .getByRole("button", { name: "One pot", exact: true })
    .click();
  await expect(card("Lemon & chickpea orzo")).toHaveCount(1);
  await expect(card("Roasted tomato pasta")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(card("Red lentil soup")).toHaveCount(1);
  await row("Diet")
    .getByRole("button", { name: "Gluten-free", exact: true })
    .click();
  await expect(card("Crispy potatoes & tahini")).toHaveCount(1);
  await expect(card("The everyday chopped salad")).toHaveCount(1);
  await expect(card("Lemon & chickpea orzo")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByRole("button", { name: /Main Lemon & chickpea orzo/ })
    .click();
  await expect(page.locator(".k-detail-facets")).toContainText("Mediterranean");
  await page.getByRole("button", { name: "Edit recipe" }).click();
  await expect(page.getByLabel("Course")).toHaveValue("main");
  await expect(page.getByLabel("Cuisine")).toHaveValue("Mediterranean");
  await expect(page.getByLabel("Vegan", { exact: true })).toBeChecked();
  await page.getByLabel("Course").selectOption("soup");
  await page
    .getByLabel("Tags · separated by commas")
    .fill("Weeknight, Shabbat");
  await page.getByLabel("Gluten-free", { exact: true }).check();
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(
    page.getByRole("heading", { name: "Lemon & chickpea orzo" }),
  ).toBeVisible();
  await expect(page.locator(".k-detail-facets")).toContainText("Shabbat");
  await expect(page.locator(".k-detail-facets")).toContainText("Gluten-free");
  await saved(page);
  await page.reload();
  await nav(page, "Recipes").click();
  await expect(
    page.getByRole("button", { name: /Soup Lemon & chickpea orzo/ }),
  ).toBeVisible();
  await row("Tags")
    .getByRole("button", { name: "Shabbat", exact: true })
    .click();
  await expect(card("Lemon & chickpea orzo")).toHaveCount(1);
  await expect(card("Red lentil soup")).toHaveCount(0);
});

test("the finished view leads back to the recipe", async ({ page }) => {
  await page
    .getByRole("button", { name: /Main Lemon & chickpea orzo/ })
    .click();
  await page.getByRole("button", { name: "Start cooking" }).click();
  for (let step = 1; step < 4; step++)
    await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Finish cooking" }).click();
  await expect(
    page.getByRole("heading", { name: "That’s a keeper." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /Lemon & chickpea orzo/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start cooking" }),
  ).toBeVisible();
});
