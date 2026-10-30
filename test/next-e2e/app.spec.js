import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The redesigned app, built into client/dist and served by web/server.js at
// /next/: once on the server without sign-in (port 4318) and once with it
// (port 4319, where sign-in emails land in an outbox directory).
const signedIn = "http://localhost:4319/next/";
const outbox = process.env.KOOKS_E2E_OUTBOX;
const mails = () => (existsSync(outbox) ? readdirSync(outbox).sort() : []);
const latestToken = () =>
  readFileSync(join(outbox, mails().at(-1)), "utf8").match(
    /#\/signin\/([A-Za-z0-9_-]+)/,
  )[1];

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

// WCAG 2.2 A and AA plus axe's best practices, on whatever the page shows.
async function expectAccessible(page, label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`),
    label,
  ).toEqual([]);
}

const title = (page) => page.getByRole("heading", { level: 1 });

for (const [name, viewport] of [
  ["phone", { width: 390, height: 844 }],
  ["wide screen", { width: 1280, height: 900 }],
])
  test(`on a ${name}, the three tabs and Household open, take focus and pass an accessibility scan in both themes`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/next/");
    await expect(title(page)).toHaveText("This week");
    await expect(page).toHaveTitle("This week · Kooks");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText([
      "Week",
      "Recipes",
      "Groceries",
    ]);
    await expect(nav.getByRole("link", { name: "Week" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [tab, heading] of [
        ["Week", "This week"],
        ["Recipes", "Recipes"],
        ["Groceries", "Groceries"],
      ]) {
        await nav.getByRole("link", { name: tab }).click();
        await expect(title(page)).toHaveText(heading);
        await expect(title(page)).toBeFocused();
        await expectAccessible(page, `${tab}, ${scheme}, ${name}`);
      }
      await page.getByRole("link", { name: "Household" }).click();
      await expect(title(page)).toHaveText("Household");
      await expect(title(page)).toBeFocused();
      await expectAccessible(page, `Household, ${scheme}, ${name}`);
    }
  });

test("the look chosen in Household is kept by this browser", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/next/#/household");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme");
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(21, 20, 18)",
  );
  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "Device" }).check();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("addresses from the previous app land on the page that replaced them, and unknown ones say so", async ({
  page,
}) => {
  await page.goto("/next/#/today");
  await expect(page).toHaveURL(/#\/week$/);
  await expect(title(page)).toHaveText("This week");
  await page.goto("/next/#/shop/pantry");
  await expect(page).toHaveURL(/#\/groceries$/);
  await page.goto("/next/#/settings/household");
  await expect(page).toHaveURL(/#\/household$/);
  await page.goto("/next/#/nowhere");
  await expect(title(page)).toHaveText("Not found");
  await expectAccessible(page, "Not found");
  await page.getByRole("link", { name: "Go to this week" }).click();
  await expect(title(page)).toHaveText("This week");
});

test("the skip link moves focus past the navigation without changing the page", async ({
  page,
}) => {
  await page.goto("/next/#/recipes");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page).toHaveURL(/#\/recipes$/);
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

// The emailed link opens the current app; the same token works here.
async function signInByLink(page, email) {
  const before = mails().length;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(title(page)).toHaveText("Check your inbox.");
  await expect(title(page)).toBeFocused();
  await expect.poll(() => mails().length).toBe(before + 1);
  await page.goto(`${signedIn}#/signin/${latestToken()}`);
  await expect(title(page)).toHaveText("This week");
  await expect(page).toHaveURL(/#\/week$/);
}

async function addPasskey(page, email) {
  await page.getByRole("link", { name: "Household" }).click();
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  await page
    .getByRole("button", { name: "Add a passkey on this device" })
    .click();
  await expect(page.getByRole("status")).toContainText("Passkey added.");
  await expect(
    page.getByRole("button", { name: /^Remove passkey / }),
  ).toHaveCount(1);
}

test("a member signs in by email link, adds a passkey, signs out and returns with it", async ({
  page,
  context,
}) => {
  await virtualAuthenticator(context, page);
  // No passkey suggestions in the email field, so the button is the way in.
  await page.addInitScript(() => {
    window.PublicKeyCredential.isConditionalMediationAvailable = async () =>
      false;
  });

  await page.goto(signedIn);
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expectAccessible(page, "Sign in");
  await signInByLink(page, "taster@example.test");
  await expect(page.getByRole("status")).toContainText("You’re signed in.");
  await addPasskey(page, "taster@example.test");
  await expectAccessible(page, "Household, signed in");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expect(page.getByRole("status")).toContainText("Signed out.");
  await expect(page).toHaveURL(/#\/week$/);

  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(title(page)).toHaveText("This week");
  await expect(page.getByRole("status")).toContainText("Welcome back.");

  // Leave the member as the test found them.
  await page.getByRole("link", { name: "Household" }).click();
  await page.getByRole("button", { name: /^Remove passkey / }).click();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
});

test("a browser that suggests the saved passkey signs the member in without a tap, and says when the kitchen no longer knows it", async ({
  page,
  context,
}) => {
  await virtualAuthenticator(context, page);
  await page.goto(signedIn);
  await signInByLink(page, "taster@example.test");
  await addPasskey(page, "taster@example.test");
  await page.getByRole("button", { name: "Sign out" }).click();
  // The sign-in page asks quietly; the device answers with its passkey.
  await expect(page.getByRole("status")).toContainText("Welcome back.");
  await expect(title(page)).toHaveText("This week");

  await page.getByRole("link", { name: "Household" }).click();
  await page.getByRole("button", { name: /^Remove passkey / }).click();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expect(page.getByRole("alert")).toContainText(
    "not registered with this kitchen",
  );
});

test("a used or unknown sign-in link explains itself on the sign-in page", async ({
  page,
}) => {
  // This browser has no authenticator, so its quiet passkey suggestion fails;
  // that failure must not replace the reason the link did not work.
  await page.addInitScript(() => {
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = (options) => {
      const request = get(options);
      if (options?.mediation === "conditional")
        window.quietPasskey = request.then(
          () => "picked",
          (error) => error.name,
        );
      return request;
    };
  });
  await page.goto(`${signedIn}#/signin/not-a-real-token`);
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expect(page).toHaveURL(/#\/week$/);
  await page.waitForFunction(() => window.quietPasskey);
  expect(await page.evaluate(() => window.quietPasskey)).not.toBe("picked");
  await expect(page.getByRole("alert")).toHaveText(
    "This sign-in link has expired or was already used. Request a new one.",
  );
});
