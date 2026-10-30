import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { KooksError } from "../mcp/store.js";
import { isEmail } from "./mail.js";
import {
  challengeOf,
  generateChallenge,
  toBase64Url,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn.js";

// Who may enter the kitchen and how: the household's email addresses are the
// membership list, a one-time emailed link proves an address, and a passkey
// makes every later sign-in one tap. The phone app, which a link cannot
// reach and a passkey cannot serve, proves an address with an emailed code
// instead and keeps a device token. Sessions, links, codes and passkeys live
// in auth_* tables beside the cookbook; only hashes of tokens are stored.

export class AuthError extends KooksError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.status = status;
  }
}
const MINUTE = 60000,
  DAY = 24 * 60 * MINUTE;
const hash = (token) => createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
export function parseMembers(text) {
  const members = [];
  for (const raw of String(text ?? "").split(/[\s,;]+/)) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    if (!isEmail(email))
      throw new Error(
        `KOOKS_HOUSEHOLD_EMAILS holds something that is not an email address: ${raw}`,
      );
    if (!members.includes(email)) members.push(email);
  }
  return members;
}
const cleanName = (value) =>
  String(value ?? "")
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
const tooSlow = () =>
  new AuthError("PASSKEY_EXPIRED", "That took a little too long. Try again.");

export function createAuth({
  path = ":memory:",
  members,
  mailer,
  now = () => Date.now(),
  linkLifetime = 15 * MINUTE,
  codeLifetime = 10 * MINUTE,
  codeAttempts = 5,
  sessionLifetime = 30 * DAY,
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
    CREATE TABLE IF NOT EXISTS auth_codes (
      email TEXT PRIMARY KEY, salt TEXT NOT NULL, code_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL
    );
  `);
  const statements = new Map();
  const q = (sql) => {
    if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
    return statements.get(sql);
  };
  // A Set may be shared with the caller, so the household can change live.
  const allowed = members instanceof Set ? members : new Set(members);
  const challenges = new Map();
  const iso = (ms) => new Date(ms).toISOString();
  function prune() {
    const t = now();
    q("DELETE FROM auth_sessions WHERE expires_at < ?").run(t);
    q("DELETE FROM auth_links WHERE expires_at < ?").run(t);
    q("DELETE FROM auth_codes WHERE expires_at < ?").run(t);
    for (const [key, pending] of challenges)
      if (pending.expires < t) challenges.delete(key);
  }
  function account(email) {
    let row = q("SELECT email, handle FROM auth_accounts WHERE email = ?").get(
      email,
    );
    if (!row) {
      row = { email, handle: toBase64Url(randomBytes(32)) };
      q(
        "INSERT INTO auth_accounts(email, handle, created_at) VALUES (?, ?, ?)",
      ).run(email, row.handle, iso(now()));
    }
    return row;
  }
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

  return {
    sessionLifetime,
    isMember: (email) => allowed.has(normalizeEmail(email)),
    // Resolves to whether a link was sent; strangers get nothing, silently.
    // The caller has already answered, the same way for every address, so a
    // mail failure goes to the log rather than to whoever asked.
    async requestLink({ email, origin }) {
      prune();
      const address = normalizeEmail(email);
      if (!allowed.has(address)) return false;
      const token = toBase64Url(randomBytes(32));
      q(
        "INSERT INTO auth_links(token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(hash(token), address, iso(now()), now() + linkLifetime);
      const minutes = Math.round(linkLifetime / MINUTE);
      try {
        await mailer.send({
          to: address,
          subject: "Your Kooks sign-in link",
          text: `Open this link to get into your kitchen:\n\n${siteOf(origin).origin}/#/signin/${token}\n\nIt works once, for the next ${minutes} minutes, on the device where you open it.\nIf you did not ask for it, you can ignore this email.\n`,
        });
      } catch (error) {
        q("DELETE FROM auth_links WHERE token_hash = ?").run(hash(token));
        console.error(`Kooks could not email a sign-in link: ${error.message}`);
        return false;
      }
      return true;
    },
    confirmLink(token) {
      prune();
      const invalid = () =>
        new AuthError(
          "LINK_INVALID",
          "This sign-in link has expired or was already used. Request a new one.",
        );
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw invalid();
      const row = q(
        "SELECT email, used_at FROM auth_links WHERE token_hash = ? AND expires_at >= ?",
      ).get(hash(token), now());
      if (!row || row.used_at || !allowed.has(row.email)) throw invalid();
      q("UPDATE auth_links SET used_at = ? WHERE token_hash = ?").run(
        iso(now()),
        hash(token),
      );
      return row.email;
    },
    // One code per address at a time, six digits, for a few minutes and a
    // few tries: a new request replaces the last code, a wrong guess spends
    // a try, and the last wrong guess spends the code.
    async requestCode({ email }) {
      prune();
      const address = normalizeEmail(email);
      if (!allowed.has(address)) return false;
      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      const salt = toBase64Url(randomBytes(16));
      q(
        "INSERT OR REPLACE INTO auth_codes(email, salt, code_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, ?, 0)",
      ).run(
        address,
        salt,
        hash(`${salt}:${code}`),
        iso(now()),
        now() + codeLifetime,
      );
      const minutes = Math.round(codeLifetime / MINUTE);
      try {
        await mailer.send({
          to: address,
          subject: `Your Kooks code: ${code}`,
          text: `Enter this code in the Kooks app to get into your kitchen:\n\n${code}\n\nIt works once, for the next ${minutes} minutes.\nIf you did not ask for it, you can ignore this email.\n`,
        });
      } catch (error) {
        q("DELETE FROM auth_codes WHERE email = ? AND salt = ?").run(
          address,
          salt,
        );
        console.error(`Kooks could not email a sign-in code: ${error.message}`);
        return false;
      }
      return true;
    },
    confirmCode({ email, code }) {
      prune();
      const address = normalizeEmail(email);
      const invalid = () =>
        new AuthError(
          "CODE_INVALID",
          "That code is not right, or it has expired. Check it, or ask for a new one.",
        );
      const row = q(
        "SELECT salt, code_hash, attempts FROM auth_codes WHERE email = ? AND expires_at >= ?",
      ).get(address, now());
      if (!row || !allowed.has(address)) throw invalid();
      const given = String(code ?? "").replace(/\s/g, "");
      const right =
        /^\d{6}$/.test(given) &&
        timingSafeEqual(
          Buffer.from(hash(`${row.salt}:${given}`)),
          Buffer.from(row.code_hash),
        );
      if (right || row.attempts + 1 >= codeAttempts)
        q("DELETE FROM auth_codes WHERE email = ?").run(address);
      else
        q("UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ?").run(
          address,
        );
      if (!right) throw invalid();
      return address;
    },
    createSession(email, method) {
      const token = randomBytes(32).toString("hex"),
        t = now();
      account(email);
      q(
        "INSERT INTO auth_sessions(token_hash, email, method, created_at, renewed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(hash(token), email, method, iso(t), t, t + sessionLifetime);
      q("UPDATE auth_accounts SET signed_in_at = ? WHERE email = ?").run(
        iso(t),
        email,
      );
      return token;
    },
    // A session slides: use within 30 days keeps it, and a day of use
    // extends it. Leaving the household ends it at the next request.
    session(token) {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
        return null;
      const row = q(
        "SELECT email, method, renewed_at, expires_at FROM auth_sessions WHERE token_hash = ?",
      ).get(hash(token));
      if (!row) return null;
      const t = now();
      if (row.expires_at < t || !allowed.has(row.email)) {
        q("DELETE FROM auth_sessions WHERE token_hash = ?").run(hash(token));
        return null;
      }
      const renewed = t - row.renewed_at > DAY;
      if (renewed)
        q(
          "UPDATE auth_sessions SET renewed_at = ?, expires_at = ? WHERE token_hash = ?",
        ).run(t, t + sessionLifetime, hash(token));
      return { email: row.email, method: row.method, renewed };
    },
    endSession(token) {
      if (typeof token === "string")
        q("DELETE FROM auth_sessions WHERE token_hash = ?").run(hash(token));
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
        user: { id: account(email).handle, name: email, displayName: email },
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
      if (!row || !allowed.has(row.email))
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
      const owner = q("SELECT handle FROM auth_accounts WHERE email = ?").get(
        row.email,
      );
      if (
        result.userHandle &&
        owner &&
        toBase64Url(result.userHandle) !== owner.handle
      )
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
    close: () => db.close(),
  };
}
