// Backups on the computer that keeps the kitchen.
//
// A portable backup is one household's cookbook as a file, the same as the
// app's Household › Backup download. Both directions stream, so a shelf of
// large ebooks needs no more memory than its largest file:
//
//   node scripts/backup.mjs export [file]   writes to stdout without a file
//   node scripts/backup.mjs restore <file>  only into an empty database
//
// A copy is the whole server: every household's database and the accounts,
// as the automatic backups take them (see docs/hosting.md#backups):
//
//   node scripts/backup.mjs snapshot        take a copy now
//   node scripts/backup.mjs list            the copies kept, newest first
//   node scripts/backup.mjs check [copy]    check a copy (the newest without one)
//   node scripts/backup.mjs stage <copy> [--household <id>]
//                                           put a copy back at the next start
//   node scripts/backup.mjs unstage         forget a staged copy
//
// KOOKS_DB_PATH selects the database, and KOOKS_BACKUP_DIR the copies'
// folder, as for the server.
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { Store, KooksError } from "../mcp/store.js";
import { backupChunks, restoreBackupFile } from "../mcp/backup.js";
import {
  BackupError,
  backupSettings,
  checkCopy,
  findCopy,
  listCopies,
  pruneCopies,
  recordFailure,
  sizeLabel,
  stageCopy,
  staged,
  takeCopy,
  unstage,
} from "../web/backups.js";

// Backups hold the household's recipes and files: owner-only, like the database.
process.umask(0o077);
const usage = `Usage: node scripts/backup.mjs export [file] | restore <file>
       node scripts/backup.mjs snapshot | list | check [copy] | stage <copy> [--household <id>] | unstage`;
const [mode, ...rest] = process.argv.slice(2);
const household = rest.includes("--household")
  ? (rest[rest.indexOf("--household") + 1] ?? "")
  : "";
const [file] = rest.filter(
  (arg, i) => !arg.startsWith("--") && rest[i - 1] !== "--household",
);
const modes = [
  "export",
  "restore",
  "snapshot",
  "list",
  "check",
  "stage",
  "unstage",
];
if (
  !modes.includes(mode) ||
  (["restore", "stage"].includes(mode) && !file) ||
  (rest.includes("--household") && !/^[a-f0-9]{16}$/.test(household))
) {
  console.error(usage);
  process.exit(2);
}
const dbPath = process.env.KOOKS_DB_PATH
  ? resolve(process.env.KOOKS_DB_PATH)
  : fileURLToPath(new URL("../.data/kooks.sqlite", import.meta.url));
const local = (iso) =>
  new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

async function portable() {
  const store = new Store(dbPath);
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
  } finally {
    store.close();
  }
}

async function copies() {
  // The folder is the server's even when its automatic backups are off.
  const settings = backupSettings(
    { ...process.env, KOOKS_BACKUPS: "on" },
    dbPath,
  );
  const { dir } = settings;
  if (mode === "snapshot") {
    try {
      const copy = await takeCopy({ dbPath, dir });
      const gone = pruneCopies(dir, settings);
      const bytes = copy.files.reduce((sum, f) => sum + f.bytes, 0);
      console.log(
        `Took copy ${copy.name}: ${copy.files.length} database${copy.files.length === 1 ? "" : "s"}, ${sizeLabel(bytes)}, in ${dir}.${gone.length ? ` Let ${gone.join(", ")} go.` : ""}`,
      );
    } catch (error) {
      recordFailure(dir, error);
      throw error;
    }
  } else if (mode === "list") {
    const list = listCopies(dir);
    if (!list.length) console.log(`There are no copies in ${dir} yet.`);
    for (const copy of list) {
      const households = copy.manifest.files.length;
      console.log(
        `${copy.name}  ${local(copy.taken_at)}  ${sizeLabel(copy.bytes)}  ${households} database${households === 1 ? "" : "s"}`,
      );
    }
    const waiting = staged(dbPath);
    if (waiting)
      console.log(
        `\nCopy ${waiting.copy} is staged and goes in place when Kooks next starts.`,
      );
  } else if (mode === "check") {
    const copy = findCopy(dir, file);
    const report = await checkCopy(copy);
    for (const f of report.files)
      console.log(
        `${f.restores_to}: ok, ${f.records} records${f.accounts === null || f.accounts === undefined ? "" : `, ${f.accounts} accounts, ${f.households} households`}, schema ${f.schema}`,
      );
    console.log(`Copy ${copy.name}, taken ${local(copy.taken_at)}, is good.`);
  } else if (mode === "stage") {
    const copy = findCopy(dir, file);
    const plan = await stageCopy({ dbPath, copy, household });
    console.log(
      `Staged copy ${copy.name}, taken ${local(copy.taken_at)}: ${plan.whole ? "every household and the accounts" : `household ${household}`}. Restart Kooks to put it in place; whatever it replaces is moved aside, not deleted. Changes made before the restart are not in the copy. To cancel, run: node scripts/backup.mjs unstage`,
    );
  } else {
    const plan = unstage(dbPath);
    console.log(
      plan ? `Copy ${plan.copy} is no longer staged.` : "No copy was staged.",
    );
  }
}

try {
  await (["export", "restore"].includes(mode) ? portable() : copies());
} catch (error) {
  const known =
    error instanceof KooksError ||
    error instanceof ZodError ||
    error instanceof BackupError;
  const doing = {
    export: "export the backup",
    restore: "restore the backup",
    snapshot: "take a copy",
    list: "list the copies",
    check: "check the copy",
    stage: "stage the copy",
    unstage: "unstage the copy",
  }[mode];
  console.error(
    `Kooks could not ${doing}: ${
      error instanceof ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : error.message
    }`,
  );
  if (!known) console.error(error);
  process.exitCode = 1;
}
