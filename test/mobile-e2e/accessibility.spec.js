import { test, expect } from "@playwright/test";
import { scan } from "../axe-scan.js";

// Every view of the mobile app, in both themes, checked by axe against WCAG
// 2.2 AA: on a phone in both palettes, and on a tablet-wide screen.
const nav = (page, name) =>
  page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: new RegExp(`^${name}\\b`) })
    .first();
const main = (page) => page.getByRole("main");
const settings = (page) =>
  page.getByRole("button", { name: "Settings", exact: true }).first();

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
});

async function walk(page, label) {
  const problems = [];
  const check = async (view) =>
    problems.push(...(await scan(page, `${label} ${view}`)));
  await nav(page, "Today").click();
  await check("today");
  await nav(page, "Recipes").click();
  await check("recipes");
  await main(page)
    .getByRole("button", { name: /^Open / })
    .first()
    .click();
  await check("recipe");
  await main(page).getByRole("button", { name: "Shop", exact: true }).click();
  await check("shopping review");
  await page.getByRole("button", { name: /^Add \d+ items/ }).click();
  await check("shopping list");
  await nav(page, "Recipes").click();
  await main(page)
    .getByRole("button", { name: /^Open / })
    .first()
    .click();
  await main(page).getByRole("button", { name: "Cook", exact: true }).click();
  await page.getByRole("button", { name: "Add a 5-minute timer" }).click();
  await check("cooking");
  await nav(page, "Plan").click();
  await check("plan");
  await page.getByRole("button", { name: "Meals" }).click();
  await check("meals");
  await page.getByRole("button", { name: "New meal" }).first().click();
  await check("meal editor");
  await page.getByRole("button", { name: "Add recipe" }).first().click();
  await check("add a recipe");
  await page.getByRole("button", { name: /Write it myself/ }).click();
  await check("recipe editor");
  for (const tab of ["Backup", "Preferences", "Timers", "Assistant"]) {
    await settings(page).click();
    await page.getByRole("button", { name: tab, exact: true }).click();
    await check(`settings ${tab}`);
  }
  return problems;
}

test("every view meets WCAG 2.2 AA on a phone in both themes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  expect(await walk(page, "phone")).toEqual([]);
});

test("every view meets WCAG 2.2 AA in the clay palette", async ({ page }) => {
  test.setTimeout(120_000);
  await settings(page).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Color").selectOption("Clay");
  expect(await walk(page, "clay")).toEqual([]);
});

test("every view meets WCAG 2.2 AA on a wide screen", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await walk(page, "wide")).toEqual([]);
});
