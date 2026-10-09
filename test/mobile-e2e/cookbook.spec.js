import { test, expect } from "@playwright/test";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });
// A tab's accessible name may carry its badge ("Cook 1 active"), so the
// name is matched as a prefix inside the navigation landmark.
const nav = (page, name) =>
  page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: new RegExp(`^${name}\\b`) });
// The settings gear opens the Backup section, which shows the storage state.
async function saved(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("[data-storage-label]")).toHaveText(
    "Saved on this device",
  );
}
const openRecipe = (page, title) =>
  page.getByRole("button", { name: title, exact: true }).click();
// Cook, Shop and Plan are both page actions and tabs, so page actions are
// looked up inside the main landmark.
const action = (page, name) =>
  page.getByRole("main").getByRole("button", { name, exact: true });

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/");
  await expect(h1(page, "Today")).toBeVisible();
});

test("works without the newer clone and UUID APIs used by early iOS 15", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.structuredClone = undefined;
    crypto.randomUUID = undefined;
  });
  await page.reload();
  await expect(h1(page, "Today")).toBeVisible();
  await nav(page, "Shop").click();
  await page
    .getByRole("textbox", { name: "Add an everyday item" })
    .fill("Oats");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Oats Added by you" }),
  ).toBeVisible();
});

test("add a recipe with original text and equipment, scale it, then reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add recipe", exact: true }).click();
  await expect(h1(page, "Add a recipe")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Paste a recipe" })
    .fill(
      "Family rice\nServes 2\n\nIngredients\n100 g rice\n200 ml water\n\nMethod\n1. Rinse the rice.\n2. Simmer gently for 12 minutes.",
    );
  await page.getByRole("button", { name: "Review recipe" }).click();
  await expect(h1(page, "Review draft")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Required tools" })
    .fill("Saucepan\nSieve");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(h1(page, "Family rice")).toBeVisible();
  await expect(page.getByText("Saucepan", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "More servings", exact: true })
    .click();
  await expect(page.getByText("150 g", { exact: true })).toBeVisible();
  await saved(page);
  await page.reload();
  await nav(page, "Recipes").click();
  await openRecipe(page, "Family rice");
  await expect(page.getByText("150 g", { exact: true })).toBeVisible();
  await expect(page.getByText("Sieve", { exact: true })).toBeVisible();
  await page.getByText("Original recipe", { exact: true }).click();
  await expect(page.locator("pre")).toContainText("100 g rice");
});

test("meal shopping merges contributions, remains idempotent, and unchecks changed quantities", async ({
  page,
}) => {
  const openMeal = async () => {
    await nav(page, "Plan").click();
    await page.getByRole("button", { name: "Meals", exact: true }).click();
    await page.getByRole("button", { name: "Open meal", exact: true }).click();
  };
  await openMeal();
  await page.getByRole("button", { name: "Shop meal", exact: true }).click();
  await expect(h1(page, "Add to shopping list")).toBeVisible();
  await page.getByRole("button", { name: /Add \d+ items to list/ }).click();
  await expect(h1(page, "Shop")).toBeVisible();
  const oil = page.locator(".list-item").filter({ hasText: "Olive oil" });
  await expect(oil).toHaveCount(1);
  await expect(oil).toContainText("45 ml");
  await oil.getByRole("checkbox").check();
  await openMeal();
  await page.getByRole("button", { name: "Shop meal", exact: true }).click();
  await page.getByRole("button", { name: /Add \d+ items to list/ }).click();
  await expect(oil).toContainText("45 ml");
  await expect(oil.getByRole("checkbox")).toBeChecked();
  await openMeal();
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
  await nav(page, "Recipes").click();
  await openRecipe(page, "Lemon & chickpea orzo");
  await action(page, "Cook").click();
  await expect(page.getByText("Step 1 of 4", { exact: true })).toBeVisible();
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
  // The Cook tab carries a badge while something is on the stove.
  await expect(nav(page, "Cook")).toContainText("1");
  await nav(page, "Cook").click();
  await expect(page.getByText("Step 2 of 4", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume Toast the orzo timer" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Toast the orzo timer" })
    .click();
  await expect(page.locator(".timer")).toHaveCount(0);
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
  await page.locator("#restore-file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"state":{}}'),
  });
  await expect(page.getByRole("status")).toContainText(
    "not a valid Kooks mobile backup",
  );
  await page.locator("#restore-file").setInputFiles(file);
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
  const fits = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ["Today", "Recipes", "Plan", "Shop", "Cook"]) {
      await nav(page, tab).click();
      expect(await fits(), `${tab} at ${width}px`).toBe(true);
    }
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    expect(await fits(), `Settings at ${width}px`).toBe(true);
    // Phones get bottom tabs; desktops get the sidebar. Never both.
    await expect(page.locator(".tabbar")).toBeVisible({
      visible: width < 840,
    });
    await expect(page.locator(".sidebar")).toBeVisible({
      visible: width >= 840,
    });
  }
});

test("links and videos save with a recipe, play on request and survive a reload", async ({
  page,
}) => {
  await nav(page, "Recipes").click();
  await openRecipe(page, "Lemon & chickpea orzo");
  await page.getByRole("button", { name: "Edit recipe" }).click();
  // Links are a secondary field, folded away until the recipe has some.
  await page.getByText("Links and videos", { exact: true }).click();
  const links = page.getByRole("textbox", { name: "Links and videos" });
  await links.fill("just words");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.locator("#editor-error")).toContainText("just words");
  await links.fill(
    "https://youtu.be/dQw4w9WgXcQ Watch the method\nexample.com/orzo The written version",
  );
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(h1(page, "Lemon & chickpea orzo")).toBeVisible();
  const play = page.getByRole("button", {
    name: "Play Watch the method on YouTube",
  });
  await expect(play).toBeVisible();
  await expect(
    page.getByRole("link", { name: "The written version" }),
  ).toHaveAttribute("href", "https://example.com/orzo");
  await expect(page.locator(".embed iframe")).toHaveCount(0);
  await play.click();
  await expect(page.locator(".embed iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
  );
  await saved(page);
  await page.reload();
  await nav(page, "Recipes").click();
  await openRecipe(page, "Lemon & chickpea orzo");
  await expect(play).toBeVisible();
  await action(page, "Cook").click();
  await expect(
    page.getByRole("link", { name: "Watch the method" }),
  ).toHaveAttribute("href", "https://youtu.be/dQw4w9WgXcQ");
});

test("course, diet and tag filters narrow the library and the editor keeps the facets", async ({
  page,
}) => {
  const card = (name) => page.locator(".recipe-card", { hasText: name });
  const row = (label) => page.locator(".facet-row", { hasText: label });
  await nav(page, "Recipes").click();
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
  await openRecipe(page, "Lemon & chickpea orzo");
  await expect(page.locator(".detail-facets")).toContainText("Mediterranean");
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
  await expect(h1(page, "Lemon & chickpea orzo")).toBeVisible();
  await expect(page.locator(".detail-facets")).toContainText("Shabbat");
  await expect(page.locator(".detail-facets")).toContainText("Gluten-free");
  await saved(page);
  await page.reload();
  await nav(page, "Recipes").click();
  await expect(card("Lemon & chickpea orzo")).toContainText("Soup");
  await row("Tags")
    .getByRole("button", { name: "Shabbat", exact: true })
    .click();
  await expect(card("Lemon & chickpea orzo")).toHaveCount(1);
  await expect(card("Red lentil soup")).toHaveCount(0);
});

test("the finished view leads back to the recipe", async ({ page }) => {
  await nav(page, "Recipes").click();
  await openRecipe(page, "Lemon & chickpea orzo");
  await action(page, "Cook").click();
  for (let step = 1; step < 4; step++)
    await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Finish cooking" }).click();
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();
  await expect(h1(page, "Lemon & chickpea orzo")).toBeVisible();
  await page.getByRole("button", { name: "Recipe", exact: true }).click();
  await expect(h1(page, "Lemon & chickpea orzo")).toBeVisible();
  await expect(action(page, "Cook")).toBeVisible();
});
