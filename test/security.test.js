import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { id, key } from "../mcp/schemas.js";
import { embedOrigins } from "../shared/links.js";
import { pagePolicy } from "../client/page-policy.js";

const hostile = [
  'x" autofocus onfocus="alert(1)',
  "x'><img src=x>",
  "<b>",
  "a&b",
  "two words",
  "line\nbreak",
  "-starts-with-a-dash",
  "",
  "x".repeat(129),
];

test("record and item ids are the shapes Kooks makes, while request ids and source keys stay free text", () => {
  for (const value of [
    crypto.randomUUID(),
    "dish-1",
    "dish-1:0",
    `recipe:${crypto.randomUUID()}`,
    "a".repeat(64),
    "x".repeat(128),
  ])
    assert.equal(id.safeParse(value).success, true, value);
  for (const value of hostile)
    assert.equal(id.safeParse(value).success, false, JSON.stringify(value));
  assert.equal(key.safeParse("Friday dinner (Noa's turn)").success, true);
  assert.equal(key.safeParse("").success, false);

  const store = new Store(":memory:");
  try {
    const tools = new Map(createTools(store).map((t) => [t.name, t]));
    const call = (name, input) => tools.get(name).execute(input);
    const saved = call("recipe_save", {
      request_id: "save pancakes, first try",
      recipe: { title: "Pancakes", servings: 2 },
    });
    assert.equal(id.safeParse(saved.record.id).success, true);
    assert.throws(
      () =>
        call("kooks_get", { kind: "recipe", id: 'x" onmouseover="alert(1)' }),
      (error) => error.name === "ZodError",
    );
    const list = call("shopping_create", {
      request_id: "list",
      title: "Groceries",
    });
    // Agents name shopping sources in their own words.
    const input = {
      id: list.record.id,
      source: { kind: "recipe", id: saved.record.id },
      source_key: "Friday dinner",
    };
    const preview = call("shopping_preview", input);
    const synced = call("shopping_sync", {
      ...input,
      request_id: "sync",
      expected_version: preview.list_version,
      preview_token: preview.preview_token,
    });
    assert.deepEqual(
      synced.record.data.sources.map((source) => source.source_key),
      ["Friday dinner"],
    );
    // A backup cannot bring in an id that Kooks would never have made.
    const backup = call("backup_export", {}).backup;
    backup.records[0].id = '"><img src=x onerror=alert(1)>';
    const fresh = new Store(":memory:");
    try {
      const restore = new Map(createTools(fresh).map((t) => [t.name, t])).get(
        "backup_restore",
      );
      assert.throws(
        () => restore.execute({ request_id: "restore", backup }),
        (error) => error.name === "ZodError",
      );
    } finally {
      fresh.close();
    }
  } finally {
    store.close();
  }
});

// On a phone the app's page comes from the app, where no server sends a
// policy, so the built page carries its own. In a browser the server's
// stricter one applies as well.
test("the app's page carries a content security policy that allows exactly the video players", () => {
  const directives = Object.fromEntries(
    pagePolicy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
  assert.deepEqual(directives["default-src"], ["'self'"]);
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["style-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'none'"]);
  assert.deepEqual(directives["frame-src"], embedOrigins);
  // The phone reaches the kitchen wherever it runs, and nothing else widens.
  assert.deepEqual(directives["connect-src"], ["'self'", "https:"]);
  assert.deepEqual(directives["img-src"], ["'self'", "blob:", "data:"]);
});
