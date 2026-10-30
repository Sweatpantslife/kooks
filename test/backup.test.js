import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { backupChunks, restoreBackupFile } from "../mcp/backup.js";
import { createWebServer } from "../web/server.js";

const code = (expected) => (error) => error.code === expected;
function setup(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  let n = 0;
  return {
    store,
    call(name, input = {}) {
      const tool = tools.get(name);
      return tool.execute({
        ...(!tool.readOnly ? { request_id: `backup-${++n}` } : {}),
        ...input,
      });
    },
  };
}
function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), "kooks-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A PDF larger than one encoded slice, so its base64 is written in pieces.
const ebook = Buffer.alloc(7 * 1024 * 1024 + 1, 7);
ebook.write("%PDF-1.7\n");
// Titles with the characters a streaming reader could trip over.
const tricky = 'Brackets ]}, {[ "quoted" \\ back, café 🍲';

function cookbook(t) {
  const kitchen = setup(t);
  const { call } = kitchen;
  const file = call("asset_save", {
    file: {
      name: "Grandma.pdf",
      mime_type: "application/pdf",
      base64: ebook.toString("base64"),
    },
  }).record;
  const recipe = call("recipe_save", {
    recipe: {
      title: tricky,
      servings: 2,
      ingredients: [{ name: "Rice", quantity: 100, unit: "g" }],
      steps: [{ text: "Cook." }],
    },
  }).record;
  call("book_save", {
    book: {
      title: "Grandma's book",
      file_id: file.id,
      recipe_ids: [recipe.id],
    },
  });
  call("meal_save", {
    meal: { title: "Dinner", dishes: [{ recipe_id: recipe.id, servings: 4 }] },
  });
  call("note_save", { recipe_id: recipe.id, text: "Again soon." });
  return { ...kitchen, file, recipe };
}
let restores = 0;
const restoreFile = (store, path, chunkSize) =>
  store.mutate(
    "backup_restore",
    { request_id: `file-${++restores}`, file: path },
    () => restoreBackupFile(store, path, chunkSize),
  );
const withoutDate = ({ exported_at, ...backup }) => backup;

test("the streamed backup is the backup_export JSON, written in pieces", (t) => {
  const { store, call } = cookbook(t);
  const pieces = [...backupChunks(store)];
  // No piece holds more than a record or one slice of a file.
  assert.ok(pieces.every((piece) => piece.length <= 4 * 1024 * 1024));
  const streamed = JSON.parse(pieces.join(""));
  assert.deepEqual(
    withoutDate(streamed),
    withoutDate(call("backup_export").backup),
  );
  assert.equal(
    streamed.records.find((r) => r.kind === "asset").data.base64,
    ebook.toString("base64"),
  );
});

test("a backup file restores record by record, whatever its layout and read size", (t) => {
  const source = cookbook(t);
  const dir = folder(t);
  const exported = source.call("backup_export").backup;
  const compact = join(dir, "compact.json");
  writeFileSync(compact, [...backupChunks(source.store)].join(""));
  // The browser app used to download backups indented.
  const indented = join(dir, "indented.json");
  writeFileSync(indented, JSON.stringify(exported, null, 2));
  for (const [path, chunkSize] of [
    [compact, 1 << 20],
    [compact, 4093],
    [indented, 1021],
  ]) {
    const target = setup(t);
    const result = restoreFile(target.store, path, chunkSize);
    assert.equal(result.restored_records, exported.records.length);
    assert.deepEqual(
      target.call("backup_export").backup.records,
      exported.records,
    );
    assert.ok(target.store.blob("asset", source.file.id).equals(ebook));
    assert.equal(
      target.store.get("recipe", source.recipe.id).data.title,
      tricky,
    );
    assert.throws(
      () => restoreFile(target.store, compact),
      code("RESTORE_NOT_EMPTY"),
    );
  }
});

test("a file that is not a sound backup restores nothing", (t) => {
  const dir = folder(t);
  const source = cookbook(t);
  const good = JSON.parse([...backupChunks(source.store)].join(""));
  const cases = [
    ["not json at all", "INVALID_BACKUP"],
    [JSON.stringify([good]), "INVALID_BACKUP"],
    [JSON.stringify({ ...good, format: "kooks-mobile" }), "INVALID_BACKUP"],
    [JSON.stringify({ ...good, records: null }), "INVALID_BACKUP"],
    [
      JSON.stringify({ ...good, records: [...good.records, 5] }),
      "INVALID_BACKUP",
    ],
    [
      JSON.stringify({ ...good, records: [...good.records, good.records[0]] }),
      "INVALID_BACKUP",
    ],
    // A book whose file is missing fails after its records were written.
    [
      JSON.stringify({
        ...good,
        records: good.records.filter((r) => r.kind !== "asset"),
      }),
      "INVALID_BACKUP",
    ],
  ];
  for (const [index, [text, expected]] of cases.entries()) {
    const path = join(dir, `bad-${index}.json`);
    writeFileSync(path, text);
    const target = setup(t);
    assert.throws(() => restoreFile(target.store, path, 64), code(expected));
    assert.equal(target.store.isEmpty(), true, `case ${index}`);
  }
  const target = setup(t);
  const broken = join(dir, "broken-record.json");
  writeFileSync(
    broken,
    JSON.stringify({
      ...good,
      records: good.records.map((r) =>
        r.kind === "recipe" ? { ...r, data: { ...r.data, title: "" } } : r,
      ),
    }),
  );
  assert.throws(() => restoreFile(target.store, broken), { name: "ZodError" });
  assert.equal(target.store.isEmpty(), true);
});

test("the browser downloads the backup as a stream and MCP points large shelves to it", async (t) => {
  const { store, call } = cookbook(t);
  const server = createWebServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/backup`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition"), "attachment");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    withoutDate(await response.json()),
    withoutDate(call("backup_export").backup),
  );
  // More than 64 MB of files would not fit one MCP reply.
  store.db
    .prepare(
      "UPDATE records SET document = json_set(document, '$.data.byte_length', 70000000) WHERE kind = 'asset'",
    )
    .run();
  assert.throws(() => call("backup_export"), code("BACKUP_TOO_LARGE"));
});
