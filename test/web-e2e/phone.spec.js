import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pagePolicy } from "../../client/page-policy.js";

// The phone app's screens, tried in a browser: `kooks.phone` makes the page
// sign in the way the phone app does, with the kitchen's address, an emailed
// link confirmed elsewhere and a device token, against the server with
// sign-in on.
const kitchen = "http://localhost:4319";
const outbox = process.env.KOOKS_E2E_OUTBOX;
const mails = () => (existsSync(outbox) ? readdirSync(outbox).sort() : []);
const latestLink = () =>
  readFileSync(join(outbox, mails().at(-1)), "utf8").match(
    /http:\/\/localhost:4319\/#\/signin\/[A-Za-z0-9_-]+/,
  )[0];

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.addInitScript(() => localStorage.setItem("kooks.phone", "1"));
});

const title = (page) => page.getByRole("heading", { level: 1 });
const stored = (page, key) =>
  page.evaluate((name) => localStorage.getItem(name), key);

async function emailLink(page, email) {
  const before = mails().length;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(title(page)).toHaveText("Check your inbox.");
  await expect(title(page)).toBeFocused();
  await expect.poll(() => mails().length).toBe(before + 1);
  return latestLink();
}
// The person confirms the link somewhere else, as a browser would.
async function confirmElsewhere(request, link) {
  const response = await request.post(`${kitchen}/api/auth/link/confirm`, {
    headers: { Origin: kitchen },
    data: { token: link.split("/").at(-1), approve: true },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function openThisPhone(page) {
  await page.getByRole("link", { name: "Household" }).click();
  await page.getByRole("link", { name: /^Sign-in/ }).click();
  await expect(page.getByRole("heading", { name: "This phone" })).toBeVisible();
}

test("on a phone, a member finds the kitchen, signs in with an emailed link confirmed in a browser, and signs out", async ({
  page,
  context,
  request,
  browser,
}) => {
  await page.goto(`${kitchen}/`);
  await expect(title(page)).toHaveText("Where is your kitchen?");
  // The built page carries its own policy, as no server sends one on a phone.
  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute("content", pagePolicy);
  expect(await scan(page, "Phone sign-in, kitchen")).toEqual([]);

  // A server without sign-in is not a kitchen the phone can join.
  await page.getByLabel("Kitchen address").fill("http://localhost:4318");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not reach");

  await page.getByLabel("Kitchen address").fill(kitchen);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expect(page.getByText(`sign this app in to ${kitchen}`)).toBeVisible();
  expect(await scan(page, "Phone sign-in, email")).toEqual([]);

  const link = await emailLink(page, "baker@example.test");
  await expect(page.getByText("Waiting for the link…")).toBeVisible();
  expect(await scan(page, "Phone sign-in, waiting")).toEqual([]);
  // The link opens in a browser, which asks before it signs the app in and
  // is not signed in itself.
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto(link);
  await expect(title(other)).toHaveText("Sign in the Kooks app?");
  await expect(other.getByText("baker@example.test")).toBeVisible();
  expect(await scan(other, "Sign in the app?")).toEqual([]);
  await other.getByRole("button", { name: "Sign in the app" }).click();
  await expect(title(other)).toHaveText("The app is signing in.");
  expect(
    (await elsewhere.cookies()).filter((c) => c.name === "kooks_session"),
  ).toEqual([]);
  await elsewhere.close();
  await expect(title(page)).toHaveText("This week");
  await expect(page.getByRole("status")).toContainText(
    "Welcome to your kitchen.",
  );

  // The phone keeps a device token, never a cookie, and stays signed in.
  const token = await stored(page, "kooks.device");
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (await context.cookies()).filter((c) => c.name === "kooks_session"),
  ).toEqual([]);
  await page.reload();
  await expect(title(page)).toHaveText("This week");

  // Files come with the token too: a backup is fetched, then saved.
  await page.getByRole("link", { name: "Household" }).click();
  await page.getByRole("link", { name: /^Backup/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download a backup" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^kooks-\d{4}-\d{2}-\d{2}\.json$/,
  );

  await page.goto(`${kitchen}/#/household`);
  await openThisPhone(page);
  await expect(
    page.getByText(`Signed in as baker@example.test to ${kitchen}.`),
  ).toBeVisible();
  expect(await scan(page, "This phone")).toEqual([]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expect(page.getByRole("status")).toContainText("Signed out.");
  expect(await stored(page, "kooks.device")).toBeNull();
  // The kitchen ended the token as well.
  const after = await request.get(`${kitchen}/api/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(after.status()).toBe(401);

  // Signing out to use another kitchen asks where the kitchen is again.
  await confirmElsewhere(request, await emailLink(page, "baker@example.test"));
  await expect(title(page)).toHaveText("This week");
  await openThisPhone(page);
  await page
    .getByRole("button", { name: "Sign out and use another kitchen" })
    .click();
  await expect(title(page)).toHaveText("Where is your kitchen?");
  expect(await stored(page, "kooks.kitchen")).toBeNull();
});

// Signed in on the phone, as the test above does it.
async function signIn(page, request, email) {
  await page.goto(`${kitchen}/`);
  await page.getByLabel("Kitchen address").fill(kitchen);
  await page.getByRole("button", { name: "Continue" }).click();
  await confirmElsewhere(request, await emailLink(page, email));
  await expect(title(page)).toHaveText("This week");
}

const copies = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("kooks", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("copies");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const count = open.result
            .transaction("copies")
            .objectStore("copies")
            .count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
  );

test("out of the kitchen's reach, a phone shows its copy, keeps the ticks made and sends them when the kitchen answers", async ({
  page,
  request,
}) => {
  await signIn(page, request, "cook@example.test");
  const grocery = `limes ${Date.now()}`;
  await page.getByRole("link", { name: "Groceries" }).first().click();
  const add = page.getByRole("textbox", { name: "Add to the list" });
  await add.fill(`3 ${grocery}`);
  await add.press("Enter");
  const box = page.getByRole("checkbox", { name: new RegExp(`^${grocery}`) });
  await expect(box).not.toBeChecked();
  // The copy is written a moment after the kitchen last changed.
  await expect.poll(() => copies(page)).toBe(1);

  // The kitchen stops answering: the tick stays, and the page says why.
  const away = (route) => route.abort("internetdisconnected");
  await page.route(`${kitchen}/api/**`, away);
  await box.check();
  const bar = page.getByRole("status").filter({ hasText: "Can’t reach" });
  await expect(bar).toContainText(
    "1 change made here will go when it answers.",
  );
  await expect(box).toBeChecked();
  expect(await scan(page, "Groceries, out of reach")).toEqual([]);

  // Started again without the kitchen, the phone shows its copy.
  await page.reload();
  await expect(title(page)).toHaveText("To buy");
  await expect(bar).toContainText("This is how it was at");
  await expect(box).toBeChecked();

  // The kitchen answers again: the bar goes and the tick is sent.
  await page.unroute(`${kitchen}/api/**`, away);
  await expect(bar).toHaveCount(0);
  await expect(box).toBeChecked();
  expect(await stored(page, "kooks.outbox")).toBeNull();
  const state = await request.get(`${kitchen}/api/state`, {
    headers: { Authorization: `Bearer ${await stored(page, "kooks.device")}` },
  });
  const list = (await state.json()).records.shopping[0];
  expect(list.items.find((row) => row.name === grocery).checked).toBe(true);

  // Signing out leaves no copy of the kitchen on the phone.
  await page.getByRole("link", { name: "Household" }).click();
  await page.getByRole("link", { name: /^Sign-in/ }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expect.poll(() => copies(page)).toBe(0);
});

// A tool call as another cook, or as the phone, straight to the kitchen.
async function call(request, token, name, input) {
  const response = await request.post(`${kitchen}/api/tools/${name}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: kitchen },
    data: { request_id: `${name}-${Date.now()}-${Math.random()}`, ...input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function kitchenNow(request, token) {
  const state = await request.get(`${kitchen}/api/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await state.json()).records;
}
const today = () => new Date().toLocaleDateString("en-CA");

test("out of the kitchen's reach, a phone keeps groceries added, leftovers eaten and a cooking note, and each arrives once when it answers", async ({
  page,
  request,
}) => {
  await signIn(page, request, "taster@example.test");
  const token = await stored(page, "kooks.device");
  const stamp = Date.now();
  const soup = `Lentil soup ${stamp}`;
  const { record: recipe } = await call(request, token, "recipe_save", {
    recipe: { title: soup, servings: 4 },
  });
  await call(request, token, "batch_create", {
    recipe_id: recipe.id,
    portions: 3,
    cooked_on: today(),
  });
  // The household's first grocery makes its list, which needs the kitchen.
  await page.getByRole("link", { name: "Groceries" }).first().click();
  const add = page.getByRole("textbox", { name: "Add to the list" });
  await add.fill(`bread ${stamp}`);
  await add.press("Enter");
  const bread = page.getByRole("checkbox", {
    name: new RegExp(`^bread ${stamp}`),
  });
  await expect(bread).toBeVisible();
  await expect.poll(() => stored(page, "kooks.outbox")).toBeNull();
  // The phone has heard of the leftovers before the kitchen goes quiet.
  await page.getByRole("link", { name: "At home" }).click();
  await expect(
    page.getByRole("button", { name: `Ate one, ${soup}` }),
  ).toBeVisible();
  await page.getByRole("link", { name: "To buy" }).click();
  const away = (route) => route.abort("internetdisconnected");
  await page.route(`${kitchen}/api/**`, away);
  const bar = page.getByRole("status").filter({ hasText: "Can’t reach" });
  await expect(bar).toBeVisible();

  // Groceries added by hand show at once, waiting to send; one is ticked
  // into the basket, and one is thought better of.
  const lemons = `lemons ${stamp}`;
  await add.fill(`2 ${lemons}`);
  await add.press("Enter");
  const lemonBox = page.getByRole("checkbox", {
    name: new RegExp(`^${lemons}`),
  });
  await expect(lemonBox).toBeVisible();
  await expect(lemonBox).toHaveAccessibleDescription("Waiting to send");
  await lemonBox.check();
  await expect(lemonBox).toBeChecked();
  const parsley = `parsley ${stamp}`;
  await add.fill(parsley);
  await add.press("Enter");
  await page
    .getByRole("button", { name: `Remove ${parsley} from the list` })
    .click();
  await expect(page.getByRole("status").last()).toContainText(
    `${parsley} won’t be added.`,
  );
  await expect(
    page.getByRole("checkbox", { name: new RegExp(`^${parsley}`) }),
  ).toHaveCount(0);
  expect(await scan(page, "Groceries, waiting to send")).toEqual([]);

  // A portion of the leftovers eaten.
  await page.getByRole("link", { name: "At home" }).click();
  await page.getByRole("button", { name: `Ate one, ${soup}` }).click();
  const leftovers = page.locator("li").filter({ hasText: soup });
  await expect(leftovers).toContainText("2 portions left");
  await expect(leftovers).toContainText("Waiting to send");

  // A note after dinner.
  await page.goto(`${kitchen}/#/recipes/${recipe.id}/note`);
  await page.getByLabel("Notes").fill("More lemon next time.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(title(page)).toHaveText(soup);
  await expect(page.getByRole("status").last()).toContainText(
    "It goes to the kitchen when it answers.",
  );
  const cooked = page.locator(".cooked").filter({ hasText: "More lemon" });
  await expect(cooked).toContainText("Waiting to send");

  // Everything waiting is listed, in order, from the bar.
  await expect(bar).toContainText(
    "3 changes made here will go when it answers.",
  );
  await bar.getByRole("link").click();
  await expect(title(page)).toHaveText("Waiting to send");
  const rows = page.locator("[data-rows=waiting] li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(
    `Add 2 ${lemons} to the grocery list`,
  );
  await expect(rows.nth(1)).toContainText(`Ate a portion of ${soup}`);
  await expect(rows.nth(2)).toContainText(`A note on ${soup}`);
  expect(await scan(page, "Waiting to send")).toEqual([]);

  // Started again without the kitchen, nothing made here is lost.
  await page.reload();
  await expect(title(page)).toHaveText("Waiting to send");
  await expect(rows).toHaveCount(3);

  // The kitchen answers: each change goes, once, and nothing waits.
  await page.unroute(`${kitchen}/api/**`, away);
  await expect(bar).toHaveCount(0);
  await expect(
    page.getByText("Everything made here is in the kitchen."),
  ).toBeVisible();
  expect(await stored(page, "kooks.outbox")).toBeNull();
  const now = await kitchenNow(request, token);
  const list = now.shopping[0];
  const named = (name) => list.items.filter((row) => row.name === name);
  expect(named(lemons)).toHaveLength(1);
  expect(named(lemons)[0].checked).toBe(true);
  expect(named(parsley)).toHaveLength(0);
  const batch = now.batch.find((b) => b.data.recipe_id === recipe.id);
  expect(batch.remaining_portions).toBe(2);
  const notes = now.note.filter((n) => n.data.recipe_id === recipe.id);
  expect(notes.map((n) => n.data.text)).toEqual(["More lemon next time."]);
});

test("a change whose answer is lost on the way is made once, and one the kitchen refuses says why until it is discarded", async ({
  page,
  request,
}) => {
  await signIn(page, request, "baker@example.test");
  const token = await stored(page, "kooks.device");
  const stamp = Date.now();
  const stew = `Bean stew ${stamp}`;
  const { record: recipe } = await call(request, token, "recipe_save", {
    recipe: { title: stew, servings: 2 },
  });
  const { record: batch } = await call(request, token, "batch_create", {
    recipe_id: recipe.id,
    portions: 2,
    cooked_on: today(),
  });
  await page.getByRole("link", { name: "Groceries" }).first().click();
  const add = page.getByRole("textbox", { name: "Add to the list" });
  await add.fill(`rice ${stamp}`);
  await add.press("Enter");
  await expect(
    page.getByRole("checkbox", { name: new RegExp(`^rice ${stamp}`) }),
  ).toBeVisible();
  await expect.poll(() => stored(page, "kooks.outbox")).toBeNull();

  // The kitchen makes the change, and the answer never reaches the phone.
  const tools = `${kitchen}/api/tools/shopping_manual_item`;
  const lost = async (route) => {
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(tools, lost, { times: 1 });
  const oats = `oats ${stamp}`;
  await add.fill(oats);
  await add.press("Enter");
  const oatBox = page.getByRole("checkbox", { name: new RegExp(`^${oats}`) });
  await expect(oatBox).toBeVisible();
  // The next answer from the kitchen sends it again, as it was: the kitchen
  // knows its request id and makes nothing new.
  await expect(oatBox).not.toHaveAccessibleDescription("Waiting to send");
  await expect.poll(() => stored(page, "kooks.outbox")).toBeNull();
  let list = (await kitchenNow(request, token)).shopping[0];
  expect(list.items.filter((row) => row.name === oats)).toHaveLength(1);

  // Out of reach, the phone eats both portions; meanwhile another cook
  // eats one.
  const away = (route) => route.abort("internetdisconnected");
  await page.route(`${kitchen}/api/**`, away);
  await page.getByRole("link", { name: "At home" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Can’t reach" }),
  ).toBeVisible();
  await page.getByRole("button", { name: `All gone, ${stew}` }).click();
  await page.getByRole("link", { name: "Groceries" }).first().click();
  await page.getByRole("link", { name: "At home" }).click();
  await call(request, token, "batch_allocate", {
    id: batch.id,
    expected_version: batch.version,
    allocation: { portions: 1, status: "eaten" },
  });
  await page.unroute(`${kitchen}/api/**`, away);
  // All gone eats whatever is left when it arrives.
  await expect.poll(() => stored(page, "kooks.outbox")).toBeNull();
  const eaten = (await kitchenNow(request, token)).batch.find(
    (b) => b.id === batch.id,
  );
  expect(eaten.remaining_portions).toBe(0);

  // A second batch: the phone eats two portions out of reach, another cook
  // eats one first, and the kitchen will not take the phone's two.
  const { record: second } = await call(request, token, "batch_create", {
    recipe_id: recipe.id,
    portions: 2,
    cooked_on: today(),
  });
  await expect(page.locator("li").filter({ hasText: stew })).toContainText(
    "2 portions left",
  );
  await page.route(`${kitchen}/api/**`, away);
  await expect(
    page.getByRole("status").filter({ hasText: "Can’t reach" }),
  ).toBeVisible();
  await page.getByRole("button", { name: `Ate one, ${stew}` }).click();
  await page.getByRole("button", { name: `Ate one, ${stew}` }).click();
  await call(request, token, "batch_allocate", {
    id: second.id,
    expected_version: second.version,
    allocation: { portions: 1, status: "eaten" },
  });
  await page.unroute(`${kitchen}/api/**`, away);
  const refused = page
    .getByRole("status")
    .filter({ hasText: "The kitchen didn’t take 1 change made here." });
  await expect(refused).toBeVisible();
  await refused.getByRole("link", { name: "See why" }).click();
  await expect(title(page)).toHaveText("Waiting to send");
  await expect(page.locator("[data-rows=waiting] li")).toHaveCount(1);
  await expect(page.locator("[data-rows=waiting]")).toContainText(
    `No portion of ${stew} was left when this arrived.`,
  );
  expect(await scan(page, "Waiting to send, refused")).toEqual([]);
  await page
    .getByRole("button", { name: `Discard, Ate a portion of ${stew}` })
    .click();
  await expect(
    page.getByText("Everything made here is in the kitchen."),
  ).toBeVisible();
  list = (await kitchenNow(request, token)).batch.find(
    (b) => b.id === second.id,
  );
  expect(list.remaining_portions).toBe(0);
  expect(await stored(page, "kooks.outbox")).toBeNull();
});
