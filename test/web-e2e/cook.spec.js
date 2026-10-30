import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// Cooking in the app, against the server without sign-in. Other
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
  await page.goto(`/#/recipes/${encodeURIComponent(risotto.id)}`);
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
  await page.goto("/#/groceries/home");
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
  await page.goto(`/#/recipes/${encodeURIComponent(stew.id)}`);
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
  await page.goto(`/#/cook/${encodeURIComponent(id)}/done`);
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
  await page.goto("/#/week");
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

const sessionIn = async (request, id) =>
  (
    await (await request.get(`${origin}/api/state`)).json()
  ).records.session.find((s) => s.id === id);

test("jobs around the cooking are shared out, ticked off in place, and removed with Undo", async ({
  page,
  request,
}) => {
  const jo = (
    await call(request, "member_save", { member: { name: named("Jo") } })
  ).record;
  await page.goto(`/#/recipes/${encodeURIComponent(stew.id)}`);
  await page.getByRole("button", { name: "Cook" }).click();
  await expect(title(page)).toHaveText("Step 1 of 3");
  const id = decodeURIComponent(page.url().split("/").at(-1));
  const jobs = page.getByRole("region", { name: "Jobs" });
  const rows = jobs.getByRole("listitem");
  const box = jobs.getByRole("textbox", { name: "A job" });
  for (const job of ["Set the table", "Rinse the rice", "Chop the herbs"]) {
    await box.fill(job);
    await box.press("Enter");
    await expect(rows.filter({ hasText: job })).toHaveCount(1);
  }
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("");

  await jobs.getByRole("checkbox", { name: "Set the table" }).check();
  await jobs
    .getByRole("combobox", { name: "Who: Rinse the rice" })
    .selectOption({ label: named("Jo") });
  await expect
    .poll(async () =>
      (await sessionIn(request, id)).data.tasks.map((t) => [
        t.text,
        t.completed,
        t.member_id,
      ]),
    )
    .toEqual([
      ["Set the table", true, null],
      ["Rinse the rice", false, jo.id],
      ["Chop the herbs", false, null],
    ]);
  await expect(rows.first()).toHaveClass(/job-done/);
  await expectAccessible(page, "Cooking with jobs");

  // Another cook sees the same jobs.
  await page.reload();
  await expect(
    jobs.getByRole("checkbox", { name: "Set the table" }),
  ).toBeChecked();
  await expect(
    jobs.getByRole("combobox", { name: "Who: Rinse the rice" }),
  ).toHaveValue(jo.id);

  await jobs.getByRole("button", { name: "Remove Rinse the rice" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(2);
  await expect(
    jobs.getByRole("button", { name: "Remove Chop the herbs" }),
  ).toBeFocused();
  await expect(toast(page)).toContainText(
    "Rinse the rice is off the jobs list.",
  );
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveText([
    /Set the table/,
    /Rinse the rice/,
    /Chop the herbs/,
  ]);

  await page.getByRole("link", { name: "Finish" }).click();
  await page.getByRole("button", { name: "Done cooking" }).click();
  await expect(toast(page)).toContainText(`${named("Stew")} is done.`);
});

test("every time a recipe was cooked shows on it, and a note can be added without cooking", async ({
  page,
  request,
}) => {
  const dal = (await call(request, "recipe_save", recipe("Dal"))).record;
  const smoky = (
    await call(request, "recipe_variant_save", {
      original_recipe_id: dal.id,
      recipe: recipe("Smoky dal").recipe,
    })
  ).record;
  for (const [recipe_id, cooked_on, text, more] of [
    [dal.id, "2026-01-05", "Cooked.", {}],
    [dal.id, "2026-02-10", "Too thin.", { rating: 3, changes: "Less water." }],
    [
      smoky.id,
      "2026-03-15",
      "Smoky and good.",
      { rating: 5, cook_again: true },
    ],
  ])
    await call(request, "note_save", { recipe_id, cooked_on, text, ...more });

  await page.goto(`/#/recipes/${encodeURIComponent(dal.id)}`);
  const cooked = page.getByRole("region", { name: "Cooked before" });
  const notes = cooked.getByRole("listitem");
  await expect(notes).toHaveCount(3);
  await expect(notes.nth(0)).toContainText(
    `As ${named("Smoky dal")} · 5 of 5 · Cook again`,
  );
  await expect(notes.nth(1)).toContainText("Changed: Less water.");
  // A finish with nothing noted says only when it was cooked.
  await expect(notes.nth(2)).not.toContainText("Cooked.");
  await expectAccessible(page, "Cooked before");

  await cooked.getByRole("link", { name: "Add a note" }).click();
  await expect(title(page)).toHaveText("Add a note");
  await expect(page.getByLabel("Cooked on")).toHaveValue(fmt(new Date()));
  await page.getByRole("radio", { name: /^4/ }).check();
  await page.getByLabel("Notes", { exact: true }).fill("Better with lime.");
  await page.getByLabel("Next time").fill("Double the ginger.");
  await expectAccessible(page, "Add a note");
  await page.getByRole("button", { name: "Save note" }).click();

  await expect(title(page)).toHaveText(named("Dal"));
  await expect(toast(page)).toContainText("Your note is with the recipe.");
  await expect(
    page.getByRole("complementary", { name: "Last time" }),
  ).toContainText("Double the ginger.");
  await expect(notes).toHaveCount(3);
  await expect(notes.first()).toContainText("4 of 5");
  await expect(notes.first()).toContainText("Next time: Double the ginger.");
  const earlier = cooked.getByText("1 earlier time");
  await earlier.click();
  await expect(notes).toHaveCount(4);
  await expect(notes.last()).toContainText(/Jan 5/);
});
