import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { batchView } from "../mcp/features.js";
import { shoppingItems } from "../mcp/shopping.js";
import {
  belongs,
  discard,
  drop,
  forgetWaiting,
  hold,
  keepChange,
  outcomes,
  retry,
  sendWaiting,
  updateInput,
  upgrade,
  waiting,
} from "../client/src/lib/outbox.js";
import { sizeOf, withWaiting } from "../client/src/lib/waiting.js";
import { mergeParts, partsPhrase, same } from "../client/src/lib/merge.js";

// A kitchen with the real tools, and a device that hears it only when it
// asks: what the device read last can be out of date, the kitchen can stop
// answering, and an answer can be lost after the change was made.
function kitchen(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  let n = 0;
  const offline = () =>
    Object.assign(new Error("Could not reach the kitchen."), {
      code: "OFFLINE",
      status: 0,
    });
  const views = () => ({
    shopping: store
      .list("shopping")
      .map((r) => ({ ...r, items: shoppingItems(r.data) })),
    batch: store.list("batch").map(batchView),
    note: store.list("note"),
    recipe: store.list("recipe"),
  });
  const k = {
    store,
    calls: [],
    down: false,
    lose: 0,
    heard: {},
    // Another cook, straight to the kitchen.
    other(name, input) {
      return tools.get(name).execute({ request_id: `other-${++n}`, ...input });
    },
    async call(name, input) {
      k.calls.push({ name, input: structuredClone(input) });
      if (k.down) throw offline();
      let result;
      try {
        result = await tools.get(name).execute(input);
      } catch (error) {
        const code = error.code ?? "INVALID_INPUT";
        throw Object.assign(new Error(error.message), {
          code,
          status:
            code === "STALE_VERSION" ? 409 : code === "NOT_FOUND" ? 404 : 400,
        });
      }
      if (k.lose > 0) {
        k.lose--;
        throw offline();
      }
      return structuredClone(result);
    },
    read: (kind, id) => k.heard[kind]?.find((r) => r.id === id),
    async refresh() {
      if (!k.down) k.heard = views();
    },
    household: () => null,
    ended() {},
  };
  k.heard = views();
  return k;
}

const groceries = (k) =>
  k.store.list("shopping")[0].data.manual_items.map((item) => item.name);

function setUp(t) {
  forgetWaiting();
  outcomes.clear();
  const k = kitchen(t);
  const list = k.other("shopping_create", { title: "Groceries" }).record;
  const recipe = k.other("recipe_save", {
    recipe: { title: "Lentil soup", servings: 4 },
  }).record;
  const batch = k.other("batch_create", {
    recipe_id: recipe.id,
    portions: 4,
    cooked_on: "2026-10-30",
  }).record;
  k.heard = {};
  return { k, list, recipe, batch };
}

const lemons = { name: "lemons", quantity: 2, original_text: "2 lemons" };
const eaten = (batch, portions) => ({
  batch: batch.id,
  title: "Lentil soup",
  ...(portions === "all" ? { all: true } : { portions }),
  date: "2026-10-31",
  slot: "Lunch",
  storage: "fridge",
});

test("changes kept without the kitchen go in the order they were made, each once, when it answers", async (t) => {
  const { k, list, recipe, batch } = setUp(t);
  await k.refresh();
  k.down = true;
  keepChange("grocery", { list: list.id, item: lemons });
  keepChange("note", {
    recipe_id: recipe.id,
    cooked_on: "2026-10-30",
    text: "More lemon next time.",
  });
  keepChange("eaten", eaten(batch, 1));
  keepChange("grocery", { list: list.id, item: { name: "parsley" } });
  await sendWaiting(k);
  assert.equal(waiting.value.length, 4, "nothing is lost while it is away");
  assert.equal(k.calls.length, 1, "the first change waits for the kitchen");

  k.down = false;
  k.calls = [];
  await sendWaiting(k);
  assert.deepEqual(
    k.calls.map((c) => c.name),
    [
      "shopping_manual_item",
      "note_save",
      "batch_allocate",
      "shopping_manual_item",
    ],
  );
  assert.deepEqual(waiting.value, []);
  assert.deepEqual(groceries(k), ["lemons", "parsley"]);
  assert.equal(k.store.list("note").length, 1);
  assert.equal(batchView(k.store.get("batch", batch.id)).remaining_portions, 3);

  // Asked again, nothing is sent twice.
  k.calls = [];
  await sendWaiting(k);
  assert.deepEqual(k.calls, []);
});

test("a change whose answer was lost is asked again exactly as it was, and is made once", async (t) => {
  const { k, list } = setUp(t);
  await k.refresh();
  const entry = keepChange("grocery", { list: list.id, item: lemons });
  k.lose = 1;
  await sendWaiting(k);
  assert.equal(groceries(k).length, 1, "the kitchen made it");
  assert.ok(waiting.value[0].sent, "the device does not know");
  // Meanwhile another cook adds to the list, so the version the device
  // sent is out of date.
  k.other("shopping_manual_item", {
    id: list.id,
    expected_version: k.store.get("shopping", list.id).version,
    item: { name: "eggs" },
  });
  await sendWaiting(k);
  assert.equal(k.calls.length, 2);
  assert.deepEqual(k.calls[1], k.calls[0], "the same call, request id and all");
  assert.equal(k.calls[1].input.request_id, entry.id);
  assert.deepEqual(groceries(k), ["lemons", "eggs"]);
  assert.deepEqual(waiting.value, []);
});

test("a change refused as stale was never made: it goes again, with its request id, against the list as it is", async (t) => {
  const { k, list } = setUp(t);
  await k.refresh();
  k.other("shopping_manual_item", {
    id: list.id,
    expected_version: list.version,
    item: { name: "eggs" },
  });
  const entry = keepChange("grocery", { list: list.id, item: lemons });
  await sendWaiting(k);
  assert.deepEqual(
    k.calls.map((c) => [c.input.request_id, c.input.expected_version]),
    [
      [entry.id, list.version],
      [entry.id, list.version + 1],
    ],
  );
  assert.deepEqual(groceries(k), ["eggs", "lemons"]);
});

test("a change the kitchen will not take waits for the member with the reason, and discarding it can be undone", async (t) => {
  const { k, batch, list } = setUp(t);
  await k.refresh();
  // Another cook eats all but one portion while this one waits.
  k.other("batch_allocate", {
    id: batch.id,
    expected_version: batch.version,
    allocation: { portions: 3, status: "eaten" },
  });
  const two = keepChange("eaten", eaten(batch, 2));
  const later = keepChange("grocery", { list: list.id, item: lemons });
  await sendWaiting(k);
  assert.equal(waiting.value.length, 1);
  assert.equal(waiting.value[0].id, two.id);
  assert.equal(
    waiting.value[0].problem.message,
    "Only 1 portion of Lentil soup was left when this arrived.",
  );
  assert.deepEqual(groceries(k), ["lemons"], "what came after it still goes");
  assert.ok(outcomes.get(later.id).done.record);

  // It is not sent again until the member says so.
  k.calls = [];
  await sendWaiting(k);
  assert.deepEqual(k.calls, []);
  const back = discard(two.id);
  assert.deepEqual(waiting.value, []);
  back();
  assert.equal(waiting.value[0].id, two.id);
  discard(two.id);

  // All gone eats whatever is left when it arrives, or nothing.
  keepChange("eaten", eaten(batch, "all"));
  keepChange("eaten", eaten(batch, "all"));
  await sendWaiting(k);
  assert.deepEqual(waiting.value, []);
  assert.equal(batchView(k.store.get("batch", batch.id)).remaining_portions, 0);
  assert.equal(
    k.calls.filter((c) => c.name === "batch_allocate").length,
    1,
    "the second had nothing left to eat",
  );

  // Asked to try again, a refused change is sent as the kitchen is now.
  const entry = keepChange("note", {
    recipe_id: "no-such-recipe",
    text: "Nice.",
  });
  await sendWaiting(k);
  assert.equal(
    waiting.value[0].problem.message,
    "recipe no-such-recipe does not exist.",
  );
  retry(entry.id);
  assert.equal(waiting.value[0].problem, undefined);
});

test("ticks keep the latest per grocery, let go of groceries no longer on the list, and keep a tick made while one is on its way", async (t) => {
  const { k, list } = setUp(t);
  const made = k.other("shopping_manual_item", {
    id: list.id,
    expected_version: list.version,
    item: { name: "eggs" },
  });
  const other = k.other("shopping_manual_item", {
    id: list.id,
    expected_version: made.record.version,
    item: { name: "flour" },
  });
  const [eggs, flour] = ["eggs", "flour"].map(
    (name) => other.items.find((row) => row.name === name).id,
  );
  await k.refresh();
  hold(list.id, [eggs, flour], true);
  hold(list.id, [flour], false);
  hold(list.id, ["gone-meanwhile"], true);
  assert.equal(waiting.value.length, 1, "one entry for the list");
  assert.equal(sizeOf(waiting.value[0]), 3);
  // A tick that reached the kitchen since says the last word.
  drop(list.id, [flour]);
  assert.deepEqual(waiting.value[0].input.ticks, {
    [eggs]: true,
    "gone-meanwhile": true,
  });

  // A tick on eggs made while the first call is on its way stays.
  const call = k.call;
  k.call = async (name, input) => {
    hold(list.id, [eggs], false);
    k.call = call;
    return call(name, input);
  };
  await sendWaiting(k);
  assert.deepEqual(waiting.value, []);
  assert.deepEqual(
    k.calls.map((c) => [c.input.item_ids, c.input.checked]),
    [
      [[eggs], true],
      [[eggs], false],
    ],
  );
  const id = waiting.value[0]?.id;
  assert.equal(id, undefined);
  assert.deepEqual(k.store.get("shopping", list.id).data.checked, []);
  assert.notEqual(
    k.calls[0].input.request_id,
    k.calls[1].input.request_id,
    "each call has its own request id",
  );
});

test("a grocery added and ticked while it waits is ticked once it is on the list", async (t) => {
  const { k, list } = setUp(t);
  await k.refresh();
  const entry = keepChange("grocery", { list: list.id, item: lemons });
  let view = withWaiting(k.heard, waiting.value);
  const row = view.shopping[0].items[0];
  assert.equal(row.waiting, entry.id);
  assert.equal(row.checked, false);
  updateInput(entry.id, (input) => ({ ...input, checked: true }));
  view = withWaiting(k.heard, waiting.value);
  assert.equal(view.shopping[0].items[0].checked, true);

  await sendWaiting(k);
  assert.deepEqual(
    k.calls.map((c) => [c.name, c.input.request_id]),
    [
      ["shopping_manual_item", entry.id],
      ["shopping_check", `${entry.id}.2`],
    ],
  );
  const now = k.store.get("shopping", list.id);
  assert.deepEqual(now.data.checked, [shoppingItems(now.data)[0].id]);
  assert.deepEqual(waiting.value, []);
});

test("what waits shows on the records meanwhile, and a change the kitchen refused does not", async (t) => {
  const { k, list, recipe, batch } = setUp(t);
  await k.refresh();
  keepChange("eaten", eaten(batch, 1));
  keepChange("note", { recipe_id: recipe.id, text: "Good." });
  const refused = keepChange("grocery", { list: list.id, item: lemons });
  waiting.value = waiting.value.map((e) =>
    e.id === refused.id ? { ...e, problem: { message: "No." } } : e,
  );
  const view = withWaiting(k.heard, waiting.value);
  const b = view.batch[0];
  assert.equal(b.available_portions, 3);
  assert.equal(b.remaining_portions, 3);
  assert.ok(b.waiting);
  assert.equal(view.note.length, 1);
  assert.equal(view.note[0].data.text, "Good.");
  assert.ok(view.note[0].waiting);
  assert.deepEqual(view.shopping[0].items, []);
  // The kitchen as heard is left as it was.
  assert.equal(k.heard.batch[0].available_portions, 4);
  assert.equal(k.heard.note.length, 0);
});

test("changes made in another household wait for it, and ticks an earlier version kept are carried over", (t) => {
  forgetWaiting();
  t.after(forgetWaiting);
  const here = keepChange(
    "note",
    { recipe_id: "r", text: "x" },
    {
      household: "home",
    },
  );
  assert.equal(belongs(here, "home"), true);
  assert.equal(belongs(here, "cabin"), false);
  assert.equal(belongs({ household: null }, "cabin"), true);

  const [ticks] = upgrade({ "list-1": { a: true, b: false }, empty: {} });
  assert.equal(ticks.kind, "ticks");
  assert.deepEqual(ticks.input, {
    list: "list-1",
    ticks: { a: true, b: false },
  });
  assert.deepEqual(upgrade(null), []);
  assert.deepEqual(
    upgrade({ entries: [{ id: "x", kind: "nonsense", input: {} }] }),
    [],
  );

  forgetWaiting();
  assert.deepEqual(waiting.value, []);
});

test("parts of a recipe changed on one side are merged, and a part both changed is a clash", () => {
  const base = {
    title: "Soup",
    servings: 4,
    steps: [{ text: "Boil." }],
    tags: [],
    notes: "",
  };
  const mine = { ...base, title: "Lemon soup", notes: "Zest first." };
  const theirs = {
    ...base,
    steps: [{ text: "Boil.", duration_seconds: null }, { text: "Serve." }],
    notes: "Zest first.",
  };
  const parts = mergeParts(base, mine, theirs);
  assert.deepEqual(parts.clashes, []);
  assert.deepEqual(parts.mine, ["title"]);
  assert.deepEqual(parts.theirs, ["steps"]);
  assert.equal(parts.merged.title, "Lemon soup");
  assert.equal(parts.merged.steps.length, 2);
  // Defaults the kitchen fills in are not changes.
  assert.ok(same({ a: [], b: null, c: "" }, {}));
  assert.ok(same([{ text: "x", equipment_names: [] }], [{ text: "x" }]));
  assert.ok(!same({ spice: 0 }, {}));
  const clash = mergeParts(base, mine, { ...base, title: "Pea soup" });
  assert.deepEqual(clash.clashes, ["title"]);
  assert.equal(partsPhrase(["steps", "title"]), "the title and method");
  assert.equal(
    partsPhrase(["notes", "ingredients", "title"]),
    "the title, ingredients and notes",
  );
});

test("an edit kept without the kitchen goes as it is, merges with changes to other parts, and waits for the member where both changed a part", async (t) => {
  const { k, recipe } = setUp(t);
  const full = k.other("recipe_save", {
    id: recipe.id,
    expected_version: recipe.version,
    recipe: {
      title: "Lentil soup",
      servings: 4,
      ingredients: [{ name: "lentils", quantity: 200, unit: "g" }],
      steps: [{ text: "Simmer." }],
      tags: ["weeknight"],
    },
  }).record;
  await k.refresh();
  const base = { version: full.version, data: full.data };
  const edit = (recipe) => ({ id: full.id, base, recipe });

  // Two edits before the kitchen answers are one change.
  const first = keepChange("edit", edit({ ...full.data, servings: 6 }));
  const again = keepChange(
    "edit",
    edit({ ...full.data, servings: 6, title: "Red lentil soup" }),
  );
  assert.equal(again.id, first.id);
  assert.equal(waiting.value.length, 1);
  // Meanwhile another cook changes the method.
  k.other("recipe_save", {
    id: full.id,
    expected_version: full.version,
    recipe: { ...full.data, steps: [{ text: "Simmer." }, { text: "Blend." }] },
  });
  await sendWaiting(k);
  assert.deepEqual(waiting.value, []);
  let now = k.store.get("recipe", full.id).data;
  assert.equal(now.title, "Red lentil soup");
  assert.equal(now.servings, 6);
  assert.equal(now.steps.length, 2, "their method is kept");
  assert.deepEqual(now.tags, ["weeknight"]);
  assert.equal(k.calls.filter((c) => c.name === "recipe_save").length, 2);

  // Both change the title: nothing is sent, and the member is asked.
  const before = k.store.get("recipe", full.id);
  await k.refresh();
  const clash = keepChange("edit", {
    id: full.id,
    base: { version: before.version, data: before.data },
    recipe: { ...before.data, title: "Lentil soup, my way" },
  });
  k.other("recipe_save", {
    id: full.id,
    expected_version: before.version,
    recipe: { ...before.data, title: "Dal" },
  });
  k.calls = [];
  await sendWaiting(k);
  assert.deepEqual(waiting.value[0].problem, {
    message: "Someone changed the title while your edit waited.",
    parts: ["title"],
  });
  assert.equal(k.store.get("recipe", full.id).data.title, "Dal");
  // Another edit of the same recipe replaces the one waiting for a choice,
  // made from the kitchen's version.
  await k.refresh();
  const dal = k.read("recipe", full.id);
  keepChange("edit", {
    id: full.id,
    base: { version: dal.version, data: dal.data },
    recipe: { ...dal.data, notes: "Lots of cumin." },
  });
  assert.equal(waiting.value.length, 1);
  assert.equal(waiting.value[0].id, clash.id);
  assert.equal(waiting.value[0].problem, undefined);
  await sendWaiting(k);
  now = k.store.get("recipe", full.id).data;
  assert.equal(now.title, "Dal");
  assert.equal(now.notes, "Lots of cumin.");

  // A recipe taken out of the cookbook meanwhile has nothing to save to.
  await k.refresh();
  const last = k.read("recipe", full.id);
  keepChange("edit", {
    id: full.id,
    base: { version: last.version, data: last.data },
    recipe: { ...last.data, servings: 2 },
  });
  k.other("record_archive", {
    kind: "recipe",
    id: full.id,
    expected_version: last.version,
    archived: true,
  });
  await sendWaiting(k);
  assert.equal(waiting.value[0].problem.gone, true);
});

test("an edit made while an earlier one is on its way waits behind it, and both arrive", async (t) => {
  const { k, recipe } = setUp(t);
  await k.refresh();
  const base = { version: recipe.version, data: recipe.data };
  const one = { ...recipe.data, servings: 6 };
  keepChange("edit", { id: recipe.id, base, recipe: one });
  k.lose = 1;
  await sendWaiting(k);
  assert.ok(waiting.value[0].sent, "its answer was lost");
  // The phone shows the first edit, so the second starts from it.
  const second = keepChange("edit", {
    id: recipe.id,
    base: { version: recipe.version, data: one },
    recipe: { ...one, notes: "Double it." },
  });
  assert.equal(waiting.value.length, 2);
  assert.notEqual(second.id, waiting.value[0].id);
  await sendWaiting(k);
  assert.deepEqual(waiting.value, []);
  const now = k.store.get("recipe", recipe.id);
  assert.equal(now.data.servings, 6);
  assert.equal(now.data.notes, "Double it.");
  assert.equal(now.version, recipe.version + 2);
});
