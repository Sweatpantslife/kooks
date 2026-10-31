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
      archived: false,
      title: "Lemon orzo",
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

test("each action records who made it, and history names them without an address", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  let sequence = 0;
  const as =
    (context) =>
    (name, input = {}) => {
      const tool = tools.get(name);
      return tool.execute(
        tool.readOnly ? input : { request_id: `who-${++sequence}`, ...input },
        context,
      );
    };
  const ada = as({})("member_save", { member: { name: "Ada" } }).record.id;
  const ben = as({})("member_save", { member: { name: "Ben" } }).record.id;
  // Ada's account is linked to Ada; Ben's account linked to nobody yet;
  // Cy, who has left, was linked to Ben when they made their change.
  const members = new Map([
    ["acc-ada", ada],
    ["acc-ben", null],
  ]);
  const member = (account, person = null) => ({
    actor: { type: "member", account, person },
    links: () => members,
  });
  const byAda = as(member("acc-ada", ada))("recipe_save", {
    recipe: dish("Orzo"),
  });
  as(member("acc-ben"))("recipe_save", { recipe: dish("Pilaf") });
  as(member("acc-cy", ben))("recipe_save", { recipe: dish("Stew") });
  as({ actor: { type: "agent" } })("recipe_save", { recipe: dish("Soup") });
  as({ actor: { type: "local" } })("recipe_save", { recipe: dish("Rice") });

  // What the cookbook keeps: an opaque account id and the person then.
  assert.deepEqual(
    JSON.parse(
      store.db
        .prepare("SELECT actor FROM actions WHERE id = ?")
        .get(byAda.action_id).actor,
    ),
    { type: "member", account: "acc-ada", person: ada },
  );

  const history = as(member("acc-ada", ada))("history_list").actions;
  assert.deepEqual(
    history.map((a) => [a.changes[0].title, a.actor]),
    [
      ["Rice", { type: "local", you: false }],
      ["Soup", { type: "agent", you: false }],
      // Cy left: named by the person they were then.
      ["Stew", { type: "member", person: ben, name: "Ben", you: false }],
      // Ben is a member linked to nobody now.
      ["Pilaf", { type: "member", person: null, name: null, you: false }],
      ["Orzo", { type: "member", person: ada, name: "Ada", you: true }],
      // Before anyone said who: no actor at all.
      ["Ben", null],
      ["Ada", null],
    ],
  );
  // The account ids themselves: a random record id can hold "acc-" too.
  assert.doesNotMatch(JSON.stringify(history), /acc-(ada|ben|cy)/);

  // Linking later names changes made before by the person linked now.
  members.set("acc-ben", ben);
  assert.deepEqual(
    as(member("acc-ada", ada))("history_list").actions[3].actor,
    { type: "member", person: ben, name: "Ben", you: false },
  );
  // A change keeps the person it was made as, whatever the member links to
  // later, or if they unlink: history cannot be renamed after the fact.
  members.set("acc-ada", ben);
  const orzo = () =>
    as(member("acc-ada"))("history_list").actions.find(
      (a) => a.id === byAda.action_id,
    ).actor;
  assert.equal(orzo().name, "Ada");
  members.set("acc-ada", null);
  assert.equal(orzo().name, "Ada");
  members.set("acc-ada", ada);
  // Undo works on anyone's change, and is itself recorded as the undoer's.
  as(member("acc-ben", ben))("history_undo", { action_id: byAda.action_id });
  const undone = as(member("acc-ada", ada))("history_list", { limit: 1 })
    .actions[0];
  assert.equal(undone.action, "history_undo");
  assert.deepEqual(undone.actor, {
    type: "member",
    person: ben,
    name: "Ben",
    you: false,
  });
  assert.equal(undone.changes[0].archived, true);
});

test("a database from before actors gains the column, and its older actions have none", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kooks-actors-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "kooks.sqlite");
  const first = new Store(path);
  createTools(first)
    .find((tool) => tool.name === "recipe_save")
    .execute({ request_id: "old-1", recipe: dish("Orzo") });
  // As a server from before this change left it.
  first.db.exec("ALTER TABLE actions DROP COLUMN actor");
  first.close();
  const second = harness(t, path);
  const columns = second.store.db
    .prepare("PRAGMA table_info(actions)")
    .all()
    .map((column) => column.name);
  assert.ok(columns.includes("actor"));
  assert.equal(second.call("history_list").actions[0].actor, null);
  // The schema version is unchanged, so an older server still opens it.
  assert.equal(second.store.userVersion(), 2);
});
