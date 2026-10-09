import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test(
  "real stdio client discovers tools, saves data, gets errors and reconnects to persisted records",
  { timeout: 15000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "kooks-mcp-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const dbPath = join(directory, "cookbook.sqlite");
    const errors = [];
    async function connect() {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL("../mcp/index.js", import.meta.url))],
        env: { KOOKS_DB_PATH: dbPath },
        cwd: directory,
        stderr: "pipe",
      });
      transport.stderr.on("data", (chunk) => errors.push(chunk.toString()));
      const client = new Client({
        name: "kooks-integration-test",
        version: "1.0.0",
      });
      await client.connect(transport);
      return client;
    }
    let client = await connect();
    t.after(async () => {
      await client.close();
    });
    const tools = await client.listTools();
    for (const name of [
      "recipe_save",
      "recipe_suggest",
      "batch_allocate",
      "recipe_memory",
      "recipe_variant_save",
      "member_save",
      "cooking_task_save",
      "cost_week",
      "recipe_import_image",
      "asset_save",
      "technique_save",
      "inspiration_save",
      "book_save",
    ]) {
      assert.ok(
        tools.tools.some((tool) => tool.name === name),
        `MCP exposes ${name}`,
      );
    }
    assert.equal(
      tools.tools.find((t) => t.name === "recipe_save").annotations
        .readOnlyHint,
      false,
    );
    assert.equal(
      tools.tools.find((t) => t.name === "recipe_scale").annotations
        .readOnlyHint,
      true,
    );
    assert.equal(
      tools.tools.find((t) => t.name === "recipe_save").outputSchema.type,
      "object",
    );
    const workflow = await client.readResource({ uri: "kooks://workflow" });
    assert.match(workflow.contents[0].text, /do not deliver alarms/);
    const saved = await client.callTool({
      name: "recipe_save",
      arguments: {
        request_id: "mcp-create",
        recipe: {
          title: "Family pasta",
          servings: 2,
          original_text: "A family message",
          ingredients: [{ name: "Pasta", quantity: 200, unit: "g" }],
          steps: [{ text: "Boil pasta." }],
        },
      },
    });
    assert.equal(saved.isError, undefined);
    const record = saved.structuredContent.record;
    const scaled = await client.callTool({
      name: "recipe_scale",
      arguments: { id: record.id, servings: 3 },
    });
    assert.equal(scaled.structuredContent.recipe.ingredients[0].quantity, 300);
    const stale = await client.callTool({
      name: "recipe_save",
      arguments: {
        request_id: "mcp-stale",
        id: record.id,
        expected_version: 999,
        recipe: { title: "Wrong" },
      },
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.error, "STALE_VERSION");
    const invalid = await client.callTool({
      name: "recipe_scale",
      arguments: { id: record.id, servings: -1 },
    });
    assert.equal(invalid.isError, true);
    const peer = await connect();
    try {
      const competing = await Promise.all(
        [client, peer].map((connection, index) =>
          connection.callTool({
            name: "recipe_save",
            arguments: {
              request_id: `race-${index}`,
              id: record.id,
              expected_version: record.version,
              recipe: { ...record.data, notes: `Cook ${index}` },
            },
          }),
        ),
      );
      assert.equal(competing.filter((result) => !result.isError).length, 1);
      assert.equal(
        competing.find((result) => result.isError).structuredContent.error,
        "STALE_VERSION",
      );
    } finally {
      await peer.close();
    }
    await client.close();
    client = await connect();
    const read = await client.callTool({
      name: "kooks_get",
      arguments: { kind: "recipe", id: record.id },
    });
    assert.equal(read.structuredContent.record.data.title, "Family pasta");
    assert.equal(
      read.structuredContent.record.data.original_text,
      "A family message",
    );
    assert.equal(
      errors.some((error) => error.includes("Kooks tool failed")),
      false,
    );
  },
);
