import { test, expect } from "@playwright/test";

// What every page shares: other cooks' changes arriving while someone types,
// layouts from a small phone to a wide screen, and messages with Undo.
// Other suites share this database, so every name carries this run's tag.
const origin = "http://127.0.0.1:4318";
const tag = `T${Date.now().toString(36)}`;
let seq = 0;

async function call(request, name, input) {
  const response = await request.post(`${origin}/api/tools/${name}`, {
    headers: { Origin: origin },
    data: { request_id: `${tag}-${seq++}`, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

const named = (name) => `${name} ${tag}`;
const dish = (name) => ({
  title: named(name),
  servings: 4,
  ingredients: [
    { quantity: 30, unit: "ml", name: "olive oil", preparation: "" },
    { quantity: 250, unit: "g", name: "orzo", preparation: "" },
  ],
  steps: [{ text: "Toast the orzo." }, { text: "Simmer until tender." }],
});
const title = (page) => page.getByRole("heading", { level: 1 });
const toast = (page) => page.locator(".toast-region");
const day = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A cookbook with something in it already, so Recipes offers its search.
test.beforeAll(async ({ request }) => {
  await call(request, "recipe_save", { recipe: dish("Orzo pilaf") });
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("another cook's recipe arrives and leaves on its own while the search keeps the focus and the typing", async ({
  page,
  request,
}) => {
  await page.goto("/#/recipes");
  const search = page.getByRole("searchbox", { name: "Search recipes" });
  await search.fill(tag);
  const stew = named("Polled stew");
  const tile = page.getByRole("link", { name: new RegExp(stew) });
  const { record } = await call(request, "recipe_save", {
    recipe: dish("Polled stew"),
  });
  await expect(tile).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.type(" stew");
  await expect(search).toHaveValue(`${tag} stew`);
  await expect(tile).toBeVisible();

  await call(request, "record_archive", {
    kind: "recipe",
    id: record.id,
    expected_version: record.version,
    archived: true,
  });
  await expect(tile).toHaveCount(0);
  await expect(search).toBeFocused();
});

test("every page fits a small phone, a phone, a tablet and a wide screen without sideways scrolling", async ({
  page,
  request,
}) => {
  const { record } = await call(request, "recipe_save", {
    recipe: dish("Wide orzo"),
  });
  const id = encodeURIComponent(record.id);
  const routes = [
    "week",
    `week/add/${day(new Date())}`,
    "recipes",
    `recipes/${id}`,
    `recipes/${id}/edit`,
    "recipes/add",
    "recipes/add/link",
    "recipes/add/paste",
    "recipes/add/photo",
    "recipes/add/idea",
    "recipes/new",
    "recipes/technique/new",
    "recipes/book/new",
    "groceries",
    "groceries/home",
    "groceries/week",
    "household",
    "household/people",
    "household/people/new",
    "household/history",
    "household/prices",
    "household/prices/new",
    "household/look",
    "household/signin",
    "household/backup",
    "nowhere",
  ];
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(`/#/${route}`);
      await expect(title(page)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBe(true);
    }
    // Phones and tablets get the tabs below; wide screens the rail. Never both.
    await expect(page.locator(".tabbar")).toBeVisible({
      visible: width < 840,
    });
    await expect(page.locator(".rail")).toBeVisible({ visible: width >= 840 });
  }
  await call(request, "record_archive", {
    kind: "recipe",
    id: record.id,
    expected_version: record.version,
    archived: true,
  });
});

test("Undo stays long enough to reach, waits while it has the focus, and hands the focus back", async ({
  page,
  request,
}) => {
  const stew = named("Undo stew");
  const { record } = await call(request, "recipe_save", {
    recipe: dish("Undo stew"),
  });
  await page.clock.install();
  await page.goto(`/#/recipes/${encodeURIComponent(record.id)}`);
  await expect(title(page)).toHaveText(stew);
  const favorite = page
    .getByRole("main")
    .getByRole("button", { name: "Favorite" });
  const undo = toast(page).getByRole("button", { name: "Undo" });

  await favorite.focus();
  await page.keyboard.press("Enter");
  await expect(toast(page)).toContainText(`${stew} is a favorite.`);
  await page.clock.fastForward(10_000);
  await expect(undo).toBeVisible();
  // While the keyboard is on the message it does not time out.
  await undo.focus();
  await page.clock.fastForward(60_000);
  await expect(undo).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(toast(page)).toContainText("Undone.");
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await expect(favorite).toBeFocused();

  // Escape closes a message and hands the focus back too.
  await page.keyboard.press("Enter");
  await expect(toast(page)).toContainText(`${stew} is a favorite.`);
  await undo.focus();
  await page.keyboard.press("Escape");
  await expect(toast(page)).toBeEmpty();
  await expect(favorite).toBeFocused();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");

  // Left alone, a message with Undo goes after 20 seconds.
  await page.keyboard.press("Enter");
  await expect(toast(page)).toContainText(`${stew} is no longer a favorite.`);
  await page.clock.fastForward(19_000);
  await expect(undo).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(toast(page)).toBeEmpty();
});
