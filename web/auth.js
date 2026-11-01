import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { KooksError } from "../mcp/store.js";
import { isEmail } from "./mail.js";
import {
  challengeOf,
  generateChallenge,
  toBase64Url,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn.js";

// Who may enter which kitchen, and how. People have accounts, named by their
// email address; an account belongs to any number of households, and each
// household is a kitchen with its own cookbook. A household is started by
// one of its members and grows by invitation: an emailed invite proves the
// address it went to, so opening it signs that person in and lets them in.
//
// Signing in is a one-time emailed link or a passkey, nothing else. The
// phone app cannot open a link or hold a passkey for the kitchen's address,
// so it asks for a link and waits: the member opens the link on any device,
// confirms that the app may sign in, and the app picks up its own session.
//
// Sessions last as long as they are used: each day of use extends one to
// 180 days from then, and members see and end their signed-in devices.
// Everything lives in auth_* tables beside the first household's cookbook;
// only hashes of tokens are stored.
//
// A member may say which person at the household's table they are. The
// link is kept here with the membership, never in the cookbook, so a
// cookbook and its backups hold no addresses, and a member who leaves or
// is removed takes only the link with them: their person stays at the
// table. Changes in the cookbook name their maker by an opaque account id.

export class AuthError extends KooksError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.status = status;
  }
}
const MINUTE = 60000,
  DAY = 24 * 60 * MINUTE;
// The household whose cookbook is the server's own database: every kitchen
// from before accounts, and the first one on a new server.
export const HOME = "home";
const hash = (token) => createHash("sha256").update(token).digest("hex");
const secret = () => toBase64Url(randomBytes(32));
const isSecret = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const normalizeEmail = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
// A list of addresses, as the KOOKS_HOUSEHOLD_EMAILS of earlier versions held
// them.
export function parseMembers(text, name = "KOOKS_HOUSEHOLD_EMAILS") {
  const members = [];
  for (const raw of String(text ?? "").split(/[\s,;]+/)) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    if (!isEmail(email))
      throw new Error(
        `${name} holds something that is not an email address: ${raw}`,
      );
    if (!members.includes(email)) members.push(email);
  }
  return members;
}
export const cleanName = (value, length = 60) =>
  String(value ?? "")
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
// What a signed-in device is called in the member's list, from its browser.
export function deviceLabel(userAgent, app = false) {
  const ua = String(userAgent ?? "");
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  if (app) return device ? `Kooks app on ${device}` : "Kooks app";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return ([browser, device].filter(Boolean).join(" on ") || "A browser").slice(
    0,
    60,
  );
}
const tooSlow = () =>
  new AuthError("PASSKEY_EXPIRED", "That took a little too long. Try again.");
const linkInvalid = () =>
  new AuthError(
    "LINK_INVALID",
    "This sign-in link has expired or was already used. Request a new one.",
  );
const inviteInvalid = () =>
  new AuthError(
    "INVITE_INVALID",
    "This invite has expired, was withdrawn, or was already used. Ask for a new one.",
  );
const notMember = () =>
  new AuthError("NOT_A_MEMBER", "You’re not a member of that household.", 403);

export function createAuth({
  path = ":memory:",
  mailer,
  now = () => Date.now(),
  // Addresses that share the first household when the server has none yet:
  // the household list of earlier versions.
  members = [],
  // The first household's owner, who also gets an account whenever theirs is
  // missing, so a server can always be entered.
  owner = "",
  // Whether anyone may make an account with an emailed link, or only people
  // a member invited.
  openSignup = false,
  linkLifetime = 15 * MINUTE,
  inviteLifetime = 7 * DAY,
  sessionLifetime = 180 * DAY,
  challengeLifetime = 10 * MINUTE,
}) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS auth_accounts (
      email TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, signed_in_at TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_passkeys (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      algorithm INTEGER NOT NULL, public_key TEXT NOT NULL,
      sign_count INTEGER NOT NULL, transports TEXT NOT NULL,
      backed_up INTEGER NOT NULL, created_at TEXT NOT NULL, used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS auth_passkeys_email ON auth_passkeys(email);
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, method TEXT NOT NULL,
      created_at TEXT NOT NULL, renewed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_links (
      token_hash TEXT PRIMARY KEY, email TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_households (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_members (
      email TEXT NOT NULL, household TEXT NOT NULL, role TEXT NOT NULL,
      joined_at TEXT NOT NULL, PRIMARY KEY (email, household)
    );
    CREATE INDEX IF NOT EXISTS auth_members_household
      ON auth_members(household);
    CREATE TABLE IF NOT EXISTS auth_invites (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      household TEXT NOT NULL, email TEXT NOT NULL, invited_by TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
      UNIQUE (household, email)
    );
    CREATE TABLE IF NOT EXISTS auth_waits (
      wait_hash TEXT PRIMARY KEY, email TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
      approved_at TEXT
    );
    -- The phone app's emailed codes, from before it waited for a link.
    DROP TABLE IF EXISTS auth_codes;
  `);
  const columns = (table) =>
    new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name),
    );
  const addColumns = (table, wanted) => {
    const have = columns(table);
    for (const [name, type] of wanted)
      if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD ${name} ${type}`);
  };
  addColumns("auth_sessions", [
    ["id", "TEXT"],
    ["household", "TEXT"],
    ["label", "TEXT"],
    ["used_at", "TEXT"],
  ]);
  addColumns("auth_links", [["wait_hash", "TEXT"]]);
  addColumns("auth_accounts", [["id", "TEXT"]]);
  addColumns("auth_members", [["person", "TEXT"]]);
  db.exec(`
    UPDATE auth_sessions SET id = lower(hex(randomblob(8))) WHERE id IS NULL;
    UPDATE auth_accounts SET id = lower(hex(randomblob(8))) WHERE id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_id ON auth_accounts(id);
    -- One member per person at a household's table.
    CREATE UNIQUE INDEX IF NOT EXISTS auth_members_person
      ON auth_members(household, person) WHERE person IS NOT NULL;
  `);

  const statements = new Map();
  const q = (sql) => {
    if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
    return statements.get(sql);
  };
  const transaction = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const iso = (ms) => new Date(ms).toISOString();
  const challenges = new Map();
  function prune() {
    const t = now();
    q("DELETE FROM auth_sessions WHERE expires_at < ?").run(t);
    q("DELETE FROM auth_links WHERE expires_at < ?").run(t);
    q("DELETE FROM auth_invites WHERE expires_at < ?").run(t);
    q("DELETE FROM auth_waits WHERE expires_at < ?").run(t);
    for (const [key, pending] of challenges)
      if (pending.expires < t) challenges.delete(key);
  }
  const accountOf = (email) =>
    q("SELECT email, handle, id FROM auth_accounts WHERE email = ?").get(email);
  function ensureAccount(email) {
    let row = accountOf(email);
    if (!row) {
      row = { email, handle: secret(), id: randomBytes(8).toString("hex") };
      q(
        "INSERT INTO auth_accounts(email, handle, id, created_at) VALUES (?, ?, ?, ?)",
      ).run(email, row.handle, row.id, iso(now()));
    }
    return row;
  }
  const membership = (email, household) =>
    q(
      "SELECT role, person FROM auth_members WHERE email = ? AND household = ?",
    ).get(email, household);
  const join = (email, household, role = "member") =>
    q(
      "INSERT OR IGNORE INTO auth_members(email, household, role, joined_at) VALUES (?, ?, ?, ?)",
    ).run(email, household, role, iso(now()));
  const householdsOf = (email) =>
    q(
      `SELECT h.id, h.name, m.role, m.person,
        (SELECT count(*) FROM auth_members o WHERE o.household = h.id) AS members
       FROM auth_members m JOIN auth_households h ON h.id = m.household
       WHERE m.email = ? ORDER BY m.joined_at, m.rowid`,
    ).all(email);
  const householdRow = (id) =>
    q("SELECT id, name FROM auth_households WHERE id = ?").get(id);

  // Earlier versions had one household, the server's own database, and a
  // list of addresses that could enter it. The first start with accounts
  // makes that the first household, with those addresses as its members and
  // the owner first among them; accounts of addresses no longer on the list
  // had already lost their way in, and go with their passkeys and sessions.
  const seed = [normalizeEmail(owner), ...members.map(normalizeEmail)].filter(
    (email, i, all) => email && all.indexOf(email) === i,
  );
  transaction(() => {
    const started = q("SELECT count(*) AS n FROM auth_households").get().n > 0;
    if (!started && seed.length) {
      q(
        "INSERT INTO auth_households(id, name, created_at, created_by) VALUES (?, ?, ?, ?)",
      ).run(HOME, "Our kitchen", iso(now()), seed[0]);
      seed.forEach((email, i) => {
        ensureAccount(email);
        join(email, HOME, i === 0 ? "owner" : "member");
      });
      const keep = `(${seed.map(() => "?").join(", ")})`;
      for (const table of ["auth_accounts", "auth_passkeys", "auth_sessions"])
        q(`DELETE FROM ${table} WHERE email NOT IN ${keep}`).run(...seed);
    }
    // The owner can always get in: their account comes back if it went,
    // and a first household nobody belongs to becomes theirs again.
    const ownerEmail = normalizeEmail(owner);
    if (started && ownerEmail) {
      ensureAccount(ownerEmail);
      if (
        householdRow(HOME) &&
        !q("SELECT 1 FROM auth_members WHERE household = ?").get(HOME)
      )
        join(ownerEmail, HOME, "owner");
    }
  });

  const siteOf = (value) => {
    const url = new URL(value);
    return { origin: url.origin, rpId: url.hostname.replace(/^\[|\]$/g, "") };
  };
  const passkeyView = (row) => ({
    id: row.id,
    name: row.name,
    transports: JSON.parse(row.transports),
    backed_up: Boolean(row.backed_up),
    created_at: row.created_at,
    used_at: row.used_at,
  });
  const passkeys = (email) =>
    q("SELECT * FROM auth_passkeys WHERE email = ? ORDER BY created_at, id")
      .all(email)
      .map(passkeyView);
  function takeChallenge(credential, type) {
    const { data } = challengeOf(credential);
    const pending = challenges.get(data.challenge);
    challenges.delete(data.challenge);
    if (!pending || pending.type !== type || pending.expires < now())
      throw tooSlow();
    return { ...pending, challenge: data.challenge };
  }
  const minutes = (ms) => Math.round(ms / MINUTE);
  const days = (ms) => Math.round(ms / DAY);

  function requireMember(email, household) {
    const row = membership(email, household);
    if (!row) throw notMember();
    return row;
  }
  // A household with nobody left in it can never be entered again, so its
  // last member stays.
  function leaveAllowed(household) {
    if (
      q("SELECT count(*) AS n FROM auth_members WHERE household = ?").get(
        household,
      ).n <= 1
    )
      throw new AuthError(
        "LAST_MEMBER",
        "You’re the only member of this household, so it can’t be left: nobody could open it again. Invite someone first.",
        409,
      );
  }
  // An owner who goes hands the household to whoever has been in it longest.
  function handOver(household) {
    if (
      !q(
        "SELECT 1 FROM auth_members WHERE household = ? AND role = 'owner'",
      ).get(household)
    )
      q(
        `UPDATE auth_members SET role = 'owner' WHERE rowid = (
           SELECT rowid FROM auth_members WHERE household = ?
           ORDER BY joined_at, rowid LIMIT 1)`,
      ).run(household);
  }

  return {
    sessionLifetime,
    openSignup,
    // Whether an emailed link may sign this address in: it has an account,
    // or anyone may make one.
    canSignIn: (email) =>
      openSignup || Boolean(accountOf(normalizeEmail(email))),
    accounts: () => q("SELECT count(*) AS n FROM auth_accounts").get().n,
    // Resolves to whether a link was sent; strangers get nothing, silently.
    // The caller has already answered, the same way for every address, so a
    // mail failure goes to the log rather than to whoever asked. A link the
    // phone app asked for carries the hash of the secret the app waits with.
    async requestLink({ email, origin, wait = null }) {
      prune();
      const address = normalizeEmail(email);
      if (!openSignup && !accountOf(address)) return false;
      const token = secret();
      const waitHash = isSecret(wait) ? hash(wait) : null;
      q(
        "INSERT INTO auth_links(token_hash, email, created_at, expires_at, wait_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(hash(token), address, iso(now()), now() + linkLifetime, waitHash);
      if (waitHash)
        q(
          "INSERT OR REPLACE INTO auth_waits(wait_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
        ).run(waitHash, address, iso(now()), now() + linkLifetime);
      const link = `${siteOf(origin).origin}/#/signin/${token}`;
      try {
        await mailer.send({
          to: address,
          subject: waitHash
            ? "Sign in to the Kooks app"
            : "Your Kooks sign-in link",
          text: waitHash
            ? `Open this link to sign in to the Kooks app:\n\n${link}\n\nOpen it on any phone or computer; the page asks you to confirm, and the app then signs in by itself. It works once, for the next ${minutes(linkLifetime)} minutes.\nIf you did not just ask for this in the Kooks app, ignore this email and do not confirm.\n`
            : `Open this link to get into your kitchen:\n\n${link}\n\nIt works once, for the next ${minutes(linkLifetime)} minutes, on the device where you open it.\nIf you did not ask for it, you can ignore this email.\n`,
        });
      } catch (error) {
        q("DELETE FROM auth_links WHERE token_hash = ?").run(hash(token));
        console.error(`Kooks could not email a sign-in link: ${error.message}`);
        return false;
      }
      return true;
    },
    // Opening a link signs that browser in. A link the phone app asked for
    // signs nobody in until the person who opened it confirms, and then
    // signs in the app.
    confirmLink(token, { approve = false } = {}) {
      prune();
      if (!isSecret(token)) throw linkInvalid();
      const row = q(
        "SELECT email, used_at, wait_hash FROM auth_links WHERE token_hash = ? AND expires_at >= ?",
      ).get(hash(token), now());
      if (!row || row.used_at || !(openSignup || accountOf(row.email)))
        throw linkInvalid();
      if (row.wait_hash && !approve) return { email: row.email, app: true };
      q("UPDATE auth_links SET used_at = ? WHERE token_hash = ?").run(
        iso(now()),
        hash(token),
      );
      ensureAccount(row.email);
      if (row.wait_hash) {
        const { changes } = q(
          "UPDATE auth_waits SET approved_at = ? WHERE wait_hash = ? AND approved_at IS NULL",
        ).run(iso(now()), row.wait_hash);
        if (!changes) throw linkInvalid();
        return { email: row.email, app: true, approved: true };
      }
      return { email: row.email, app: false };
    },
    // What the waiting phone app hears: nothing yet, or, once, the address
    // its link was confirmed for.
    waited(wait) {
      prune();
      if (!isSecret(wait)) return null;
      const row = q(
        "SELECT email, approved_at FROM auth_waits WHERE wait_hash = ?",
      ).get(hash(wait));
      if (!row?.approved_at) return null;
      q("DELETE FROM auth_waits WHERE wait_hash = ?").run(hash(wait));
      return accountOf(row.email) ? row.email : null;
    },
    createSession(email, method, { label = "", household = null } = {}) {
      const token = randomBytes(32).toString("hex"),
        t = now();
      ensureAccount(email);
      const current =
        household && membership(email, household)
          ? household
          : (householdsOf(email)[0]?.id ?? null);
      q(
        "INSERT INTO auth_sessions(token_hash, id, email, method, household, label, created_at, used_at, renewed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        hash(token),
        randomBytes(8).toString("hex"),
        email,
        method,
        current,
        cleanName(label) || "A device",
        iso(t),
        iso(t),
        t,
        t + sessionLifetime,
      );
      q("UPDATE auth_accounts SET signed_in_at = ? WHERE email = ?").run(
        iso(t),
        email,
      );
      return token;
    },
    // A session slides: use within its lifetime keeps it, and a day of use
    // extends it. Its household is checked on every request, so a member who
    // leaves or is removed is out at once; they stay signed in, in another
    // household of theirs or none.
    session(token) {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
        return null;
      const key = hash(token);
      const row = q(
        "SELECT id, email, method, household, renewed_at, expires_at FROM auth_sessions WHERE token_hash = ?",
      ).get(key);
      if (!row) return null;
      const t = now();
      const owner = accountOf(row.email);
      if (row.expires_at < t || !owner) {
        q("DELETE FROM auth_sessions WHERE token_hash = ?").run(key);
        return null;
      }
      let household = row.household;
      let member = household && membership(row.email, household);
      if (!member) {
        household = householdsOf(row.email)[0]?.id ?? null;
        member = household && membership(row.email, household);
        q("UPDATE auth_sessions SET household = ? WHERE token_hash = ?").run(
          household,
          key,
        );
      }
      const renewed = t - row.renewed_at > DAY;
      if (renewed)
        q(
          "UPDATE auth_sessions SET renewed_at = ?, expires_at = ?, used_at = ? WHERE token_hash = ?",
        ).run(t, t + sessionLifetime, iso(t), key);
      return {
        id: row.id,
        email: row.email,
        account: owner.id,
        method: row.method,
        household,
        // The person at this household's table the member says they are.
        person: member?.person ?? null,
        renewed,
      };
    },
    endSession(token) {
      if (typeof token === "string")
        q("DELETE FROM auth_sessions WHERE token_hash = ?").run(hash(token));
    },
    // Where this account is signed in, newest use first.
    sessions: (email) =>
      q(
        "SELECT id, method, label, created_at, used_at FROM auth_sessions WHERE email = ? AND expires_at >= ? ORDER BY used_at DESC, id",
      ).all(email, now()),
    endSessionById(email, id) {
      const { changes } = q(
        "DELETE FROM auth_sessions WHERE email = ? AND id = ?",
      ).run(email, String(id ?? ""));
      if (!changes)
        throw new AuthError(
          "NOT_FOUND",
          "That device is already signed out.",
          404,
        );
    },
    endOtherSessions(email, keepId) {
      return q("DELETE FROM auth_sessions WHERE email = ? AND id != ?").run(
        email,
        String(keepId ?? ""),
      ).changes;
    },
    // The account as the app shows it: its households, the one this session
    // is in, and invites waiting for it.
    accountView(session) {
      const households = householdsOf(session.email);
      return {
        email: session.email,
        method: session.method,
        household: households.find((h) => h.id === session.household) ?? null,
        households,
        invites: q(
          `SELECT i.id, h.name AS household, i.invited_by
           FROM auth_invites i JOIN auth_households h ON h.id = i.household
           WHERE i.email = ? AND i.expires_at >= ?
             AND NOT EXISTS (SELECT 1 FROM auth_members m
               WHERE m.email = i.email AND m.household = i.household)
           ORDER BY i.created_at`,
        ).all(session.email, now()),
      };
    },
    // A new household, with its starter as owner, entered at once.
    createHousehold(session, name) {
      const title = cleanName(name);
      if (!title)
        throw new AuthError("INVALID_INPUT", "Give the household a name.");
      if (householdsOf(session.email).length >= 10)
        throw new AuthError(
          "TOO_MANY",
          "You belong to ten households already.",
          409,
        );
      const id = randomBytes(8).toString("hex");
      transaction(() => {
        q(
          "INSERT INTO auth_households(id, name, created_at, created_by) VALUES (?, ?, ?, ?)",
        ).run(id, title, iso(now()), session.email);
        join(session.email, id, "owner");
        q("UPDATE auth_sessions SET household = ? WHERE id = ?").run(
          id,
          session.id,
        );
      });
      return id;
    },
    switchHousehold(session, id) {
      requireMember(session.email, String(id ?? ""));
      q("UPDATE auth_sessions SET household = ? WHERE id = ?").run(
        id,
        session.id,
      );
    },
    renameHousehold(session, name) {
      const title = cleanName(name);
      if (!title)
        throw new AuthError("INVALID_INPUT", "Give the household a name.");
      requireMember(session.email, session.household);
      q("UPDATE auth_households SET name = ? WHERE id = ?").run(
        title,
        session.household,
      );
    },
    // Who is in the household, and who has been asked to join it.
    members(session) {
      requireMember(session.email, session.household);
      return {
        members: q(
          "SELECT email, role, joined_at, person FROM auth_members WHERE household = ? ORDER BY joined_at, rowid",
        ).all(session.household),
        invites: q(
          "SELECT id, email, invited_by, created_at, expires_at FROM auth_invites WHERE household = ? AND expires_at >= ? ORDER BY created_at",
        )
          .all(session.household, now())
          .map((i) => ({ ...i, expires_at: iso(i.expires_at) })),
      };
    },
    // Any member may invite. The invite goes by email, works once, for a
    // week, and asking again replaces it. Resolves to whether it was sent.
    async invite(session, { email, origin }) {
      prune();
      const address = normalizeEmail(email);
      if (!isEmail(address))
        throw new AuthError("INVALID_INPUT", "Enter a valid email address.");
      requireMember(session.email, session.household);
      if (membership(address, session.household))
        throw new AuthError(
          "ALREADY_MEMBER",
          `${address} is already in this household.`,
          409,
        );
      if (
        q(
          "SELECT count(*) AS n FROM auth_invites WHERE household = ? AND email != ?",
        ).get(session.household, address).n >= 20
      )
        throw new AuthError(
          "TOO_MANY",
          "Twenty invites are waiting already. Withdraw some first.",
          409,
        );
      const token = secret();
      const id = randomBytes(8).toString("hex");
      q("DELETE FROM auth_invites WHERE household = ? AND email = ?").run(
        session.household,
        address,
      );
      q(
        "INSERT INTO auth_invites(id, token_hash, household, email, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        hash(token),
        session.household,
        address,
        session.email,
        iso(now()),
        now() + inviteLifetime,
      );
      const household = householdRow(session.household).name;
      try {
        await mailer.send({
          to: address,
          subject: `Join ${household} on Kooks`,
          text: `${session.email} invited you to ${household}, their kitchen on Kooks: recipes, the week's meals and the grocery list, shared.\n\nOpen this link to join:\n\n${siteOf(origin).origin}/#/join/${token}\n\nIt works once, for the next ${days(inviteLifetime)} days. Opening it signs you in as ${address}, so keep it to yourself.\nIf you don't know ${session.email}, you can ignore this email.\n`,
        });
      } catch (error) {
        q("DELETE FROM auth_invites WHERE id = ?").run(id);
        console.error(`Kooks could not email an invite: ${error.message}`);
        throw new AuthError(
          "MAIL_FAILED",
          "The invite could not be emailed. Try again in a while.",
          502,
        );
      }
      return true;
    },
    withdrawInvite(session, id) {
      requireMember(session.email, session.household);
      const { changes } = q(
        "DELETE FROM auth_invites WHERE household = ? AND id = ?",
      ).run(session.household, String(id ?? ""));
      if (!changes)
        throw new AuthError(
          "NOT_FOUND",
          "That invite was already used or withdrawn.",
          404,
        );
    },
    // What an invite link is for, before anyone acts on it.
    openInvite(token) {
      prune();
      if (!isSecret(token)) throw inviteInvalid();
      const row = q(
        `SELECT i.email, i.invited_by, h.name AS household
         FROM auth_invites i JOIN auth_households h ON h.id = i.household
         WHERE i.token_hash = ? AND i.expires_at >= ?`,
      ).get(hash(token), now());
      if (!row) throw inviteInvalid();
      return row;
    },
    // Accepting an invite link: the address it was sent to joins, with an
    // account if it had none. Returns that address and the household.
    acceptInvite(token) {
      prune();
      if (!isSecret(token)) throw inviteInvalid();
      return transaction(() => {
        const row = q(
          "SELECT id, email, household FROM auth_invites WHERE token_hash = ? AND expires_at >= ?",
        ).get(hash(token), now());
        if (!row || !householdRow(row.household)) throw inviteInvalid();
        q("DELETE FROM auth_invites WHERE id = ?").run(row.id);
        ensureAccount(row.email);
        join(row.email, row.household);
        return { email: row.email, household: row.household };
      });
    },
    // A signed-in person takes an invite to their own address from inside
    // the app, by its id.
    joinInvited(session, id) {
      return transaction(() => {
        const row = q(
          "SELECT id, household FROM auth_invites WHERE id = ? AND email = ? AND expires_at >= ?",
        ).get(String(id ?? ""), session.email, now());
        if (!row || !householdRow(row.household)) throw inviteInvalid();
        q("DELETE FROM auth_invites WHERE id = ?").run(row.id);
        join(session.email, row.household);
        q("UPDATE auth_sessions SET household = ? WHERE id = ?").run(
          row.household,
          session.id,
        );
        return row.household;
      });
    },
    declineInvite(session, id) {
      q("DELETE FROM auth_invites WHERE id = ? AND email = ?").run(
        String(id ?? ""),
        session.email,
      );
    },
    // A member says which person at the table they are, or that they are
    // none of them. The caller checks that the person is at this
    // household's table; each person stands for one member at most.
    linkPerson(session, person) {
      requireMember(session.email, session.household);
      const id = person == null ? null : String(person);
      transaction(() => {
        if (
          id &&
          q(
            "SELECT 1 FROM auth_members WHERE household = ? AND person = ? AND email != ?",
          ).get(session.household, id, session.email)
        )
          throw new AuthError(
            "PERSON_TAKEN",
            "Another member is already that person. They can unlink it on People at the table, or the household's owner on Members.",
            409,
          );
        q(
          "UPDATE auth_members SET person = ? WHERE email = ? AND household = ?",
        ).run(id, session.email, session.household);
      });
    },
    // An owner takes back another member's claim to a person, so that a
    // wrong one does not keep the right member from it.
    unlinkMember(session, email) {
      if (requireMember(session.email, session.household).role !== "owner")
        throw new AuthError(
          "NOT_OWNER",
          "Only the household's owner can unlink someone else.",
          403,
        );
      const { changes } = q(
        "UPDATE auth_members SET person = NULL WHERE email = ? AND household = ?",
      ).run(normalizeEmail(email), session.household);
      if (!changes)
        throw new AuthError(
          "NOT_FOUND",
          `${normalizeEmail(email)} is not in this household.`,
          404,
        );
    },
    // Each current member's account id, and the person they are at this
    // household's table, if they said: how history names them.
    links: (household) =>
      new Map(
        q(
          `SELECT a.id, m.person FROM auth_members m
           JOIN auth_accounts a ON a.email = m.email WHERE m.household = ?`,
        )
          .all(household)
          .map((row) => [row.id, row.person]),
      ),
    // Leaving, or being removed, deletes the membership and the link with
    // it; the person stays at the table, linked to nobody.
    leave(session) {
      requireMember(session.email, session.household);
      transaction(() => {
        leaveAllowed(session.household);
        q("DELETE FROM auth_members WHERE email = ? AND household = ?").run(
          session.email,
          session.household,
        );
        handOver(session.household);
      });
    },
    // Owners may take someone out of the household; that person's devices
    // lose it at their next request.
    removeMember(session, email) {
      const address = normalizeEmail(email);
      if (requireMember(session.email, session.household).role !== "owner")
        throw new AuthError(
          "NOT_OWNER",
          "Only the household's owner can remove people.",
          403,
        );
      if (address === session.email)
        throw new AuthError(
          "INVALID_INPUT",
          "To leave the household yourself, use Leave.",
        );
      const { changes } = q(
        "DELETE FROM auth_members WHERE email = ? AND household = ?",
      ).run(address, session.household);
      if (!changes)
        throw new AuthError(
          "NOT_FOUND",
          `${address} is not in this household.`,
          404,
        );
    },
    passkeys,
    registrationOptions({ email, origin }) {
      prune();
      const site = siteOf(origin);
      const challenge = generateChallenge();
      challenges.set(challenge, {
        type: "register",
        email,
        ...site,
        expires: now() + challengeLifetime,
      });
      return {
        rp: { id: site.rpId, name: "Kooks" },
        user: {
          id: ensureAccount(email).handle,
          name: email,
          displayName: email,
        },
        challenge,
        pubKeyCredParams: [-8, -7, -257].map((alg) => ({
          type: "public-key",
          alg,
        })),
        timeout: 120000,
        attestation: "none",
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        excludeCredentials: passkeys(email).map((p) => ({
          type: "public-key",
          id: p.id,
          transports: p.transports,
        })),
      };
    },
    register({ email, credential, name }) {
      const pending = takeChallenge(credential, "register");
      if (pending.email !== email) throw tooSlow();
      const result = verifyRegistration({
        credential,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        rpId: pending.rpId,
      });
      if (q("SELECT 1 FROM auth_passkeys WHERE id = ?").get(result.id))
        throw new AuthError(
          "PASSKEY_EXISTS",
          "This passkey is already registered.",
          409,
        );
      q(
        "INSERT INTO auth_passkeys(id, email, name, algorithm, public_key, sign_count, transports, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        result.id,
        email,
        cleanName(name) || "Passkey",
        result.publicKey.alg,
        JSON.stringify(result.publicKey.jwk),
        result.signCount,
        JSON.stringify(result.transports),
        result.backedUp ? 1 : 0,
        iso(now()),
      );
      return passkeyView(
        q("SELECT * FROM auth_passkeys WHERE id = ?").get(result.id),
      );
    },
    authenticationOptions({ origin }) {
      prune();
      const site = siteOf(origin);
      const challenge = generateChallenge();
      challenges.set(challenge, {
        type: "authenticate",
        ...site,
        expires: now() + challengeLifetime,
      });
      return {
        challenge,
        rpId: site.rpId,
        timeout: 120000,
        userVerification: "required",
        allowCredentials: [],
      };
    },
    authenticate({ credential }) {
      const pending = takeChallenge(credential, "authenticate");
      const row = q("SELECT * FROM auth_passkeys WHERE id = ?").get(
        String(credential.id),
      );
      const owner = row && accountOf(row.email);
      if (!owner)
        throw new AuthError(
          "PASSKEY_UNKNOWN",
          "This passkey is not registered with this kitchen. Sign in with an email link, then add it.",
          401,
        );
      const result = verifyAuthentication({
        credential,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        rpId: pending.rpId,
        publicKey: { alg: row.algorithm, jwk: JSON.parse(row.public_key) },
        signCount: row.sign_count,
      });
      if (result.userHandle && toBase64Url(result.userHandle) !== owner.handle)
        throw new AuthError(
          "PASSKEY_INVALID",
          "This passkey belongs to a different account.",
          401,
        );
      q(
        "UPDATE auth_passkeys SET sign_count = ?, backed_up = ?, used_at = ? WHERE id = ?",
      ).run(result.signCount, result.backedUp ? 1 : 0, iso(now()), row.id);
      return row.email;
    },
    removePasskey(email, id) {
      const { changes } = q(
        "DELETE FROM auth_passkeys WHERE email = ? AND id = ?",
      ).run(email, String(id ?? ""));
      if (!changes)
        throw new AuthError(
          "NOT_FOUND",
          "That passkey is no longer registered.",
          404,
        );
    },
    // For whoever runs the server, from its terminal (scripts/accounts.mjs).
    // No route reaches these.
    roster: () => ({
      households: q(
        "SELECT id, name FROM auth_households ORDER BY created_at, rowid",
      )
        .all()
        .map((h) => ({
          id: h.id,
          name: h.name,
          members: q(
            `SELECT m.email, m.role, m.joined_at, a.signed_in_at,
              (SELECT count(*) FROM auth_passkeys p WHERE p.email = m.email) AS passkeys
             FROM auth_members m LEFT JOIN auth_accounts a ON a.email = m.email
             WHERE m.household = ? ORDER BY m.joined_at, m.rowid`,
          ).all(h.id),
        })),
      unhoused: q(
        `SELECT email FROM auth_accounts a WHERE NOT EXISTS
          (SELECT 1 FROM auth_members m WHERE m.email = a.email)
         ORDER BY created_at, email`,
      ).all(),
    }),
    // Makes an address an owner of a household, with an account if it has
    // none, for an owner who lost theirs. Nobody is signed in by it.
    grantOwner(email, household = HOME) {
      const address = normalizeEmail(email);
      if (!isEmail(address))
        throw new AuthError("INVALID_INPUT", "Enter a valid email address.");
      return transaction(() => {
        const row = householdRow(household);
        if (!row)
          throw new AuthError(
            "NOT_FOUND",
            `There is no household ${household}.`,
            404,
          );
        const created = !accountOf(address);
        ensureAccount(address);
        const was = membership(address, household)?.role ?? null;
        if (was)
          q(
            "UPDATE auth_members SET role = 'owner' WHERE email = ? AND household = ?",
          ).run(address, household);
        else join(address, household, "owner");
        return { email: address, household, name: row.name, was, created };
      });
    },
    // Deletes an address's account with its passkeys, sessions, links,
    // invitations and memberships, for an address whose mailbox may now be
    // someone else's: a removed member keeps an account, and can still sign
    // in and start a household. A household's last owner stays, and so does
    // its last member unless leaveEmpty says to leave it with nobody in it,
    // as for a household someone else started with that address; grantOwner
    // gives such a household an owner again.
    deleteAccount(email, { leaveEmpty = false } = {}) {
      const address = normalizeEmail(email);
      if (!isEmail(address))
        throw new AuthError("INVALID_INPUT", "Enter a valid email address.");
      return transaction(() => {
        if (!accountOf(address))
          throw new AuthError("NOT_FOUND", `${address} has no account.`, 404);
        const households = q(
          `SELECT h.id, h.name, m.role FROM auth_members m
           JOIN auth_households h ON h.id = m.household
           WHERE m.email = ? ORDER BY m.joined_at, m.rowid`,
        ).all(address);
        const left = households.map((h) => {
          const others = q(
            `SELECT count(*) AS n, count(*) FILTER (WHERE role = 'owner') AS owners
             FROM auth_members WHERE household = ? AND email != ?`,
          ).get(h.id, address);
          if (!others.n && !leaveEmpty)
            throw new AuthError(
              "LAST_MEMBER",
              `${address} is the only member of ${h.name} (${h.id}), so nobody could open it again.`,
              409,
            );
          if (others.n && h.role === "owner" && !others.owners)
            throw new AuthError(
              "LAST_OWNER",
              `${address} is the only owner of ${h.name} (${h.id}). Make another member an owner first, or, if the others came with ${address}, remove them first.`,
              409,
            );
          return { id: h.id, name: h.name, empty: !others.n };
        });
        const drop = (sql) => q(sql).run(address).changes;
        const removed = {
          email: address,
          households: left,
          passkeys: drop("DELETE FROM auth_passkeys WHERE email = ?"),
          sessions: drop("DELETE FROM auth_sessions WHERE email = ?"),
          // Invitations to the address, and the ones it sent.
          invites: q(
            "DELETE FROM auth_invites WHERE email = ? OR invited_by = ?",
          ).run(address, address).changes,
        };
        drop("DELETE FROM auth_links WHERE email = ?");
        drop("DELETE FROM auth_waits WHERE email = ?");
        drop("DELETE FROM auth_members WHERE email = ?");
        drop(
          "UPDATE auth_households SET created_by = NULL WHERE created_by = ?",
        );
        drop("DELETE FROM auth_accounts WHERE email = ?");
        return removed;
      });
    },
    close: () => db.close(),
  };
}
