import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { createWebServer } from "../web/server.js";

// A browser tab polls /api/state with its revision every few seconds.
async function setup(t, path = ":memory:") {
  const store = new Store(path);
  const server = createWebServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let n = 0;
  return {
    store,
    state: async (revision) =>
      (
        await fetch(
          `${origin}/api/state${revision ? `?revision=${revision}` : ""}`,
        )
      ).json(),
    call: async (name, input) => {
      const response = await fetch(`${origin}/api/tools/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ request_id: `state-${++n}`, ...input }),
      });
      return response.json();
    },
  };
}
const recipe = (title) => ({
  title,
  servings: 2,
  ingredients: [{ name: "Rice", quantity: 100, unit: "g" }],
  steps: [{ text: "Cook." }],
});

test("an unchanged poll reads no records and a changed one sends only the changes", async (t) => {
  const { store, state, call } = await setup(t);
  const rice = (await call("recipe_save", { recipe: recipe("Rice") })).record;
  const full = await state();
  assert.deepEqual(
    full.records.recipe.map((r) => r.id),
    [rice.id],
  );
  const read = [];
  for (const method of ["all", "list", "get"]) {
    const original = store[method].bind(store);
    store[method] = (...args) => {
      read.push(method);
      return original(...args);
    };
  }
  assert.deepEqual(await state(full.revision), {
    unchanged: true,
    revision: full.revision,
  });
  assert.deepEqual(read, []);

  const soup = (await call("recipe_save", { recipe: recipe("Soup") })).record;
  await call("record_archive", {
    kind: "recipe",
    id: rice.id,
    expected_version: rice.version,
    archived: true,
  });
  const list = (await call("shopping_create", { title: "Saturday" })).record;
  const batch = (
    await call("batch_create", {
      recipe_id: soup.id,
      portions: 4,
      cooked_on: "2026-10-30",
    })
  ).record;
  const changed = await state(full.revision);
  assert.equal(changed.records, undefined);
  const byId = new Map(changed.changes.map((c) => [c.id, c]));
  assert.equal(byId.size, 4);
  assert.equal(byId.get(soup.id).record.data.title, "Soup");
  // Archived records leave the tab, as they are absent from a full load.
  assert.equal(byId.get(rice.id).kind, "recipe");
  assert.equal(byId.get(rice.id).record, null);
  // Shopping lists and batches arrive in the same views as a full load.
  assert.deepEqual(byId.get(list.id).record.items, []);
  assert.equal(byId.get(batch.id).record.available_portions, 4);
  assert.deepEqual(await state(changed.revision), {
    unchanged: true,
    revision: changed.revision,
  });
});

test("tabs from another server start or far behind load everything again", async (t) => {
  const { state, call } = await setup(t);
  const first = await state();
  for (let i = 0; i < 201; i++)
    await call("pantry_save", { pantry: { name: `Spice ${i}` } });
  const behind = await state(first.revision);
  assert.equal(behind.changes, undefined);
  assert.equal(behind.records.pantry.length, 201);
  const [, sequence] = behind.revision.split("-");
  for (const revision of [`00000000-${sequence}`, "not-a-revision", "-"]) {
    const other = await state(revision);
    assert.equal(other.records.pantry.length, 201, revision);
  }
  const close = await state(`${behind.revision.split("-")[0]}-200`);
  assert.equal(close.changes.length, 1);
});

test("polling notices writes from another process sharing the database", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kooks-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "kooks.sqlite");
  const { state } = await setup(t, path);
  const before = await state();
  // The MCP server is a separate process with its own connection.
  const mcp = new Store(path);
  t.after(() => mcp.close());
  const tool = createTools(mcp).find((d) => d.name === "recipe_save");
  const saved = tool.execute({
    request_id: "from-mcp",
    recipe: recipe("From the agent"),
  }).record;
  const after = await state(before.revision);
  assert.notEqual(after.revision, before.revision);
  assert.deepEqual(
    after.changes.map((c) => c.id),
    [saved.id],
  );
});
