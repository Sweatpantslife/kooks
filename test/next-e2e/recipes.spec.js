import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The Recipes tab of the redesigned app, against the server without sign-in.
// Other suites share this database, so every name carries this run's tag.
const origin = "http://127.0.0.1:4318";
const tag = `R${Date.now().toString(36)}`;
let seq = 0;

async function call(request, name, input) {
  const response = await request.post(`${origin}/api/tools/${name}`, {
    headers: { Origin: origin },
    data: { request_id: `${tag}-${seq++}`, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

const ing = (quantity, unit, name, preparation = "") => ({
  quantity,
  unit,
  name,
  preparation,
});

let orzo, stew, salad, meal;
test.beforeAll(async ({ request }) => {
  orzo = (
    await call(request, "recipe_save", {
      recipe: {
        title: `Lemon orzo ${tag}`,
        servings: 4,
        course: "main",
        cuisine: "Italian",
        diets: ["vegetarian"],
        total_minutes: 25,
        active_minutes: 15,
        pan_count: 1,
        ingredients: [
          ing(250, "g", `orzo ${tag}`),
          ing(0.5, "cup", "parmesan", "grated"),
        ],
        steps: [
          { text: "Boil the orzo until just tender.", duration_seconds: 600 },
          { text: "Stir in the parmesan." },
        ],
        source_url: "https://example.com/lemon-orzo",
      },
    })
  ).record;
  stew = (
    await call(request, "recipe_save", {
      recipe: {
        title: `Chickpea stew ${tag}`,
        servings: 6,
        course: "soup",
        total_minutes: 60,
        ingredients: [ing(2, "can", `chickpeas ${tag}`)],
        steps: [{ text: "Simmer." }],
      },
    })
  ).record;
  salad = (
    await call(request, "recipe_save", {
      recipe: {
        title: `Green salad ${tag}`,
        servings: 2,
        course: "salad",
        total_minutes: 10,
        ingredients: [ing(1, "head", `lettuce ${tag}`)],
        steps: [{ text: "Toss." }],
      },
    })
  ).record;
  await call(request, "recipe_variant_save", {
    original_recipe_id: orzo.id,
    recipe: { ...orzo.data, title: `Lemon orzo with peas ${tag}` },
    preferred: true,
  });
  meal = (
    await call(request, "meal_save", {
      meal: {
        title: `Sunday supper ${tag}`,
        dishes: [
          { recipe_id: stew.id, label: "Main" },
          { recipe_id: salad.id, label: "Side" },
        ],
      },
    })
  ).record;
  for (const name of [`orzo ${tag}`, `lettuce ${tag}`])
    await call(request, "pantry_save", { pantry: { name } });
  await call(request, "note_save", {
    recipe_id: orzo.id,
    text: "Lovely.",
    cooked_on: "2026-10-27",
    rating: 4,
    next_time: "More lemon next time.",
  });
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

async function expectAccessible(page, label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`),
    label,
  ).toEqual([]);
}

const tile = (page, title) =>
  page.getByRole("listitem").filter({ hasText: title });

test("the cookbook can be searched by ingredient and narrowed to a kind, and keeps the search after a visit", async ({
  page,
}) => {
  await page.goto("/next/#/recipes");
  const search = page.getByRole("searchbox", { name: "Search recipes" });
  // Ingredients count: only the salad has lettuce.
  await search.fill(`lettuce ${tag}`);
  await expect(page.locator(".tile-title")).toHaveText([`Green salad ${tag}`]);
  await expect(page.getByRole("status").first()).toContainText("1 result");
  // The meal shows too: the stew is one of its dishes.
  await search.fill(`chickpea ${tag}`);
  await expect(
    page.getByRole("link", { name: /^Chickpea stew/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Sunday supper/ }),
  ).toBeVisible();
  await expect(page.getByRole("status").first()).toContainText("2 results");

  await page.getByRole("button", { name: /^Meals/ }).click();
  await expect(page.getByRole("link", { name: /^Chickpea stew/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /^Meals/ }).click();

  await search.fill(`${tag} nothing like it`);
  await expect(
    page.getByRole("heading", { name: "Nothing matches" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show everything" }).click();
  await expect(search).toHaveValue("");

  await search.fill(tag);
  await page
    .getByRole("link", { name: new RegExp(`^Green salad ${tag}`) })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Green salad ${tag}`,
  );
  await expect(page).toHaveTitle(`Green salad ${tag} · Kooks`);
  await page
    .getByRole("link", { name: "Recipes", exact: true })
    .first()
    .click();
  await expect(search).toHaveValue(tag);

  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `Recipes, ${scheme}`);
  }
});

test("a favorite is marked from its tile and can be undone", async ({
  page,
}) => {
  await page.goto("/next/#/recipes");
  await page.getByRole("searchbox", { name: "Search recipes" }).fill(tag);
  const heart = page.getByRole("button", {
    name: `Favorite: Chickpea stew ${tag}`,
  });
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").last()).toContainText(
    `Chickpea stew ${tag} is a favorite.`,
  );
  await page.getByRole("button", { name: "Favorites" }).click();
  await expect(tile(page, `Chickpea stew ${tag}`)).toBeVisible();
  await expect(tile(page, `Green salad ${tag}`)).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status").last()).toContainText("Undone.");
  await expect(tile(page, `Chickpea stew ${tag}`)).toHaveCount(0);
});

test("“What can I make?” puts recipes whose ingredients are at home first and says what is missing", async ({
  page,
}) => {
  await page.goto("/next/#/recipes");
  await page.getByRole("searchbox", { name: "Search recipes" }).fill(tag);
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "sorted by what’s already at home",
  );
  await expect(tile(page, `Green salad ${tag}`)).toContainText("All at home");
  await expect(tile(page, `Chickpea stew ${tag}`)).toContainText("Need 1 more");
  // Ideas, techniques and meals are not recipes to rank.
  await expect(tile(page, `Sunday supper ${tag}`)).toHaveCount(0);
  const titles = await page.locator(".tile-title").allTextContents();
  expect(titles.indexOf(`Green salad ${tag}`)).toBeLessThan(
    titles.indexOf(`Chickpea stew ${tag}`),
  );
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(tile(page, `Sunday supper ${tag}`)).toBeVisible();
});

test("a recipe page scales its ingredients, shows what is at home and links its family", async ({
  page,
}) => {
  await page.goto(`/next/#/recipes/${encodeURIComponent(orzo.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Lemon orzo ${tag}`,
  );
  await expect(page.getByText("25 min, 15 min hands-on")).toBeVisible();
  await expect(page.getByText("Last time, Oct 27 · 4 of 5")).toBeVisible();
  await expect(page.getByText("More lemon next time.")).toBeVisible();

  const items = page.locator(".ingredients li");
  await expect(items.first().locator(".ingredient-amount")).toHaveText("250 g");
  await expect(items.first()).toContainText(`orzo ${tag}`);
  await expect(items.first()).toContainText("At home");
  await expect(items.nth(1).locator(".ingredient-amount")).toHaveText("½ cup");
  await expect(items.nth(1)).toContainText("parmesan, grated");
  await expect(items.nth(1)).not.toContainText("At home");
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "More servings" }).click();
  await expect(page.getByText("Serves 8")).toBeVisible();
  await expect(items.first().locator(".ingredient-amount")).toHaveText("500 g");
  await expect(items.nth(1).locator(".ingredient-amount")).toHaveText("1 cup");

  await expect(page.locator(".steps li")).toHaveCount(2);
  await expect(page.locator(".steps li").first()).toContainText("10 min");
  await expect(
    page.getByRole("link", { name: /From example\.com/ }),
  ).toHaveAttribute("href", "https://example.com/lemon-orzo");

  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `Recipe, ${scheme}`);
  }

  await page
    .getByRole("link", { name: new RegExp(`^Lemon orzo with peas ${tag}`) })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Lemon orzo with peas ${tag}`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  // A new page starts at its own yield.
  await expect(page.getByText("Serves 4")).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(`^Lemon orzo ${tag}`) }),
  ).toContainText("The original");
});

test("a meal page lists its dishes, and a missing recipe says so", async ({
  page,
}) => {
  await page.goto(`/next/#/recipes/meal/${encodeURIComponent(meal.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Sunday supper ${tag}`,
  );
  await expect(tile(page, `Chickpea stew ${tag}`)).toContainText("Main");
  await expect(tile(page, `Green salad ${tag}`)).toContainText("Side");
  await expectAccessible(page, "Meal");

  await page.goto("/next/#/recipes/recipe-that-is-not-here");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
  await expect(
    page.getByRole("heading", { name: "That recipe isn’t in the kitchen" }),
  ).toBeVisible();
});
