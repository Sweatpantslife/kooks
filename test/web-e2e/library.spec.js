import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// Ideas, techniques and books in the app, against the server
// without sign-in. Other suites share this database, so every name carries
// this run's tag.
const origin = "http://127.0.0.1:4318";
const tag = `L${Date.now().toString(36)}`;
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
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

test.beforeAll(async ({ request }) => {
  await call(request, "recipe_save", {
    recipe: {
      title: named("Dal"),
      servings: 4,
      ingredients: [
        { quantity: 200, unit: "g", name: "red lentils", preparation: "" },
      ],
      steps: [{ text: "Simmer until soft." }],
    },
  });
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
const more = (page, name) => page.getByRole("region", { name });

test("an idea is marked tried, edited, and written up as a recipe that points back to it", async ({
  page,
  request,
}) => {
  const bowls = named("Chickpea bowls");
  const idea = (
    await call(request, "inspiration_save", {
      inspiration: {
        title: bowls,
        source: "Noa’s dinner",
        notes: "Tahini and lemon.",
        links: [{ url: "https://example.com/bowls", title: "Noa’s notes" }],
      },
    })
  ).record;
  await page.goto(`/#/recipes/idea/${encodeURIComponent(idea.id)}`);
  await expect(title(page)).toHaveText(bowls);
  await expect(page.getByText("From Noa’s dinner")).toBeVisible();
  await expect(more(page, "Links and videos")).toContainText("Noa’s notes");
  await expectAccessible(page, "Idea");

  const tried = page.getByRole("button", { name: "We tried it" });
  await tried.click();
  await expect(toast(page)).toContainText(`${bowls} is marked as tried.`);
  await expect(tried).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(title(page)).toHaveText("Edit idea");
  await page.getByLabel("Notes").fill("Tahini, lemon and mint.");
  await page.getByLabel("Links and videos").fill("not a link");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Each link needs a web address",
  );
  await page
    .getByLabel("Links and videos")
    .fill("https://example.com/bowls Noa’s notes");
  await expectAccessible(page, "Edit idea");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(title(page)).toHaveText(bowls);
  await expect(page.getByText("Tahini, lemon and mint.")).toBeVisible();

  await page.getByRole("link", { name: "Write it up as a recipe" }).click();
  await expect(title(page)).toHaveText("Write up the idea");
  await expect(page.getByLabel("Name")).toHaveValue(bowls);
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(toast(page)).toContainText(`${bowls} is in your cookbook.`);
  await expect(page).toHaveURL(/#\/recipes\/[^/]+$/);
  await expect(title(page)).toHaveText(bowls);
  await more(page, "More about this recipe")
    .getByRole("link", { name: new RegExp(`^${bowls}`) })
    .click();
  await expect(page).toHaveURL(/#\/recipes\/idea\//);
  await expect(
    page.getByRole("link", { name: "Open the recipe" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "We tried it" })).toHaveCount(
    0,
  );
});

test("a technique is kept from the Add page with the recipes that use it, and leaves with Undo", async ({
  page,
}) => {
  const poach = named("Poaching eggs");
  await page.goto("/#/recipes/add");
  await page.getByRole("link", { name: /^Keep a technique/ }).click();
  await expect(title(page)).toHaveText("New technique");
  await page.getByLabel("Name").fill(poach);
  await page
    .getByLabel("Steps")
    .fill("Bring water to a bare simmer.\n\nSlide the egg in.");
  await page.getByLabel("Tips and pitfalls").fill("Strain the egg first.");
  await page
    .getByLabel("Links and videos")
    .fill("youtu.be/dQw4w9WgXcQ The video");
  await page.getByRole("searchbox", { name: /^Find a recipe/ }).fill(tag);
  await page.getByRole("checkbox", { name: named("Dal") }).check();
  await expectAccessible(page, "New technique");
  await page.getByRole("button", { name: "Save technique" }).click();

  await expect(toast(page)).toContainText(`${poach} is in your techniques.`);
  await expect(title(page)).toHaveText(poach);
  await expect(
    page.getByRole("region", { name: "How it’s done" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(page.getByRole("complementary", { name: "Tips" })).toContainText(
    "Strain the egg first.",
  );
  const used = more(page, "Where it’s used and shown");
  await expect(used).toContainText("Video on YouTube");
  await expectAccessible(page, "Technique");
  await used
    .getByRole("link", { name: new RegExp(`^${named("Dal")}`) })
    .click();
  await expect(title(page)).toHaveText(named("Dal"));
  await expect(more(page, "More about this recipe")).toContainText(poach);

  await page.goBack();
  await expect(title(page)).toHaveText(poach);
  await page.getByRole("button", { name: "Remove technique" }).click();
  await expect(toast(page)).toContainText(`${poach} is off your techniques.`);
  await expect(title(page)).toHaveText("Recipes");
  await expect(
    page.getByRole("button", { name: /^Techniques/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: new RegExp(poach) })).toHaveCount(
    0,
  );
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(poach) }),
  ).toBeVisible();
});

test("a book goes on the shelf from a file, keeps bookmarks and its recipes, and leaves with Undo", async ({
  page,
}) => {
  const salt = named("Salt Fat Acid Heat");
  await page.goto("/#/recipes/book/new");
  await expect(title(page)).toHaveText("Add a book");
  await page.getByLabel("The book").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Not a book"),
  });
  await page.getByLabel("Title").fill(salt);
  await page.getByRole("button", { name: "Add to the shelf" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Choose a PDF or an EPUB file.",
  );
  await page.getByLabel("Title").fill("");
  await page.getByLabel("The book").setInputFiles({
    name: `${salt}.pdf`,
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.getByLabel("Title")).toHaveValue(salt);
  await page.getByLabel("Author").fill("Samin Nosrat");
  await expectAccessible(page, "Add a book");
  await page.getByRole("button", { name: "Add to the shelf" }).click();

  await expect(toast(page)).toContainText(`${salt} is on your shelf.`);
  await expect(title(page)).toHaveText(salt);
  await expect(page.getByText("By Samin Nosrat")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the book" }),
  ).toHaveAttribute("href", /^\/api\/assets\//);

  const marks = page.getByRole("region", { name: "Bookmarks" });
  await marks.getByLabel("Bookmark").fill("Salt chart");
  await marks.getByLabel("Page").fill("40");
  await marks.getByRole("button", { name: "Add bookmark" }).click();
  await expect(toast(page)).toContainText("Bookmarked Salt chart.");
  await expect(marks.getByRole("link", { name: "Salt chart" })).toHaveAttribute(
    "href",
    /#page=40$/,
  );
  await expectAccessible(page, "Book");
  await marks
    .getByRole("button", { name: "Remove the bookmark Salt chart" })
    .click();
  await expect(marks).toContainText("No bookmarks yet.");

  await page.getByRole("link", { name: "Edit details" }).click();
  await expect(title(page)).toHaveText("Edit book");
  await page.getByRole("searchbox", { name: /^Find a recipe/ }).fill(tag);
  await page.getByRole("checkbox", { name: named("Dal") }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(title(page)).toHaveText(salt);
  await expect(more(page, "Recipes from this book")).toContainText(
    named("Dal"),
  );

  await page.getByRole("button", { name: "Remove from the shelf" }).click();
  await expect(toast(page)).toContainText(`${salt} is off the shelf.`);
  await expect(page.getByRole("button", { name: /^Books/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(salt) }),
  ).toBeVisible();
});

test("the previous app's idea, technique and book addresses open their new pages", async ({
  page,
  request,
}) => {
  const idea = (
    await call(request, "inspiration_save", {
      inspiration: { title: named("Old idea") },
    })
  ).record;
  await page.goto(`/#/inspiration/${encodeURIComponent(idea.id)}`);
  await expect(page).toHaveURL(/#\/recipes\/idea\/[^/]+$/);
  await expect(title(page)).toHaveText(named("Old idea"));
  await page.goto("/#/techniques/new");
  await expect(page).toHaveURL(/#\/recipes\/technique\/new$/);
  await expect(title(page)).toHaveText("New technique");
  await page.goto("/#/inspiration/new");
  await expect(page).toHaveURL(/#\/recipes\/add\/idea$/);
  await page.goto("/#/library/nothing-here");
  await expect(title(page)).toHaveText("Not found");
  await expectAccessible(page, "Missing book");
});
