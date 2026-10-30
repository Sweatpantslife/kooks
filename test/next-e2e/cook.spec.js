import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// Cooking in the redesigned app, against the server without sign-in. Other
// suites share this database, so every name carries this run's tag.
const origin = "http://127.0.0.1:4318";
const tag = `C${Date.now().toString(36)}`;
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
const named = (name) => `${name} ${tag}`;

const recipe = (title) => ({
  recipe: {
    title: named(title),
    servings: 4,
    ingredients: [
      { quantity: 300, unit: "g", name: "arborio rice", preparation: "" },
      { quantity: 1, unit: "l", name: "stock", preparation: "hot" },
    ],
    steps: [
      { text: "Toast the rice in butter." },
      { text: "Add the stock a ladle at a time.", duration_seconds: 120 },
      { text: "Stir in the parmesan and rest." },
    ],
  },
});

let risotto, stew;
test.beforeAll(async ({ request }) => {
  risotto = (await call(request, "recipe_save", recipe("Risotto"))).record;
  stew = (await call(request, "recipe_save", recipe("Stew"))).record;
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

test("a recipe is cooked a step at a time, left and picked up, and finished with a note and leftovers", async ({
  page,
}) => {
  await page.goto(`/next/#/recipes/${encodeURIComponent(risotto.id)}`);
  await page.getByRole("button", { name: "Cook" }).click();
  await expect(page).toHaveURL(/#\/cook\/[^/]+$/);
  await expect(title(page)).toHaveText("Step 1 of 3");
  await expect(page.locator(".cook-text")).toHaveText(
    "Toast the rice in butter.",
  );
  // Cooking fills the screen.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expectAccessible(page, "Cooking");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(title(page)).toHaveText("Step 2 of 3");
  await page.getByRole("button", { name: "Start a 2 min timer" }).click();
  const timers = page.getByRole("region", { name: "Timers" });
  await expect(timers.getByRole("listitem")).toContainText("Step 2");
  await expect(timers.getByRole("listitem")).toContainText(/[12]:\d\d/);
  await expectAccessible(page, "Cooking with a timer");
  await timers.getByRole("button", { name: "Stop Step 2" }).click();
  await expect(timers.getByRole("listitem")).toHaveCount(0);

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(title(page)).toHaveText("Every step done");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(title(page)).toHaveText("Step 3 of 3");
  await page.getByRole("button", { name: "Done" }).click();

  // Left, the stove shows on every page and goes back to where it was.
  await page.getByRole("button", { name: "Leave the stove" }).click();
  await expect(title(page)).toHaveText(named("Risotto"));
  const bar = page.getByRole("link", {
    name: `Now cooking ${named("Risotto")}`,
  });
  await expect(bar).toContainText("Every step done");
  await expectAccessible(page, "Now cooking");
  await bar.click();
  await expect(title(page)).toHaveText("Every step done");

  await page.getByRole("link", { name: "Finish cooking" }).click();
  await expect(title(page)).toHaveText("How did it go?");
  await page.getByRole("radio", { name: /^4/ }).check();
  await page.getByLabel("Next time").fill("More parmesan.");
  await page.getByLabel("Portions left over").fill("2");
  await expectAccessible(page, "Finish cooking");
  await page.getByRole("button", { name: "Done cooking" }).click();

  await expect(title(page)).toHaveText(named("Risotto"));
  await expect(toast(page)).toContainText(`${named("Risotto")} is done.`);
  const last = page.getByRole("complementary", { name: "Last time" });
  await expect(last).toContainText("4 of 5");
  await expect(last).toContainText("More parmesan.");
  await expect(bar).toHaveCount(0);
  await page.goto("/next/#/groceries/home");
  await expect(
    page
      .getByRole("region", { name: "Leftovers" })
      .getByRole("listitem")
      .filter({ hasText: named("Risotto") }),
  ).toContainText("2 portions left");
});

test("a timer that runs out says so wherever the cook is", async ({
  page,
  request,
}) => {
  await page.goto(`/next/#/recipes/${encodeURIComponent(stew.id)}`);
  await page.getByRole("button", { name: "Cook" }).click();
  await expect(title(page)).toHaveText("Step 1 of 3");
  const id = decodeURIComponent(page.url().split("/").at(-1));
  await page.getByRole("button", { name: "Leave the stove" }).click();
  const session = (
    await (await request.get(`${origin}/api/state`)).json()
  ).records.session.find((s) => s.id === id);
  await call(request, "cooking_timer", {
    id,
    expected_version: session.version,
    label: "Taste the stew",
    duration_seconds: 2,
  });
  await expect(toast(page)).toContainText("Time’s up: Taste the stew.", {
    timeout: 10000,
  });
  // Clear the stove for the next test.
  await page.goto(`/next/#/cook/${encodeURIComponent(id)}/done`);
  await page.getByRole("button", { name: "Done cooking" }).click();
  await expect(toast(page)).toContainText(`${named("Stew")} is done.`);
});

test("a day's plan is cooked from the week, and pressing Cook again picks it up", async ({
  page,
  request,
}) => {
  await call(request, "plan_save", {
    source: { kind: "recipe", id: stew.id },
    date: fmt(new Date()),
    slot: "Dinner",
  });
  await page.goto("/next/#/week");
  const cook = page
    .getByRole("button", { name: `Cook ${named("Stew")}` })
    .first();
  await cook.click();
  await expect(title(page)).toHaveText("Step 1 of 3");
  const first = page.url();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(title(page)).toHaveText("Step 2 of 3");
  await page.getByRole("button", { name: "Leave the stove" }).click();
  await expect(title(page)).toHaveText("This week");
  await cook.click();
  await expect(page).toHaveURL(first);
  await expect(title(page)).toHaveText("Step 2 of 3");
  await page.getByRole("link", { name: "Finish" }).click();
  await page.getByRole("button", { name: "Done cooking" }).click();
  await expect(toast(page)).toContainText(`${named("Stew")} is done.`);
});
