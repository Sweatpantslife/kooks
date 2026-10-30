import test from "node:test";
import assert from "node:assert/strict";
import { Store, KooksError } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { Kooks } from "../mcp/kooks.js";

// Writes check only the records they touched and the meals and variants of a
// touched recipe. A long random run of edits, archives and undos must never
// leave the cookbook in a state that checking every record would reject.
test("checking only what a write touched never accepts what a full check rejects", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  const kooks = new Kooks(store);
  let seed = 20261030,
    n = 0;
  const random = (count) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor((seed / 2147483648) * count);
  };
  const skip = new Error("Nothing to choose from yet");
  const pick = (items) => {
    if (!items.length) throw skip;
    return items[random(items.length)];
  };
  const call = (name, input) =>
    tools.get(name).execute({ request_id: `fuzz-${++n}`, ...input });
  const current = (kind, id) => store.get(kind, id, true);
  const ids = { recipe: [], meal: [], budget: [] },
    actions = [],
    refusals = new Map();
  const recipe = (title) => ({
    title,
    servings: random(4) ? 2 : null,
    ingredients: [{ name: "Rice", quantity: 100, unit: "g" }],
    steps: [{ text: "Cook." }],
  });
  const operations = [
    () => call("recipe_save", { recipe: recipe(`Recipe ${n}`) }),
    () =>
      call("recipe_variant_save", {
        original_recipe_id: pick(ids.recipe),
        recipe: recipe(`Variant ${n}`),
        preferred: Boolean(random(2)),
      }),
    // A direct save can change a recipe's yield, parent and preference.
    () => {
      const r = current("recipe", pick(ids.recipe));
      return call("recipe_save", {
        id: r.id,
        expected_version: r.version,
        recipe: {
          ...r.data,
          servings: random(3) ? 2 : null,
          original_recipe_id: random(3) ? null : pick(ids.recipe),
          preferred: Boolean(random(2)),
        },
      });
    },
    () =>
      call("meal_save", {
        meal: {
          title: `Meal ${n}`,
          dishes: Array.from({ length: 1 + random(3) }, () => ({
            recipe_id: pick(ids.recipe),
            servings: random(2) ? 3 : null,
          })),
        },
      }),
    () =>
      call("budget_save", {
        budget: {
          week_start: pick(["2026-10-26", "2026-11-02", "2026-11-03"]),
          currency: pick(["USD", "EUR"]),
          amount: 100,
        },
      }),
    () => {
      const kind = pick(["recipe", "recipe", "meal", "budget"]);
      const r = current(kind, pick(ids[kind]));
      return call("record_archive", {
        kind,
        id: r.id,
        expected_version: r.version,
        archived: !r.archived,
      });
    },
    () => call("history_undo", { action_id: pick(actions) }),
    () =>
      call("technique_save", {
        technique: { title: `Technique ${n}`, recipe_ids: [pick(ids.recipe)] },
      }),
    () =>
      call("batch_create", {
        recipe_id: pick(ids.recipe),
        portions: 2,
        cooked_on: "2026-10-30",
      }),
  ];
  call("recipe_save", { recipe: recipe("First") });
  ids.recipe.push(store.list("recipe")[0].id);
  for (let step = 0; step < 600; step++) {
    let result;
    try {
      result = pick(operations)();
    } catch (error) {
      if (error === skip) continue;
      assert.ok(error instanceof KooksError, error.stack);
      refusals.set(error.code, (refusals.get(error.code) ?? 0) + 1);
      continue;
    }
    actions.push(result.action_id);
    const created = result.record;
    if (created?.version === 1) {
      const kind = ["recipe", "meal", "budget"].find(
        (k) =>
          !ids[k].includes(created.id) &&
          store.list(k, true).some((r) => r.id === created.id),
      );
      if (kind) ids[kind].push(created.id);
    }
    store.read(() => kooks.validateRelations());
  }
  // The run reached the cross-record refusals it is meant to exercise.
  for (const code of [
    "ARCHIVED",
    "INVALID_VARIANT",
    "MISSING_YIELD",
    "DUPLICATE_BUDGET",
    "INVALID_WEEK",
  ])
    assert.ok(refusals.get(code) > 0, `no ${code} refusal`);
  assert.ok(actions.length > 250);
});

test("saving, varying and archiving a recipe reads only its family and meals", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  let n = 0;
  const call = (name, input) =>
    tools.get(name).execute({ request_id: `read-${++n}`, ...input });
  const recipe = (title) => ({
    title,
    servings: 2,
    ingredients: [{ name: "Rice", quantity: 100, unit: "g" }],
    steps: [{ text: "Cook." }],
  });
  const ids = Array.from(
    { length: 50 },
    (_, i) => call("recipe_save", { recipe: recipe(`Recipe ${i}`) }).record.id,
  );
  call("meal_save", {
    meal: { title: "Dinner", dishes: [{ recipe_id: ids[1], servings: 4 }] },
  });
  const listed = [];
  const list = store.list.bind(store);
  store.list = (kind, ...rest) => {
    listed.push(kind);
    return list(kind, ...rest);
  };
  const variant = call("recipe_variant_save", {
    original_recipe_id: ids[0],
    recipe: recipe("Recipe 0, my way"),
  }).record;
  call("recipe_save", {
    id: variant.id,
    expected_version: variant.version,
    recipe: { ...variant.data, title: "Recipe 0, our way" },
  });
  const original = store.get("recipe", ids[0]);
  assert.throws(
    () =>
      call("record_archive", {
        kind: "recipe",
        id: original.id,
        expected_version: original.version,
        archived: true,
      }),
    (error) =>
      error.code === "IN_USE" && error.message.includes("Recipe 0, our way"),
  );
  const used = store.get("recipe", ids[1]);
  assert.throws(
    () =>
      call("recipe_save", {
        id: used.id,
        expected_version: used.version,
        recipe: { ...used.data, servings: null },
      }),
    (error) => error.code === "MISSING_YIELD",
  );
  assert.deepEqual(listed, []);
});
