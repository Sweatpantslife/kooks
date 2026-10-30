import { test, expect } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../axe-scan.js";

// The sign-in screens of the browser app with sign-in on, in both themes,
// checked by axe against WCAG 2.2 AA: signing in by email, the passkey
// offer, the member's sign-in settings and a spent link.
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
});

test("the sign-in screens meet WCAG 2.2 AA in both themes", async ({
  page,
  context,
}) => {
  // A device with a passkey authenticator that offers no passkey suggestions,
  // as in the sign-in tests: without one, the browser rejects the suggestion
  // request in the background and its message replaces the spent link's.
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.addInitScript(() => {
    if (window.PublicKeyCredential)
      PublicKeyCredential.isConditionalMediationAvailable = () =>
        Promise.resolve(false);
  });
  const problems = [];
  const check = async (label) => problems.push(...(await scan(page, label)));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to your kitchen." }),
  ).toBeVisible();
  await check("sign in");
  const before = mails().length;
  await page.getByLabel("Email address").fill("baker@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox." }),
  ).toBeVisible();
  await check("check your inbox");
  await expect.poll(() => mails().length).toBe(before + 1);
  const link = latestLink();
  await page.goto(link);
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  await check("today with the passkey offer");
  await page.getByRole("link", { name: "Sign-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Signed in as baker@example.test" }),
  ).toBeVisible();
  await check("sign-in settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(link);
  await expect(page.locator("[data-login-error]")).toContainText(
    "expired or was already used",
  );
  await check("spent link");
  expect(problems).toEqual([]);
});
