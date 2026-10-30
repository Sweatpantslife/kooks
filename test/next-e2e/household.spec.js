import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { scan } from "../axe-scan.js";

// Household in the redesigned app, against the server without sign-in.
// Other suites share this database, so every name carries this run's tag.
const origin = "http://127.0.0.1:4318";
const tag = `H${Date.now().toString(36)}`;
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

let salad;
test.beforeAll(async ({ request }) => {
  salad = (
    await call(request, "recipe_save", {
      recipe: {
        title: named("Market salad"),
        servings: 2,
        tags: [],
        ingredients: [
          { quantity: 300, unit: "g", name: "chickpeas", preparation: "" },
          { quantity: 1, unit: "l", name: "water", preparation: "" },
          { quantity: 8, unit: "", name: "kalamata olives", preparation: "" },
          { quantity: 2, unit: "", name: named("quince"), preparation: "" },
        ],
        steps: [{ text: "Toss everything together." }],
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

test("the people at the table are added, changed and removed with Undo, and a recipe says what they think of it", async ({
  page,
}) => {
  const ada = named("Ada");
  await page.goto("/next/#/household");
  await expectAccessible(page, "Household");
  await page.getByRole("link", { name: /^People at the table/ }).click();
  await expect(title(page)).toHaveText("People at the table");

  await page.getByRole("link", { name: "Add a person" }).click();
  await expect(title(page)).toHaveText("Add a person");
  await page.getByLabel("Name").fill(ada);
  await page.getByLabel("Likes").fill("Chickpeas, soup");
  await page.getByLabel("Doesn’t like").fill("olives");
  await page.getByRole("radio", { name: "Mild" }).check();
  await expectAccessible(page, "Add a person");
  await page.getByRole("button", { name: "Add to the table" }).click();
  await expect(toast(page)).toContainText(`${ada} is at the table.`);
  await expect(title(page)).toHaveText("People at the table");
  const card = page.getByRole("listitem").filter({ hasText: ada });
  await expect(card).toContainText("Chickpeas, soup");
  await expect(card).toContainText("Mild");
  await expectAccessible(page, "People at the table");

  await page.goto(`/next/#/recipes/${encodeURIComponent(salad.id)}`);
  const table = page.getByRole("list", { name: "At the table" });
  await expect(table).toContainText(`${ada} likes Chickpeas`);
  await expect(table).toContainText(`${ada} doesn’t like olives`);

  await page.goto("/next/#/household/people");
  await card.getByRole("link", { name: `Edit ${ada}` }).click();
  await expect(page.getByLabel("Likes")).toHaveValue("Chickpeas, soup");
  await page.getByLabel("Doesn’t like").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(toast(page)).toContainText(`Saved ${ada}.`);
  await expect(card).not.toContainText("Doesn’t like");

  await card.getByRole("button", { name: `Remove ${ada}` }).click();
  await expect(toast(page)).toContainText(`${ada} is off the list.`);
  await expect(card).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Remove ${ada}` }).click();
  await expect(card).toHaveCount(0);
});

test("a weekly budget and the prices paid add up the week, and a missing price is one tap away", async ({
  page,
  request,
}) => {
  const quince = named("quince");
  const plan = (
    await call(request, "plan_save", {
      source: { kind: "recipe", id: salad.id },
      date: fmt(new Date()),
      slot: "Dinner",
    })
  ).record;
  await page.goto("/next/#/household/prices");
  await expect(title(page)).toHaveText("Prices and budget");
  // A currency of its own keeps this test's sums apart from other suites'.
  await page.getByLabel("Currency").fill("chf");
  await page.getByRole("button", { name: "Use this currency" }).click();
  await page.getByLabel("Weekly budget (CHF)").fill("80");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(toast(page)).toContainText("from this week on");
  await expect(page.locator(".week-money")).toContainText(/budget CHF\s80/);

  const unpriced = page.getByRole("region", { name: "Still without a price" });
  await expect(unpriced).toContainText(quince);
  await expectAccessible(page, "Prices and budget");
  await unpriced
    .getByRole("button", { name: `Add a price for ${quince}` })
    .click();
  await expect(title(page)).toHaveText("Add a price");
  await expect(page.getByLabel("What")).toHaveValue(quince);
  await page.getByLabel("Pack size").fill("4");
  await page.getByLabel("Price (CHF)").fill("6");
  await expectAccessible(page, "Add a price");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(toast(page)).toContainText(`Saved the price of ${quince}.`);
  await expect(title(page)).toHaveText("Prices and budget");
  const known = page.getByRole("region", { name: "What things cost" });
  await expect(known).toContainText(/4 for CHF\s6\.00/);
  await expect(unpriced).not.toContainText(quince);

  await page.goto("/next/#/household");
  await expect(
    page.getByRole("link", { name: /^Prices and budget/ }),
  ).toContainText(/CHF\s80\.00 a week/);
  await page.goto("/next/#/week");
  await expect(page.locator(".week-money-line")).toContainText(
    /of your CHF\s80\.00 budget/,
  );
  await expectAccessible(page, "Week with its cost");

  // Leave the kitchen as the test found it.
  await page.goto("/next/#/household/prices");
  await known
    .getByRole("button", { name: `Remove the price of ${quince}` })
    .click();
  await expect(toast(page)).toContainText(`The price of ${quince} is gone.`);
  await expect(known).not.toContainText(quince);
  const { records } = await (await request.get(`${origin}/api/state`)).json();
  for (const [kind, record] of [
    ["plan", plan],
    ...records.budget
      .filter((b) => b.data.currency === "CHF")
      .map((b) => ["budget", b]),
  ])
    await call(request, "record_archive", {
      kind,
      id: record.id,
      expected_version: kind === "plan" ? plan.version : record.version,
      archived: true,
    });
});

test("amounts read in metric or US units on this device, and the backup downloads", async ({
  page,
}) => {
  await page.goto("/next/#/household/look");
  await page.getByRole("radio", { name: "US" }).check();
  await expectAccessible(page, "Look and units");
  await page.reload();
  await expect(page.getByRole("radio", { name: "US" })).toBeChecked();
  await page.goto(`/next/#/recipes/${encodeURIComponent(salad.id)}`);
  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await expect(ingredients).toContainText("10½ oz");
  await expect(ingredients).toContainText("4¼ cups");
  await expect(ingredients).toContainText("8");

  await page.goto("/next/#/household/look");
  await page.getByRole("radio", { name: "As written" }).check();
  await page.goto(`/next/#/recipes/${encodeURIComponent(salad.id)}`);
  await expect(ingredients).toContainText("300 g");
  await expect(ingredients).not.toContainText("oz");

  await page.goto("/next/#/household/backup");
  await expectAccessible(page, "Backup");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download a backup" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^kooks-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(backup.records.some((r) => r.id === salad.id)).toBe(true);
});
