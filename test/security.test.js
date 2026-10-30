import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { id, key } from "../mcp/schemas.js";
import { embedOrigins } from "../shared/links.js";

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

// The server only hands out safe ids, and the mobile app still escapes every
// id it puts into an attribute, so a record that predates the rule cannot
// break out of the markup. (The browser app's Preact components never write
// markup as text.)
test("the mobile app escapes the ids it writes into markup attributes", () => {
  const source = readFileSync(
    new URL("../app/cookbook.js", import.meta.url),
    "utf8",
  );
  const raw = [
    ...source.matchAll(
      /(?<![[\w-])[\w-]+="[^"$]*\$\{((?:\w*[iI]d|[\w?.]+\.\w*[iI]d)(?: \?\? "")?)\}/g,
    ),
  ].map((match) => match[0]);
  assert.deepEqual(raw, [], "app/cookbook.js writes ids into markup unescaped");
});

test("the mobile app runs under a content security policy that allows exactly the video players", () => {
  const html = readFileSync(
    new URL("../app/index.html", import.meta.url),
    "utf8",
  );
  const policy = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )?.[1];
  assert.ok(policy, "app/index.html declares a policy");
  assert.ok(
    html.indexOf("Content-Security-Policy") < html.indexOf("<link"),
    "the policy comes before anything it governs",
  );
  const directives = Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'none'"]);
  assert.deepEqual(directives["frame-src"], embedOrigins);
});
