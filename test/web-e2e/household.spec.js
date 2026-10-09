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

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/#/today");
  await expect(
    page.getByRole("heading", { name: "What sounds good today?" }),
  ).toBeVisible();
});

test("paste a recipe, review the draft, save it, rescale and read the original", async ({
  page,
}) => {
  const name = title("Family rice");
  await page.getByRole("link", { name: "Add recipe" }).click();
  await page
    .getByLabel("Recipe text")
    .fill(
      `${name}\nServes 2\n\nIngredients\n100 g rice\n200 ml water\n\nMethod\nRinse the rice.\n\nSimmer gently.`,
    );
  await page.getByRole("button", { name: "Review pasted recipe" }).click();
  await expect(
    page.getByRole("heading", { name: "Check it, then make it yours." }),
  ).toBeVisible();
  await expect(page.getByLabel("Ingredients · one per line")).toHaveValue(
    /100 g rice/,
  );
  await page
    .getByLabel(
      "I checked the ingredients, amounts and method against the original.",
    )
    .check();
  await page.getByRole("button", { name: "Save reviewed recipe" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
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
  await page.goto("/#/pantry");
  await page.getByLabel("Ingredient name").fill("Zucchini");
  await page.getByLabel("Use this soon").check();
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await expect(
    page.locator(".list-row", { hasText: "Zucchini" }).first(),
  ).toContainText("Use soon ✓");
  await page.goto("/#/household");
  const person = title("Ari");
  await page.getByLabel("Name", { exact: true }).fill(person);
  await page
    .getByLabel("Likes · ingredients or tags, separated by commas")
    .fill("Rice");
  await page.getByRole("button", { name: "Add household member" }).click();
  await expect(page.getByRole("heading", { name: person })).toBeVisible();
  await page.goto("/#/today");
  await page.getByLabel(person).check();
  await page.getByRole("button", { name: "Find dinner" }).click();
  const card = page.locator(".card", { hasText: quick.title });
  await expect(card).toContainText("Use soon · Zucchini");
  await expect(card).toContainText(`${person} likes Rice`);
  await expect(card).toContainText("1 shopping gap");
  await expect(page.locator(".card", { hasText: vague.title })).toHaveCount(1);
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
  await page.goto("/#/meals");
  await page.getByLabel("Meal name").fill(meal);
  await page.getByLabel(main.title).check();
  await page.getByLabel(side.title).check();
  await page.getByRole("button", { name: "Save meal" }).click();
  await expect(page.getByRole("heading", { name: meal })).toBeVisible();
  await page.goto("/#/plan");
  await page.getByText("Plan something to cook").first().click();
  const planForm = page.locator('form[data-form="plan"]').first();
  await planForm
    .getByLabel("Recipe or meal")
    .selectOption({ label: `${meal} · Meal` });
  await planForm.getByRole("button", { name: "Add to this day" }).click();
  const planned = page.locator(".list-row", { hasText: meal });
  await expect(planned).toBeVisible();
  const shopPlanned = async () => {
    await planned.getByRole("link", { name: "Shop" }).click();
    await expect(
      page.getByRole("heading", { name: /Shop for|Start a shopping list/ }),
    ).toBeVisible();
    const create = page.getByRole("button", { name: "Create shopping list" });
    if (await create.isVisible()) await create.click();
    await expect(
      page.getByRole("heading", { name: `Shop for ${meal}` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Apply to shopping list" }).click();
    await expect(
      page.getByRole("heading", { name: "Pick up something good." }),
    ).toBeVisible();
  };
  await shopPlanned();
  const oil = page.locator(".list-row", { hasText: "Olive oil" });
  await expect(oil).toHaveCount(1);
  await expect(oil).toContainText("45 mL");
  await page.goto("/#/plan");
  await expect(planned).toBeVisible();
  await shopPlanned();
  await expect(oil).toHaveCount(1);
  await expect(oil).toContainText("45 mL");
  await expect(
    page
      .locator(".list-row")
      .filter({ has: page.getByText("Orzo", { exact: true }) }),
  ).toContainText("250 g");
  await page.getByRole("checkbox", { name: "Bought Olive oil" }).check();
  await expect(page.getByRole("status")).toContainText("Saved.");
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
  await page.getByRole("button", { name: "Start cooking" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: dish.title }),
  ).toBeVisible();
  await expect(page.getByText("0 of 2 steps complete")).toBeVisible();
  await page.getByRole("button", { name: "Done, next step" }).click();
  await expect(page.getByText("1 of 2 steps complete")).toBeVisible();
  await page.getByLabel("New task").fill("Chop the herbs");
  await page.getByLabel("Who’s doing it?").selectOption({ label: cook });
  await page.getByRole("button", { name: "Add cooking task" }).click();
  const task = page.locator(".task-row", { hasText: "Chop the herbs" });
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
  await expect(
    page.getByRole("heading", { name: "That’s one for the cookbook." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Record leftovers" }).click();
  await expect(page.getByLabel("Portions actually cooked")).toHaveValue("4");
  await page.getByRole("button", { name: "Record cooked batch" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: dish.title }),
  ).toBeVisible();
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
    page.locator(".list-row", { hasText: dish.title }).filter({
      hasText: "Already cooked",
    }),
  ).toBeVisible();
});

test("confirmed prices cost a recipe and a weekly budget appears on the spending page", async ({
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
  await page.goto("/#/spending");
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

test("cooking memories and preferred variations stay attached to the original", async ({
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
  await page.getByRole("link", { name: "Add a cooking memory" }).click();
  await page.getByLabel("How did it turn out?").fill("A keeper.");
  await page
    .getByLabel("What should you remember next time?")
    .fill("Less salt next time.");
  await page.getByRole("button", { name: "Save cooking memory" }).click();
  await expect(
    page.getByRole("heading", { name: original.title }),
  ).toBeVisible();
  await expect(page.getByText("Less salt next time.").first()).toBeVisible();
  await page.getByRole("link", { name: "Make a variation" }).click();
  await expect(page.getByLabel("Recipe name")).toHaveValue(
    `${original.title} · My version`,
  );
  await page.getByRole("button", { name: "Save variation" }).click();
  await expect(
    page.getByRole("heading", { name: `${original.title} · My version` }),
  ).toBeVisible();
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
