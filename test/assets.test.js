import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { createWebServer } from "../web/server.js";

const bytes = readFileSync(new URL("./fixtures/recipe.png", import.meta.url));
const image = {
  name: "recipe.png",
  mime_type: "image/png",
  base64: bytes.toString("base64"),
};
const sha256 = createHash("sha256").update(bytes).digest("hex");
const code = (expected) => (error) => error.code === expected;

function harness(t, path = ":memory:") {
  const store = new Store(path);
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  let n = 0;
  return {
    store,
    call(name, input = {}) {
      const tool = tools.get(name);
      return tool.execute(
        tool.readOnly ? input : { request_id: `asset-${++n}`, ...input },
      );
    },
  };
}
function tempDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), "kooks-assets-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "cookbook.sqlite");
}
const storeAsset = (store, requestId = "create-asset") =>
  store.mutate("test_asset", { request_id: requestId }, () => ({
    record: store.put("asset", image),
  })).record;

// The layout written by servers before schema 2: bytes inline in documents
// and copied into every history entry.
const versionOneSchema = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE records (
    kind TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE TABLE actions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
    action TEXT NOT NULL, created_at TEXT NOT NULL,
    changes TEXT NOT NULL, result TEXT NOT NULL
  );
  PRAGMA user_version = 1;
`;
function writeVersionOneDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(versionOneSchema);
  const now = "2026-09-01T00:00:00.000Z";
  const record = (id, data, version = 1, archived = false) => ({
    id,
    version,
    archived,
    created_at: now,
    updated_at: now,
    data,
  });
  const created = record("asset-1", { ...image });
  const archived = { ...created, version: 2, archived: true };
  const recipe = record("recipe-1", {
    title: "Lemon rice",
    servings: 4,
    original_text: "",
    source_url: null,
    ingredients: [],
    steps: [],
    equipment: [],
    tags: [],
    notes: "",
    favorite: false,
    source_image_ids: ["asset-1"],
    original_recipe_id: null,
    preferred: false,
  });
  const draft = record("import-1", {
    title: "Lemon rice",
    original_text: "Lemon rice",
    image_id: "asset-1",
    recipe: recipe.data,
    warnings: [],
    status: "saved",
    recipe_id: "recipe-1",
  });
  const insert = db.prepare(
    "INSERT INTO records(kind, id, document) VALUES (?, ?, ?)",
  );
  insert.run("asset", "asset-1", JSON.stringify(archived));
  insert.run("recipe", "recipe-1", JSON.stringify(recipe));
  insert.run("import", "import-1", JSON.stringify(draft));
  const action = db.prepare(
    "INSERT INTO actions(id, request_id, fingerprint, action, created_at, changes, result) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  action.run(
    "action-create",
    "req-create",
    "fp-1",
    "recipe_import_image",
    now,
    JSON.stringify([
      { kind: "asset", id: "asset-1", before: null, after: created },
    ]),
    JSON.stringify({
      image_id: "asset-1",
      action_id: "action-create",
      replayed: false,
    }),
  );
  action.run(
    "action-archive",
    "req-archive",
    "fp-2",
    "record_archive",
    now,
    JSON.stringify([
      { kind: "asset", id: "asset-1", before: created, after: archived },
    ]),
    JSON.stringify({ action_id: "action-archive", replayed: false }),
  );
  db.close();
}

test("a schema 1 database moves image bytes out of records and history once, keeping undo working", (t) => {
  const path = tempDatabase(t);
  writeVersionOneDatabase(path);
  const first = harness(t, path);
  assert.equal(first.store.userVersion(), 2);
  const asset = first.store.get("asset", "asset-1", true);
  assert.equal(asset.data.base64, undefined);
  assert.equal(asset.data.sha256, sha256);
  assert.equal(asset.data.byte_length, bytes.length);
  assert.equal(asset.version, 2);
  assert.equal(asset.archived, true);
  assert.equal(asset.updated_at, "2026-09-01T00:00:00.000Z");
  assert.ok(first.store.blob("asset", "asset-1").equals(bytes));
  const changes = first.store.db
    .prepare("SELECT changes FROM actions ORDER BY seq")
    .all()
    .map((row) => row.changes);
  assert.equal(changes.length, 2);
  assert.ok(changes.every((text) => !text.includes("base64")));
  assert.ok(changes.every((text) => text.includes(sha256)));
  const history = first.call("history_list").actions;
  assert.deepEqual(
    history.map((action) => action.changes[0].after_version),
    [2, 1],
  );
  const undone = first.call("history_undo", { action_id: "action-archive" });
  assert.equal(undone.records[0].archived, false);
  assert.equal(undone.records[0].version, 3);
  assert.equal(undone.records[0].data.sha256, sha256);
  assert.ok(first.store.blob("asset", "asset-1").equals(bytes));
  assert.equal(
    first.call("kooks_get", { kind: "asset", id: "asset-1" }).record.data
      .base64,
    image.base64,
  );
  const second = new Store(path);
  t.after(() => second.close());
  assert.equal(second.userVersion(), 2);
  assert.equal(second.get("asset", "asset-1").data.sha256, sha256);
  assert.ok(second.blob("asset", "asset-1").equals(bytes));
});

test("databases from a newer server are refused", (t) => {
  const path = tempDatabase(t);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 3");
  db.close();
  assert.throws(() => new Store(path), code("DATABASE_VERSION"));
});

test("asset bytes are stored once, never edited, and survive archive, undo and backup", (t) => {
  const source = harness(t);
  const asset = storeAsset(source.store);
  assert.equal(asset.data.base64, undefined);
  assert.equal(asset.data.sha256, sha256);
  assert.equal(asset.data.byte_length, bytes.length);
  assert.ok(source.store.blob("asset", asset.id).equals(bytes));
  assert.throws(
    () =>
      source.store.mutate("test_asset", { request_id: "edit-asset" }, () =>
        source.store.put("asset", { ...image }, asset.id, asset.version),
      ),
    code("INTERNAL"),
  );
  const recipe = source.call("recipe_save", {
    recipe: { title: "Rice", source_image_ids: [asset.id] },
  }).record;
  const archived = source.call("record_archive", {
    kind: "asset",
    id: asset.id,
    expected_version: asset.version,
    archived: true,
  });
  assert.equal(archived.record.archived, true);
  source.call("history_undo", { action_id: archived.action_id });
  assert.equal(source.store.get("asset", asset.id).archived, false);
  assert.ok(
    source.store.db
      .prepare("SELECT length(changes) AS n FROM actions")
      .all()
      .every((row) => row.n < 4000),
    "history entries stay small",
  );
  assert.equal(
    source.call("kooks_list", { kind: "asset" }).records[0].title,
    "recipe.png",
  );
  const backup = source.call("backup_export").backup;
  const exported = backup.records.find((record) => record.kind === "asset");
  assert.deepEqual(Object.keys(exported.data), ["name", "mime_type", "base64"]);
  assert.equal(exported.data.base64, image.base64);
  const target = harness(t);
  target.call("backup_restore", { backup });
  assert.deepEqual(target.call("backup_export").backup.records, backup.records);
  assert.ok(target.store.blob("asset", asset.id).equals(bytes));
  assert.equal(target.store.get("asset", asset.id).data.sha256, sha256);
  assert.deepEqual(
    target.store.get("recipe", recipe.id).data.source_image_ids,
    [asset.id],
  );
  assert.throws(
    () => target.call("backup_restore", { backup }),
    code("RESTORE_NOT_EMPTY"),
  );
});

test("the browser server serves asset bytes separately from state and hides internal errors", async (t) => {
  const store = new Store(":memory:");
  const server = createWebServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const asset = storeAsset(store);
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(state.records.asset.length, 1);
  assert.equal(state.records.asset[0].data.base64, undefined);
  assert.equal(state.records.asset[0].data.sha256, sha256);
  const served = await fetch(`${origin}/api/assets/${asset.id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("content-length"), String(bytes.length));
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(bytes));
  const missing = await fetch(`${origin}/api/assets/nope`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "NOT_FOUND");
  assert.equal((await fetch(`${origin}/icons.svg`)).status, 404);
  assert.equal((await fetch(`${origin}/style.css`)).status, 200);
});
