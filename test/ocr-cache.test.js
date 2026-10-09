import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRecognizer } from "../mcp/imports.js";

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), "kooks-ocr-cache-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "recognize.m");
  writeFileSync(source, "int main() { return 0; }\n");
  const cacheDir = join(directory, "cache");
  let compiles = 0;
  const compile = async (output) => {
    compiles++;
    writeFileSync(output, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  };
  return { source, cacheDir, compile, compiles: () => compiles };
}
const hashOf = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

test("the OCR helper is compiled once per source revision and reused", async (t) => {
  const { source, cacheDir, compile, compiles } = setup(t);
  const first = await ensureRecognizer({ source, cacheDir, compile });
  assert.equal(compiles(), 1);
  assert.equal(
    first,
    join(cacheDir, `recognize-${hashOf("int main() { return 0; }\n")}`),
  );
  assert.equal(await ensureRecognizer({ source, cacheDir, compile }), first);
  assert.equal(compiles(), 1);
  writeFileSync(source, "int main() { return 1; }\n");
  const second = await ensureRecognizer({ source, cacheDir, compile });
  assert.notEqual(second, first);
  assert.equal(compiles(), 2);
  assert.deepEqual(
    readdirSync(cacheDir).filter((name) => name.endsWith(".tmp")),
    [],
    "no staging files remain",
  );
});

test("a failed compile leaves nothing behind and is retried next time", async (t) => {
  const { source, cacheDir } = setup(t);
  let attempts = 0;
  const failing = async () => {
    attempts++;
    throw new Error("clang missing");
  };
  await assert.rejects(
    ensureRecognizer({ source, cacheDir, compile: failing }),
    /clang missing/,
  );
  assert.deepEqual(readdirSync(cacheDir), []);
  const working = async (output) =>
    writeFileSync(output, "#!/bin/sh\n", { mode: 0o755 });
  await ensureRecognizer({ source, cacheDir, compile: working });
  assert.equal(attempts, 1);
  assert.equal(readdirSync(cacheDir).length, 1);
});
