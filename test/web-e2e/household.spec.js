import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// The browser app against web/server.js with a fresh database per run. Tests
// run serially on one worker and share the database, so every record carries
// a per-run suffix and tests only assert on records they created.
const run = Date.now().toString(36);
const title = (name) => `${name} ${run}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Seeds go straight to the HTTP API; call page.reload() afterwards because the
// client only notices other writers on its next poll.
async function seed(request, baseURL, name, input) {
  const response = await request.post(`${baseURL}/api/tools/${name}`, {
    data: { request_id: crypto.randomUUID(), ...input },
    headers: { Origin: baseURL },
  });
  expect(response.ok(), `${name}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
const recipe = (name, overrides = {}) => ({
  title: title(name),
  servings: 4,
  ingredients: [
    { name: "Olive oil", quantity: 30, unit: "mL" },
    { name: "Orzo", quantity: 250, unit: "g" },
  ],
  steps: [{ text: "Toast the orzo." }, { text: "Simmer until tender." }],
  ...overrides,
});
const h1 = (page, name) => page.getByRole("heading", { level: 1, name });

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/#/today");
  await expect(h1(page, "Today")).toBeVisible();
});

test("paste a recipe, review the draft, save it, rescale and read the original", async ({
  page,
}) => {
  const name = title("Family rice");
  await page.getByRole("link", { name: "Add recipe" }).click();
  await expect(h1(page, "Add a recipe")).toBeVisible();
  await page
    .getByLabel("Recipe text")
    .fill(
      `${name}\nServes 2\n\nIngredients\n100 g rice\n200 ml water\n\nMethod\nRinse the rice.\n\nSimmer gently.`,
    );
  await page.getByRole("button", { name: "Review pasted recipe" }).click();
  await expect(h1(page, "Review draft")).toBeVisible();
  await expect(page.getByLabel("Ingredients · one per line")).toHaveValue(
    /100 g rice/,
  );
  await page
    .getByLabel(
      "I checked the ingredients, amounts and method against the original.",
    )
    .check();
  await page.getByRole("button", { name: "Save reviewed recipe" }).click();
  await expect(h1(page, name)).toBeVisible();
  const rice = page.locator(".ingredient", { hasText: "rice" });
  await expect(rice).toContainText("100 g");
  const servings = page.locator('form[data-form="servings"]');
  await servings.getByLabel("Portions").fill("4");
  await servings.getByRole("button", { name: "Update" }).click();
  await expect(rice).toContainText("200 g");
  await page.getByText("Original recipe and sources").click();
  await expect(page.locator("pre.source-text")).toContainText("100 g rice");
});

test("pantry, household tastes and effort filters shape today's suggestions", async ({
  page,
  request,
  baseURL,
}) => {
  const quick = recipe("Zucchini rice", {
    servings: 2,
    ingredients: [
      { name: "Zucchini", quantity: 200, unit: "g" },
      { name: "Rice", quantity: 100, unit: "g" },
    ],
    active_minutes: 10,
    total_minutes: 20,
    pan_count: 1,
    cleanup: "low",
    spice_level: 1,
  });
  const vague = recipe("Mystery stew", {
    ingredients: [{ name: "Beef", quantity: 500, unit: "g" }],
  });
  await seed(request, baseURL, "recipe_save", { recipe: quick });
  await seed(request, baseURL, "recipe_save", { recipe: vague });
  await page.reload();
  // Pantry lives under Shop; the old #/pantry address still gets there.
  await page.goto("/#/pantry");
  await expect(page).toHaveURL(/#\/shop\/pantry$/);
  await page.getByRole("link", { name: "Add ingredient" }).click();
  await page.getByLabel("Ingredient name").fill("Zucchini");
  await page.getByLabel("Use this soon").check();
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await expect(
    page.locator(".list-item", { hasText: "Zucchini" }).first(),
  ).toContainText("Use soon ✓");
  await page.goto("/#/settings/household/new");
  const person = title("Ari");
  await page.getByLabel("Name", { exact: true }).fill(person);
  await page
    .getByLabel("Likes · ingredients or tags, separated by commas")
    .fill("Rice");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { name: person })).toBeVisible();
  await page.goto("/#/today");
  await page.getByLabel(person).check();
  await page.getByRole("button", { name: "Find dinner" }).click();
  const card = page.locator(".card", { hasText: quick.title });
  await expect(card).toContainText("Use soon · Zucchini");
  await expect(card).toContainText(`${person} likes Rice`);
  await expect(card).toContainText("1 shopping gap");
  await expect(page.locator(".card", { hasText: vague.title })).toHaveCount(1);
  await page.getByText("More filters").click();
  await page.getByLabel("Hands-on minutes, at most").fill("15");
  await page.getByRole("button", { name: "Find dinner" }).click();
  await expect(page.getByText(/need effort details/)).toBeVisible();
  await expect(page.locator(".card", { hasText: vague.title })).toHaveCount(0);
  await expect(page.locator(".card", { hasText: quick.title })).toHaveCount(1);
});

test("a planned meal reviews into one shopping list without duplicating groceries", async ({
  page,
  request,
  baseURL,
}) => {
  const main = recipe("Orzo");
  const side = recipe("Salad", {
    servings: 2,
    ingredients: [
      { name: "Olive oil", quantity: 15, unit: "mL" },
      { name: "Cucumber", quantity: 1, unit: "each" },
    ],
  });
  await seed(request, baseURL, "recipe_save", { recipe: main });
  await seed(request, baseURL, "recipe_save", { recipe: side });
  const meal = title("Friday dinner");
  await page.reload();
  await page.goto("/#/plan/meals");
  await page.getByRole("link", { name: "New meal" }).click();
  await page.getByLabel("Meal name").fill(meal);
  await page.getByLabel(main.title, { exact: true }).check();
  await page.getByLabel(side.title, { exact: true }).check();
  await page.getByRole("button", { name: "Save meal" }).click();
  await expect(page.getByRole("heading", { name: meal })).toBeVisible();
  await page.goto("/#/plan");
  const monday = page.locator(".day").first();
  await monday.locator("summary").click();
  const planForm = monday.locator('form[data-form="plan"]');
  await planForm
    .getByLabel("Recipe or meal")
    .selectOption({ label: `${meal} · Meal` });
  await planForm.getByRole("button", { name: "Add to this day" }).click();
  const planned = page.locator(".list-item", { hasText: meal });
  await expect(planned).toBeVisible();
  const shopPlanned = async () => {
    await planned.getByRole("link", { name: "Shop" }).click();
    await expect(
      page.getByRole("heading", { name: /Shop for|Start a shopping list/ }),
    ).toBeVisible();
    const create = page.getByRole("button", { name: "Create shopping list" });
    if (await create.isVisible()) await create.click();
    await expect(h1(page, `Shop for ${meal}`)).toBeVisible();
    await page.getByRole("button", { name: "Add to shopping list" }).click();
    await expect(h1(page, "Shop")).toBeVisible();
  };
  await shopPlanned();
  const oil = page.locator(".list-item", { hasText: "Olive oil" });
  await expect(oil).toHaveCount(1);
  await expect(oil).toContainText("45 mL");
  await page.goto("/#/plan");
  await expect(planned).toBeVisible();
  await shopPlanned();
  await expect(oil).toHaveCount(1);
  await expect(oil).toContainText("45 mL");
  await expect(
    page
      .locator(".list-item")
      .filter({ has: page.getByText("Orzo", { exact: true }) }),
  ).toContainText("250 g");
  await page.getByRole("checkbox", { name: "Bought Olive oil" }).check();
  await expect(page.locator("#toast")).toContainText("Saved.");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Bought Olive oil" }),
  ).toBeChecked();
});

test("cooking together records progress, tasks and timers, then leftovers reach the week", async ({
  page,
  request,
  baseURL,
}) => {
  const dish = recipe("Baked orzo");
  const { record } = await seed(request, baseURL, "recipe_save", {
    recipe: dish,
  });
  const cook = title("Jo");
  await seed(request, baseURL, "member_save", { member: { name: cook } });
  await page.reload();
  await page.goto(`/#/recipes/${record.id}`);
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  await expect(h1(page, dish.title)).toBeVisible();
  await expect(page.getByText("Cooking", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 2 steps complete")).toBeVisible();
  await page.getByRole("button", { name: "Done, next step" }).click();
  await expect(page.getByText("1 of 2 steps complete")).toBeVisible();
  await page.getByLabel("New task").fill("Chop the herbs");
  await page.getByLabel("Who’s doing it?").selectOption({ label: cook });
  await page.getByRole("button", { name: "Add cooking task" }).click();
  const task = page.locator(".task", { hasText: "Chop the herbs" });
  await expect(task).toBeVisible();
  await expect(task.getByRole("combobox")).toHaveValue(/./);
  await page.getByLabel("Timer name").fill("Orzo");
  await page.getByLabel("Minutes").fill("1");
  await page.getByLabel("Who’s watching it?").selectOption({ label: cook });
  await page.getByRole("button", { name: "Start timer" }).click();
  const timer = page.locator(".timer", { hasText: "Orzo" });
  await expect(timer).toContainText(cook);
  await expect(timer.locator("[data-deadline]")).toHaveText(/0[01]:\d\d/);
  await page.getByLabel("A note about this meal").fill("Crispy top.");
  await page.getByRole("button", { name: "Finish cooking" }).click();
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();
  await expect(h1(page, dish.title)).toBeVisible();
  await page.getByRole("link", { name: "Record leftovers" }).click();
  await expect(page.getByLabel("Portions actually cooked")).toHaveValue("4");
  await page.getByRole("button", { name: "Record cooked batch" }).click();
  await expect(h1(page, dish.title)).toBeVisible();
  const allocation = page.locator('form[data-form="allocation"]');
  await allocation.getByLabel("Portions", { exact: true }).fill("2");
  await allocation.getByLabel("Meal date (optional)").fill(today());
  await allocation.getByRole("button", { name: "Allocate portions" }).click();
  await expect(page.getByText("2 portions · Lunch")).toBeVisible();
  await expect(
    page.getByText("2 portions available to allocate"),
  ).toBeVisible();
  await page.goto("/#/plan");
  await expect(
    page.locator(".list-item", { hasText: dish.title }).filter({
      hasText: "Already cooked",
    }),
  ).toBeVisible();
});

test("confirmed prices cost a recipe and a weekly budget appears under settings", async ({
  page,
  request,
  baseURL,
}) => {
  const plain = recipe("Plain rice", {
    servings: 2,
    ingredients: [{ name: "Rice", quantity: 500, unit: "g" }],
  });
  const { record } = await seed(request, baseURL, "recipe_save", {
    recipe: plain,
  });
  await page.reload();
  // Spending moved under Settings; the old address redirects.
  await page.goto("/#/spending");
  await expect(page).toHaveURL(/#\/settings\/prices$/);
  await page.getByRole("link", { name: "Add price" }).click();
  const price = page.locator('form[data-form="price"]');
  await price.getByLabel("Ingredient name").fill("Rice");
  await price.getByLabel("Package amount").fill("1");
  await price.getByLabel("Package unit").fill("kg");
  await price.getByLabel("Package price").fill("4");
  await price.getByRole("button", { name: "Save confirmed price" }).click();
  await expect(
    page
      .locator("tbody tr")
      .filter({ has: page.getByRole("cell", { name: "Rice", exact: true }) })
      .first(),
  ).toContainText("$4.00");
  await page.getByText(/this week’s budget/).click();
  await page.getByLabel(/^Budget \(/).fill("10");
  await page.getByRole("button", { name: "Save weekly budget" }).click();
  await expect(
    page.locator("p").filter({ hasText: /^Weekly budget/ }),
  ).toContainText("$10.00");
  await page.reload();
  await page.goto(`/#/recipes/${record.id}`);
  const cost = page.locator(".panel", { hasText: "Estimated ingredient cost" });
  await expect(cost).toContainText("$2.00");
  await expect(cost).toContainText("$1.00 per portion");
});

test("cooking notes and preferred variations stay attached to the original", async ({
  page,
  request,
  baseURL,
}) => {
  const original = recipe("Lemon orzo");
  const { record } = await seed(request, baseURL, "recipe_save", {
    recipe: original,
  });
  await page.reload();
  await page.goto(`/#/recipes/${record.id}`);
  await page.getByRole("link", { name: "Add a cooking note" }).click();
  await page.getByLabel("How did it turn out?").fill("A keeper.");
  await page
    .getByLabel("What should you remember next time?")
    .fill("Less salt next time.");
  await page.getByRole("button", { name: "Save cooking note" }).click();
  await expect(h1(page, original.title)).toBeVisible();
  await expect(page.getByText("Less salt next time.").first()).toBeVisible();
  await page.getByRole("link", { name: "Make a variation" }).click();
  await expect(page.getByLabel("Recipe name")).toHaveValue(
    `${original.title} · My version`,
  );
  await page.getByRole("button", { name: "Save variation" }).click();
  await expect(h1(page, `${original.title} · My version`)).toBeVisible();
  await page.reload();
  await page.goto(`/#/recipes/${record.id}`);
  await expect(
    page.getByText(`Your preferred version: ${original.title} · My version`),
  ).toBeVisible();
});

test("the cookbook exports as a portable Kooks backup", async ({
  page,
  request,
  baseURL,
}) => {
  const kept = recipe("Exported soup");
  await seed(request, baseURL, "recipe_save", { recipe: kept });
  await page.goto("/#/settings/backup");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export cookbook" }).click();
  const download = await downloadEvent;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup.format).toBe("kooks");
  expect(backup.schema_version).toBe(2);
  expect(
    backup.records.some(
      (r) => r.kind === "recipe" && r.data.title === kept.title,
    ),
  ).toBe(true);
});

test("links and videos save with a recipe, play on request and round-trip through the editor", async ({
  page,
  request,
  baseURL,
}) => {
  const dish = recipe("Video orzo", {
    source_url: "https://youtu.be/dQw4w9WgXcQ?t=1m5s",
    links: [
      { url: "https://vimeo.com/76979871", title: "Vimeo version" },
      { url: "https://example.com/orzo", title: "The written recipe" },
    ],
  });
  const { record } = await seed(request, baseURL, "recipe_save", {
    recipe: dish,
  });
  await page.reload();
  await page.goto(`/#/recipes/${record.id}`);
  const section = page.locator(".links");
  await expect(
    section.getByRole("heading", { name: "Links and videos" }),
  ).toBeVisible();
  // A video source plays from the recipe page; nothing loads before play.
  await expect(section.locator(".embed").first()).toHaveAttribute(
    "data-src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=65&autoplay=1",
  );
  await expect(
    section.getByRole("button", { name: "Play Original source on YouTube" }),
  ).toBeVisible();
  await expect(
    section.getByRole("link", { name: "The written recipe" }),
  ).toHaveAttribute("href", "https://example.com/orzo");
  await expect(section.locator("iframe")).toHaveCount(0);
  await section
    .getByRole("button", { name: "Play Vimeo version on Vimeo" })
    .click();
  await expect(section.locator("iframe")).toHaveCount(1);
  await expect(section.locator("iframe")).toHaveAttribute(
    "src",
    "https://player.vimeo.com/video/76979871?autoplay=1",
  );
  await page.getByRole("link", { name: "Edit recipe" }).click();
  const links = page.getByLabel("Links and videos · one per line");
  await expect(links).toHaveValue(
    "https://vimeo.com/76979871 Vimeo version\nhttps://example.com/orzo The written recipe",
  );
  await links.fill("just words");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(
    page.locator('form[data-form="recipe"] [data-error]'),
  ).toContainText("just words");
  await links.fill(
    "https://example.com/orzo The written recipe\nwww.instagram.com/reel/C1abcdefg/ Folding the dough",
  );
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(h1(page, dish.title)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play Folding the dough on Instagram" }),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: /on Vimeo/ })).toHaveCount(
    0,
  );
  // The cooking snapshot keeps the links as plain links beside the steps.
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Folding the dough" }),
  ).toHaveAttribute("href", "https://www.instagram.com/reel/C1abcdefg/");
});

test("every section fits phone, tablet and desktop widths without sideways scrolling", async ({
  page,
}) => {
  const routes = [
    "today",
    "recipes",
    "recipes/add",
    "techniques",
    "inspiration",
    "library",
    "plan",
    "plan/meals",
    "plan/leftovers",
    "shop",
    "shop/pantry",
    "cook",
    "settings/household",
    "settings/prices",
    "settings/preferences",
  ];
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(`/#/${route}`);
      await expect(page.locator("h1.page-title")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBe(true);
    }
    // Phones get bottom tabs; desktops get the sidebar. Never both.
    await expect(page.locator(".tabbar")).toBeVisible({
      visible: width < 840,
    });
    await expect(page.locator(".sidebar")).toBeVisible({
      visible: width >= 840,
    });
  }
});

test("courses, cuisines, diet labels and tags filter the cookbook and round-trip through the editor", async ({
  page,
  request,
  baseURL,
}) => {
  const orzo = recipe("Weeknight orzo", {
    course: "main",
    cuisine: "Italian",
    diets: ["vegan"],
    tags: ["Weeknight", "One pot"],
    total_minutes: 25,
  });
  const salad = recipe("Chopped salad", {
    course: "salad",
    cuisine: "Israeli",
    diets: ["vegan", "gluten_free"],
    tags: ["No cook"],
  });
  const stew = recipe("Slow stew", { tags: ["Weekend"] });
  for (const item of [orzo, salad, stew])
    await seed(request, baseURL, "recipe_save", { recipe: item });
  await page.reload();
  await page.goto("/#/recipes");
  const card = (name) => page.locator(".card", { hasText: name });
  const filters = page.getByLabel("Recipe filters");
  const row = (label) => filters.locator(".facet-row", { hasText: label });
  await expect(card(orzo.title)).toContainText("Main");
  await expect(card(stew.title)).toContainText("Your collection");
  await row("Course")
    .getByRole("button", { name: "Main", exact: true })
    .click();
  await expect(card(orzo.title)).toHaveCount(1);
  await expect(card(salad.title)).toHaveCount(0);
  await expect(card(stew.title)).toHaveCount(0);
  await expect(page.getByText(/without a course recorded/)).toBeVisible();
  await filters.getByRole("button", { name: "Clear filters" }).click();
  await expect(card(salad.title)).toHaveCount(1);
  // Every chosen diet label must be present.
  await row("Diet").getByRole("button", { name: "Vegan", exact: true }).click();
  await expect(card(orzo.title)).toHaveCount(1);
  await expect(card(salad.title)).toHaveCount(1);
  await expect(card(stew.title)).toHaveCount(0);
  await row("Diet")
    .getByRole("button", { name: "Gluten-free", exact: true })
    .click();
  await expect(card(orzo.title)).toHaveCount(0);
  await expect(card(salad.title)).toHaveCount(1);
  await filters.getByRole("button", { name: "Clear filters" }).click();
  // A chip on a card narrows the cookbook to that tag.
  await card(stew.title)
    .getByRole("button", { name: "Show Weekend recipes" })
    .click();
  await expect(card(stew.title)).toHaveCount(1);
  await expect(card(orzo.title)).toHaveCount(0);
  await expect(
    row("Tags").getByRole("button", { name: "Weekend", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await filters.getByRole("button", { name: "Clear filters" }).click();
  await row("Show")
    .getByRole("button", { name: "30 minutes or less", exact: true })
    .click();
  await expect(card(orzo.title)).toHaveCount(1);
  await expect(card(salad.title)).toHaveCount(0);
  await expect(page.getByText(/without a total time recorded/)).toBeVisible();
  await filters.getByRole("button", { name: "Clear filters" }).click();
  // The editor shows the facets and offers the household's existing tags.
  await page.getByRole("link", { name: orzo.title, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show Italian recipes" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(page.getByLabel("Course")).toHaveValue("main");
  await expect(page.getByLabel("Cuisine")).toHaveValue("Italian");
  await expect(page.getByLabel("Vegan", { exact: true })).toBeChecked();
  await page.getByLabel("Gluten-free", { exact: true }).check();
  await page.getByRole("button", { name: "No cook", exact: true }).click();
  await expect(page.getByLabel("Tags, separated by commas")).toHaveValue(
    "Weeknight, One pot, No cook",
  );
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(h1(page, orzo.title)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show Gluten-free recipes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show No cook recipes" }),
  ).toBeVisible();
  // The dinner finder narrows by course as well.
  await page.goto("/#/today");
  await page.getByLabel("Course").selectOption("salad");
  await page.getByRole("button", { name: "Find dinner" }).click();
  await expect(card(salad.title)).toHaveCount(1);
  await expect(card(orzo.title)).toHaveCount(0);
});

test("techniques, ideas and books: a video technique, an idea written up as a recipe, and an uploaded cookbook", async ({
  page,
  request,
  baseURL,
}) => {
  const dish = recipe("Seared orzo");
  await seed(request, baseURL, "recipe_save", { recipe: dish });
  await page.reload();
  const technique = title("Reverse sear");
  await page.goto("/#/techniques/new");
  await page.getByLabel("Technique name").fill(technique);
  await page
    .getByLabel("Steps · separate steps with a blank line")
    .fill("Low oven first.\n\nSear last.");
  await page
    .getByLabel("Links and videos · one per line")
    .fill("https://youtu.be/dQw4w9WgXcQ Watch it");
  await page.getByLabel(dish.title).check();
  await page.getByRole("button", { name: "Add technique" }).click();
  await expect(h1(page, technique)).toBeVisible();
  // The video waits for play, exactly as on a recipe page.
  await expect(
    page.getByRole("button", { name: "Play Watch it on YouTube" }),
  ).toBeVisible();
  await expect(page.locator(".links iframe")).toHaveCount(0);
  await page.getByRole("link", { name: dish.title }).click();
  await expect(
    page.locator(".connections").getByRole("link", { name: technique }),
  ).toBeVisible();
  const idea = title("Crispy chickpea bowls");
  await page.goto("/#/inspiration/new");
  await page.getByLabel("Idea", { exact: true }).fill(idea);
  await page.getByLabel("Where it came from").fill("Noa’s dinner");
  await page.getByLabel("Notes", { exact: true }).fill("Tahini and lemon.");
  await page
    .getByLabel("Links and videos · one per line")
    .fill("www.instagram.com/reel/C1abcdefg/ The reel");
  await page.getByRole("button", { name: "Add idea" }).click();
  await expect(h1(page, idea)).toBeVisible();
  await expect(page.locator(".tag", { hasText: "Want to try" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play The reel on Instagram" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "We tried it" }).click();
  await expect(page.locator(".tag", { hasText: "Tried it" })).toBeVisible();
  await page.getByRole("link", { name: "Write it up as a recipe" }).click();
  await expect(page.getByLabel("Recipe name")).toHaveValue(idea);
  await expect(page.getByLabel("Recipe notes")).toHaveValue(
    "Tahini and lemon.",
  );
  await page.getByLabel("Ingredients · one per line").fill("400 g chickpeas");
  await page
    .getByLabel("Method · separate steps with a blank line")
    .fill("Roast until crisp.");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(h1(page, idea)).toBeVisible();
  await expect(
    page.locator(".connections").getByRole("link", { name: idea }),
  ).toBeVisible();
  await page.goto("/#/inspiration");
  await expect(page.locator(".card", { hasText: idea })).toContainText(
    "In the cookbook",
  );
  const book = title("Family cookbook");
  await page.goto("/#/library/new");
  await page.locator('input[name="file"]').setInputFiles({
    name: "family.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  });
  await page.getByLabel("Title", { exact: true }).fill(book);
  await page.getByLabel("Author").fill("Grandma");
  await page.getByRole("button", { name: "Add to shelf" }).click();
  await expect(h1(page, book)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Download PDF/ }),
  ).toHaveAttribute("href", /^\/api\/assets\/[^?]+\?download=1$/);
  await page.getByLabel("What’s there").fill("The braise");
  await page.getByLabel("Page", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Add bookmark" }).click();
  await expect(page.getByText("Page 12")).toBeVisible();
  // The PDF frame is created only when asked for, at the bookmarked page.
  await expect(page.locator(".reader iframe")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Read The braise on page 12" })
    .click();
  await expect(page.locator(".reader iframe")).toHaveAttribute(
    "src",
    /^\/api\/assets\/[^#]+#page=12$/,
  );
  await page.goto("/#/library");
  const card = page.locator(".card.book", { hasText: book });
  await expect(card).toContainText("PDF");
  await expect(card).toContainText("1 bookmark");
});

test("every page that opens from another page offers a way back to it", async ({
  page,
  request,
  baseURL,
}) => {
  const dish = recipe("Braised leeks");
  const { record: saved } = await seed(request, baseURL, "recipe_save", {
    recipe: dish,
  });
  const { record: idea } = await seed(request, baseURL, "inspiration_save", {
    inspiration: { title: title("Leeks with brown butter") },
  });
  await page.reload();
  const back = page.locator("a.back");
  // The way back names where the page was opened from: the list of its
  // section, or the record it belongs to.
  const leadsBack = async (route, label, target) => {
    await page.goto(`/#/${route}`);
    await expect(back, route).toHaveText(label);
    await expect(back, route).toHaveAttribute("href", `#/${target}`);
  };
  await leadsBack("recipes/add", "Recipes", "recipes");
  await leadsBack("recipes/new", "Recipes", "recipes");
  await leadsBack(
    `recipes/${saved.id}/edit`,
    dish.title,
    `recipes/${saved.id}`,
  );
  await leadsBack(
    `recipes/${saved.id}/variant`,
    dish.title,
    `recipes/${saved.id}`,
  );
  await leadsBack(
    `recipes/${saved.id}/memory`,
    dish.title,
    `recipes/${saved.id}`,
  );
  await leadsBack(
    `recipes/new/inspiration/${idea.id}`,
    idea.data.title,
    `inspiration/${idea.id}`,
  );
  await leadsBack("techniques/new", "Techniques", "techniques");
  await leadsBack("inspiration/new", "Ideas", "inspiration");
  await leadsBack(
    `inspiration/${idea.id}/edit`,
    idea.data.title,
    `inspiration/${idea.id}`,
  );
  await leadsBack("plan/leftovers/new", "Leftovers", "plan/leftovers");
  await leadsBack(
    `plan/leftovers/new/${saved.id}`,
    dish.title,
    `recipes/${saved.id}`,
  );
  await leadsBack(
    `shop/review/recipe/${saved.id}`,
    dish.title,
    `recipes/${saved.id}`,
  );
  // Addresses from before the redesign land on the same pages.
  await leadsBack(`edit/${saved.id}`, dish.title, `recipes/${saved.id}`);
  await leadsBack(
    `new-recipe/inspiration/${idea.id}`,
    idea.data.title,
    `inspiration/${idea.id}`,
  );
  const book = title("Shelf book");
  await page.goto("/#/library/new");
  await page.locator('input[name="file"]').setInputFiles({
    name: "shelf.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  });
  await page.getByLabel("Title", { exact: true }).fill(book);
  await page.getByRole("button", { name: "Add to shelf" }).click();
  await expect(h1(page, book)).toBeVisible();
  await expect(back).toHaveText("Books");
  const bookId = page.url().split("/").pop();
  await leadsBack(`library/${bookId}/edit`, book, `library/${bookId}`);
  // A cooking session leads back to Cook, and the leftovers form opened from
  // a finished session leads back to that session.
  await page.goto(`/#/recipes/${saved.id}`);
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  await expect(h1(page, dish.title)).toBeVisible();
  await expect(back).toHaveText("Cook");
  const session = page.url().split("/").pop();
  await page.getByRole("button", { name: "Finish cooking" }).click();
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();
  await expect(back).toHaveText("Cook");
  await page.getByRole("link", { name: "Record leftovers" }).click();
  await expect(back).toHaveText(dish.title);
  await back.click();
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();
  expect(page.url()).toContain(`#/cook/${session}`);
  await back.click();
  await expect(h1(page, "Cook")).toBeVisible();
});
