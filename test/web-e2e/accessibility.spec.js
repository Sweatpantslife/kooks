import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// Every page of the browser app, at desktop and phone widths, in both themes,
// checked by axe against WCAG 2.2 AA. The records give each page something to
// show; the suffix keeps them apart from the other tests' records.
const run = `a11y ${Date.now().toString(36)}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function seed(request, baseURL, name, input) {
  const response = await request.post(`${baseURL}/api/tools/${name}`, {
    data: { request_id: crypto.randomUUID(), ...input },
    headers: { Origin: baseURL },
  });
  expect(response.ok(), `${name}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function seedKitchen(request, baseURL) {
  const save = (name, input) => seed(request, baseURL, name, input);
  const recipe = (title, extra = {}) => ({
    title: `${title} ${run}`,
    servings: 4,
    ingredients: [
      { name: "Olive oil", quantity: 30, unit: "mL" },
      { name: "Orzo", quantity: 250, unit: "g" },
    ],
    steps: [{ text: "Toast the orzo." }, { text: "Simmer until tender." }],
    course: "main",
    cuisine: "Italian",
    diets: ["vegetarian"],
    tags: ["Weeknight"],
    active_minutes: 15,
    total_minutes: 25,
    links: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "Folding" }],
    ...extra,
  });
  const main = (await save("recipe_save", { recipe: recipe("Lemon orzo") }))
    .record;
  const side = (
    await save("recipe_save", {
      recipe: recipe("Green salad", { course: "side", favorite: true }),
    })
  ).record;
  const member = (await save("member_save", { member: { name: `Jo ${run}` } }))
    .record;
  await save("pantry_save", {
    pantry: { name: `Zucchini ${run}`, use_soon: true, available: true },
  });
  const meal = (
    await save("meal_save", {
      meal: {
        title: `Friday dinner ${run}`,
        dishes: [
          { recipe_id: main.id, servings: 4 },
          { recipe_id: side.id, servings: 4 },
        ],
      },
    })
  ).record;
  await save("plan_save", {
    source: { kind: "recipe", id: main.id },
    date: today(),
    slot: "Dinner",
  });
  const list = (await save("shopping_create", { title: `Groceries ${run}` }))
    .record;
  await save("shopping_manual_item", {
    id: list.id,
    expected_version: list.version,
    item: { name: "Coffee" },
  });
  const started = (
    await save("cooking_start", { source: { kind: "meal", id: meal.id } })
  ).record;
  const timed = await save("cooking_timer", {
    id: started.id,
    expected_version: started.version,
    label: "Orzo",
    duration_seconds: 600,
  });
  await save("cooking_task_save", {
    id: started.id,
    expected_version: timed.record.version,
    task: { text: "Chop", member_id: member.id },
  });
  const batch = (
    await save("batch_create", {
      recipe_id: main.id,
      portions: 4,
      cooked_on: today(),
    })
  ).record;
  await save("price_save", {
    price: {
      name: `Orzo ${run}`,
      package_quantity: 500,
      unit: "g",
      price: 2.5,
      currency: "USD",
      purchased_on: today(),
    },
  });
  const technique = (
    await save("technique_save", {
      technique: {
        title: `Reverse sear ${run}`,
        summary: "Low, then hot.",
        steps: [{ text: "Oven." }, { text: "Pan." }],
        recipe_ids: [main.id],
      },
    })
  ).record;
  const idea = (
    await save("inspiration_save", {
      inspiration: { title: `Leeks with brown butter ${run}`, tags: ["Veg"] },
    })
  ).record;
  const draft = (
    await save("recipe_import_text", {
      text: `Pasta ${run}\nServes 2\n\nIngredients\n200 g pasta\n\nMethod\nBoil.`,
    })
  ).record;
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  ).toString("base64");
  const file = (
    await save("asset_save", {
      file: { name: "book.pdf", mime_type: "application/pdf", base64: pdf },
    })
  ).record;
  const book = (
    await save("book_save", {
      book: {
        title: `The braise book ${run}`,
        author: "Noa",
        tags: ["Slow"],
        notes: "",
        file_id: file.id,
        cover_id: null,
        bookmarks: [{ label: "Braise", page: 3 }],
        recipe_ids: [main.id],
      },
    })
  ).record;
  return [
    "today",
    "recipes",
    "recipes/add",
    "recipes/new",
    `recipes/${main.id}`,
    `recipes/${main.id}/edit`,
    `recipes/${main.id}/memory`,
    `imports/${draft.id}`,
    "techniques",
    `techniques/${technique.id}`,
    "techniques/new",
    "inspiration",
    `inspiration/${idea.id}`,
    "inspiration/new",
    "library",
    "library/new",
    `library/${book.id}`,
    `library/${book.id}/edit`,
    "plan",
    "plan/meals",
    `plan/meals/${meal.id}`,
    "plan/leftovers",
    `plan/leftovers/${batch.id}`,
    `plan/leftovers/new/${main.id}`,
    "shop",
    "shop/pantry",
    "shop/pantry/new",
    `shop/review/recipe/${main.id}`,
    "cook",
    `cook/${started.id}`,
    "settings/household",
    "settings/household/new",
    "settings/prices",
    "settings/prices/new",
    "settings/backup",
    "settings/preferences",
    "no-such-page",
  ];
}

// Moving between routes swaps the hash, so the old page stays on screen until
// the new one replaces it; wait for that before scanning.
async function open(page, route) {
  const previous = await page.$("main");
  await page.goto(`/#/${route}`);
  if (previous) await page.waitForFunction((el) => !el.isConnected, previous);
  await expect(page.locator("main .page")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("every page meets WCAG 2.2 AA in both themes at desktop and phone widths", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const routes = await seedKitchen(request, baseURL);
  const problems = [];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await open(page, route);
      problems.push(...(await scan(page, `${width} px #/${route}`)));
    }
  }
  expect(problems).toEqual([]);
});
