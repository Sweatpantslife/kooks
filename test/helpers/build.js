import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// A stand-in for client/dist, so the server tests need no build: a folder
// holding the given files (index.html by default), removed after the test.
// The folder beside it is outside the build, for tests that try to reach it.
export function fakeBuild(
  t,
  files = { "index.html": "<!doctype html><title>Kooks</title>" },
) {
  const folder = mkdtempSync(join(tmpdir(), "kooks-client-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const build = join(folder, "dist");
  mkdirSync(build);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(build, name)), { recursive: true });
    writeFileSync(join(build, name), body);
  }
  return build;
}
