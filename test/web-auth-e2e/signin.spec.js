import { test, expect } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The browser app against web/server.js with sign-in on. Sign-in emails land
// in an outbox directory, and a virtual authenticator stands in for Touch ID,
// Face ID or a screen lock.
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

// Touch ID, Face ID or a screen lock, simulated: it confirms every request
// at once, including a passkey suggested in the email field.
async function virtualAuthenticator(context, page) {
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
}
// Each test has its own member, so one test's passkeys never meet another's.
async function signInByLink(page, email) {
  const before = mails().length;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox." }),
  ).toBeVisible();
  await expect.poll(() => mails().length).toBe(before + 1);
  const link = latestLink();
  await page.goto(link);
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  return link;
}

test("a member signs in by email link, adds a passkey and returns with one tap", async ({
  page,
  context,
}) => {
  await virtualAuthenticator(context, page);
  // This browser offers no passkey suggestions, so the button is the way in.
  await page.addInitScript(() => {
    if (window.PublicKeyCredential)
      PublicKeyCredential.isConditionalMediationAvailable = () =>
        Promise.resolve(false);
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to your kitchen." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Add recipe" })).toHaveCount(0);
  // Strangers and members get the same answer; only members get an email.
  const before = mails().length;
  await page.getByLabel("Email address").fill("stranger@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox." }),
  ).toBeVisible();
  expect(mails().length).toBe(before);
  await page.getByRole("button", { name: "Use a different address" }).click();
  const link = await signInByLink(page, "Cook@Example.test");
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByText("You’re signed in.")).toBeVisible();
  // The link is spent; opening it again while signed in just says so.
  await page.goto(link);
  await expect(page.getByText(/expired or was already used/)).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  // One tap next time: the prompt registers a passkey on this device.
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(
    page.getByText("Passkey added. Next time, sign in with one tap."),
  ).toBeVisible();
  await expect(page.locator(".passkey-prompt")).toHaveCount(0);
  await page.getByRole("link", { name: "Sign-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Signed in as cook@example.test" }),
  ).toBeVisible();
  const passkeys = page.locator(".list-item");
  await expect(passkeys).toHaveCount(1);
  await expect(passkeys).toContainText("Added");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to your kitchen." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign-in" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome back.")).toBeVisible();
  await expect(page.locator(".passkey-prompt")).toHaveCount(0);
  await page.getByRole("link", { name: "Sign-in" }).click();
  await expect(passkeys).toContainText("Last used");
  await page.getByRole("button", { name: /^Remove passkey/ }).click();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  // Signed out, a spent link shows the sign-in screen with the reason.
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Welcome to your kitchen." }),
  ).toBeVisible();
  await expect(page.locator("[data-login-error]")).toContainText(
    "expired or was already used",
  );
});

test("a browser that suggests the saved passkey signs the member in without a tap", async ({
  page,
  context,
}) => {
  await virtualAuthenticator(context, page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to your kitchen." }),
  ).toBeVisible();
  await signInByLink(page, "baker@example.test");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(
    page.getByText("Passkey added. Next time, sign in with one tap."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  // The sign-in screen suggests the passkey; picking it is the whole sign-in.
  await expect(page.getByText("Welcome back.")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Signed in as baker@example.test" }),
  ).toBeVisible();
  await expect(page.locator(".list-item")).toContainText("Last used");
  await page.getByRole("button", { name: /^Remove passkey/ }).click();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  // The device still offers its passkey, but the kitchen no longer knows it.
  await expect(
    page.getByRole("heading", { name: "Welcome to your kitchen." }),
  ).toBeVisible();
  await expect(page.locator("[data-login-error]")).toContainText(
    "not registered with this kitchen",
  );
});
