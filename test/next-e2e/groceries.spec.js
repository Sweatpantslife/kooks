import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// The Groceries tab of the redesigned app, against the server without
// sign-in. Other suites share this database and its shopping list, so every
// name carries this run's tag and checks look only for those.
const origin = "http://127.0.0.1:4318";
const tag = `G${Date.now().toString(36)}`;
let seq = 0;

async function call(request, name, input) {
  const response = await request.post(`${origin}/api/tools/${name}`, {
    headers: { Origin: origin },
    data: { request_id: `${tag}-${seq++}`, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => fmt(new Date());

const named = (name) => `${name} ${tag}`;
const ingredient = (quantity, unit, name) => ({
  quantity,
  unit,
  name: named(name),
  preparation: "",
});

let tagine;
test.beforeAll(async ({ request }) => {
  tagine = (
    await call(request, "recipe_save", {
      recipe: {
        title: named("Tagine"),
        servings: 4,
        ingredients: [
          ingredient(2, "", "carrots"),
          ingredient(1, "can", "chickpeas"),
          ingredient(1, "tsp", "cumin"),
        ],
        steps: [{ text: "Simmer." }],
      },
    })
  ).record;
  await call(request, "plan_save", {
    source: { kind: "recipe", id: tagine.id },
    date: today(),
    slot: "Dinner",
  });
  await call(request, "pantry_save", { pantry: { name: named("cumin") } });
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
const region = (page, name) => page.getByRole("region", { name });
const box = (scope, name) =>
  scope.getByRole("checkbox", { name: new RegExp(`^${named(name)}`) });

test("the week's plans are picked through and land on the list by aisle", async ({
  page,
}) => {
  await page.goto("/next/#/week");
  await page.getByRole("link", { name: "Shop for the week" }).click();
  await expect(title(page)).toHaveText("Shop for this week");
  const card = region(page, named("Tagine"));
  await expect(card).toContainText("Dinner");
  await expect(box(card, "carrots")).toBeChecked();
  // What is at home starts unticked.
  await expect(box(card, "cumin")).not.toBeChecked();
  await expect(
    card.getByRole("listitem").filter({ hasText: named("cumin") }),
  ).toContainText("At home");
  await box(card, "chickpeas").uncheck();
  await expectAccessible(page, "Shop for the week");
  await page.getByRole("button", { name: "Put them on the list" }).click();

  await expect(title(page)).toHaveText("To buy");
  await expect(toast(page)).toContainText(
    "The week’s groceries are on the list.",
  );
  const produce = region(page, "Fruit and vegetables");
  await expect(box(produce, "carrots")).toBeVisible();
  await expect(
    produce.getByRole("listitem").filter({ hasText: named("carrots") }),
  ).toContainText(`for ${named("Tagine")}`);
  await expect(page.getByText(named("chickpeas"))).toHaveCount(0);
  await expect(page.getByText(named("cumin"))).toHaveCount(0);

  // Shopping again keeps what was chosen, and adds what is ticked now.
  await page.goto("/next/#/groceries/week");
  await expect(card).toContainText("On the list");
  await expect(box(card, "chickpeas")).not.toBeChecked();
  await box(card, "chickpeas").check();
  await page.getByRole("button", { name: "Put them on the list" }).click();
  await expect(title(page)).toHaveText("To buy");
  await expect(box(region(page, "Pantry"), "chickpeas")).toBeVisible();
  await expect(box(produce, "carrots")).toHaveCount(1);

  // The whole plan can come off the list, and back with Undo.
  await page.getByText("What it’s for").click();
  await page
    .getByRole("button", { name: `Take off, ${named("Tagine")}` })
    .click();
  await expect(toast(page)).toContainText(
    `${named("Tagine")} is off the list.`,
  );
  await expect(box(page, "carrots")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(box(produce, "carrots")).toBeVisible();
});

test("groceries are added by hand, ticked into the basket and put away", async ({
  page,
}) => {
  await page.goto("/next/#/groceries");
  await expect(title(page)).toHaveText("To buy");
  const add = page.getByRole("textbox", { name: "Add to the list" });
  for (const line of [`2 ${named("lemons")}`, named("paper towels")]) {
    await add.fill(line);
    await add.press("Enter");
    await expect(add).toHaveValue("");
  }
  await expect(
    box(region(page, "Fruit and vegetables"), "lemons"),
  ).toBeVisible();
  await expect(box(region(page, "Household"), "paper towels")).toBeVisible();
  await expectAccessible(page, "To buy");

  // A ticked row moves to the basket and the keyboard stays in the list.
  await box(page, "lemons").focus();
  await page.keyboard.press("Space");
  const basket = region(page, "In the basket");
  await expect(box(basket, "lemons")).toBeChecked();
  await expect(page.locator(":focus")).toHaveAttribute("data-row", "check");
  await box(page, "paper towels").check();
  await expect(box(basket, "paper towels")).toBeChecked();

  // Taken off by mistake, a grocery comes back with Undo.
  await add.fill(named("ginger"));
  await add.press("Enter");
  await page
    .getByRole("button", { name: `Remove ${named("ginger")} from the list` })
    .click();
  await expect(toast(page)).toContainText(
    `${named("ginger")} is off the list.`,
  );
  await expect(box(page, "ginger")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(box(page, "ginger")).toBeVisible();

  await basket.getByRole("link", { name: "Put it all away" }).click();
  await expect(title(page)).toHaveText("Put it all away");
  // Household things are not worth noting as at home.
  await expect(box(page, "lemons")).toBeChecked();
  await expect(box(page, "paper towels")).not.toBeChecked();
  await expectAccessible(page, "Put away");
  await page.getByRole("button", { name: "Put away" }).click();
  await expect(title(page)).toHaveText("To buy");
  await expect(toast(page)).toContainText("put away.");
  await expect(box(page, "lemons")).toHaveCount(0);
  await expect(box(page, "paper towels")).toHaveCount(0);
  await expect(box(page, "ginger")).toBeVisible();

  await page.getByRole("link", { name: "At home" }).click();
  await expect(title(page)).toHaveText("At home");
  await expect(region(page, "In the kitchen")).toContainText(named("lemons"));
  await expect(page.getByText(named("paper towels"))).toHaveCount(0);
});

test("at home, things are used soon, used up, bought again, and leftovers eaten", async ({
  page,
  request,
}) => {
  await call(request, "batch_create", {
    recipe_id: tagine.id,
    portions: 3,
    cooked_on: today(),
  });
  await page.goto("/next/#/groceries/home");
  await expect(title(page)).toHaveText("At home");
  const saffron = named("saffron");
  const have = page.getByRole("textbox", { name: "Add something you have" });
  await have.fill(saffron);
  await have.press("Enter");
  const kitchen = region(page, "In the kitchen");
  await expect(kitchen).toContainText(saffron);

  await kitchen.getByRole("button", { name: `Use soon, ${saffron}` }).click();
  const soon = region(page, "Use soon");
  await expect(
    soon.getByRole("button", { name: `Use soon, ${saffron}` }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectAccessible(page, "At home");

  await soon.getByRole("button", { name: `Used up, ${saffron}` }).click();
  await expect(toast(page)).toContainText(`${saffron} is used up.`);
  await page.getByText("Ran out").click();
  await page
    .getByRole("button", { name: `Add to the list, ${saffron}` })
    .click();
  await expect(toast(page)).toContainText(`${saffron} is on the list.`);
  await page.getByRole("button", { name: `Have it, ${saffron}` }).click();
  await expect(kitchen).toContainText(saffron);

  const left = page
    .getByRole("region", { name: "Leftovers" })
    .getByRole("listitem")
    .filter({ hasText: named("Tagine") });
  await expect(left).toContainText("3 portions left");
  await left
    .getByRole("button", { name: `Ate one, ${named("Tagine")}` })
    .click();
  await expect(toast(page)).toContainText(
    `A portion of ${named("Tagine")} eaten.`,
  );
  await expect(left).toContainText("2 portions left");
  await left
    .getByRole("button", { name: `All gone, ${named("Tagine")}` })
    .click();
  await expect(toast(page)).toContainText(`${named("Tagine")} is all gone.`);
  await expect(left).toHaveCount(0);
});

test("a recipe's groceries go on the list from its page", async ({ page }) => {
  await page.goto(`/next/#/recipes/${encodeURIComponent(tagine.id)}`);
  await page.getByRole("link", { name: "Add to groceries" }).click();
  await expect(title(page)).toHaveText("Add to groceries");
  await expect(box(page, "cumin")).not.toBeChecked();
  await page.getByRole("button", { name: "Put them on the list" }).click();
  await expect(title(page)).toHaveText(named("Tagine"));
  await expect(toast(page)).toContainText(
    `${named("Tagine")}’s groceries are on the list.`,
  );
});
