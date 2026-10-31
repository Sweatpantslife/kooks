import test from "node:test";
import assert from "node:assert/strict";
import { kitchenAddress } from "../client/src/lib/device.js";
import { SystemBarsStyle } from "@capacitor/core";
import {
  barStyleFor,
  notificationChanges,
  notificationIdOf,
} from "../client/src/lib/native.js";
import { oldPhoneRecipes } from "../client/src/lib/old-phone.js";
import {
  drop,
  forgetWaiting,
  hold,
  release,
  waiting,
  waitingCount,
} from "../client/src/lib/outbox.js";
import { recipe } from "../mcp/schemas.js";

test("the phone takes the kitchen's address as typed, as an https origin", () => {
  assert.equal(
    kitchenAddress("kooks.example.com"),
    "https://kooks.example.com",
  );
  assert.equal(
    kitchenAddress("  https://Kooks.Example.com:8443/week?x=1  "),
    "https://kooks.example.com:8443",
  );
  // A phone reaches the kitchen only over https; a browser trying the
  // phone's screens may use a kitchen on this computer.
  assert.equal(kitchenAddress("http://127.0.0.1:4317", { plain: false }), null);
  assert.equal(
    kitchenAddress("http://127.0.0.1:4317", { plain: true }),
    "http://127.0.0.1:4317",
  );
  for (const typed of ["", "   ", "ftp://kooks.example.com", "https://", "a b"])
    assert.equal(kitchenAddress(typed), null, typed);
});

const session = (title, timers) => ({ data: { title, timers } });
const now = Date.parse("2026-10-30T18:00:00Z");
const later = (minutes) => new Date(now + minutes * 60000).toISOString();

test("the phone rings for every timer still counting, and for nothing else", () => {
  const sessions = [
    session("Dal", [
      { id: "t1", label: "Rice", deadline: later(10) },
      { id: "t2", label: "Onions", deadline: later(-1) },
      { id: "t3", label: "Bread", deadline: later(5), cancelled: true },
    ]),
    session("Pho", [{ id: "t4", label: "Broth", deadline: later(90) }]),
  ];
  const first = notificationChanges(sessions, [], now);
  assert.deepEqual(first.cancel, []);
  assert.deepEqual(
    first.schedule.map((n) => [n.id, n.title, n.body, n.schedule.at]),
    [
      [notificationIdOf("t1"), "Time’s up", "Rice · Dal", new Date(later(10))],
      [notificationIdOf("t4"), "Time’s up", "Broth · Pho", new Date(later(90))],
    ],
  );
  assert.ok(first.schedule.every((n) => n.channelId === "kooks-timers"));

  // Nothing changes when the phone already holds them; a timer moved on
  // another device is scheduled again, and one taken away is cancelled.
  // Other apps' notifications are left alone.
  const pending = [
    ...first.schedule,
    { id: 99, extra: { other: true } },
    {
      id: notificationIdOf("gone"),
      extra: { kooksTimer: true, deadline: "x" },
    },
  ];
  assert.deepEqual(notificationChanges(sessions, first.schedule, now), {
    cancel: [],
    schedule: [],
  });
  sessions[1].data.timers[0].deadline = later(95);
  const next = notificationChanges(sessions, pending, now);
  assert.deepEqual(next.cancel, [
    { id: notificationIdOf("t4") },
    { id: notificationIdOf("gone") },
  ]);
  assert.deepEqual(
    next.schedule.map((n) => n.extra.deadline),
    [later(95)],
  );
});

test("a timer's notification id is a stable whole number a phone can hold", () => {
  const ids = ["t1", "t2", "a".repeat(500), "😀", ""].map(notificationIdOf);
  for (const id of ids) {
    assert.ok(Number.isInteger(id) && id >= 1 && id <= 2147483647, `${id}`);
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(notificationIdOf("t1"), ids[0]);
});

const oldFile = (custom, format = "kooks-mobile") =>
  JSON.stringify({ format, schemaVersion: 1, state: { custom } });

test("the previous phone app's recipes come in as kitchen recipes", () => {
  const found = oldPhoneRecipes(
    oldFile([
      {
        id: "recipe-a1",
        title: "  Lemon orzo ",
        description: "Bright and quick.",
        course: "main",
        cuisine: "Greek",
        diets: ["vegetarian", "not-a-diet"],
        tag: "Weeknight",
        time: 25,
        servings: 4,
        source: "https://example.test/orzo",
        favorite: true,
        ingredients: [
          {
            n: "orzo",
            q: 300,
            u: "g",
            group: "Pantry",
            note: "rinsed",
            raw: "300 g orzo, rinsed",
          },
          { n: "salt", q: null, u: "" },
          { n: "  ", q: 1, u: "" },
        ],
        steps: [
          { title: "Boil", text: "Cook the orzo.", mins: 9 },
          { title: "", text: "Stir in the lemon." },
          { title: "", text: "" },
        ],
        note: "More lemon next time.",
        originalText: "Lemon orzo\n300 g orzo",
        equipment: ["Pot", ""],
        links: [
          { url: "https://www.youtube.com/watch?v=abc", title: "Video" },
          { url: "javascript:alert(1)", title: "Bad" },
        ],
      },
      { id: "recipe-b2", title: "Toast", source: "Grandma", tags: ["Snack"] },
      { id: "recipe-c3", title: "   " },
    ]),
  );
  assert.deepEqual(
    found.map((r) => r.key),
    ["old-phone-recipe-a1", "old-phone-recipe-b2"],
  );
  const [orzo, toast] = found.map((r) => r.recipe);
  assert.deepEqual(orzo, {
    title: "Lemon orzo",
    servings: 4,
    original_text: "Lemon orzo\n300 g orzo",
    source_url: "https://example.test/orzo",
    links: [{ url: "https://www.youtube.com/watch?v=abc", title: "Video" }],
    ingredients: [
      {
        name: "orzo",
        quantity: 300,
        unit: "g",
        preparation: "rinsed",
        category: "Pantry",
        original_text: "300 g orzo, rinsed",
      },
      {
        name: "salt",
        quantity: null,
        unit: "",
        preparation: "",
        category: "Other",
        original_text: "",
      },
    ],
    steps: [
      { text: "Boil: Cook the orzo.", duration_seconds: 540 },
      { text: "Stir in the lemon.", duration_seconds: null },
    ],
    equipment: [{ name: "Pot" }],
    course: "main",
    cuisine: "Greek",
    diets: ["vegetarian"],
    tags: ["Weeknight"],
    notes: "Bright and quick.\n\nMore lemon next time.",
    favorite: true,
    total_minutes: 25,
  });
  // A source that is not a web address is kept as a note.
  assert.equal(toast.source_url, null);
  assert.equal(toast.notes, "From Grandma");
  assert.deepEqual(toast.tags, ["Snack"]);
  // Every recipe is one the kitchen accepts as it is.
  for (const r of found) assert.ok(recipe.safeParse(r.recipe).success);
});

test("only the previous phone app's own file is read, and its limits are the kitchen's", () => {
  assert.deepEqual(oldPhoneRecipes("not json"), []);
  assert.deepEqual(
    oldPhoneRecipes(oldFile([{ id: "a", title: "X" }], "x")),
    [],
  );
  assert.deepEqual(oldPhoneRecipes(JSON.stringify(null)), []);
  const [big] = oldPhoneRecipes(
    oldFile([
      {
        id: "b".repeat(300),
        title: "t".repeat(900),
        description: "d".repeat(20000),
        note: "n".repeat(20000),
        servings: 50000,
        time: 99999,
        tags: Array.from({ length: 150 }, (_, i) => `tag ${i}`),
        ingredients: Array.from({ length: 600 }, () => ({ n: "x", q: 2e9 })),
        steps: Array.from({ length: 600 }, () => ({ text: "s", mins: 99999 })),
        equipment: Array.from({ length: 150 }, () => "pan"),
        links: Array.from({ length: 80 }, (_, i) => ({
          url: `https://example.test/${i}`,
          title: "l".repeat(900),
        })),
      },
    ]),
  );
  assert.ok(big.key.length <= 128);
  const r = big.recipe;
  assert.equal(r.title.length, 500);
  assert.equal(r.notes.length, 30000);
  assert.equal(r.servings, 10000);
  assert.equal(r.total_minutes, 10080);
  assert.equal(r.tags.length, 100);
  assert.equal(r.ingredients.length, 500);
  assert.equal(r.ingredients[0].quantity, null);
  assert.equal(r.steps.length, 500);
  assert.equal(r.steps[0].duration_seconds, 604800);
  assert.equal(r.equipment.length, 100);
  assert.equal(r.links.length, 50);
  assert.equal(r.links[0].title.length, 500);
  assert.ok(recipe.safeParse(r).success);
});

test("ticks made out of the kitchen's reach keep only the latest for each grocery", () => {
  forgetWaiting();
  hold("list-1", ["a", "b"], true);
  hold("list-1", ["b"], false);
  hold("list-2", ["c"], true);
  assert.deepEqual(waiting.value, {
    "list-1": { a: true, b: false },
    "list-2": { c: true },
  });
  assert.equal(waitingCount(), 3);
  // Sent as they were: a tick changed since stays to be sent.
  hold("list-1", ["a"], false);
  release("list-1", { a: true, b: false });
  assert.deepEqual(waiting.value, {
    "list-1": { a: false },
    "list-2": { c: true },
  });
  // A tick made with the kitchen answering says the last word.
  drop("list-1", ["a"]);
  drop("list-3", ["x"]);
  assert.deepEqual(waiting.value, { "list-2": { c: true } });
  forgetWaiting();
  assert.equal(waitingCount(), 0);
});

// A look chosen by hand must not leave dark text on a dark page under the
// status bar, or light text on a light one.
test("the phone's bars follow the app's look", () => {
  assert.equal(barStyleFor("system"), SystemBarsStyle.Default);
  assert.equal(barStyleFor("dark"), SystemBarsStyle.Dark);
  assert.equal(barStyleFor("light"), SystemBarsStyle.Light);
});
