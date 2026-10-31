import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The app, built into client/dist and served by web/server.js: once on the
// server without sign-in (port 4318) and once with it (port 4319, where
// sign-in emails land in an outbox directory).
const signedIn = "http://localhost:4319/";
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

// The accessibility suites' scan: WCAG 2.2 A and AA plus axe's best
// practices, in the light and the dark theme.
async function expectAccessible(page, label) {
  expect(await scan(page, label)).toEqual([]);
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
    await page.goto("/");
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

    for (const [tab, heading] of [
      ["Week", "This week"],
      ["Recipes", "Recipes"],
      ["Groceries", "To buy"],
    ]) {
      await nav.getByRole("link", { name: tab }).click();
      await expect(title(page)).toHaveText(heading);
      await expect(title(page)).toBeFocused();
      await expectAccessible(page, `${tab}, ${name}`);
    }
    await page.getByRole("link", { name: "Household" }).click();
    await expect(title(page)).toHaveText("Household");
    await expect(title(page)).toBeFocused();
    await expectAccessible(page, `Household, ${name}`);
  });

test("the look chosen in Household is kept by this browser", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/household");
  await page.getByRole("link", { name: /^Look and units/ }).click();
  await expect(title(page)).toHaveText("Look and units");
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
  await page.goto("/#/today");
  await expect(page).toHaveURL(/#\/week$/);
  await expect(title(page)).toHaveText("This week");
  await page.goto("/#/shop/pantry");
  await expect(page).toHaveURL(/#\/groceries$/);
  await page.goto("/#/settings/household");
  await expect(page).toHaveURL(/#\/household\/people$/);
  await page.goto("/#/settings/preferences");
  await expect(page).toHaveURL(/#\/household\/look$/);
  await page.goto("/#/settings");
  await expect(page).toHaveURL(/#\/household$/);
  await page.goto("/#/account");
  await expect(page).toHaveURL(/#\/household\/signin$/);
  await expect(page.getByText("Nobody signs in here")).toBeVisible();
  // Its pages about one record open that record's page here.
  for (const [from, to] of [
    ["imports/d1", "recipes/draft/d1"],
    ["recipes/r1/variant", "recipes/r1/variation"],
    ["recipes/r1/memory", "recipes/r1/note"],
    ["recipes/new/inspiration/i1", "recipes/idea/i1/write"],
    ["plan/meals/m1", "recipes/meal/m1"],
    ["plan/meals/new", "recipes/meal/new"],
    ["shop/review/meal/m1", "groceries/add/meal/m1"],
  ]) {
    await page.goto(`/#/${from}`);
    await expect(page).toHaveURL(new RegExp(`#/${to}$`));
    await expect(title(page)).toBeVisible();
  }
  await page.goto("/#/nowhere");
  await expect(title(page)).toHaveText("Not found");
  await expectAccessible(page, "Not found");
  await page.getByRole("link", { name: "Go to this week" }).click();
  await expect(title(page)).toHaveText("This week");
});

test("the skip link moves focus past the navigation without changing the page", async ({
  page,
}) => {
  await page.goto("/#/recipes");
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

// The member opens the link exactly as the email gives it.
async function signInByLink(page, email) {
  const before = mails().length;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(title(page)).toHaveText("Check your inbox.");
  await expect(title(page)).toBeFocused();
  await expect.poll(() => mails().length).toBe(before + 1);
  await page.goto(latestLink());
  await expect(title(page)).toHaveText("This week");
  await expect(page).toHaveURL(/#\/week$/);
}

// Household › Sign-in, the way a member finds it.
async function openSignIn(page) {
  await page.getByRole("link", { name: "Household" }).click();
  await page.getByRole("link", { name: /^Sign-in/ }).click();
  await expect(title(page)).toHaveText("Sign-in");
}

async function addPasskey(page, email) {
  await openSignIn(page);
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

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(title(page)).toHaveText("Welcome to your kitchen.");
  await expect(page.getByRole("status")).toContainText("Signed out.");
  await expect(page).toHaveURL(/#\/week$/);

  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(title(page)).toHaveText("This week");
  await expect(page.getByRole("status")).toContainText("Welcome back.");

  // Leave the member as the test found them.
  await openSignIn(page);
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
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  // The sign-in page asks quietly; the device answers with its passkey.
  await expect(page.getByRole("status")).toContainText("Welcome back.");
  await expect(title(page)).toHaveText("This week");

  await openSignIn(page);
  await page.getByRole("button", { name: /^Remove passkey / }).click();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
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

const latestInvite = () =>
  readFileSync(join(outbox, mails().at(-1)), "utf8").match(
    /http:\/\/localhost:4319\/#\/join\/[A-Za-z0-9_-]+/,
  )[0];

test("a member invites someone new, who joins by the emailed link, and someone taken out starts a kitchen of their own", async ({
  page,
  browser,
}) => {
  const newcomer = `newcomer-${Date.now()}@example.test`;
  await page.goto(signedIn);
  await signInByLink(page, "cook@example.test");
  await page.getByRole("link", { name: "Household" }).click();
  await expect(title(page)).toHaveText("Our kitchen");
  await page.getByRole("link", { name: /^Members/ }).click();
  await expect(title(page)).toHaveText("Members");
  await expect(page.getByText("cook@example.test")).toBeVisible();
  await page.getByLabel("Their email address").fill(newcomer);
  const before = mails().length;
  await page.getByRole("button", { name: "Send an invite" }).click();
  await expect(page.getByRole("status")).toContainText(
    `Invite sent to ${newcomer}.`,
  );
  await expect(
    page.getByRole("button", { name: `Withdraw the invite to ${newcomer}` }),
  ).toBeVisible();
  await expectAccessible(page, "Household › Members");
  await expect.poll(() => mails().length).toBe(before + 1);
  const invite = latestInvite();

  // The invite opens in another browser: it names the household and who
  // asked, and joining signs that browser in.
  const theirs = await browser.newContext();
  const them = await theirs.newPage();
  them.on("pageerror", (error) => {
    throw error;
  });
  await them.goto(invite);
  await expect(title(them)).toHaveText("Join Our kitchen");
  await expect(them.getByText("cook@example.test invited")).toBeVisible();
  await expectAccessible(them, "Join a household");
  await them.getByRole("button", { name: `Join as ${newcomer}` }).click();
  await expect(title(them)).toHaveText("This week");
  await expect(them.getByRole("status")).toContainText(
    "Welcome to Our kitchen.",
  );
  await them.goto(invite);
  await expect(title(them)).toHaveText("This invite can’t be used");

  // The owner takes them out again; at their next look they are signed in
  // to no household, and start one.
  await page.reload();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: `Remove ${newcomer} from the household` })
    .click();
  await expect(page.getByRole("status")).toContainText(
    `${newcomer} is no longer in the household.`,
  );
  await them.goto(signedIn);
  await expect(title(them)).toHaveText("Welcome to Kooks.");
  await expectAccessible(them, "Welcome, no household");
  await them.getByLabel("Household name").fill("Newcomer’s flat");
  await them.getByRole("button", { name: "Start your kitchen" }).click();
  await expect(title(them)).toHaveText("This week");
  await them.getByRole("link", { name: "Household" }).click();
  await expect(title(them)).toHaveText("Newcomer’s flat");
  await theirs.close();
});

test("members say who they are at the table, see who changed what, and are asked before undoing someone else's change", async ({
  page,
  browser,
}) => {
  const tag = Date.now().toString(36);
  const cook = `Cook ${tag}`;
  const baker = `Baker ${tag}`;
  await page.goto(signedIn);
  await signInByLink(page, "cook@example.test");

  // The member adds themselves to the table.
  await page.goto(`${signedIn}#/household/people`);
  await expect(title(page)).toHaveText("People at the table");
  await expect(
    page.getByRole("heading", { name: "Which one is you?" }),
  ).toBeVisible();
  await expectAccessible(page, "People at the table, who is you");
  await page.getByLabel("Your name").fill(cook);
  await page.getByRole("button", { name: "Add me" }).click();
  await expect(page.getByRole("status")).toContainText(
    `You’re at the table as ${cook}.`,
  );
  await expect(
    page.getByRole("heading", { name: `You’re ${cook}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: cook }).getByText("You"),
  ).toBeVisible();
  await expectAccessible(page, "People at the table, linked");

  // Another member sees that person is taken, and picks their own.
  const theirs = await browser.newContext();
  const them = await theirs.newPage();
  them.on("pageerror", (error) => {
    throw error;
  });
  await them.goto(signedIn);
  await signInByLink(them, "baker@example.test");
  await them.goto(`${signedIn}#/household/people`);
  const cookCard = them.getByRole("listitem").filter({ hasText: cook });
  await expect(cookCard.getByText("A member")).toBeVisible();
  await expect(
    them.getByRole("button", { name: `This is me: ${cook}` }),
  ).toHaveCount(0);
  await them.getByLabel("Your name").fill(baker);
  await them.getByRole("button", { name: "Add me" }).click();
  await expect(
    them.getByRole("heading", { name: `You’re ${baker}` }),
  ).toBeVisible();
  const made = await them.request.post(`${signedIn}api/tools/recipe_save`, {
    headers: { Origin: signedIn.slice(0, -1) },
    data: {
      request_id: `baker-${tag}`,
      recipe: { title: `Rye ${tag}` },
    },
  });
  expect(made.ok(), await made.text()).toBe(true);
  await theirs.close();

  // History names who did what, by their name at the table.
  await page.goto(`${signedIn}#/household`);
  await page.getByRole("link", { name: /^Recent changes/ }).click();
  await expect(title(page)).toHaveText("Recent changes");
  const bakersLine = page
    .getByRole("listitem")
    .filter({ hasText: `${baker} added Rye ${tag}` });
  await expect(bakersLine).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: `You added ${cook} to the table` }),
  ).toBeVisible();
  await expect(page.getByText("@example.test")).toHaveCount(0);
  await expectAccessible(page, "Household › Recent changes");

  // Undoing someone else's change asks first, by their name.
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    return dialog.accept();
  });
  await bakersLine.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByRole("status")).toContainText("Undone.");
  expect(asked).toBe(`Undo ${baker}’s change?`);
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: `You undid a change to Rye ${tag}` }),
  ).toBeVisible();

  // Members shows who each member is at the table, and the owner can take
  // a claim back.
  await page.goto(`${signedIn}#/household/members`);
  await expect(
    page.getByText(`At the table as ${baker}`, { exact: false }),
  ).toBeVisible();
  await expectAccessible(page, "Household › Members, linked");
  await page
    .getByRole("button", { name: `Unlink baker@example.test from ${baker}` })
    .click();
  await expect(page.getByRole("status")).toContainText(
    `baker@example.test is no longer ${baker} at the table.`,
  );
  await expect(
    page.getByText(`At the table as ${baker}`, { exact: false }),
  ).toHaveCount(0);

  // What can I make? asks who's eating: everyone to start, you first, and
  // this browser remembers "Just me".
  const soup = await page.request.post(`${signedIn}api/tools/recipe_save`, {
    headers: { Origin: signedIn.slice(0, -1) },
    data: {
      request_id: `cook-${tag}`,
      recipe: { title: `Soup ${tag}`, steps: [{ text: "Simmer." }] },
    },
  });
  expect(soup.ok(), await soup.text()).toBe(true);
  await page.goto(`${signedIn}#/recipes`);
  await page.getByRole("button", { name: "What can I make?" }).click();
  const eating = page.getByRole("group", { name: "Who’s eating" });
  await expect(eating.getByRole("button").nth(1)).toHaveText(`${cook} (you)`);
  await expect(eating.getByRole("button", { name: baker })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await eating.getByRole("button", { name: "Just me" }).click();
  await expect(eating.getByRole("button", { name: baker })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expectAccessible(page, "What can I make?, who's eating");
  await page.reload();
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(
    page
      .getByRole("group", { name: "Who’s eating" })
      .getByRole("button", { name: "Just me" }),
  ).toHaveAttribute("aria-pressed", "true");

  // A cooking job is one tap to take on.
  await page.goto(
    `${signedIn}#/recipes/${encodeURIComponent((await soup.json()).record.id)}`,
  );
  await page.getByRole("button", { name: "Cook" }).click();
  await expect(title(page)).toHaveText("Step 1 of 1");
  const jobs = page.getByRole("region", { name: "Jobs" });
  await jobs.getByRole("textbox", { name: "A job" }).fill("Set the table");
  await jobs.getByRole("textbox", { name: "A job" }).press("Enter");
  await jobs.getByRole("button", { name: "I’ll do it: Set the table" }).click();
  await expect(
    jobs
      .getByRole("combobox", { name: "Who: Set the table" })
      .locator("option:checked"),
  ).toHaveText(`${cook} (you)`);
  await expect(
    jobs.getByRole("button", { name: "I’ll do it: Set the table" }),
  ).toHaveCount(0);
  await expectAccessible(page, "Cooking, a job taken");
  await page.getByRole("link", { name: "Finish" }).click();
  await page.getByRole("button", { name: "Done cooking" }).click();
  await expect(page.getByRole("status")).toContainText(`Soup ${tag} is done.`);

  // Saying "That's not me" leaves the person at the table.
  await page.goto(`${signedIn}#/household/people`);
  await page.getByRole("button", { name: "That’s not me" }).click();
  await expect(
    page.getByRole("heading", { name: "Which one is you?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `This is me: ${cook}` }),
  ).toBeVisible();
  await expectAccessible(page, "People at the table, choosing");
});
