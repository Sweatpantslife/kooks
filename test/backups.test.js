import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { createAuth } from "../web/auth.js";
import { createWebServer } from "../web/server.js";
import {
  BackupError,
  applyRestore,
  backupHealth,
  backupSettings,
  checkCopy,
  copiesToKeep,
  createBackups,
  findCopy,
  listCopies,
  pruneCopies,
  stageCopy,
  staged,
  takeCopy,
  unstage,
} from "../web/backups.js";

const HOUR = 3600000;
const HOUSEHOLD = "0123456789abcdef";
const OTHER = "fedcba9876543210";
const quiet = { log() {}, error() {} };

function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), "kooks-backups-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A server's data folder: its own database and one household beside it.
function server(t) {
  const data = folder(t);
  const dbPath = join(data, "kooks.sqlite");
  const settings = backupSettings({}, dbPath);
  return { data, dbPath, settings, dir: settings.dir };
}
const householdPath = (dbPath, id) =>
  join(dbPath, "..", "households", `${id}.sqlite`);
function cook(path, ...titles) {
  const store = new Store(path);
  try {
    const tools = new Map(createTools(store).map((t) => [t.name, t]));
    for (const title of titles)
      tools.get("recipe_save").execute({
        request_id: `save-${title}`,
        recipe: { title, servings: 2 },
      });
  } finally {
    store.close();
  }
}
function titles(path) {
  const store = new Store(path);
  try {
    return store
      .all()
      .filter((r) => r.kind === "recipe" && !r.archived)
      .map((r) => r.data.title)
      .sort();
  } finally {
    store.close();
  }
}
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const leftovers = (dir) =>
  readdirSync(dir).filter((name) => name.startsWith("."));

test("backups are on by default beside the database, off on request, and their settings are checked", () => {
  assert.deepEqual(backupSettings({}, "/data/kooks.sqlite"), {
    dbPath: "/data/kooks.sqlite",
    dir: "/data/backups",
    every: 24 * HOUR,
    keepDaily: 7,
    keepWeekly: 4,
    ping: "",
    offsite: null,
  });
  for (const off of ["off", "OFF", "false", "0", "no"])
    assert.equal(
      backupSettings({ KOOKS_BACKUPS: off }, "/data/kooks.sqlite"),
      null,
    );
  assert.equal(backupSettings({}, ":memory:"), null);
  const custom = backupSettings(
    {
      KOOKS_BACKUPS: "on",
      KOOKS_BACKUP_DIR: "/backups",
      KOOKS_BACKUP_EVERY_HOURS: "6",
      KOOKS_BACKUP_KEEP_DAILY: "14",
      KOOKS_BACKUP_KEEP_WEEKLY: "0",
      KOOKS_BACKUP_PING_URL: "https://hc-ping.com/abc",
    },
    "/data/kooks.sqlite",
  );
  assert.equal(custom.dir, "/backups");
  assert.equal(custom.every, 6 * HOUR);
  assert.equal(custom.keepDaily, 14);
  assert.equal(custom.keepWeekly, 0);
  assert.equal(custom.ping, "https://hc-ping.com/abc");
  for (const [name, value, message] of [
    ["KOOKS_BACKUPS", "maybe", /on or off/],
    ["KOOKS_BACKUP_EVERY_HOURS", "0", /from 1 to 168/],
    ["KOOKS_BACKUP_EVERY_HOURS", "1.5", /whole number/],
    ["KOOKS_BACKUP_KEEP_DAILY", "0", /from 1 to 366/],
    ["KOOKS_BACKUP_PING_URL", "ftp://example.test/ping", /http or https/],
    ["KOOKS_BACKUP_PING_URL", "not an address", /http or https/],
  ])
    assert.throws(
      () => backupSettings({ [name]: value }, "/data/kooks.sqlite"),
      message,
    );
});

test("a copy holds every database as it was at one moment, checked and checksummed, while a write is open", async (t) => {
  const { dbPath, dir } = server(t);
  cook(dbPath, "Lentil soup", "Flatbread");
  const auth = createAuth({
    path: dbPath,
    owner: "cook@example.test",
    mailer: { description: "nowhere", async send() {} },
  });
  auth.close();
  cook(householdPath(dbPath, HOUSEHOLD), "Toast");
  // A change still being written is not in the copy, and does not hold it up.
  const writer = new DatabaseSync(dbPath);
  writer.exec(
    "BEGIN IMMEDIATE; INSERT INTO records(kind, id, document) VALUES ('recipe', 'unsaved', '{}')",
  );
  let copy;
  try {
    copy = await takeCopy({ dbPath, dir, reserve: 0 });
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
  }
  assert.match(copy.name, /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/);
  assert.equal(copy.format, 1);
  assert.deepEqual(
    copy.files.map((f) => [f.path, f.restores_to, f.records, f.schema]),
    [
      ["kooks.sqlite.gz", "kooks.sqlite", 2, 2],
      [
        `households/${HOUSEHOLD}.sqlite.gz`,
        `households/${HOUSEHOLD}.sqlite`,
        1,
        2,
      ],
    ],
  );
  assert.equal(copy.files[0].accounts, 1);
  assert.equal(copy.files[0].households, 1);
  for (const file of copy.files) {
    assert.equal(file.sha256, sha256(join(dir, copy.name, file.path)));
    assert.equal(file.bytes, statSync(join(dir, copy.name, file.path)).size);
  }
  // Owner-only, like the database.
  assert.equal(
    statSync(join(dir, copy.name, "kooks.sqlite.gz")).mode & 0o077,
    0,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, copy.name, "manifest.json"))),
    (({ name, ...manifest }) => manifest)(copy),
  );
  const [listed] = listCopies(dir);
  assert.equal(listed.name, copy.name);
  const report = await checkCopy(listed);
  assert.deepEqual(
    report.files.map((f) => f.records),
    [2, 1],
  );
  assert.deepEqual(leftovers(dir), []);
});

test("a damaged database or a full disk costs no copy already kept", async (t) => {
  const { dbPath, dir } = server(t);
  cook(dbPath, "Lentil soup");
  const household = householdPath(dbPath, HOUSEHOLD);
  cook(household, ...Array.from({ length: 60 }, (_, i) => `Dish ${i}`));
  const good = await takeCopy({ dbPath, dir, reserve: 0 });

  await assert.rejects(
    takeCopy({ dbPath, dir, reserve: Number.MAX_SAFE_INTEGER }),
    (error) =>
      error instanceof BackupError &&
      /not enough room on the disk/.test(error.message),
  );
  // Bytes scribbled over the household's pages.
  const fd = openSync(household, "r+");
  writeSync(fd, Buffer.alloc(4096, 0xa5), 0, 4096, 8192);
  closeSync(fd);
  rmSync(`${household}-wal`, { force: true });
  rmSync(`${household}-shm`, { force: true });
  await assert.rejects(
    takeCopy({ dbPath, dir, reserve: 0 }),
    /malformed|damaged|corrupt/i,
  );
  assert.deepEqual(
    listCopies(dir).map((c) => c.name),
    [good.name],
  );
  assert.deepEqual(leftovers(dir), []);
});

test("copies are kept for the last days and weeks that have one, and a gap costs none", (t) => {
  const at = (iso) => ({ name: iso.replace(/:/g, "-"), taken_at: iso });
  const copies = [
    // Today, three times, then a day a week back for six weeks, with a
    // month the server was off.
    "2026-11-20T18:00:00Z",
    "2026-11-20T12:00:00Z",
    "2026-11-20T06:00:00Z",
    "2026-11-19T06:00:00Z",
    "2026-11-12T06:00:00Z",
    "2026-11-05T06:00:00Z",
    "2026-10-29T06:00:00Z",
    "2026-09-01T06:00:00Z",
    "2026-08-25T06:00:00Z",
  ].map(at);
  const kept = (keep) =>
    copies
      .filter((c) => copiesToKeep(copies, keep).has(c.name))
      .map((c) => c.taken_at.slice(0, 13));
  assert.deepEqual(kept({ keepDaily: 3, keepWeekly: 0 }), [
    "2026-11-20T18",
    "2026-11-19T06",
    "2026-11-12T06",
  ]);
  // Weeks run Monday to Sunday: the 19th and 20th share one.
  assert.deepEqual(kept({ keepDaily: 2, keepWeekly: 4 }), [
    "2026-11-20T18",
    "2026-11-19T06",
    "2026-11-12T06",
    "2026-11-05T06",
    "2026-10-29T06",
  ]);
  assert.deepEqual(kept({ keepDaily: 7, keepWeekly: 4 }).length, 7);
  assert.deepEqual(kept({ keepDaily: 1, keepWeekly: 0 }), ["2026-11-20T18"]);

  // On disk: only folders with a manifest are copies, and only they go.
  const dir = folder(t);
  for (const copy of copies) {
    mkdirSync(join(dir, copy.name));
    writeFileSync(
      join(dir, copy.name, "manifest.json"),
      JSON.stringify({ format: 1, taken_at: copy.taken_at, files: [] }),
    );
  }
  mkdirSync(join(dir, "2026-01-01T00-00-00Z"));
  mkdirSync(join(dir, "notes"));
  const gone = pruneCopies(dir, { keepDaily: 3, keepWeekly: 0 });
  assert.equal(gone.length, 6);
  assert.deepEqual(readdirSync(dir).sort(), [
    "2026-01-01T00-00-00Z",
    "2026-11-12T06-00-00Z",
    "2026-11-19T06-00-00Z",
    "2026-11-20T18-00-00Z",
    "notes",
  ]);
});

test("a damaged copy fails its check and cannot be staged", async (t) => {
  const { dbPath, dir } = server(t);
  cook(dbPath, "Lentil soup");
  const copy = await takeCopy({ dbPath, dir, reserve: 0 });
  const file = join(dir, copy.name, "kooks.sqlite.gz");
  const bytes = readFileSync(file);
  bytes[bytes.length >> 1] ^= 0xff;
  writeFileSync(file, bytes);
  const listed = findCopy(dir, copy.name);
  await assert.rejects(checkCopy(listed), /does not match its checksum/);
  await assert.rejects(
    stageCopy({ dbPath, copy: listed }),
    /does not match its checksum/,
  );
  assert.equal(staged(dbPath), null);
  assert.equal(existsSync(join(dbPath, "..", "restore")), false);
  assert.deepEqual(leftovers(dir), []);
  assert.throws(() => findCopy(dir, "2020-01-01T00-00-00Z"), /no copy named/);
});

test("a staged copy goes in place at the next start, and what it replaces is moved aside", async (t) => {
  const { data, dbPath, dir } = server(t);
  const first = householdPath(dbPath, HOUSEHOLD);
  const later = householdPath(dbPath, OTHER);
  cook(dbPath, "Lentil soup");
  cook(first, "Toast");
  const copy = await takeCopy({ dbPath, dir, reserve: 0 });
  // After the copy: more cooking, and a household started.
  cook(dbPath, "Flatbread");
  cook(first, "Porridge");
  cook(later, "Jam");
  const plan = await stageCopy({ dbPath, copy: findCopy(dir) });
  assert.equal(plan.copy, copy.name);
  assert.equal(plan.whole, true);
  // Nothing live changes until the server starts.
  assert.deepEqual(titles(dbPath), ["Flatbread", "Lentil soup"]);
  assert.equal(staged(dbPath).copy, copy.name);

  // The server stops, leaving its write-ahead logs, and starts again: the
  // first look at the clock names the folder, the second fails part way.
  const kept = new DatabaseSync(dbPath);
  kept.exec("PRAGMA wal_autocheckpoint = 0; UPDATE records SET id = id");
  let clock = 0;
  assert.throws(
    () =>
      applyRestore(dbPath, () => {
        if (++clock > 1) throw new Error("power cut");
        return Date.parse("2026-11-01T03:00:00Z");
      }),
    /power cut/,
  );
  kept.close();
  // The next start finishes it.
  const restored = applyRestore(dbPath);
  const aside = join(data, "replaced-2026-11-01T03-00-00Z");
  assert.equal(restored.aside, aside);
  assert.deepEqual(titles(dbPath), ["Lentil soup"]);
  assert.deepEqual(titles(first), ["Toast"]);
  // The household the copy does not know moved aside with the rest.
  assert.equal(existsSync(later), false);
  assert.deepEqual(titles(join(aside, "households", `${OTHER}.sqlite`)), [
    "Jam",
  ]);
  assert.deepEqual(titles(join(aside, "kooks.sqlite")), [
    "Flatbread",
    "Lentil soup",
  ]);
  assert.deepEqual(titles(join(aside, "households", `${HOUSEHOLD}.sqlite`)), [
    "Porridge",
    "Toast",
  ]);
  assert.equal(
    JSON.parse(readFileSync(join(aside, "RESTORED.json"))).copy,
    copy.name,
  );
  assert.equal(existsSync(join(data, "restore")), false);
  assert.equal(applyRestore(dbPath), null);
});

test("one household's file can be put back alone, and a staged copy can be forgotten", async (t) => {
  const { data, dbPath, dir } = server(t);
  const first = householdPath(dbPath, HOUSEHOLD);
  const other = householdPath(dbPath, OTHER);
  cook(dbPath, "Lentil soup");
  cook(first, "Toast");
  cook(other, "Jam");
  await takeCopy({ dbPath, dir, reserve: 0 });
  cook(dbPath, "Flatbread");
  cook(first, "Porridge");
  cook(other, "Scones");
  await assert.rejects(
    stageCopy({ dbPath, copy: findCopy(dir), household: "aaaaaaaaaaaaaaaa" }),
    /has no household aaaaaaaaaaaaaaaa/,
  );
  await stageCopy({ dbPath, copy: findCopy(dir), household: OTHER });
  assert.equal(unstage(dbPath).whole, false);
  assert.equal(applyRestore(dbPath), null);
  const plan = await stageCopy({
    dbPath,
    copy: findCopy(dir),
    household: HOUSEHOLD,
  });
  assert.deepEqual(plan.files, [`households/${HOUSEHOLD}.sqlite`]);
  const restored = applyRestore(dbPath);
  assert.deepEqual(titles(first), ["Toast"]);
  assert.deepEqual(titles(dbPath), ["Flatbread", "Lentil soup"]);
  assert.deepEqual(titles(other), ["Jam", "Scones"]);
  assert.deepEqual(
    readdirSync(join(restored.aside, "households")).filter((n) =>
      n.endsWith(".sqlite"),
    ),
    [`${HOUSEHOLD}.sqlite`],
  );
  assert.equal(existsSync(join(restored.aside, "kooks.sqlite")), false);
  assert.ok(readdirSync(data).includes("households"));
});

test("the schedule copies when the newest copy is older than the interval, and reports failures and lateness", async (t) => {
  const { dbPath, settings } = server(t);
  cook(dbPath, "Lentil soup");
  let clock = Date.parse("2026-11-01T03:00:00Z");
  const pings = [];
  const options = {
    now: () => clock,
    log: quiet,
    ping: async (url) => pings.push(url),
    inThread: false,
    reserve: 0,
  };
  const backups = createBackups(
    { ...settings, ping: "https://hc-ping.com/abc/" },
    options,
  );
  assert.equal(backups.health().ok, true);
  assert.equal(backups.due(), true);
  const copy = await backups.run();
  assert.equal(copy.taken_at, "2026-11-01T03:00:00.000Z");
  assert.deepEqual(pings, ["https://hc-ping.com/abc/"]);
  clock += 23 * HOUR;
  assert.equal(backups.due(), false);
  clock += 2 * HOUR;
  assert.equal(backups.due(), true);

  // A run that cannot find room is reported, retried an hour later, and
  // pings the monitor's failure address.
  const cramped = createBackups(
    { ...settings, ping: "https://hc-ping.com/abc/" },
    { ...options, reserve: Number.MAX_SAFE_INTEGER },
  );
  await assert.rejects(cramped.run(), /not enough room/);
  assert.equal(pings.at(-1), "https://hc-ping.com/abc/fail");
  const failing = cramped.health();
  assert.equal(failing.ok, true);
  assert.match(failing.failure.error, /not enough room/);
  assert.equal(failing.failure.at, new Date(clock).toISOString());
  assert.equal(cramped.due(), false);
  clock += HOUR;
  assert.equal(cramped.due(), true);
  // Late once a day and a half has passed without a good copy.
  clock = Date.parse("2026-11-02T15:00:00Z");
  assert.equal(backups.health().ok, true);
  clock += 1;
  assert.equal(backups.health().late, true);
  assert.equal(backups.health().ok, false);
  // A good copy, from the schedule or the backup script, ends both.
  await backups.run();
  assert.equal(backups.health().ok, true);
  assert.equal(backups.health().failure, null);
  assert.equal(backups.health().copies.length, 2);

  // A server without any copy yet counts from its start.
  const fresh = server(t);
  cook(fresh.dbPath, "Toast");
  const waiting = createBackups(fresh.settings, options);
  clock += 37 * HOUR;
  assert.equal(waiting.health().late, true);
  assert.equal(waiting.health().last_copy_at, null);
  assert.equal(
    backupHealth(fresh.settings, { now: clock, since: clock }).late,
    false,
  );
});

test("the schedule copies in a worker thread, and stops with the server", async (t) => {
  const { dbPath, settings } = server(t);
  cook(dbPath, "Lentil soup");
  cook(householdPath(dbPath, HOUSEHOLD), "Toast");
  // The server keeps its connection open, as it does while running.
  const store = new Store(dbPath);
  t.after(() => store.close());
  const lines = [];
  const backups = createBackups(settings, {
    log: { log: (line) => lines.push(line), error: (line) => lines.push(line) },
    reserve: 0,
  });
  const copy = await backups.run();
  assert.equal(copy.files.length, 2);
  assert.match(lines[0], /^Kooks took its automatic backup: 2 databases/);
  backups.start();
  backups.stop();
  assert.equal(backups.due(), false);
});

// A plain HTTP client, so the test can send the Origin a browser would.
async function listen(t, options) {
  const server = createWebServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    if (!server.listening) return;
    await new Promise((resolve) => server.close(resolve));
    server.auth?.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { input, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        `${origin}${path}`,
        {
          method: input === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...headers,
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              cookie: response.headers["set-cookie"]?.[0]?.split(";")[0],
              json: JSON.parse(Buffer.concat(chunks).toString() || "null"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(input === undefined ? undefined : JSON.stringify(input));
    });
  return { server, call };
}

test("the server tells whoever runs it how its backups are doing, and a monitor whether they are late", async (t) => {
  const { dbPath, settings } = server(t);
  const store = new Store(dbPath);
  t.after(() => store.close());
  const off = await listen(t, { store });
  assert.equal((await off.call("/healthz/backups")).status, 404);
  assert.deepEqual((await off.call("/api/backups")).json, {
    on: false,
    operator: true,
  });

  let clock = Date.now();
  const backups = createBackups(settings, {
    now: () => clock,
    log: quiet,
    inThread: false,
    reserve: 0,
  });
  const { call } = await listen(t, { store, backups });
  assert.deepEqual((await call("/healthz/backups")).json, {
    ok: true,
    last_copy_at: null,
  });
  clock += 37 * HOUR;
  const late = await call("/healthz/backups");
  assert.equal(late.status, 503);
  assert.equal(late.json.ok, false);
  const copy = await backups.run();
  const fine = await call("/healthz/backups");
  assert.equal(fine.status, 200);
  assert.deepEqual(fine.json, { ok: true, last_copy_at: copy.taken_at });
  const status = (await call("/api/backups")).json;
  assert.equal(status.operator, true);
  assert.equal(status.every_hours, 24);
  assert.equal(status.dir, settings.dir);
  assert.equal(status.late, false);
  assert.equal(status.failure, null);
  assert.equal(status.offsite, null);
  assert.deepEqual(
    status.copies.map((c) => c.name),
    [copy.name],
  );
});

test("only the owner named for the server sees its backups, and a restore brings sign-ins back", async (t) => {
  const { dbPath, settings } = server(t);
  const sent = [];
  const mailer = {
    description: "to the test mailbox",
    async send(message) {
      sent.push(message);
    },
  };
  const options = {
    owner: "cook@example.test",
    members: ["baker@example.test"],
    mailer,
  };
  let store = new Store(dbPath);
  const backups = createBackups(settings, {
    log: quiet,
    inThread: false,
    reserve: 0,
  });
  const first = await listen(t, { store, backups, ...options });
  const signIn = async (email) => {
    await first.call("/api/auth/link", { input: { email } });
    const token = sent.at(-1).text.match(/#\/signin\/([A-Za-z0-9_-]+)/)[1];
    return {
      Cookie: (await first.call("/api/auth/link/confirm", { input: { token } }))
        .cookie,
    };
  };
  const owner = await signIn("cook@example.test");
  const baker = await signIn("baker@example.test");
  assert.equal((await first.call("/api/backups", { headers: {} })).status, 401);
  assert.deepEqual(
    (await first.call("/api/backups", { headers: baker })).json,
    { on: true, operator: false },
  );
  assert.equal(
    (await first.call("/api/backups", { headers: owner })).json.operator,
    true,
  );
  await first.call("/api/tools/recipe_save", {
    input: { request_id: "soup", recipe: { title: "Lentil soup" } },
    headers: owner,
  });
  await backups.run();
  // After the copy: the owner signs out and a recipe is saved.
  await first.call("/api/tools/recipe_save", {
    input: { request_id: "bread", recipe: { title: "Flatbread" } },
    headers: baker,
  });
  await first.call("/api/auth/signout", { input: {}, headers: owner });
  assert.equal(
    (await first.call("/api/state", { headers: owner })).status,
    401,
  );
  await stageCopy({ dbPath, copy: findCopy(settings.dir) });
  await new Promise((resolve) => first.server.close(resolve));
  first.server.auth.close();
  store.close();

  // The next start puts the copy in place: the owner's session is back and
  // the later recipe is gone.
  applyRestore(dbPath);
  store = new Store(dbPath);
  t.after(() => store.close());
  const second = await listen(t, { store, ...options });
  const state = await second.call("/api/state", { headers: owner });
  assert.equal(state.status, 200);
  assert.deepEqual(
    state.json.records.recipe.map((r) => r.data.title),
    ["Lentil soup"],
  );
});
