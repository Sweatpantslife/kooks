// Export or restore a portable Kooks backup of any size on the computer that
// keeps the cookbook. Both directions stream, so a shelf of large ebooks needs
// no more memory than its largest file.
//
//   node scripts/backup.mjs export [file]   writes to stdout without a file
//   node scripts/backup.mjs restore <file>  only into an empty database
//
// KOOKS_DB_PATH selects the database, as for the servers.
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { Store, KooksError } from "../mcp/store.js";
import { backupChunks, restoreBackupFile } from "../mcp/backup.js";

// Backups hold the household's recipes and files: owner-only, like the database.
process.umask(0o077);
const [mode, file] = process.argv.slice(2);
if (!["export", "restore"].includes(mode) || (mode === "restore" && !file)) {
  console.error(
    "Usage: node scripts/backup.mjs export [file] | restore <file>",
  );
  process.exit(2);
}
const store = new Store(
  process.env.KOOKS_DB_PATH
    ? resolve(process.env.KOOKS_DB_PATH)
    : fileURLToPath(new URL("../.data/kooks.sqlite", import.meta.url)),
);
try {
  if (mode === "export") {
    await pipeline(
      Readable.from(backupChunks(store)),
      file ? createWriteStream(resolve(file)) : process.stdout,
    );
    if (file) console.error(`Saved the cookbook to ${resolve(file)}.`);
  } else {
    const path = resolve(file);
    const result = store.mutate(
      "backup_restore",
      { request_id: randomUUID(), file: path },
      () => restoreBackupFile(store, path),
      // Made at the kitchen's own computer.
      { type: "local" },
    );
    console.error(
      `Restored ${result.restored_records} records into ${store.path}.`,
    );
  }
} catch (error) {
  const known = error instanceof KooksError || error instanceof ZodError;
  console.error(
    `Kooks could not ${mode} the backup: ${
      error instanceof ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : error.message
    }`,
  );
  if (!known) console.error(error);
  process.exitCode = 1;
} finally {
  store.close();
}
