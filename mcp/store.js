import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class KooksError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function requireThat(condition, code, message) {
  if (!condition) throw new KooksError(code, message);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// SQLite serializes transactions across MCP processes. The domain layer never
// awaits while a transaction is open, so reads and writes form one atomic action.
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    const schemaVersion = this.db.prepare('PRAGMA user_version').get().user_version;
    requireThat(schemaVersion <= 1, 'DATABASE_VERSION', 'This database was created by a newer Kooks server.');
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
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
      PRAGMA user_version = 1;
    `);
  }
  close() { this.db.close(); }
  read(fn) {
    this.db.exec('BEGIN');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(kind, id, includeArchived = false) {
    const row = this.db.prepare('SELECT document FROM records WHERE kind = ? AND id = ?').get(kind, id);
    requireThat(row, 'NOT_FOUND', `${kind} ${id} does not exist.`);
    const record = JSON.parse(row.document);
    requireThat(includeArchived || !record.archived, 'ARCHIVED', `${kind} ${id} is archived. Restore it before use.`);
    return record;
  }
  list(kind, includeArchived = false) {
    return this.db.prepare('SELECT document FROM records WHERE kind = ? ORDER BY id').all(kind)
      .map(row => JSON.parse(row.document)).filter(record => includeArchived || !record.archived);
  }
  all() {
    return this.db.prepare('SELECT kind, document FROM records ORDER BY kind, id').all()
      .map(row => ({ kind: row.kind, ...JSON.parse(row.document) }));
  }
  restoreRecord(kind, record) {
    requireThat(this.changes, 'INTERNAL', 'Restore must occur inside an action.');
    this.db.prepare('INSERT INTO records(kind, id, document) VALUES (?, ?, ?)').run(kind, record.id, JSON.stringify(record));
    this.changes.push({ kind, id: record.id, before: null, after: record });
    return record;
  }
  put(kind, data, id, expectedVersion, archived = false) {
    requireThat(this.changes, 'INTERNAL', 'Writes must occur inside an action.');
    let before = null;
    if (id) {
      before = this.get(kind, id, true);
      requireThat(expectedVersion === before.version, 'STALE_VERSION', `Expected ${kind} version ${before.version}; read it again before changing it.`);
    } else {
      requireThat(expectedVersion === undefined, 'INVALID_INPUT', 'expected_version requires an id.');
      id = randomUUID();
    }
    const now = new Date().toISOString();
    const record = {
      id, version: (before?.version ?? 0) + 1, archived,
      created_at: before?.created_at ?? now, updated_at: now, data,
    };
    this.db.prepare('INSERT OR REPLACE INTO records(kind, id, document) VALUES (?, ?, ?)').run(kind, id, JSON.stringify(record));
    this.changes.push({ kind, id, before, after: record });
    return record;
  }
  mutate(action, args, fn) {
    const fingerprint = digest({ action, args });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT fingerprint, result FROM actions WHERE request_id = ?').get(args.request_id);
      if (prior) {
        requireThat(prior.fingerprint === fingerprint, 'REQUEST_ID_REUSED', 'This request_id belongs to a different action or different arguments. Use a new request_id.');
        this.db.exec('COMMIT');
        return { ...JSON.parse(prior.result), replayed: true };
      }
      this.changes = [];
      const data = fn();
      const actionId = randomUUID();
      const result = { ...data, action_id: actionId, replayed: false };
      this.db.prepare('INSERT INTO actions(id, request_id, fingerprint, action, created_at, changes, result) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(actionId, args.request_id, fingerprint, action, new Date().toISOString(), JSON.stringify(this.changes), JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.changes = null; }
  }
  history(limit, offset) {
    return this.db.prepare('SELECT id, action, request_id, created_at, changes FROM actions ORDER BY seq DESC LIMIT ? OFFSET ?')
      .all(limit, offset).map(row => ({ ...row, changes: JSON.parse(row.changes).map(change => ({
        kind: change.kind, id: change.id, before_version: change.before?.version ?? null, after_version: change.after.version,
      })) }));
  }
  undo(actionId) {
    const row = this.db.prepare('SELECT changes FROM actions WHERE id = ?').get(actionId);
    requireThat(row, 'NOT_FOUND', 'Action does not exist.');
    const changes = JSON.parse(row.changes);
    for (const change of changes) {
      requireThat(digest(this.get(change.kind, change.id, true)) === digest(change.after), 'UNDO_CONFLICT', 'A record changed after this action. Undo cannot overwrite the newer change.');
    }
    return { records: changes.map(change => this.put(change.kind, change.before?.data ?? change.after.data,
      change.id, change.after.version, change.before?.archived ?? true)) };
  }
}
