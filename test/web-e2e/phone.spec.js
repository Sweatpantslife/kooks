import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pagePolicy } from "../../client/page-policy.js";

// The phone app's screens, tried in a browser: `kooks.phone` makes the page
// sign in the way the phone app does, with the kitchen's address, an emailed
// code and a device token, against the server with sign-in on.
const kitchen = "http://localhost:4319";
const outbox = process.env.KOOKS_E2E_OUTBOX;
const mails = () => (existsSync(outbox) ? readdirSync(outbox).sort() : []);
const latestCode = () =>
  readFileSync(join(outbox, mails().at(-1)), "utf8").match(
    /Your Kooks code: (\d{6})/,
  )[1];

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.addInitScript(() => localStorage.setItem("kooks.phone", "1"));
});

const title = (page) => page.getByRole("heading", { level: 1 });
const stored = (page, key) =>
  page.evaluate((name) => localStorage.getItem(name), key);

async function emailCode(page, email) {
  const before = mails().length;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(title(page)).toHaveText("Check your inbox.");
  await expect(title(page)).toBeFocused();
  await expect.poll(() => mails().length).toBe(before + 1);
  return latestCode();
}

async function openThisPhone(page) {
  await page.getByRole("link", { name: "Household" }).click();
  await page.getByRole("link", { name: /^Sign-in/ }).click();
  await expect(page.getByRole("heading", { name: "This phone" })).toBeVisible();
}

test("on a phone, a member finds the kitchen, signs in with an emailed code, and signs out", async ({
  page,
  context,
  request,
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
  await expect(page.getByText(`sign in to ${kitchen}`)).toBeVisible();
  expect(await scan(page, "Phone sign-in, email")).toEqual([]);

  const code = await emailCode(page, "baker@example.test");
  expect(await scan(page, "Phone sign-in, code")).toEqual([]);
  const wrong = code.replace(/.$/, (digit) => String((Number(digit) + 1) % 10));
  await page.getByLabel("Code").fill(wrong);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("That code is not right");
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
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
  await page
    .getByLabel("Code")
    .fill(await emailCode(page, "baker@example.test"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(title(page)).toHaveText("This week");
  await openThisPhone(page);
  await page
    .getByRole("button", { name: "Sign out and use another kitchen" })
    .click();
  await expect(title(page)).toHaveText("Where is your kitchen?");
  expect(await stored(page, "kooks.kitchen")).toBeNull();
});
