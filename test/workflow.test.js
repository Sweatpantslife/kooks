import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";

function harness(t, path = ":memory:") {
  const store = new Store(path);
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  let sequence = 0;
  return {
    store,
    call(name, input = {}) {
      const tool = tools.get(name);
      return tool.execute(
        tool.readOnly ? input : { request_id: `test-${++sequence}`, ...input },
      );
    },
  };
}
const dish = (title = "Orzo", oil = 30, temperature = 200) => ({
  title,
  servings: 4,
  original_text: `Original ${title}: 4 portions, ${oil} mL oil. Cook at ${temperature} C for 15 minutes.`,
  ingredients: [
    { name: "Olive oil", quantity: oil, unit: "mL" },
    { name: title, quantity: 250, unit: "g" },
  ],
  steps: [
    { text: "Prepare ingredients." },
    { text: `Cook at ${temperature} C.`, duration_seconds: 900 },
  ],
  equipment: [{ name: "Oven", quantity: 1, temperature_celsius: temperature }],
});
function setupMeal(call) {
  const a = call("recipe_save", { recipe: dish() }).record;
  const b = call("recipe_save", { recipe: dish("Salad", 15, 220) }).record;
  const meal = call("meal_save", {
    meal: {
      title: "Dinner",
      dishes: [
        { recipe_id: a.id, servings: 6 },
        { recipe_id: b.id, servings: 4 },
      ],
    },
  }).record;
  return { a, b, meal, source: { kind: "meal", id: meal.id } };
}
function sync(call, listId, source, sourceKey = "dinner", exclude = []) {
  const input = {
    id: listId,
    source,
    source_key: sourceKey,
    exclude_ingredients: exclude,
  };
  const preview = call("shopping_preview", input);
  return call("shopping_sync", {
    ...input,
    expected_version: preview.list_version,
    preview_token: preview.preview_token,
  });
}
const oil = (items) => items.find((item) => item.name === "Olive oil");
const hasCode = (code) => (error) => error.code === code;

test("compose, scale, plan, shop, check, repeat and remove contributions without duplication", (t) => {
  const { call } = harness(t);
  const { a, source } = setupMeal(call);
  call("equipment_save", { equipment: { name: "Oven", quantity: 1 } });
  const prepared = call("prepare_source", { source });
  assert.equal(prepared.dishes[0].ingredients[0].quantity, 45);
  assert.equal(prepared.dishes[0].steps[1].duration_seconds, 900);
  assert.match(
    prepared.equipment.requirements[0].conflicts.join(" "),
    /Different temperatures/,
  );
  const plan = call("plan_save", { source, date: "2026-09-20" }).record;
  const list = call("shopping_create", { title: "Weekend" }).record;
  let result = sync(call, list.id, { kind: "plan", id: plan.id });
  assert.equal(oil(result.items).quantity, 60);
  assert.equal(oil(result.items).contributions.length, 2);
  const checked = call("shopping_check", {
    id: list.id,
    expected_version: result.record.version,
    item_ids: [oil(result.items).id],
    checked: true,
  });
  result = sync(call, list.id, { kind: "plan", id: plan.id });
  assert.equal(oil(result.items).quantity, 60);
  assert.equal(oil(result.items).checked, true);
  assert.deepEqual(result.diff, { added: [], removed: [], changed: [] });
  const manual = call("shopping_manual_item", {
    id: list.id,
    expected_version: result.record.version,
    item: { name: "Coffee", quantity: 1, unit: "kg" },
  });
  result = sync(call, list.id, source, "second-dinner");
  assert.equal(oil(result.items).quantity, 120);
  assert.equal(oil(result.items).checked, false);
  result = call("shopping_remove_source", {
    id: list.id,
    expected_version: result.record.version,
    source_key: "second-dinner",
  });
  assert.equal(oil(result.items).quantity, 60);
  assert.equal(result.items.find((i) => i.name === "Coffee").quantity, 1000);
  assert.equal(
    result.items.find((i) => i.name === "Coffee").contributions[0].id,
    manual.item_id,
  );
  call("recipe_save", {
    id: a.id,
    expected_version: a.version,
    recipe: dish("Orzo", 100),
  });
  assert.equal(
    call("prepare_source", { source: { kind: "plan", id: plan.id } }).dishes[0]
      .ingredients[0].quantity,
    45,
  );
  assert.equal(
    call("prepare_source", { source }).dishes[0].ingredients[0].quantity,
    150,
  );
  assert.equal(checked.record.version, 3);
});

test("shopping changes require a current preview and stale operations leave the list untouched", (t) => {
  const { call } = harness(t);
  const { a, source } = setupMeal(call);
  const list = call("shopping_create", { title: "Groceries" }).record;
  const input = {
    id: list.id,
    source,
    source_key: "dinner",
    exclude_ingredients: [],
  };
  const preview = call("shopping_preview", input);
  call("recipe_save", {
    id: a.id,
    expected_version: a.version,
    recipe: dish("Orzo", 40),
  });
  assert.throws(
    () =>
      call("shopping_sync", {
        ...input,
        expected_version: 1,
        preview_token: preview.preview_token,
      }),
    hasCode("STALE_PREVIEW"),
  );
  assert.equal(
    call("kooks_get", { kind: "shopping", id: list.id }).record.version,
    1,
  );
  assert.throws(
    () => sync(call, list.id, source, "dinner", ["dish-9:1"]),
    hasCode("INVALID_EXCLUSION"),
  );
  const first = sync(call, list.id, source, "dinner", ["dish-1:0"]);
  assert.equal(oil(first.items).quantity, 15);
  const secondPreview = call("shopping_preview", input);
  call("shopping_manual_item", {
    id: list.id,
    expected_version: first.record.version,
    item: { name: "Milk" },
  });
  assert.throws(
    () =>
      call("shopping_sync", {
        ...input,
        expected_version: secondPreview.list_version,
        preview_token: secondPreview.preview_token,
      }),
    hasCode("STALE_VERSION"),
  );
});

test("ambiguous quantities, yields and measurements are preserved rather than guessed", (t) => {
  const { call } = harness(t);
  const recipe = call("recipe_save", {
    recipe: {
      title: "Draft",
      ingredients: [{ name: "Salt", quantity: null, unit: "g" }],
    },
  }).record;
  assert.throws(
    () => call("recipe_scale", { id: recipe.id, servings: 6 }),
    hasCode("MISSING_YIELD"),
  );
  assert.equal(
    call("recipe_scale", { id: recipe.id }).recipe.ingredients[0].quantity,
    null,
  );
  assert.throws(
    () => call("quantity_convert", { quantity: 1, from: "cup", to: "mL" }),
    hasCode("AMBIGUOUS_CONVERSION"),
  );
  assert.throws(
    () => call("quantity_convert", { quantity: 1, from: "mL", to: "g" }),
    hasCode("AMBIGUOUS_CONVERSION"),
  );
  assert.equal(
    call("quantity_convert", { quantity: 1, from: "metric_cup", to: "mL" })
      .quantity,
    250,
  );
  assert.equal(
    call("quantity_convert", { quantity: 100, from: "C", to: "F" }).quantity,
    212,
  );
  const list = call("shopping_create", { title: "Units" }).record;
  let version = 1;
  for (const item of [
    { name: "Salt", unit: "g" },
    { name: "Salt", unit: "g", quantity: 5 },
    { name: "Salt", unit: "mL", quantity: 5 },
    { name: "Flour", unit: "kg", quantity: 1 },
    { name: "Flour", unit: "g", quantity: 500 },
    { name: "Flour", unit: "g", quantity: 100, preparation: "sifted" },
  ]) {
    version = call("shopping_manual_item", {
      id: list.id,
      expected_version: version,
      item,
    }).record.version;
  }
  const { items } = call("kooks_get", { kind: "shopping", id: list.id }).record;
  assert.equal(items.filter((item) => item.name === "Salt").length, 3);
  assert.equal(
    items.find((item) => item.name === "Flour" && !item.preparation).quantity,
    1500,
  );
  assert.equal(
    items.find((item) => item.preparation === "sifted").quantity,
    100,
  );
});

test("editing only recipe notes preserves bought items; changed quantities reset them", (t) => {
  const { call } = harness(t);
  const { a, source } = setupMeal(call);
  const list = call("shopping_create", { title: "Checkmarks" }).record;
  let result = sync(call, list.id, source);
  call("shopping_check", {
    id: list.id,
    expected_version: result.record.version,
    item_ids: [oil(result.items).id],
    checked: true,
  });
  const edited = call("recipe_save", {
    id: a.id,
    expected_version: 1,
    recipe: { ...a.data, notes: "Remember the garnish" },
  }).record;
  result = sync(call, list.id, source);
  assert.equal(oil(result.items).checked, true);
  call("recipe_save", {
    id: a.id,
    expected_version: edited.version,
    recipe: dish("Orzo", 40),
  });
  result = sync(call, list.id, source);
  assert.equal(oil(result.items).checked, false);
  assert.equal(oil(result.items).quantity, 75);
});

test("idempotency, optimistic edits, dependencies and undo protect later changes", (t) => {
  const { call } = harness(t);
  const input = { request_id: "stable-save", recipe: dish() };
  const first = call("recipe_save", input);
  const replay = call("recipe_save", input);
  assert.equal(replay.record.id, first.record.id);
  assert.equal(replay.replayed, true);
  assert.throws(
    () => call("recipe_save", { ...input, recipe: dish("Changed") }),
    hasCode("REQUEST_ID_REUSED"),
  );
  assert.equal(call("kooks_list", { kind: "recipe" }).total, 1);
  const edited = call("recipe_save", {
    id: first.record.id,
    expected_version: 1,
    recipe: dish("New title"),
  });
  assert.throws(
    () =>
      call("recipe_save", {
        id: first.record.id,
        expected_version: 1,
        recipe: dish("Lost edit"),
      }),
    hasCode("STALE_VERSION"),
  );
  assert.throws(
    () => call("history_undo", { action_id: first.action_id }),
    hasCode("UNDO_CONFLICT"),
  );
  const undo = call("history_undo", { action_id: edited.action_id });
  assert.equal(undo.records[0].data.title, "Orzo");
  assert.equal(undo.records[0].version, 3);
  const another = call("recipe_save", { recipe: dish("Dependency") });
  call("meal_save", {
    meal: {
      title: "Uses dependency",
      dishes: [{ recipe_id: another.record.id }],
    },
  });
  assert.throws(
    () => call("history_undo", { action_id: another.action_id }),
    hasCode("ARCHIVED"),
  );
  assert.equal(
    call("kooks_get", { kind: "recipe", id: another.record.id }).record
      .archived,
    false,
  );
  assert.throws(
    () =>
      call("record_archive", {
        kind: "recipe",
        id: another.record.id,
        expected_version: 1,
        archived: true,
      }),
    hasCode("IN_USE"),
  );
  const disposable = call("recipe_save", { recipe: dish("Temporary") });
  call("history_undo", { action_id: disposable.action_id });
  assert.equal(
    call("kooks_get", {
      kind: "recipe",
      id: disposable.record.id,
      include_archived: true,
    }).record.archived,
    true,
  );
});

test("multi-dish cooking preserves snapshots, independent progress and timer deadlines across restart", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "kooks-restart-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "cookbook.sqlite");
  const first = new Store(path);
  const tools = new Map(createTools(first).map((tool) => [tool.name, tool]));
  let sequence = 0;
  const call = (name, input = {}) =>
    tools
      .get(name)
      .execute({
        ...(tools.get(name).readOnly
          ? {}
          : { request_id: `restart-${++sequence}` }),
        ...input,
      });
  const { a, source } = setupMeal(call);
  let session = call("cooking_start", { source }).record;
  session = call("cooking_progress", {
    id: session.id,
    expected_version: session.version,
    dish_id: "dish-1",
    current_step: 1,
    completed_steps: [0],
  }).record;
  session = call("cooking_timer", {
    id: session.id,
    expected_version: session.version,
    dish_id: "dish-2",
    step_index: 1,
    label: "Salad timer",
    duration_seconds: 120,
  }).record;
  call("recipe_save", {
    id: a.id,
    expected_version: 1,
    recipe: dish("Edited during cooking", 100),
  });
  first.close();
  const { call: restored } = harness(t, path);
  const resumed = restored("kooks_get", {
    kind: "session",
    id: session.id,
  }).record;
  assert.equal(resumed.data.dishes[0].title, "Orzo");
  assert.equal(resumed.data.dishes[0].ingredients[0].quantity, 45);
  assert.equal(resumed.data.progress[0].current_step, 1);
  assert.equal(resumed.data.progress[1].current_step, 0);
  assert.equal(
    resumed.data.timers[0].deadline,
    session.data.timers[0].deadline,
  );
  assert.ok(
    resumed.timers[0].remaining_seconds > 0 &&
      resumed.timers[0].remaining_seconds <= 120,
  );
  assert.throws(
    () =>
      restored("cooking_progress", {
        id: session.id,
        expected_version: session.version,
        dish_id: "dish-1",
        current_step: 9,
        completed_steps: [],
      }),
    hasCode("INVALID_STEP"),
  );
  const note = restored("note_save", {
    recipe_id: a.id,
    session_id: session.id,
    text: "Use less salt next time.",
    cooked_on: "2026-09-19",
  });
  assert.equal(note.record.data.text, "Use less salt next time.");
  const finished = restored("cooking_finish", {
    id: session.id,
    expected_version: session.version,
    notes: "Done",
  }).record;
  assert.equal(finished.data.timers[0].cancelled, true);
});

test("a complete backup restores all records and rejects invalid or destructive restores", (t) => {
  const { call } = harness(t);
  const { a, source } = setupMeal(call);
  call("equipment_save", { equipment: { name: "Oven", quantity: 1 } });
  const plan = call("plan_save", { source, date: "2026-09-20" }).record;
  const list = call("shopping_create", { title: "Backup shopping" }).record;
  sync(call, list.id, { kind: "plan", id: plan.id });
  const session = call("cooking_start", { source }).record;
  call("cooking_timer", {
    id: session.id,
    expected_version: 1,
    label: "Oven",
    duration_seconds: 60,
  });
  call("note_save", {
    recipe_id: a.id,
    session_id: session.id,
    text: "Good meal",
  });
  const backup = call("backup_export").backup;
  const target = harness(t);
  const restored = target.call("backup_restore", { backup });
  assert.equal(restored.restored_records, backup.records.length);
  assert.deepEqual(target.call("backup_export").backup.records, backup.records);
  assert.throws(
    () => target.call("backup_restore", { backup }),
    hasCode("RESTORE_NOT_EMPTY"),
  );
  const invalid = structuredClone(backup);
  invalid.records.find((r) => r.kind === "meal").data.dishes[0].recipe_id =
    "missing";
  const empty = harness(t);
  assert.throws(
    () => empty.call("backup_restore", { backup: invalid }),
    hasCode("INVALID_BACKUP"),
  );
  assert.equal(empty.call("kooks_status").counts.recipe, 0);
  const brokenCheckmark = structuredClone(backup);
  brokenCheckmark.records
    .find((record) => record.kind === "shopping")
    .data.checked.push("missing");
  assert.throws(
    () => empty.call("backup_restore", { backup: brokenCheckmark }),
    hasCode("INVALID_BACKUP"),
  );
  assert.equal(empty.call("kooks_status").counts.recipe, 0);
});

test("two connections to one database reject stale edits without losing the winning write", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "kooks-concurrency-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "cookbook.sqlite");
  const first = harness(t, path),
    second = harness(t, path);
  const recipe = first.call("recipe_save", {
    request_id: "create-shared",
    recipe: dish(),
  }).record;
  const seen = second.call("kooks_get", {
    kind: "recipe",
    id: recipe.id,
  }).record;
  first.call("recipe_save", {
    request_id: "winning-edit",
    id: recipe.id,
    expected_version: recipe.version,
    recipe: dish("Winner"),
  });
  assert.throws(
    () =>
      second.call("recipe_save", {
        request_id: "stale-edit",
        id: seen.id,
        expected_version: seen.version,
        recipe: dish("Stale"),
      }),
    hasCode("STALE_VERSION"),
  );
  assert.equal(
    second.call("kooks_get", { kind: "recipe", id: recipe.id }).record.data
      .title,
    "Winner",
  );
});

test("invalid dates, servings, fields and references fail before writes", (t) => {
  const { call } = harness(t);
  assert.throws(() =>
    call("recipe_save", { recipe: { title: "Zero", servings: 0 } }),
  );
  assert.throws(() =>
    call("recipe_save", {
      recipe: { title: "Too small", servings: Number.MIN_VALUE },
    }),
  );
  assert.throws(() =>
    call("recipe_save", { unexpected: true, recipe: dish() }),
  );
  assert.throws(
    () =>
      call("meal_save", {
        meal: { title: "Missing", dishes: [{ recipe_id: "missing" }] },
      }),
    hasCode("NOT_FOUND"),
  );
  const recipe = call("recipe_save", { recipe: dish() }).record;
  assert.throws(() =>
    call("plan_save", {
      source: { kind: "recipe", id: recipe.id },
      date: "2026-02-30",
    }),
  );
  assert.throws(
    () =>
      call("recipe_save", { id: recipe.id, recipe: dish("Missing version") }),
    hasCode("INVALID_INPUT"),
  );
  assert.equal(call("kooks_status").counts.meal, 0);
  assert.equal(
    call("kooks_get", { kind: "recipe", id: recipe.id }).record.version,
    1,
  );
});
