import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { createGunzip, createGzip } from "node:zlib";
import { SCHEMA_VERSION } from "../mcp/store.js";
import { version } from "../mcp/version.js";
import {
  OffsiteError,
  offsiteLabel,
  offsiteSettings,
  pushCopy,
} from "./offsite.js";

// Automatic backups: a copy of every database on the server, taken on a
// schedule while it runs. A copy is a folder named by when it was taken,
// holding each database compressed, as SQLite's VACUUM INTO writes it (one
// consistent moment per file, taken without stopping anyone's cooking), and
// a manifest with what each file holds and its checksum. A copy is checked
// before it is kept, and only a good new copy lets an older one go, so a
// damaged database or a full disk never costs the copies already kept.
//
// The server's own database holds the accounts and the first household's
// cookbook; each household started later has its file in households/. A
// restore puts a whole copy back, or one household's file, at the next
// start: the files it replaces are moved aside, never deleted.

const MINUTE = 60000,
  HOUR = 60 * MINUTE,
  MB = 1024 * 1024;
// A copy is not taken when it would leave less than this free on the disk,
// so a backup never crowds out the kitchen it protects.
export const reserveBytes = 1024 * MB;
const MAIN = "kooks.sqlite";
const HOUSEHOLD_FILE = /^[a-f0-9]{16}\.sqlite$/;
const COPY_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-\d+)?$/;
const FAILURE = "last-failure.json";
// What reached the off-site bucket last, and the last attempt that did not.
const SENT = "offsite.json";
const SEND_FAILURE = "offsite-failure.json";

export class BackupError extends Error {}

const iso = (ms) => new Date(ms).toISOString();
// 2026-11-01T03-00-00Z: sortable, and safe in any file system or bucket.
const stampOf = (ms) => iso(ms).slice(0, 19).replace(/:/g, "-") + "Z";
const megabytes = (bytes) =>
  bytes < MB
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : bytes < 1024 * MB
      ? `${(bytes / MB).toFixed(1)} MB`
      : `${(bytes / 1024 / MB).toFixed(2)} GB`;
export { megabytes as sizeLabel };
const sizeOf = (path) => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
// Written in full and flushed before it takes the name, so a crash leaves
// the old file or the new one, never half of one.
function writeDurably(path, text) {
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  const fd = openSync(temporary, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}
function syncDirectory(path) {
  try {
    const fd = openSync(path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Not every file system lets a directory be flushed.
  }
}

// KOOKS_BACKUPS and its companions, checked once at start. Null when backups
// are off.
export function backupSettings(env, dbPath) {
  const flag = String(env.KOOKS_BACKUPS ?? "on")
    .trim()
    .toLowerCase();
  if (!/^(on|off|true|false|yes|no|1|0)?$/.test(flag))
    throw new Error("KOOKS_BACKUPS is on or off.");
  if (/^(off|false|no|0)$/.test(flag) || dbPath === ":memory:") return null;
  const whole = (name, fallback, min, max) => {
    const raw = String(env[name] ?? "").trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} is a whole number from ${min} to ${max}.`);
    return value;
  };
  const ping = String(env.KOOKS_BACKUP_PING_URL ?? "").trim();
  if (ping) {
    let url = null;
    try {
      url = new URL(ping);
    } catch {
      // Reported below.
    }
    if (!url || !["http:", "https:"].includes(url.protocol))
      throw new Error(
        "KOOKS_BACKUP_PING_URL is the http or https address a monitor gives you, such as https://hc-ping.com/…",
      );
  }
  const dir = String(env.KOOKS_BACKUP_DIR ?? "").trim();
  return {
    dbPath,
    dir: dir ? resolve(dir) : join(dirname(dbPath), "backups"),
    every: whole("KOOKS_BACKUP_EVERY_HOURS", 24, 1, 168) * HOUR,
    keepDaily: whole("KOOKS_BACKUP_KEEP_DAILY", 7, 1, 366),
    keepWeekly: whole("KOOKS_BACKUP_KEEP_WEEKLY", 4, 0, 520),
    ping,
    offsite: offsiteSettings(env),
  };
}

// The databases on this server: its own, then each household's by id.
export function databasesOf(dbPath) {
  const list = [{ name: MAIN, path: dbPath }];
  const dir = join(dirname(dbPath), "households");
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const name of names.filter((n) => HOUSEHOLD_FILE.test(n)).sort())
    list.push({ name: `households/${name}`, path: join(dir, name) });
  return list;
}

const freeBytes = (dir) => {
  const disk = statfsSync(dir);
  return disk.bavail * disk.bsize;
};
function makeRoom(dir, need, reserve) {
  const free = freeBytes(dir);
  if (free - need < reserve)
    throw new BackupError(
      `There is not enough room on the disk: this needs about ${megabytes(need)}, and Kooks keeps at least ${megabytes(reserve)} free for the kitchen (${megabytes(free)} free now).`,
    );
}

// What a database file holds, read from a copy of it. A copy that SQLite
// finds damaged, or that a newer Kooks wrote, is refused.
function inspect(path, main) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const problems = db
      .prepare("PRAGMA integrity_check")
      .all()
      .map((row) => row.integrity_check);
    if (problems.join() !== "ok")
      throw new BackupError(
        `SQLite found the database damaged: ${problems.slice(0, 3).join("; ")}`,
      );
    const schema = db.prepare("PRAGMA user_version").get().user_version;
    if (schema > SCHEMA_VERSION)
      throw new BackupError("This copy was written by a newer Kooks.");
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (!tables.has("records"))
      throw new BackupError("This is not a Kooks database.");
    const count = (table) =>
      tables.has(table)
        ? db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n
        : null;
    return {
      schema,
      records: count("records"),
      ...(main && {
        accounts: count("auth_accounts"),
        households: count("auth_households"),
      }),
    };
  } finally {
    db.close();
  }
}

// Counts and checksums the bytes passing through.
function tally() {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  return { stream, result: () => ({ sha256: hash.digest("hex"), bytes }) };
}
async function compress(from, to) {
  const count = tally();
  await pipeline(
    createReadStream(from),
    createGzip({ level: 6 }),
    count.stream,
    createWriteStream(to, { mode: 0o600, flush: true }),
  );
  return count.result();
}
// Expands one file of a copy, refusing it unless its checksum matches the
// manifest.
async function expand(from, to, sha256) {
  const count = tally();
  await pipeline(createReadStream(from), count.stream);
  if (count.result().sha256 !== sha256)
    throw new BackupError(
      `${basename(from)} does not match its checksum: the copy is damaged.`,
    );
  await pipeline(
    createReadStream(from),
    createGunzip(),
    createWriteStream(to, { mode: 0o600, flush: true }),
  );
}

// Folders a copy that never finished left behind. A copy being written right
// now by another process is younger than this.
function clearLeftovers(dir, now) {
  for (const name of readdirSync(dir))
    if (/^\.(partial|check)-/.test(name)) {
      const path = join(dir, name);
      if (now - statSync(path).mtimeMs > 6 * HOUR)
        rmSync(path, { recursive: true, force: true });
    }
}

// Takes a copy of every database on the server into dir. Runs in a worker
// thread under the server (see backup-worker.js), since SQLite's calls hold
// the thread they run on.
export async function takeCopy({
  dbPath,
  dir,
  reserve = reserveBytes,
  now = Date.now,
}) {
  const started = now();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  clearLeftovers(dir, started);
  const sources = databasesOf(dbPath).filter(
    (source) => source.name !== MAIN || existsSync(source.path),
  );
  if (!existsSync(dbPath))
    throw new BackupError(`There is no database at ${dbPath} to copy.`);
  // The copies are no larger than the files and their write-ahead logs.
  makeRoom(
    dir,
    sources.reduce(
      (sum, s) => sum + sizeOf(s.path) + sizeOf(`${s.path}-wal`),
      0,
    ),
    reserve,
  );
  const partial = join(
    dir,
    `.partial-${stampOf(started)}-${randomBytes(4).toString("hex")}`,
  );
  mkdirSync(join(partial, "households"), { recursive: true, mode: 0o700 });
  try {
    const files = [];
    for (const source of sources) {
      const plain = join(partial, source.name);
      const db = new DatabaseSync(source.path, { readOnly: true });
      try {
        db.prepare("VACUUM INTO ?").run(plain);
      } finally {
        db.close();
      }
      let facts;
      try {
        facts = inspect(plain, source.name === MAIN);
      } catch (error) {
        error.message = `${source.name}: ${error.message}`;
        throw error;
      }
      const stored = `${source.name}.gz`;
      const sqliteBytes = sizeOf(plain);
      const { sha256, bytes } = await compress(plain, join(partial, stored));
      rmSync(plain);
      files.push({
        path: stored,
        restores_to: source.name,
        bytes,
        sqlite_bytes: sqliteBytes,
        sha256,
        ...facts,
      });
    }
    const manifest = {
      format: 1,
      kooks: version,
      taken_at: iso(started),
      took_ms: now() - started,
      files,
    };
    writeDurably(
      join(partial, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    syncDirectory(join(partial, "households"));
    syncDirectory(partial);
    let name = stampOf(started);
    for (let n = 2; existsSync(join(dir, name)); n++)
      name = `${stampOf(started)}-${n}`;
    renameSync(partial, join(dir, name));
    syncDirectory(dir);
    return { name, ...manifest };
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }
}

// The copies in dir, newest first. A folder without a readable manifest is
// not a copy.
export function listCopies(dir) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return names
    .filter((name) => COPY_NAME.test(name))
    .map((name) => ({
      name,
      path: join(dir, name),
      manifest: readJson(join(dir, name, "manifest.json")),
    }))
    .filter((copy) => copy.manifest?.format === 1)
    .map((copy) => ({
      ...copy,
      taken_at: copy.manifest.taken_at,
      bytes: copy.manifest.files.reduce((sum, f) => sum + f.bytes, 0),
    }))
    .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
}

// Monday of the day's week, as YYYY-MM-DD.
const mondayOf = (day) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};
// Which copies stay: the newest, the newest of each of the last keepDaily
// days that have one, and the newest of each of the last keepWeekly weeks.
// Days without a copy (a server that was off) do not count, so a long gap
// never empties the folder.
export function copiesToKeep(copies, { keepDaily, keepWeekly }) {
  const kept = new Set(copies.slice(0, 1).map((c) => c.name));
  const days = new Set(),
    weeks = new Set();
  for (const copy of copies) {
    const day = copy.taken_at.slice(0, 10);
    const week = mondayOf(day);
    if (!days.has(day) && days.size < keepDaily) {
      days.add(day);
      kept.add(copy.name);
    }
    if (!weeks.has(week) && weeks.size < keepWeekly) {
      weeks.add(week);
      kept.add(copy.name);
    }
  }
  return kept;
}
export function pruneCopies(dir, keep) {
  const copies = listCopies(dir);
  const kept = copiesToKeep(copies, keep);
  const gone = copies.filter((copy) => !kept.has(copy.name));
  for (const copy of gone) rmSync(copy.path, { recursive: true, force: true });
  return gone.map((copy) => copy.name);
}

export function findCopy(dir, name) {
  const copies = listCopies(dir);
  if (!copies.length) throw new BackupError(`There are no copies in ${dir}.`);
  if (!name) return copies[0];
  const copy = copies.find((c) => c.name === name || c.path === resolve(name));
  if (!copy)
    throw new BackupError(
      `There is no copy named ${name} in ${dir}. The newest is ${copies[0].name}.`,
    );
  return copy;
}

// Expands every file of a copy beside it and checks each the way a copy is
// checked when it is taken: its checksum, SQLite's integrity check, and that
// this Kooks can open it.
export async function checkCopy(copy, { reserve = 0 } = {}) {
  const work = join(
    dirname(copy.path),
    `.check-${randomBytes(4).toString("hex")}`,
  );
  makeRoom(
    dirname(copy.path),
    copy.manifest.files.reduce((sum, f) => sum + f.sqlite_bytes, 0),
    reserve,
  );
  mkdirSync(join(work, "households"), { recursive: true, mode: 0o700 });
  try {
    const files = [];
    for (const file of copy.manifest.files) {
      const plain = join(work, file.restores_to);
      await expand(join(copy.path, file.path), plain, file.sha256);
      const facts = inspect(plain, file.restores_to === MAIN);
      if (facts.records !== file.records)
        throw new BackupError(
          `${file.restores_to} holds ${facts.records} records; the manifest says ${file.records}.`,
        );
      rmSync(plain);
      files.push({ ...file, ...facts });
    }
    return { name: copy.name, taken_at: copy.taken_at, files };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Where a restore waits for the next start, beside the server's database.
const restoreDir = (dbPath) => join(dirname(dbPath), "restore");
const liveFile = (dbPath, name) =>
  name === MAIN ? dbPath : join(dirname(dbPath), name);

// Expands a copy, or one household's file of it, into restore/ beside the
// database, checked, for the server to put in place when it next starts.
// Nothing live changes until then.
export async function stageCopy({ dbPath, copy, household = "" }) {
  const wanted = household
    ? copy.manifest.files.filter(
        (f) => f.restores_to === `households/${household}.sqlite`,
      )
    : copy.manifest.files;
  if (!wanted.length)
    throw new BackupError(
      `Copy ${copy.name} has no household ${household}. It has ${
        copy.manifest.files
          .filter((f) => f.restores_to !== MAIN)
          .map((f) => basename(f.restores_to, ".sqlite"))
          .join(", ") || "only the first one"
      }.`,
    );
  const staging = restoreDir(dbPath);
  rmSync(staging, { recursive: true, force: true });
  makeRoom(
    dirname(dbPath),
    wanted.reduce((sum, f) => sum + f.sqlite_bytes, 0),
    0,
  );
  mkdirSync(join(staging, "households"), { recursive: true, mode: 0o700 });
  try {
    for (const file of wanted) {
      const plain = join(staging, file.restores_to);
      await expand(join(copy.path, file.path), plain, file.sha256);
      inspect(plain, file.restores_to === MAIN);
    }
    const plan = {
      copy: copy.name,
      taken_at: copy.taken_at,
      whole: !household,
      files: wanted.map((f) => f.restores_to),
      staged_at: iso(Date.now()),
    };
    syncDirectory(join(staging, "households"));
    writeDurably(
      join(staging, "READY.json"),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    syncDirectory(staging);
    return plan;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
export function unstage(dbPath) {
  const staging = restoreDir(dbPath);
  const plan = readJson(join(staging, "READY.json"));
  rmSync(staging, { recursive: true, force: true });
  return plan;
}
export const staged = (dbPath) =>
  readJson(join(restoreDir(dbPath), "READY.json"));

// Puts a staged restore in place. The server calls this before it opens any
// database. Every file it replaces, with its write-ahead log, moves to a
// replaced-<time> folder beside the database first; a whole restore also
// moves the households that the copy does not have, since the accounts it
// brings back do not know them. Interrupted, it carries on from where it
// stopped at the next start.
export function applyRestore(dbPath, now = Date.now) {
  const staging = restoreDir(dbPath);
  const ready = join(staging, "READY.json");
  const plan = readJson(ready);
  if (!plan) return null;
  const data = dirname(dbPath);
  if (!plan.aside) {
    plan.aside = `replaced-${stampOf(now())}`;
    writeDurably(ready, `${JSON.stringify(plan, null, 2)}\n`);
  }
  const aside = join(data, plan.aside);
  mkdirSync(join(aside, "households"), { recursive: true, mode: 0o700 });
  const move = (from, to) => {
    if (existsSync(from)) renameSync(from, to);
  };
  const setAside = (name) => {
    for (const suffix of ["-wal", "-shm", "-journal", ""])
      move(
        `${liveFile(dbPath, name)}${suffix}`,
        join(aside, `${name === MAIN ? basename(dbPath) : name}${suffix}`),
      );
  };
  if (!plan.moved) {
    if (plan.whole) {
      setAside(MAIN);
      const households = join(data, "households");
      let names = [];
      try {
        names = readdirSync(households);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      for (const name of names)
        move(join(households, name), join(aside, "households", name));
    } else for (const name of plan.files) setAside(name);
    syncDirectory(aside);
    plan.moved = true;
    writeDurably(ready, `${JSON.stringify(plan, null, 2)}\n`);
  }
  mkdirSync(join(data, "households"), { recursive: true, mode: 0o700 });
  for (const name of plan.files)
    move(join(staging, name), liveFile(dbPath, name));
  syncDirectory(join(data, "households"));
  syncDirectory(data);
  const { moved, ...restored } = plan;
  writeDurably(
    join(aside, "RESTORED.json"),
    `${JSON.stringify({ ...restored, restored_at: iso(now()) }, null, 2)}\n`,
  );
  rmSync(staging, { recursive: true, force: true });
  return { ...restored, aside };
}

// The last failed attempt, kept beside the copies so the server and the
// backup script agree; a newer good copy makes it history.
function lastFailure(dir) {
  const failure = readJson(join(dir, FAILURE));
  return failure?.at ? failure : null;
}
export function recordFailure(dir, error, at = Date.now()) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeDurably(
      join(dir, FAILURE),
      `${JSON.stringify({ at: iso(at), error: error.message }, null, 2)}\n`,
    );
  } catch {
    // A disk that cannot take the note is reported by the log line.
  }
}
const clearFailure = (dir) => rmSync(join(dir, FAILURE), { force: true });

// How the backups are doing. Late means no good copy for an interval and a
// half (and at least two hours), counted from the server's start when there
// is none yet.
export function backupHealth(settings, { now = Date.now(), since = now } = {}) {
  const copies = listCopies(settings.dir);
  const last = copies[0] ?? null;
  const failure = lastFailure(settings.dir);
  const failed = failure && (!last || failure.at > last.taken_at);
  const allowed = settings.every + Math.max(settings.every / 2, 2 * HOUR);
  const reference = last ? Date.parse(last.taken_at) : since;
  const late = now - reference > allowed;
  let offsite = null;
  if (settings.offsite) {
    const sent = readJson(join(settings.dir, SENT));
    const unsent = readJson(join(settings.dir, SEND_FAILURE));
    offsite = {
      to: offsiteLabel(settings.offsite),
      last_sent: sent?.copy ?? null,
      last_sent_at: sent?.at ?? null,
      failure: unsent?.at && (!sent?.at || unsent.at > sent.at) ? unsent : null,
      // Counted from the server's start until a copy has gone.
      late: now - (sent?.at ? Date.parse(sent.at) : since) > allowed,
    };
  }
  return {
    ok: !late && !offsite?.late,
    late,
    last_copy_at: last?.taken_at ?? null,
    failure: failed ? failure : null,
    copies,
    offsite,
  };
}

// Sends a copy to the off-site bucket and notes how it went, for the server
// and the backup script alike.
export async function sendCopy(settings, copy, { now = Date.now } = {}) {
  try {
    const bytes = await pushCopy(settings.offsite, copy, { now });
    writeDurably(
      join(settings.dir, SENT),
      `${JSON.stringify({ copy: copy.name, at: iso(now()) }, null, 2)}\n`,
    );
    rmSync(join(settings.dir, SEND_FAILURE), { force: true });
    return bytes;
  } catch (error) {
    try {
      writeDurably(
        join(settings.dir, SEND_FAILURE),
        `${JSON.stringify({ at: iso(now()), copy: copy.name, error: error.message }, null, 2)}\n`,
      );
    } catch {
      // A disk that cannot take the note is reported by the log line.
    }
    throw error;
  }
}

// Pings a monitor such as healthchecks.io after each attempt: its address
// after a good copy, with /fail after a failed one. A monitor that hears
// nothing, because the server is down, raises the alarm itself.
async function defaultPing(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!response.ok)
      console.error(
        `Kooks could not ping the backup monitor: it answered ${response.status}.`,
      );
  } catch (error) {
    console.error(`Kooks could not ping the backup monitor: ${error.message}`);
  }
}

// Runs one copy in a worker thread, so the server keeps answering while
// SQLite reads.
function copyInWorker(options, onWorker) {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(new URL("./backup-worker.js", import.meta.url), {
      workerData: options,
    });
    onWorker(worker);
    let answered = false;
    worker.once("message", (message) => {
      answered = true;
      if (message.ok) resolvePromise(message.copy);
      else reject(new BackupError(message.error));
    });
    worker.once("error", (error) => {
      answered = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      onWorker(null);
      if (!answered)
        reject(
          new BackupError(
            `The backup stopped before it finished (exit code ${code}).`,
          ),
        );
    });
  });
}

// The schedule: every quarter hour the server looks at its newest copy, and
// takes one when it is older than the interval. A copy taken by the backup
// script counts too. After a failure it tries again an hour later.
export function createBackups(
  settings,
  {
    now = Date.now,
    log = console,
    ping = defaultPing,
    reserve = reserveBytes,
    firstLook = MINUTE,
    inThread = true,
  } = {},
) {
  const startedAt = now();
  let running = null,
    worker = null,
    stopped = false;
  const timers = [];
  const health = () => backupHealth(settings, { now: now(), since: startedAt });
  const failed = () => `${settings.ping.replace(/\/+$/, "")}/fail`;
  // Sends a copy off-site when there is somewhere to send it: true when it
  // got there, or there is nowhere.
  async function send(copy) {
    if (!settings.offsite) return true;
    const at = now();
    try {
      await sendCopy(settings, copy, { now });
      log.log(
        `Kooks sent copy ${copy.name} to ${offsiteLabel(settings.offsite)} (${((now() - at) / 1000).toFixed(1)} s).`,
      );
      return true;
    } catch (error) {
      if (stopped) throw error;
      log.error(
        `Kooks could not send copy ${copy.name} off-site: ${error.message}`,
      );
      if (!(error instanceof OffsiteError)) log.error(error);
      return false;
    }
  }
  // The newest copy has not reached the bucket, and an hour has passed
  // since the last attempt that failed.
  function sendDue() {
    if (!settings.offsite || running || stopped) return false;
    const { copies, offsite } = health();
    if (!copies.length || offsite.last_sent === copies[0].name) return false;
    return !(offsite.failure && now() - Date.parse(offsite.failure.at) < HOUR);
  }
  function resend() {
    if (running) return running;
    running = (async () => {
      try {
        const sent = await send(health().copies[0]);
        if (settings.ping) await ping(sent ? settings.ping : failed());
        return sent;
      } finally {
        running = null;
      }
    })();
    return running;
  }
  function due() {
    if (running || stopped) return false;
    const { last_copy_at: last, failure } = health();
    const t = now();
    if (last && t - Date.parse(last) < settings.every) return false;
    if (failure && t - Date.parse(failure.at) < HOUR) return false;
    return true;
  }
  function run() {
    if (running) return running;
    running = (async () => {
      const at = now();
      try {
        const options = { dbPath: settings.dbPath, dir: settings.dir, reserve };
        const copy = inThread
          ? await copyInWorker(options, (w) => (worker = w))
          : await takeCopy({ ...options, now });
        const gone = pruneCopies(settings.dir, settings);
        clearFailure(settings.dir);
        const bytes = copy.files.reduce((sum, f) => sum + f.bytes, 0);
        log.log(
          `Kooks took its automatic backup: ${copy.files.length} database${copy.files.length === 1 ? "" : "s"}, ${megabytes(bytes)}, in ${join(settings.dir, copy.name)} (${((now() - at) / 1000).toFixed(1)} s)${gone.length ? `; ${gone.length} older cop${gone.length === 1 ? "y" : "ies"} let go` : ""}.`,
        );
        const sent = await send(findCopy(settings.dir, copy.name));
        if (settings.ping) await ping(sent ? settings.ping : failed());
        return copy;
      } catch (error) {
        if (stopped) throw error;
        recordFailure(settings.dir, error, at);
        log.error(
          `Kooks could not take its automatic backup: ${error.message}`,
        );
        if (!(error instanceof BackupError)) log.error(error);
        if (settings.ping) await ping(failed());
        throw error;
      } finally {
        running = null;
      }
    })();
    return running;
  }
  const look = () => {
    if (due()) run().catch(() => {});
    else if (sendDue()) resend().catch(() => {});
  };
  return {
    settings,
    health,
    due,
    run,
    sendDue,
    resend,
    start() {
      timers.push(setTimeout(look, firstLook), setInterval(look, 15 * MINUTE));
      for (const timer of timers) timer.unref();
    },
    stop() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      worker?.terminate();
    },
  };
}
