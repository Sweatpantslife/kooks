import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export class KooksError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export function requireThat(condition, code, message) {
  if (!condition) throw new KooksError(code, message);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

// Schema 2 keeps asset bytes in the blobs table. Records, listings, polling,
// history and undo only ever see asset metadata.
const SCHEMA_VERSION = 2;
const hasInlineBytes = (kind, data) =>
  kind === "asset" && typeof data?.base64 === "string";

// Split an asset document into immutable bytes and the metadata that stays in
// the record. The input object is never mutated.
export function splitAsset(data) {
  const { base64, ...metadata } = data;
  const bytes = Buffer.from(base64, "base64");
  return {
    bytes,
    data: {
      ...metadata,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byte_length: bytes.length,
    },
  };
}

// SQLite serializes transactions across MCP processes. The domain layer never
// awaits while a transaction is open, so reads and writes form one atomic action.
export class Store {
  constructor(path) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    requireThat(
      this.userVersion() <= SCHEMA_VERSION,
      "DATABASE_VERSION",
      "This database was created by a newer Kooks server.",
    );
    // A large photo library can take a while to migrate; give a concurrent
    // opener time to wait instead of failing with SQLITE_BUSY.
    this.db.exec("PRAGMA busy_timeout = 60000; PRAGMA journal_mode = WAL;");
    let moved = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS records (
          kind TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL,
          PRIMARY KEY (kind, id)
        );
        CREATE TABLE IF NOT EXISTS actions (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
          action TEXT NOT NULL, created_at TEXT NOT NULL,
          changes TEXT NOT NULL, result TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS blobs (
          kind TEXT NOT NULL, id TEXT NOT NULL, bytes BLOB NOT NULL,
          PRIMARY KEY (kind, id)
        );
      `);
      // Re-read inside the transaction: another process may have upgraded
      // the file between the first check and the lock.
      if (this.userVersion() < SCHEMA_VERSION) moved = this.#migrateAssets();
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    // Rewriting documents frees pages but does not shrink the file.
    if (moved) this.db.exec("VACUUM");
    this.db.exec("PRAGMA busy_timeout = 5000");
  }
  userVersion() {
    return this.db.prepare("PRAGMA user_version").get().user_version;
  }
  // Schema 1 stored base64 inside asset documents and copied it into every
  // history entry. Move the bytes out once and strip the copies.
  #migrateAssets() {
    let moved = 0;
    const insertBlob = this.db.prepare(
      "INSERT OR REPLACE INTO blobs(kind, id, bytes) VALUES (?, ?, ?)",
    );
    const updateRecord = this.db.prepare(
      "UPDATE records SET document = ? WHERE kind = 'asset' AND id = ?",
    );
    for (const row of this.db
      .prepare("SELECT id, document FROM records WHERE kind = 'asset'")
      .all()) {
      const record = JSON.parse(row.document);
      if (!hasInlineBytes("asset", record.data)) continue;
      const { bytes, data } = splitAsset(record.data);
      insertBlob.run("asset", record.id, bytes);
      updateRecord.run(JSON.stringify({ ...record, data }), record.id);
      moved++;
    }
    const strip = (record) =>
      record && hasInlineBytes("asset", record.data)
        ? { ...record, data: splitAsset(record.data).data }
        : record;
    const updateAction = this.db.prepare(
      "UPDATE actions SET changes = ? WHERE seq = ?",
    );
    for (const row of this.db
      .prepare(
        `SELECT seq, changes FROM actions WHERE instr(changes, '"kind":"asset"') > 0`,
      )
      .all()) {
      const changes = JSON.parse(row.changes).map((change) =>
        change.kind === "asset"
          ? {
              ...change,
              before: strip(change.before),
              after: strip(change.after),
            }
          : change,
      );
      updateAction.run(JSON.stringify(changes), row.seq);
    }
    return moved;
  }
  #storeBytes(kind, id, bytes) {
    this.db
      .prepare("INSERT INTO blobs(kind, id, bytes) VALUES (?, ?, ?)")
      .run(kind, id, bytes);
  }
  close() {
    this.db.close();
  }
  read(fn) {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  get(kind, id, includeArchived = false) {
    const row = this.db
      .prepare("SELECT document FROM records WHERE kind = ? AND id = ?")
      .get(kind, id);
    requireThat(row, "NOT_FOUND", `${kind} ${id} does not exist.`);
    const record = JSON.parse(row.document);
    requireThat(
      includeArchived || !record.archived,
      "ARCHIVED",
      `${kind} ${id} is archived. Restore it before use.`,
    );
    return record;
  }
  list(kind, includeArchived = false) {
    return this.db
      .prepare("SELECT document FROM records WHERE kind = ? ORDER BY id")
      .all(kind)
      .map((row) => JSON.parse(row.document))
      .filter((record) => includeArchived || !record.archived);
  }
  all() {
    return this.db
      .prepare("SELECT kind, document FROM records ORDER BY kind, id")
      .all()
      .map((row) => ({ kind: row.kind, ...JSON.parse(row.document) }));
  }
  isEmpty() {
    return (
      this.db
        .prepare(
          "SELECT (SELECT count(*) FROM records) + (SELECT count(*) FROM blobs) AS n",
        )
        .get().n === 0
    );
  }
  // The stored bytes of an asset, as a zero-copy Buffer view.
  blob(kind, id) {
    const row = this.db
      .prepare("SELECT bytes FROM blobs WHERE kind = ? AND id = ?")
      .get(kind, id);
    requireThat(row, "NOT_FOUND", `${kind} ${id} has no stored bytes.`);
    return Buffer.from(
      row.bytes.buffer,
      row.bytes.byteOffset,
      row.bytes.byteLength,
    );
  }
  restoreRecord(kind, record) {
    requireThat(
      this.changes,
      "INTERNAL",
      "Restore must occur inside an action.",
    );
    let stored = record;
    if (hasInlineBytes(kind, record.data)) {
      const { bytes, data } = splitAsset(record.data);
      this.#storeBytes(kind, record.id, bytes);
      stored = { ...record, data };
    }
    this.db
      .prepare("INSERT INTO records(kind, id, document) VALUES (?, ?, ?)")
      .run(kind, stored.id, JSON.stringify(stored));
    this.changes.push({ kind, id: stored.id, before: null, after: stored });
    return stored;
  }
  put(kind, data, id, expectedVersion, archived = false) {
    requireThat(
      this.changes,
      "INTERNAL",
      "Writes must occur inside an action.",
    );
    let bytes = null;
    if (hasInlineBytes(kind, data)) {
      requireThat(
        !id,
        "INTERNAL",
        "Asset bytes are immutable. Create a new asset instead.",
      );
      ({ bytes, data } = splitAsset(data));
    }
    let before = null;
    if (id) {
      before = this.get(kind, id, true);
      requireThat(
        expectedVersion === before.version,
        "STALE_VERSION",
        `Expected ${kind} version ${before.version}; read it again before changing it.`,
      );
    } else {
      requireThat(
        expectedVersion === undefined,
        "INVALID_INPUT",
        "expected_version requires an id.",
      );
      id = randomUUID();
    }
    if (bytes) this.#storeBytes(kind, id, bytes);
    const now = new Date().toISOString();
    const record = {
      id,
      version: (before?.version ?? 0) + 1,
      archived,
      created_at: before?.created_at ?? now,
      updated_at: now,
      data,
    };
    this.db
      .prepare(
        "INSERT OR REPLACE INTO records(kind, id, document) VALUES (?, ?, ?)",
      )
      .run(kind, id, JSON.stringify(record));
    this.changes.push({ kind, id, before, after: record });
    return record;
  }
  mutate(action, args, fn) {
    const fingerprint = digest({ action, args });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare("SELECT fingerprint, result FROM actions WHERE request_id = ?")
        .get(args.request_id);
      if (prior) {
        requireThat(
          prior.fingerprint === fingerprint,
          "REQUEST_ID_REUSED",
          "This request_id belongs to a different action or different arguments. Use a new request_id.",
        );
        this.db.exec("COMMIT");
        return { ...JSON.parse(prior.result), replayed: true };
      }
      this.changes = [];
      const data = fn();
      const actionId = randomUUID();
      const result = { ...data, action_id: actionId, replayed: false };
      this.db
        .prepare(
          "INSERT INTO actions(id, request_id, fingerprint, action, created_at, changes, result) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          actionId,
          args.request_id,
          fingerprint,
          action,
          new Date().toISOString(),
          JSON.stringify(this.changes),
          JSON.stringify(result),
        );
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.changes = null;
    }
  }
  history(limit, offset) {
    return this.db
      .prepare(
        "SELECT id, action, request_id, created_at, changes FROM actions ORDER BY seq DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset)
      .map((row) => ({
        ...row,
        changes: JSON.parse(row.changes).map((change) => ({
          kind: change.kind,
          id: change.id,
          before_version: change.before?.version ?? null,
          after_version: change.after.version,
        })),
      }));
  }
  undo(actionId) {
    const row = this.db
      .prepare("SELECT changes FROM actions WHERE id = ?")
      .get(actionId);
    requireThat(row, "NOT_FOUND", "Action does not exist.");
    const changes = JSON.parse(row.changes);
    for (const change of changes) {
      requireThat(
        digest(this.get(change.kind, change.id, true)) === digest(change.after),
        "UNDO_CONFLICT",
        "A record changed after this action. Undo cannot overwrite the newer change.",
      );
    }
    return {
      records: changes.map((change) =>
        this.put(
          change.kind,
          change.before?.data ?? change.after.data,
          change.id,
          change.after.version,
          change.before?.archived ?? true,
        ),
      ),
    };
  }
}
