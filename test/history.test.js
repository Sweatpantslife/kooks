import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, UNDO_DAYS } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";

const DAY = 24 * 60 * 60 * 1000;
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
const dish = (title) => ({
  title,
  servings: 4,
  original_text: `${title}: rice and onion for four.`,
  ingredients: [
    { name: "Rice", quantity: 300, unit: "g" },
    { name: "Onion", quantity: 1, unit: "" },
  ],
  steps: [{ text: "Cook the rice with the onion." }],
});
const code = (expected) => (error) => error.code === expected;
const historyBytes = (store) =>
  store.db
    .prepare("SELECT sum(length(changes) + length(result)) AS n FROM actions")
    .get().n;

test("actions older than the undo window keep their history line but not their copies", (t) => {
  const { store, call } = harness(t);
  const created = call("recipe_save", {
    request_id: "create-orzo",
    recipe: dish("Orzo"),
  });
  const edited = call("recipe_save", {
    id: created.record.id,
    expected_version: 1,
    recipe: dish("Lemon orzo"),
  });
  const recent = call("recipe_save", { recipe: dish("Pilaf") });
  const old = new Date(Date.now() - (UNDO_DAYS + 1) * DAY).toISOString();
  store.db
    .prepare("UPDATE actions SET created_at = ? WHERE id IN (?, ?)")
    .run(old, created.action_id, edited.action_id);
  const before = historyBytes(store);
  assert.equal(store.trimHistory(), 2);
  assert.equal(store.trimHistory(), 0);
  assert.ok(historyBytes(store) < before / 2);

  const actions = call("history_list").actions;
  assert.deepEqual(
    actions.map((action) => [action.id, action.trimmed]),
    [
      [recent.action_id, false],
      [edited.action_id, true],
      [created.action_id, true],
    ],
  );
  assert.deepEqual(actions[1].changes, [
    {
      kind: "recipe",
      id: created.record.id,
      before_version: 1,
      after_version: 2,
    },
  ]);
  assert.deepEqual(actions[2].changes[0].before_version, null);

  assert.throws(
    () => call("history_undo", { action_id: edited.action_id }),
    code("UNDO_EXPIRED"),
  );
  assert.equal(
    call("kooks_get", { kind: "recipe", id: created.record.id }).record.data
      .title,
    "Lemon orzo",
  );
  // Recent actions undo as before.
  call("history_undo", { action_id: recent.action_id });
  assert.equal(call("kooks_status").counts.recipe, 1);

  // A retry still recognises the old request, though it can only return the
  // action's id now; different arguments are still refused.
  const replay = call("recipe_save", {
    request_id: "create-orzo",
    recipe: dish("Orzo"),
  });
  assert.deepEqual(replay, {
    action_id: created.action_id,
    trimmed: true,
    replayed: true,
  });
  assert.throws(
    () =>
      call("recipe_save", {
        request_id: "create-orzo",
        recipe: dish("Paella"),
      }),
    code("REQUEST_ID_REUSED"),
  );
  // Polling still learns which records an old action changed.
  assert.deepEqual(store.changedSince(0)[0], {
    kind: "recipe",
    id: created.record.id,
  });
});

test("a long-running server trims once a day as it writes, and opening a database trims it", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01") });
  const dir = mkdtempSync(join(tmpdir(), "kooks-history-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "kooks.sqlite");
  const first = harness(t, path);
  const january = first.call("recipe_save", { recipe: dish("January") });
  t.mock.timers.tick((UNDO_DAYS - 1) * DAY);
  const march = first.call("recipe_save", { recipe: dish("March") });
  assert.ok(first.call("history_list").actions.every((a) => !a.trimmed));

  t.mock.timers.tick(2 * DAY);
  first.call("recipe_save", { recipe: dish("April") });
  const trimmed = (actions) =>
    actions.filter((a) => a.trimmed).map((a) => a.id);
  assert.deepEqual(trimmed(first.call("history_list").actions), [
    january.action_id,
  ]);

  // Another process that has not written yet still trims when it opens.
  // April is now exactly UNDO_DAYS old, so it can still be undone.
  t.mock.timers.tick(UNDO_DAYS * DAY);
  const second = harness(t, path);
  assert.deepEqual(trimmed(second.call("history_list").actions), [
    march.action_id,
    january.action_id,
  ]);
});
