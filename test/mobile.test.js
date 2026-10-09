import test from "node:test";
import assert from "node:assert/strict";
import { createRepository } from "../app/repository.js";
import {
  newCookbook,
  parseBackup,
  snapshot,
  validateBackup,
} from "../app/model.js";
import { notificationChanges, notificationId } from "../app/timers.js";

function memoryAdapter(files = new Map()) {
  return {
    files,
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, value) {
      files.set(name, value);
    },
    async writeAtomic(name, value) {
      files.set(name, value);
    },
  };
}

test("mobile cookbook round-trips recipes larger than the old widget state limit", () => {
  const book = newCookbook();
  book.state.notes.orzo = "A family recipe. ".repeat(3000);
  assert.deepEqual(parseBackup(JSON.stringify(book)), book);
  assert.equal(
    snapshot({ ...book.state, view: "editor" }, book.design).state.view,
    "library",
  );
});

test("mobile recipes keep links and accept only web addresses", () => {
  const book = newCookbook();
  const custom = {
    id: "linked",
    title: "Linked rice",
    description: "",
    tag: "Your collection",
    time: null,
    servings: 2,
    source: "Your recipe",
    ingredients: [],
    steps: [{ title: "Step 1", text: "Cook.", ids: [] }],
    note: "",
    equipment: [],
  };
  book.state.custom = [custom];
  assert.deepEqual(validateBackup(book).state.custom[0].links, []);
  book.state.custom = [
    {
      ...custom,
      links: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "The method" }],
    },
  ];
  assert.equal(
    validateBackup(book).state.custom[0].links[0].title,
    "The method",
  );
  book.state.custom = [{ ...custom, links: [{ url: "javascript:alert(1)" }] }];
  assert.throws(() => validateBackup(book), /web addresses/);
});

test("mobile restore rejects broken relationships, invalid versions, and duplicate records", () => {
  const book = newCookbook();
  book.state.meals[0].components[0].recipeId = "missing";
  assert.throws(() => validateBackup(book), /missing recipe/);
  assert.throws(() => validateBackup({ ...newCookbook(), schemaVersion: 99 }));
  const duplicate = newCookbook();
  duplicate.state.meals.push(structuredClone(duplicate.state.meals[0]));
  assert.throws(() => validateBackup(duplicate), /duplicate meals/);
  const malicious = JSON.parse(JSON.stringify(newCookbook()));
  malicious.state.notes = JSON.parse('{"__proto__":"bad"}');
  assert.equal(
    Object.hasOwn(validateBackup(malicious).state.notes, "__proto__"),
    false,
  );
  malicious.state.notes = { constructor: "bad" };
  assert.throws(() => validateBackup(malicious));
});

test("mobile writes serialize and preserve the previous complete snapshot", async () => {
  const adapter = memoryAdapter();
  const repository = createRepository(adapter, parseBackup);
  assert.equal((await repository.load()).data, null);
  const first = newCookbook();
  const second = structuredClone(first);
  second.state.notes.orzo = "More lemon";
  await Promise.all([repository.save(first), repository.save(second)]);
  assert.equal(
    parseBackup(adapter.files.get("cookbook.json")).state.notes.orzo,
    "More lemon",
  );
  assert.equal(
    parseBackup(adapter.files.get("cookbook.previous.json")).state.notes.orzo,
    undefined,
  );
});

test("mobile failed writes keep durable data and do not poison later saves", async () => {
  const adapter = memoryAdapter();
  const statuses = [];
  const repository = createRepository(adapter, parseBackup, (status) =>
    statuses.push(status),
  );
  await repository.load();
  await repository.save(newCookbook());
  const original = adapter.files.get("cookbook.json");
  const write = adapter.writeAtomic;
  adapter.writeAtomic = async () => {
    throw new Error("No disk space");
  };
  const next = newCookbook();
  next.state.notes.orzo = "Keep this note";
  await assert.rejects(repository.save(next), /disk space/);
  assert.equal(adapter.files.get("cookbook.json"), original);
  assert.ok(statuses.includes("error"));
  adapter.writeAtomic = write;
  await repository.save(next);
  assert.equal(
    parseBackup(adapter.files.get("cookbook.json")).state.notes.orzo,
    "Keep this note",
  );
});

test("mobile recovers a prior valid snapshot without rotating corrupt data over it", async () => {
  const good = JSON.stringify(newCookbook());
  const adapter = memoryAdapter(
    new Map([
      ["cookbook.json", "{broken"],
      ["cookbook.previous.json", good],
    ]),
  );
  const repository = createRepository(adapter, parseBackup);
  const loaded = await repository.load();
  assert.equal(loaded.recovered, true);
  await repository.save(loaded.data);
  assert.equal(adapter.files.get("cookbook.previous.json"), good);
  assert.doesNotThrow(() => parseBackup(adapter.files.get("cookbook.json")));
});

test("mobile storage read errors and unrecoverable corruption never reset the cookbook", async () => {
  const adapter = memoryAdapter(new Map([["cookbook.json", "{broken"]]));
  const repository = createRepository(adapter, parseBackup);
  await assert.rejects(repository.load(), /could not be read/);
  await assert.rejects(repository.save(newCookbook()), /Load the cookbook/);
  assert.equal(adapter.files.get("cookbook.json"), "{broken");
  const unreadable = createRepository(
    {
      ...adapter,
      read: async () => {
        throw new Error("Permission denied");
      },
    },
    parseBackup,
  );
  await assert.rejects(unreadable.load(), /Permission denied/);
});

test("mobile timers schedule once, cancel on pause/finish, and reschedule on resume", () => {
  const now = 1000;
  const timer = {
    id: "timer-1",
    notificationId: 42,
    label: "Orzo",
    endAt: 61000,
    pausedMs: null,
  };
  const scheduled = notificationChanges([timer], [], now);
  assert.equal(scheduled.schedule[0].schedule.at.getTime(), 61000);
  assert.deepEqual(notificationChanges([timer], scheduled.schedule, now), {
    cancel: [],
    schedule: [],
  });
  const paused = notificationChanges(
    [{ ...timer, pausedMs: 20000 }],
    scheduled.schedule,
    now,
  );
  assert.deepEqual(paused, { cancel: [{ id: 42 }], schedule: [] });
  assert.deepEqual(notificationChanges([], scheduled.schedule, now).cancel, [
    { id: 42 },
  ]);
  const resumed = notificationChanges(
    [{ ...timer, endAt: 91000 }],
    scheduled.schedule,
    now,
  );
  assert.equal(resumed.schedule[0].schedule.at.getTime(), 91000);
  assert.deepEqual(resumed.cancel, [{ id: 42 }]);
  assert.equal(notificationChanges([timer], [], 62000).schedule.length, 0);
  assert.deepEqual(
    notificationChanges([], [{ id: 9, extra: { other: true } }], now),
    { cancel: [], schedule: [] },
  );
});

test("mobile notification identifiers are unique even for timers started in the same millisecond", () => {
  const first = notificationId([], 2147483647);
  const second = notificationId([{ notificationId: first }], 2147483647);
  assert.notEqual(first, second);
  assert.ok(first > 0 && second <= 2147483647);
});

test("mobile facets validate against the shared lists and older single labels become tags", () => {
  const book = newCookbook();
  const legacy = {
    id: "legacy",
    title: "Legacy rice",
    description: "",
    tag: "Comfort food",
    time: null,
    servings: 2,
    source: "Your recipe",
    ingredients: [],
    steps: [{ title: "Step 1", text: "Cook.", ids: [] }],
    note: "",
    equipment: [],
  };
  const { tag, ...bare } = legacy;
  book.state.custom = [
    legacy,
    { ...legacy, id: "placeholder", tag: "Your collection" },
    { ...legacy, id: "tagged", tags: ["Weeknight"] },
  ];
  const restored = validateBackup(book).state.custom;
  assert.deepEqual(restored[0].tags, ["Comfort food"]);
  assert.equal("tag" in restored[0], false);
  assert.equal(restored[0].course, null);
  assert.equal(restored[0].cuisine, "");
  assert.deepEqual(restored[0].diets, []);
  assert.deepEqual(restored[1].tags, []);
  assert.deepEqual(restored[2].tags, ["Weeknight"]);
  book.state.custom = [
    {
      ...bare,
      course: "main",
      cuisine: "Israeli",
      diets: ["vegan"],
      tags: ["Weeknight", "Shabbat"],
    },
  ];
  const faceted = validateBackup(book).state.custom[0];
  assert.equal(faceted.course, "main");
  assert.equal(faceted.cuisine, "Israeli");
  assert.deepEqual(faceted.diets, ["vegan"]);
  assert.equal(tag, "Comfort food");
  book.state.custom = [{ ...bare, course: "lunch" }];
  assert.throws(() => validateBackup(book));
  book.state.custom = [{ ...bare, diets: ["paleo"] }];
  assert.throws(() => validateBackup(book));
  // A cooking session snapshot of an older recipe is upgraded the same way.
  book.state.custom = [legacy];
  book.state.session = {
    recipeId: "legacy",
    snapshot: legacy,
    servings: 2,
    units: "metric",
    step: 0,
    timers: [],
  };
  const session = validateBackup(book).state.session;
  assert.deepEqual(session.snapshot.tags, ["Comfort food"]);
  assert.equal("tag" in session.snapshot, false);
  assert.deepEqual(parseBackup(JSON.stringify(newCookbook())), newCookbook());
});
