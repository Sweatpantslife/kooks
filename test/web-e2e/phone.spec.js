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
    "1 tick on the grocery list will go when it answers.",
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
