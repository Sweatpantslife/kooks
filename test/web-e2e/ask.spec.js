import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// Ask Kooks, against the server without sign-in. That server has no API
// key, so the test plays the assistant: it says the kitchen has one, and
// answers questions with lines the real server would send. What the member
// then makes goes to the real kitchen. Other suites share this database,
// so every name carries this run's tag.
const origin = "http://127.0.0.1:4318";
const tag = `A${Date.now().toString(36)}`;
let seq = 0;

async function call(request, name, input) {
  const response = await request.post(`${origin}/api/tools/${name}`, {
    headers: { Origin: origin },
    data: { request_id: `${tag}-${seq++}`, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

// A Monday some weeks ahead, out of the other suites' way.
const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ahead = (() => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 35);
  return fmt(d);
})();
const weekday = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
  });

let soup;
test.beforeAll(async ({ request }) => {
  soup = (
    await call(request, "recipe_save", {
      recipe: {
        title: `Tomato soup ${tag}`,
        servings: 4,
        ingredients: [{ quantity: 6, unit: "", name: "tomatoes" }],
        steps: [{ text: "Simmer." }],
      },
    })
  ).record;
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

// The kitchen as the server describes it, with the assistant on.
async function withAssistant(page, answer) {
  await page.route("**/api/state**", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, assistant: true } });
  });
  const asked = [];
  await page.route("**/api/assistant", async (route) => {
    const input = route.request().postDataJSON();
    asked.push(input);
    const lines = [{ step: "Looking through your recipes" }, answer(input)];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
    });
  });
  return asked;
}

test("without a key there is no Ask, and its address says how to turn it on", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This week");
  await expect(page.getByRole("link", { name: "Ask Kooks" })).toHaveCount(0);
  await page.goto("/#/ask");
  await expect(
    page.getByRole("heading", { name: "The assistant isn’t set up here" }),
  ).toBeVisible();
});

test("a member asks, reads the answer and makes the changes they want", async ({
  page,
}) => {
  const asked = await withAssistant(page, (input) =>
    input.messages.length === 1
      ? {
          answer: {
            reply: `Your Tomato soup would suit Monday.\n\n- It serves 4\n- It needs tomatoes\n\n<img src=x onerror=alert(1)> https://evil.example`,
            proposals: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                type: "plan",
                input: {
                  kind: "recipe",
                  id: soup.id,
                  date: ahead,
                  slot: "Dinner",
                },
              },
              {
                id: "22222222-2222-4222-8222-222222222222",
                type: "groceries",
                input: {
                  items: [
                    { name: `Basil ${tag}`, quantity: 1, unit: "bunch" },
                    { name: `Crusty bread ${tag}`, quantity: null, unit: "" },
                  ],
                },
              },
              {
                id: "33333333-3333-4333-8333-333333333333",
                type: "draft",
                input: { title: "Never mind", text: "Not this one at all." },
              },
            ],
          },
        }
      : { error: "Kooks couldn’t answer just now. Try again in a moment." },
  );
  await page.goto("/");
  await page.getByRole("link", { name: "Ask Kooks" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask Kooks");
  await expect(page).toHaveTitle("Ask Kooks · Kooks");
  expect(await scan(page, "Ask, empty")).toEqual([]);

  await page.getByRole("button", { name: "Plan dinners for the week" }).click();
  const kooks = page.locator(".turn-kooks");
  await expect(kooks).toContainText("Your Tomato soup would suit Monday.");
  expect(asked[0].messages).toEqual([
    { role: "user", text: "Plan dinners for the week" },
  ]);
  expect(asked[0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // The answer is text: a list stays a list, and markup and addresses stay
  // words.
  await expect(kooks.getByRole("listitem").first()).toHaveText("It serves 4");
  await expect(kooks.locator("img")).toHaveCount(0);
  await expect(kooks.getByRole("link")).toHaveCount(0);
  await expect(kooks).toContainText("<img src=x onerror=alert(1)>");

  // Each suggestion says what it does in the kitchen's words.
  const plan = kooks.getByRole("listitem").filter({ hasText: soup.data.title });
  await expect(plan).toContainText(`${soup.data.title} on ${weekday(ahead)}`);
  const groceries = kooks
    .getByRole("listitem")
    .filter({ hasText: "Add 2 things to the groceries" });
  await expect(groceries).toContainText(`1 bunch Basil ${tag}`);
  await expect(groceries).toContainText(`Crusty bread ${tag}`);
  expect(await scan(page, "Ask, answered")).toEqual([]);

  await plan.getByRole("button", { name: "Plan it" }).click();
  await expect(plan).toContainText("Done");
  await groceries.getByRole("button", { name: "Add them" }).click();
  await expect(groceries).toContainText("Done");
  await kooks
    .getByRole("listitem")
    .filter({ hasText: "Save “Never mind” as a draft" })
    .getByRole("button", { name: "No thanks" })
    .click();
  await expect(kooks).toContainText("Not this time");

  // A failed answer leaves the question in the box to send again, and the
  // next question tells the assistant what became of its suggestions.
  await page.getByLabel("Your question").fill("And dessert?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Kooks couldn’t answer just now. Try again in a moment.",
  );
  await expect(page.getByLabel("Your question")).toHaveValue("And dessert?");
  expect(asked[1].messages.at(-2).text).toContain(
    "(the member made it); Add 2 things to the groceries (the member made it); Save “Never mind” as a draft (the member said no)]",
  );

  // The changes are in the kitchen.
  await page.goto(`/#/week/${ahead}`);
  await expect(page.getByText(soup.data.title)).toBeVisible();
  await page.goto("/#/groceries");
  await expect(page.getByText(`Basil ${tag}`)).toBeVisible();
  await expect(page.getByText(`Crusty bread ${tag}`)).toBeVisible();

  // Starting over forgets the conversation.
  await page.goto("/#/ask");
  await expect(kooks).toHaveCount(1);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(kooks).toHaveCount(0);
});
