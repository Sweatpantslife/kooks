import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// The Week tab of the redesigned app, against the server without sign-in.
// Other suites share this database, so every name carries this run's tag.
const origin = "http://127.0.0.1:4318";
const tag = `W${Date.now().toString(36)}`;
let seq = 0;

async function call(request, name, input) {
  const response = await request.post(`${origin}/api/tools/${name}`, {
    headers: { Origin: origin },
    data: { request_id: `${tag}-${seq++}`, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

// The browser and these tests share the computer's time zone.
const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return fmt(d);
};
// The Monday of this week, plus a number of days.
const monday = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset);
  return fmt(d);
};
const weekday = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
  });

const recipe = (title, extra = {}) => ({
  recipe: {
    title: `${title} ${tag}`,
    servings: 4,
    ingredients: [{ quantity: 1, unit: "", name: "onion", preparation: "" }],
    steps: [{ text: "Cook." }],
    ...extra,
  },
});

let soup, stew, salad, meal;
test.beforeAll(async ({ request }) => {
  soup = (
    await call(request, "recipe_save", recipe("Soup", { course: "soup" }))
  ).record;
  stew = (await call(request, "recipe_save", recipe("Stew"))).record;
  salad = (await call(request, "recipe_save", recipe("Salad"))).record;
  meal = (
    await call(request, "meal_save", {
      meal: {
        title: `Friday supper ${tag}`,
        dishes: [
          { recipe_id: stew.id, label: "Main" },
          { recipe_id: salad.id, label: "Side" },
        ],
      },
    })
  ).record;
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

async function expectAccessible(page, label) {
  expect(await scan(page, label)).toEqual([]);
}

const title = (page) => page.getByRole("heading", { level: 1 });
const toast = (page) => page.locator(".toast-region");
const dayCard = (page, date) => page.locator(`[aria-labelledby="day-${date}"]`);

test("a dish is added to today, moved to tomorrow, and taken off with Undo", async ({
  page,
}) => {
  const today = day(),
    tomorrow = day(1);
  await page.goto("/next/#/week");
  await expect(title(page)).toHaveText("This week");
  await expect(dayCard(page, today)).toContainText("Today");
  await dayCard(page, today)
    .getByRole("link", { name: `Add to ${weekday(today)}` })
    .click();
  await expect(title(page)).toHaveText(`Add to ${weekday(today)}`);
  await expect(title(page)).toBeFocused();
  await page.getByRole("radio", { name: "Lunch" }).check();
  await page
    .getByRole("searchbox", { name: "Search recipes and meals" })
    .fill(`soup ${tag}`);
  await expect(page.getByRole("status").first()).toHaveText("1 choice");
  await expectAccessible(page, "Add to a day");
  await page.getByRole("button", { name: new RegExp(`^Soup ${tag}`) }).click();

  await expect(title(page)).toHaveText("This week");
  await expect(toast(page)).toContainText(
    `Soup ${tag} is on ${weekday(today)}.`,
  );
  const item = dayCard(page, today)
    .getByRole("listitem")
    .filter({ hasText: `Soup ${tag}` });
  await expect(item).toContainText("Lunch · Serves 4");
  await expectAccessible(page, "Week");

  await item
    .getByRole("link", { name: `Move Soup ${tag} to another day` })
    .click();
  await expect(title(page)).toHaveText("Move to which day?");
  await expect(page.getByRole("radio", { name: "Lunch" })).toBeChecked();
  await expectAccessible(page, "Move");
  await page.getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(toast(page)).toContainText(
    `Soup ${tag} is on ${weekday(tomorrow)}.`,
  );
  const moved = dayCard(page, tomorrow)
    .getByRole("listitem")
    .filter({ hasText: `Soup ${tag}` });
  await expect(moved).toBeVisible();
  await expect(dayCard(page, today)).not.toContainText(`Soup ${tag}`);

  await moved
    .getByRole("button", {
      name: `Remove Soup ${tag} from ${weekday(tomorrow)}`,
    })
    .click();
  await expect(toast(page)).toContainText(
    `Soup ${tag} is off ${weekday(tomorrow)}.`,
  );
  await expect(moved).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(toast(page)).toContainText("Undone.");
  await expect(moved).toBeVisible();
});

test("a recipe or a meal is planned from its own page", async ({ page }) => {
  const today = day();
  await page.goto(`/next/#/recipes/${encodeURIComponent(stew.id)}`);
  await page.getByRole("link", { name: "Add to the week" }).click();
  await expect(title(page)).toHaveText("Which day?");
  await expect(page.getByRole("radio", { name: "Dinner" })).toBeChecked();
  await page.getByRole("button", { name: /^Today/ }).click();
  // Back on the recipe, which is where the person was.
  await expect(title(page)).toHaveText(`Stew ${tag}`);
  await expect(toast(page)).toContainText(
    `Stew ${tag} is on ${weekday(today)}.`,
  );

  await page.goto(`/next/#/recipes/meal/${encodeURIComponent(meal.id)}`);
  await page.getByRole("link", { name: "Add to the week" }).click();
  await page.getByRole("button", { name: /^Today/ }).click();
  await expect(title(page)).toHaveText(`Friday supper ${tag}`);

  await page.getByRole("link", { name: "Week", exact: true }).first().click();
  const card = dayCard(page, today);
  await expect(
    card.getByRole("listitem").filter({ hasText: `Friday supper ${tag}` }),
  ).toContainText(`Dinner · Stew ${tag} + Salad ${tag}`);
  await card.getByRole("link", { name: `Stew ${tag}`, exact: true }).click();
  await expect(title(page)).toHaveText(`Stew ${tag}`);
});

test("leftovers set aside for a day show on it", async ({ page, request }) => {
  const batch = (
    await call(request, "batch_create", {
      recipe_id: soup.id,
      portions: 4,
      cooked_on: day(),
    })
  ).record;
  await call(request, "batch_allocate", {
    id: batch.id,
    expected_version: batch.version,
    allocation: { portions: 2, date: day(), slot: "Lunch" },
  });
  // Today is always on this week's page; tomorrow may be next week's.
  await page.goto("/next/#/week");
  await expect(
    dayCard(page, day())
      .getByRole("listitem")
      .filter({ hasText: "Leftovers" })
      .filter({ hasText: `Soup ${tag}` }),
  ).toContainText("Lunch · 2 portions");
});

test("the weeks page forward and back, and each has its own address", async ({
  page,
}) => {
  await page.goto("/next/#/week");
  await page.getByRole("link", { name: "Next week" }).click();
  await expect(title(page)).toHaveText("Next week");
  await expect(page).toHaveURL(new RegExp(`#/week/${monday(7)}$`));
  await page.getByRole("link", { name: "Next week" }).click();
  await expect(title(page)).toHaveText(/^Week of /);
  await page.getByRole("link", { name: "This week", exact: true }).click();
  await expect(title(page)).toHaveText("This week");
  await page.getByRole("link", { name: "Previous week" }).click();
  await expect(title(page)).toHaveText("Last week");
  await expect(page).toHaveURL(new RegExp(`#/week/${monday(-7)}$`));
  await expect(page).toHaveTitle(/^Week of .+ · Kooks$/);
});
