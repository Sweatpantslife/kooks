import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// Adding and editing in the redesigned app, against the server without
// sign-in. Other suites share this database, so every name carries this run's
// tag.
const origin = "http://127.0.0.1:4318";
const tag = `E${Date.now().toString(36)}`;
let seq = 0;

async function call(request, name, input) {
  const response = await request.post(`${origin}/api/tools/${name}`, {
    headers: { Origin: origin },
    data: { request_id: `${tag}-${seq++}`, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

const seed = async (request, title, extra = {}) =>
  (
    await call(request, "recipe_save", {
      recipe: {
        title: `${title} ${tag}`,
        servings: 4,
        ingredients: [
          { quantity: 1, unit: "knob", name: "butter", preparation: "" },
          { quantity: 200, unit: "g", name: "rice", preparation: "" },
        ],
        steps: [{ text: "Melt the butter.", duration_seconds: 120 }],
        ...extra,
      },
    })
  ).record;

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

// The accessibility suites' scan: WCAG 2.2 A and AA plus axe's best
// practices, in the light and the dark theme.
async function expectAccessible(page, label) {
  expect(await scan(page, label)).toEqual([]);
}

const title = (page) => page.getByRole("heading", { level: 1 });
const status = (page) => page.locator(".toast-region");
const ingredientsField = (page) =>
  page.getByRole("textbox", { name: "Ingredients One per line" });

test("a pasted recipe becomes a draft checked beside the original, then a recipe", async ({
  page,
}) => {
  await page.goto("/next/#/recipes");
  await page.getByRole("link", { name: "Add a recipe" }).click();
  await expect(title(page)).toHaveText("Add to your cookbook");
  await expect(title(page)).toBeFocused();
  await expectAccessible(page, "Add");

  await page.getByRole("link", { name: /^Paste it/ }).click();
  await expect(title(page)).toHaveText("Paste a recipe");
  await page
    .getByLabel("The recipe")
    .fill(
      [
        `Tomato soup ${tag}`,
        "Serves 4",
        "Ingredients",
        `800 g tomatoes ${tag}, chopped`,
        "2 cloves garlic",
        "Salt",
        "Method",
        "Soften the garlic.",
        "Simmer the tomatoes for 20 minutes.",
      ].join("\n"),
    );
  await expectAccessible(page, "Paste");
  await page.getByRole("button", { name: "Read it" }).click();

  await expect(title(page)).toHaveText("Check the draft");
  await expect(page).toHaveURL(/#\/recipes\/draft\//);
  const draftUrl = page.url();
  await expect(page.getByLabel("Name")).toHaveValue(`Tomato soup ${tag}`);
  await expect(page.getByLabel("Serves")).toHaveValue("4");
  await expect(ingredientsField(page)).toHaveValue(
    `800 g tomatoes ${tag}, chopped\n2 cloves garlic\nSalt`,
  );
  const original = page.getByRole("complementary", { name: "Your original" });
  await expect(original).toContainText("Simmer the tomatoes for 20 minutes.");
  await expect(original).toContainText("Some ingredient amounts are unclear");
  const reading = page.getByRole("list", { name: "As Kooks reads it" });
  await expect(reading.locator("li")).toHaveCount(3);
  await expect(reading.locator("li").first()).toContainText("800 g");
  await expect(reading.locator("li").nth(2)).toContainText("No amount");
  await expect(page.getByText("2 steps so far.")).toBeVisible();
  await expectAccessible(page, "Draft");

  // The check is required before the draft becomes a recipe.
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(title(page)).toHaveText("Check the draft");
  await page
    .getByRole("checkbox", { name: /I checked the amounts and method/ })
    .check();
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(title(page)).toHaveText(`Tomato soup ${tag}`);
  await expect(status(page)).toContainText(
    `Tomato soup ${tag} is in your cookbook.`,
  );
  await expect(page.locator(".ingredients li").first()).toContainText("800 g");
  await expect(page.locator(".steps li")).toHaveCount(2);

  // Back skips the draft: it is in the cookbook now.
  await page.goBack();
  await expect(title(page)).toHaveText("Add to your cookbook");
  await expect(
    page.locator(".drafts").getByText(`Tomato soup ${tag}`),
  ).toHaveCount(0);
  await page.goto(draftUrl);
  await expect(title(page)).toHaveText("Already saved");
  await page.getByRole("link", { name: "Open the recipe" }).click();
  await expect(title(page)).toHaveText(`Tomato soup ${tag}`);
});

test("a draft waiting for its check can be discarded, with Undo", async ({
  page,
  request,
}) => {
  await call(request, "recipe_import_text", {
    text: `Lentil salad ${tag}\nIngredients\n1 cup lentils\nMethod\nCook.`,
  });
  await page.goto("/next/#/recipes/add");
  const drafts = page.getByRole("region", { name: "Waiting for your check" });
  await expect(
    drafts.getByRole("link", { name: new RegExp(`^Lentil salad ${tag}`) }),
  ).toBeVisible();
  await drafts
    .getByRole("button", { name: `Discard Lentil salad ${tag}` })
    .click();
  await expect(status(page)).toContainText("Draft discarded.");
  await expect(page.getByText(`Lentil salad ${tag}`)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(status(page)).toContainText("Undone.");
  await expect(
    drafts.getByRole("link", { name: new RegExp(`^Lentil salad ${tag}`) }),
  ).toBeVisible();
});

test("a recipe written from scratch shows how its lines are read and keeps its facets", async ({
  page,
}) => {
  await page.goto("/next/#/recipes/new");
  await expect(title(page)).toHaveText("New recipe");
  await page.getByLabel("Name").fill(`Orzo ${tag}`);
  await page.getByLabel("Serves").fill("2");
  await page.getByLabel("Total time, minutes").fill("25");
  await ingredientsField(page).fill(
    "250 g orzo\n½ cup parmesan, grated\nA pinch of salt",
  );
  const reading = page.getByRole("list", { name: "As Kooks reads it" });
  await expect(reading.locator(".ingredient-amount")).toHaveText([
    "250 g",
    "½ cup",
  ]);
  await expect(reading.locator("li").nth(1)).toContainText("parmesan, grated");
  await expect(reading.locator("li").nth(2)).toContainText("No amount");
  await page
    .getByRole("textbox", { name: "Method A blank line between steps" })
    .fill("Boil the orzo.\n\nStir in the parmesan.");
  await expect(page.getByText("2 steps so far.")).toBeVisible();

  await page.getByText("Course, cuisine and diet").click();
  await page.getByLabel("Course").selectOption("main");
  await page.getByLabel("Cuisine").fill("Italian");
  await page.getByRole("checkbox", { name: "Vegetarian" }).check();
  await page.getByLabel("Tags").fill("Weeknight, weeknight, Quick");
  await expectAccessible(page, "Editor");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessible(page, "Editor, phone");

  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(title(page)).toHaveText(`Orzo ${tag}`);
  await expect(page.getByText("25 min")).toBeVisible();
  await expect(page.locator(".labels li")).toHaveText([
    "Main",
    "Italian",
    "Vegetarian",
    "Weeknight",
    "Quick",
  ]);
  await expect(
    page.locator(".ingredients li").nth(1).locator(".ingredient-amount"),
  ).toHaveText("½ cup");
  // Opened again, the lines read as a cook writes them.
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(ingredientsField(page)).toHaveValue(
    "250 g orzo\n½ cup parmesan, grated\nA pinch of salt",
  );
});

test("editing keeps lines left as they were, holds unsaved changes, and offers Undo", async ({
  page,
  request,
}) => {
  const risotto = await seed(request, "Risotto");
  await page.goto("/next/#/recipes");
  await page.evaluate(
    (id) => (location.hash = `#/recipes/${encodeURIComponent(id)}`),
    risotto.id,
  );
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(title(page)).toHaveText("Edit recipe");
  await expect(title(page)).toBeFocused();
  await expect(page).toHaveTitle(`Edit recipe · Risotto ${tag} · Kooks`);
  // A unit the reader does not know is shown as stored and kept that way.
  await expect(ingredientsField(page)).toHaveValue("1 knob butter\n200 g rice");
  await page.getByLabel("Name").fill(`Lemon risotto ${tag}`);
  await ingredientsField(page).fill("1 knob butter\n300 g rice");

  // Leaving with unsaved changes asks first; staying keeps them.
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("link", { name: "Recipes", exact: true })
    .first()
    .click();
  await expect(title(page)).toHaveText("Edit recipe");
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByLabel("Name")).toHaveValue(`Lemon risotto ${tag}`);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(title(page)).toHaveText(`Lemon risotto ${tag}`);
  await expect(status(page)).toContainText("Changes saved.");
  const amounts = page.locator(".ingredients .ingredient-amount");
  await expect(amounts).toHaveText(["1 knob", "300 g"]);
  // The editor closed into the page it was opened from.
  await page.goBack();
  await expect(page).toHaveURL(/#\/recipes$/);

  await page.goForward();
  await expect(title(page)).toHaveText(`Lemon risotto ${tag}`);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(status(page)).toContainText("Undone.");
  await expect(title(page)).toHaveText(`Risotto ${tag}`);
  await expect(amounts).toHaveText(["1 knob", "200 g"]);

  // Leaving is fine once the person says so.
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Something else");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(title(page)).toHaveText(`Risotto ${tag}`);
});

test("a recipe someone else saved meanwhile can be replaced on purpose", async ({
  page,
  request,
}) => {
  const pilaf = await seed(request, "Pilaf");
  await page.goto(`/next/#/recipes/${encodeURIComponent(pilaf.id)}/edit`);
  await expect(page.getByLabel("Name")).toHaveValue(`Pilaf ${tag}`);
  await call(request, "recipe_save", {
    id: pilaf.id,
    expected_version: pilaf.version,
    recipe: { ...pilaf.data, notes: "Their note." },
  });
  await page.getByLabel("Name").fill(`My pilaf ${tag}`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Someone else saved this recipe while you were editing it.",
  );
  await page.getByRole("button", { name: "Save mine over theirs" }).click();
  await expect(title(page)).toHaveText(`My pilaf ${tag}`);
});

test("a recipe leaves the cookbook from its editor and comes back with Undo", async ({
  page,
  request,
}) => {
  const tart = await seed(request, "Plum tart");
  await page.goto(`/next/#/recipes/${encodeURIComponent(tart.id)}/edit`);
  await page.getByRole("button", { name: "Remove from cookbook" }).click();
  await expect(title(page)).toHaveText("Recipes");
  await expect(status(page)).toContainText(
    `Plum tart ${tag} is out of your cookbook.`,
  );
  const search = page.getByRole("searchbox", { name: "Search recipes" });
  await search.fill(`Plum tart ${tag}`);
  await expect(page.locator(".tile-title")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".tile-title")).toHaveText([`Plum tart ${tag}`]);
});

test("your own version starts from the recipe and links back to it", async ({
  page,
  request,
}) => {
  const curry = await seed(request, "Curry", { favorite: true });
  await page.goto(`/next/#/recipes/${encodeURIComponent(curry.id)}`);
  await page.getByRole("link", { name: "Make your own version" }).click();
  await expect(title(page)).toHaveText("Your own version");
  await expect(page.getByLabel("Name")).toHaveValue(`Curry ${tag}, my way`);
  await expect(
    page.getByRole("checkbox", { name: "Make this my usual way of making it" }),
  ).toBeChecked();
  await expectAccessible(page, "Variation");
  await ingredientsField(page).fill("1 knob butter\n150 g rice");
  await page.getByRole("button", { name: "Save your version" }).click();
  await expect(title(page)).toHaveText(`Curry ${tag}, my way`);
  await expect(page.getByRole("button", { name: "Favorite" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(
    page.getByRole("link", { name: new RegExp(`^Curry ${tag}`) }),
  ).toContainText("The original");
});

test("an idea to try is saved with its link and opens the To try list", async ({
  page,
}) => {
  await page.goto("/next/#/recipes/add");
  await page.getByRole("link", { name: /^Save an idea/ }).click();
  await expect(title(page)).toHaveText("Save an idea");
  await page.getByLabel("What is it?").fill(`Shakshuka ${tag}`);
  await page.getByLabel("Link").fill("not a link");
  await page.getByRole("button", { name: "Save idea" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The link needs a web address such as https://example.com.",
  );
  await page.getByLabel("Link").fill("example.com/shakshuka");
  await page.getByLabel("Where it’s from").fill("The café on the corner");
  await expectAccessible(page, "Idea");
  await page.getByRole("button", { name: "Save idea" }).click();
  await expect(title(page)).toHaveText("Recipes");
  await expect(status(page)).toContainText(
    `Shakshuka ${tag} is on your list to try.`,
  );
  await expect(page.getByRole("button", { name: /^To try/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("listitem").filter({ hasText: `Shakshuka ${tag}` }),
  ).toContainText("To try · The café on the corner");
});

test("a photo that is not an image is turned down before it is sent", async ({
  page,
}) => {
  await page.goto("/next/#/recipes/add/photo");
  await expect(title(page)).toHaveText("Photograph a recipe");
  await expectAccessible(page, "Photo");
  await page.getByLabel("Photo of the recipe").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Not a photo"),
  });
  await page.getByRole("button", { name: "Read the photo" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Choose a PNG, JPEG or WebP photo.",
  );
});
