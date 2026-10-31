import http from "node:http";
import { isIPv4, isIPv6 } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, sep } from "node:path";
import { ZodError } from "zod";
import { Store, KooksError } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { id as recordId, kind } from "../mcp/schemas.js";
import { batchView } from "../mcp/features.js";
import { backupChunks } from "../mcp/backup.js";
import { shoppingItems } from "../mcp/shopping.js";
import { embedOrigins } from "../shared/links.js";
import {
  AuthError,
  HOME,
  createAuth,
  deviceLabel,
  normalizeEmail,
  parseMembers,
} from "./auth.js";
import { createMailer, isEmail } from "./mail.js";
import { askInput, createAssistant } from "./assistant.js";

// The app, built by `npm run build:client`, is the files in client/dist.
const builtClient = fileURLToPath(new URL("../client/dist/", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
// Text larger than this travels compressed when the browser accepts it.
// Brotli at quality 5 shrinks app.js to a quarter and a 7.8 MB cookbook to
// about 160 KB in some 50 ms, off the main thread.
const compressFrom = 32 * 1024;
const compressors = {
  br: (body) =>
    promisify(brotliCompress)(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
        [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    }),
  gzip: (body) => promisify(gzip)(body),
};
function acceptedEncoding(req) {
  const accepted = String(req.headers["accept-encoding"] ?? "")
    .split(",")
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .split(/\s*;\s*/),
    )
    .filter(([, weight]) => !/^q=0(\.0*)?$/.test(weight ?? ""))
    .map(([name]) => name);
  return ["br", "gzip"].find((name) => accepted.includes(name)) ?? null;
}
// Static files revalidate on every load against a tag of their size and
// modification time: an unchanged file costs a 304, and an edited one shows
// at once without restarting the server. Each version is read and encoded
// once; fonts and images are already compressed and travel as they are.
const compressible = new Set([".html", ".js", ".css", ".svg", ".webmanifest"]);
const staticCache = new Map();
async function staticFile(file, encoding) {
  const info = await stat(file);
  const tag = `W/"${info.size}-${Math.floor(info.mtimeMs)}"`;
  let entry = staticCache.get(file);
  if (entry?.tag !== tag) {
    entry = { tag, identity: await readFile(file) };
    staticCache.set(file, entry);
  }
  if (
    encoding &&
    compressible.has(extname(file)) &&
    entry.identity.length > 1024
  )
    entry[encoding] ??= await compressors[encoding](entry.identity);
  else encoding = null;
  return { tag, encoding, data: entry[encoding ?? "identity"] };
}
async function sendStatic(req, res, file, cacheControl = "no-cache") {
  const found = await staticFile(file, acceptedEncoding(req));
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("ETag", found.tag);
  res.setHeader("Vary", "Accept-Encoding");
  if (req.headers["if-none-match"] === found.tag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": mime[extname(file)],
    "Content-Length": found.data.length,
    ...(found.encoding ? { "Content-Encoding": found.encoding } : {}),
  });
  return res.end(found.data);
}
const MINUTE = 60000;
// A tab that is this many actions behind gets everything again instead of
// the changed records.
const maxChangedActions = 200;
const randomToken = () => randomBytes(32).toString("base64url");
const isLoopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);
// The phone app is this app inside Capacitor, whose pages come from these
// origins: capacitor://localhost on iOS and https://localhost on Android.
// It signs in with an emailed link it waits for and sends a device token
// with every request, never a cookie, so its requests are allowed across
// origins only to the API and only with that token.
const appOrigins = new Set(["capacitor://localhost", "https://localhost"]);
const bearer = (req) =>
  String(req.headers.authorization ?? "").match(/^Bearer ([a-f0-9]{64})$/)?.[1];
// Plain HTTP is only for the household's own network: loopback, private and
// link-local addresses (100.64.0.0/10 is Tailscale's), and names that only
// resolve there.
function onPrivateNetwork(hostname) {
  const name = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIPv4(name)) {
    const [a, b] = name.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIPv6(name)) return name === "::1" || /^(f[cd]|fe[89ab])/.test(name);
  return (
    !name.includes(".") ||
    /\.(local|lan|internal|localhost|home\.arpa)$/.test(name)
  );
}
// The assistant's daily allowance, in tokens.
function dailyTokens(value) {
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens < 1)
    throw new Error(
      "KOOKS_ASSISTANT_DAILY_TOKENS must be a whole number of tokens, such as 2000000.",
    );
  return tokens;
}
// The address members open, when one is configured: HTTPS behind a proxy,
// or plain HTTP on the household's own network.
function parseOrigin(value) {
  let url = null;
  try {
    url = new URL(value);
  } catch {
    // Not a URL: refused below.
  }
  if (
    !url ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && onPrivateNetwork(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "KOOKS_PUBLIC_ORIGIN must be an HTTPS origin without a path, such as https://kooks.example.com, or an http:// address on this private network, such as http://192.168.1.20:4317.",
    );
  return url;
}
// Request bodies are JSON and are read whole, so each route gets the room it
// needs and no more: sign-in a few kilobytes before anyone has signed in,
// ordinary actions a long imported recipe. Files travel as base64, so only
// the actions that carry them get more: an ebook of 64 MB needs about 86 MB.
const KB = 1024,
  MB = 1024 * KB;
const authBody = 64 * KB;
const toolBody = 2 * MB;
const askBody = 1 * MB;
const largeBodies = new Map([
  ["asset_save", 96 * MB],
  ["backup_restore", 96 * MB],
  ["recipe_import_image", 12 * MB],
]);
// Each large upload is held several times over while it is parsed, checked
// and decoded, so only this many run at once.
const maxLargeUploads = 2;
const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
};
const extensions = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
};
const displayable = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);
// How the browser receives an asset: photos and PDFs display (PDFs inside the
// app's own reader frame), anything else downloads. The name is the stored
// one with the extension its type calls for, in ASCII and in RFC 5987 form.
function disposition(data, download) {
  const extension = extensions[data.mime_type] ?? "bin";
  let name =
    String(data.name ?? "")
      .trim()
      // eslint-disable-next-line no-control-regex -- control characters are replaced on purpose
      .replace(/[\\/\0-\x1f"]/g, "_") || "file";
  if (
    !name.toLowerCase().endsWith(`.${extension}`) &&
    !(extension === "jpg" && /\.jpe?g$/i.test(name))
  )
    name += `.${extension}`;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const kind =
    download || !displayable.has(data.mime_type) ? "attachment" : "inline";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Sign-in is on whenever the kitchen is reachable beyond this computer, or
// when an owner or members are configured on purpose. People prove an
// address with an emailed link and then add passkeys for one-tap sign-in;
// each household they belong to is a kitchen of its own. Beyond this
// computer the address people open must be configured: links, invites,
// passkeys and the accepted Host all follow it, never the request.
export function createWebServer({
  store,
  host = "127.0.0.1",
  publicOrigin = "",
  // Addresses that share the first household on a server that has none yet.
  members = [],
  // The first household's owner; see createAuth.
  owner = "",
  openSignup = false,
  mailer = null,
  authOptions = {},
  clientRoot = builtClient,
  toolOptions = {},
  assistantOptions = {},
}) {
  const external = publicOrigin ? parseOrigin(publicOrigin) : null;
  // Kooks speaks plain HTTP, so an HTTPS origin means a proxy in front.
  const proxied = external?.protocol === "https:";
  const seeded = [...members];
  const signIn =
    seeded.length > 0 ||
    Boolean(owner) ||
    openSignup ||
    !isLoopback(host) ||
    Boolean(external);
  if (signIn && !mailer)
    throw new Error(
      "Sign-in links need KOOKS_SMTP_HOST (with KOOKS_SMTP_USER, KOOKS_SMTP_PASSWORD and KOOKS_MAIL_FROM), or KOOKS_MAIL_OUTBOX during development.",
    );
  if (!isLoopback(host) && !external)
    throw new Error(
      "Sharing Kooks beyond this computer needs KOOKS_PUBLIC_ORIGIN: the address members open, such as https://kooks.example.com, or http://192.168.1.20:4317 on a home network.",
    );
  const auth = signIn
    ? createAuth({
        path: store.path,
        members: seeded,
        owner,
        openSignup,
        mailer,
        ...authOptions,
      })
    : null;
  if (auth && !auth.accounts() && !openSignup) {
    auth.close();
    throw new Error(
      "Sharing Kooks needs a first person to sign in: set KOOKS_OWNER_EMAIL to their email address.",
    );
  }
  // Each household's cookbook is a database of its own: the first one is the
  // server's database, and households started later sit beside it.
  const opened = new Map();
  function openKitchen(id, kitchenStore) {
    const tools = new Map(
      createTools(kitchenStore, toolOptions).map((t) => [t.name, t]),
    );
    // The assistant is there when the host gives the server a Claude API
    // key; each kitchen keeps its own daily allowance.
    const assistant =
      assistantOptions.apiKey || assistantOptions.client
        ? createAssistant({ store: kitchenStore, tools, ...assistantOptions })
        : null;
    const kitchen = { id, store: kitchenStore, tools, assistant };
    opened.set(id, kitchen);
    return kitchen;
  }
  const home = openKitchen(HOME, store);
  const kitchenPath = (id) =>
    store.path === ":memory:"
      ? ":memory:"
      : join(dirname(store.path), "households", `${id}.sqlite`);
  function kitchenOf(id) {
    if (!auth) return home;
    if (opened.has(id)) return opened.get(id);
    if (!/^[a-f0-9]{16}$/.test(id ?? ""))
      throw new KooksError("NOT_FOUND", "That household is not here.");
    return openKitchen(id, new Store(kitchenPath(id)));
  }
  const asking = new Set();
  const clientDir = resolve(clientRoot) + sep;
  const limits = new Map();
  // Revisions are this server start plus the action sequence, so a tab that
  // was open before a restart, or against another database, reloads fully.
  const serverStart = randomUUID().slice(0, 8);
  // Video players load only from the embed origins the shared module
  // produces, and only once the person presses play; the book reader frames
  // PDFs from this origin, which asset responses allow in turn.
  const policy = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-src 'self' ${embedOrigins.join(" ")}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
  let importsInProgress = 0,
    pagesInProgress = 0,
    largeUploads = 0;
  // A large reply, such as a cookbook's first load, is compressed when the
  // browser accepts it.
  async function send(res, status, data) {
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    let body = Buffer.from(JSON.stringify(data));
    const encoding = body.length > compressFrom && acceptedEncoding(res.req);
    if (encoding)
      try {
        body = await compressors[encoding](body);
        headers["Content-Encoding"] = encoding;
        headers.Vary = "Accept-Encoding";
      } catch (error) {
        console.error(error);
      }
    res.writeHead(status, headers);
    res.end(body);
  }
  const tooLarge = () =>
    Object.assign(new KooksError("TOO_LARGE", "Request is too large."), {
      status: 413,
    });
  // A declared length over the limit is refused before a byte is read.
  async function body(req, limit) {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
      throw new KooksError("INVALID_INPUT", "Send JSON.");
    if (Number(req.headers["content-length"]) > limit) throw tooLarge();
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw tooLarge();
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new KooksError("INVALID_INPUT", "Invalid JSON.");
    }
  }
  // Fixed windows per key: a caller gets max tries per window.
  function limited(key, max, windowMs) {
    const t = Date.now();
    if (limits.size > 5000)
      for (const [k, v] of limits) if (v.until < t) limits.delete(k);
    let entry = limits.get(key);
    if (!entry || entry.until < t) {
      entry = { count: 0, until: t + windowMs };
      limits.set(key, entry);
    }
    return ++entry.count > max;
  }
  // Behind the HTTPS proxy every connection comes from the proxy, which
  // appends the real client's address last. Without one, anyone could write
  // the header, so only the connection counts.
  const clientAddress = (req) =>
    (proxied &&
      String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .pop()
        .trim()) ||
    req.socket.remoteAddress ||
    "unknown";
  const cookieFor = (token, maxAge) =>
    `kooks_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${proxied ? "; Secure" : ""}`;
  // The phone app's device token, or else the browser's cookie. A request
  // from the phone app never counts a cookie. A kitchen whose own address is
  // https://localhost is a browser's, not the app's.
  const fromApp = (req) =>
    appOrigins.has(req.headers.origin) &&
    req.headers.origin !== external?.origin;
  const sessionToken = (req) =>
    bearer(req) ??
    (fromApp(req)
      ? undefined
      : (req.headers.cookie ?? "").match(
          /(?:^|;\s*)kooks_session=([a-f0-9]{64})(?:;|$)/,
        )?.[1]);
  function authenticated(req, res) {
    const token = sessionToken(req);
    const session = auth.session(token);
    if (session?.renewed && !bearer(req))
      res.setHeader(
        "Set-Cookie",
        cookieFor(token, auth.sessionLifetime / 1000),
      );
    return session;
  }
  // A browser signed in: whatever session it had ends, and the new one is
  // its cookie.
  function signedIn(req, res, email, method, household = null) {
    auth.endSession(sessionToken(req));
    const token = auth.createSession(email, method, {
      label: deviceLabel(req.headers["user-agent"]),
      household,
    });
    res.setHeader("Set-Cookie", cookieFor(token, auth.sessionLifetime / 1000));
    send(res, 200, { ok: true, account: { email, method } });
  }
  const askToSignIn = (res) =>
    send(res, 401, {
      error: "SIGN_IN",
      message: "Sign in to open the kitchen.",
    });
  // Sign-in and invite emails share one hourly budget, so nobody can use the
  // server to flood inboxes; what is held back is logged.
  const mailBudgetSpent = () => {
    if (!limited("mail", 100, 60 * MINUTE)) return false;
    console.error("Kooks held back an email: 100 went out in the last hour.");
    return true;
  };
  async function authRoute(req, res, url) {
    const route = `${req.method} ${url.pathname.slice("/api/auth/".length)}`;
    const origin = external?.origin ?? url.origin;
    const address = clientAddress(req);
    const input = () => body(req, authBody);
    const throttle = (key, max, windowMs) => {
      if (limited(key, max, windowMs))
        throw new AuthError(
          "RATE_LIMITED",
          "Too many sign-in attempts. Wait a few minutes and try again.",
          429,
        );
    };
    const app = fromApp(req);
    // The phone app asks for links and waits for them; opening links,
    // invites and passkeys are the browser's, and are never offered across
    // origins, whatever the request carries.
    if (app && /^POST (link\/confirm|passkey\/|invite\/)/.test(route))
      return send(res, 403, {
        message: "Open Kooks directly to make changes.",
      });
    if (route === "POST link") {
      const request = await input();
      const email = normalizeEmail(request.email);
      if (!isEmail(email))
        throw new AuthError("INVALID_INPUT", "Enter a valid email address.");
      throttle(`link:${address}`, 10, 10 * MINUTE);
      throttle(`link:${email}`, 5, 15 * MINUTE);
      // The phone app waits with a secret of its own for the link to be
      // confirmed. Everyone gets one, and the same answer at once; only then
      // does a member's link go out, so neither the reply nor its timing
      // tells who has an account. Strangers cannot spend the hourly email
      // budget either: spending it on them would lock members out.
      const wait = app || request.app === true ? randomToken() : null;
      send(res, 200, wait ? { ok: true, wait } : { ok: true });
      if (!auth.canSignIn(email) || mailBudgetSpent()) return;
      return void auth
        .requestLink({ email, origin, wait })
        .catch((error) =>
          console.error(
            `Kooks could not prepare a sign-in link: ${error.message}`,
          ),
        );
    }
    if (route === "POST link/confirm") {
      throttle(`confirm:${address}`, 20, 10 * MINUTE);
      const { token, approve } = await input();
      const link = auth.confirmLink(token, { approve: approve === true });
      // A link the phone app is waiting for signs the app in, not this
      // browser, and only once the person here says so.
      if (link.app)
        return send(res, 200, {
          ok: true,
          app: true,
          email: link.email,
          approved: Boolean(link.approved),
        });
      return signedIn(req, res, link.email, "email");
    }
    if (route === "POST link/wait") {
      // About one question every few seconds while a link is on its way.
      throttle(`wait:${address}`, 400, 10 * MINUTE);
      const email = auth.waited((await input()).wait);
      if (!email) return send(res, 200, { ok: true, waiting: true });
      // The device keeps the token and sends it; it is never a cookie.
      return send(res, 200, {
        ok: true,
        token: auth.createSession(email, "email", {
          label: deviceLabel(req.headers["user-agent"], true),
        }),
        account: { email, method: "email" },
      });
    }
    if (route === "POST passkey/options") {
      throttle(`passkey:${address}`, 60, 10 * MINUTE);
      return send(res, 200, {
        options: auth.authenticationOptions({ origin }),
      });
    }
    if (route === "POST passkey/signin") {
      throttle(`passkey:${address}`, 60, 10 * MINUTE);
      const email = auth.authenticate({
        credential: (await input()).credential,
      });
      return signedIn(req, res, email, "passkey");
    }
    // An invite link names the household before anyone acts on it, and
    // accepting it signs in the address it was sent to.
    if (route === "POST invite/open") {
      throttle(`confirm:${address}`, 20, 10 * MINUTE);
      const invite = auth.openInvite((await input()).token);
      const session = authenticated(req, res);
      return send(res, 200, {
        invite: { ...invite, signed_in_as: session?.email ?? null },
      });
    }
    if (route === "POST invite/accept") {
      throttle(`confirm:${address}`, 20, 10 * MINUTE);
      const { email, household } = auth.acceptInvite((await input()).token);
      return signedIn(req, res, email, "invite", household);
    }
    if (route === "POST signout") {
      auth.endSession(sessionToken(req));
      if (!bearer(req)) res.setHeader("Set-Cookie", cookieFor("", 0));
      return send(res, 200, { ok: true });
    }
    const session = authenticated(req, res);
    if (!session) return askToSignIn(res);
    if (route === "GET me")
      return send(res, 200, { account: auth.accountView(session) });
    if (route === "POST passkey/register/options")
      return send(res, 200, {
        options: auth.registrationOptions({ email: session.email, origin }),
      });
    if (route === "POST passkey/register") {
      const { credential, name } = await input();
      return send(res, 200, {
        passkey: auth.register({ email: session.email, credential, name }),
      });
    }
    if (route === "GET passkeys")
      return send(res, 200, { passkeys: auth.passkeys(session.email) });
    if (route === "POST passkey/remove") {
      auth.removePasskey(session.email, (await input()).id);
      return send(res, 200, { ok: true });
    }
    if (route === "GET sessions")
      return send(res, 200, {
        sessions: auth
          .sessions(session.email)
          .map((s) => ({ ...s, current: s.id === session.id })),
      });
    if (route === "POST session/end") {
      const { id } = await input();
      if (id === session.id)
        throw new AuthError(
          "INVALID_INPUT",
          "To sign out of this device, use Sign out.",
        );
      auth.endSessionById(session.email, id);
      return send(res, 200, { ok: true });
    }
    if (route === "POST sessions/end-others")
      return send(res, 200, {
        ok: true,
        ended: auth.endOtherSessions(session.email, session.id),
      });
    if (route === "POST household/create") {
      throttle(`household:${session.email}`, 5, 24 * 60 * MINUTE);
      const id = auth.createHousehold(session, (await input()).name);
      return send(res, 200, { ok: true, household: id });
    }
    if (route === "POST household/switch") {
      auth.switchHousehold(session, (await input()).id);
      return send(res, 200, { ok: true });
    }
    if (route === "POST household/join") {
      const id = auth.joinInvited(session, (await input()).id);
      return send(res, 200, { ok: true, household: id });
    }
    if (route === "POST household/decline") {
      auth.declineInvite(session, (await input()).id);
      return send(res, 200, { ok: true });
    }
    if (!session.household)
      return send(res, 403, {
        error: "NO_HOUSEHOLD",
        message: "Start a household or join one first.",
      });
    if (route === "GET household/members")
      return send(res, 200, auth.members(session));
    // Which person at the table this member is: one already there, or none.
    if (route === "POST household/person") {
      const { person = null } = await input();
      if (person !== null) {
        const id = recordId.parse(person);
        const { store: cookbook } = kitchenOf(session.household);
        cookbook.read(() => cookbook.get("member", id));
      }
      auth.linkPerson(session, person);
      return send(res, 200, { ok: true });
    }
    if (route === "POST household/rename") {
      auth.renameHousehold(session, (await input()).name);
      return send(res, 200, { ok: true });
    }
    if (route === "POST household/invite") {
      const { email } = await input();
      if (limited(`invite:${session.email}`, 20, 24 * 60 * MINUTE))
        throw new AuthError(
          "RATE_LIMITED",
          "That’s a lot of invites for one day. Try again tomorrow.",
          429,
        );
      if (mailBudgetSpent())
        throw new AuthError(
          "RATE_LIMITED",
          "Kooks has sent a lot of email this hour. Try again in a while.",
          429,
        );
      await auth.invite(session, { email, origin });
      return send(res, 200, { ok: true });
    }
    if (route === "POST household/invite/withdraw") {
      auth.withdrawInvite(session, (await input()).id);
      return send(res, 200, { ok: true });
    }
    if (route === "POST household/remove") {
      auth.removeMember(session, (await input()).email);
      return send(res, 200, { ok: true });
    }
    if (route === "POST household/leave") {
      auth.leave(session);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { message: "Not found." });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", policy);
    // Browsers that have seen the HTTPS origin never fall back to plain HTTP;
    // subdomains are left alone, since they may be other household services.
    if (proxied) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      let url;
      try {
        url = new URL(req.url, `http://${req.headers.host}`);
      } catch {
        return send(res, 400, { message: "Bad request." });
      }
      if (url.pathname === "/healthz" && req.method === "GET")
        return send(res, 200, { ok: true });
      // A configured origin is the only accepted Host; otherwise the server
      // is on loopback, where only loopback names defeat DNS rebinding.
      if (
        external
          ? req.headers.host !== external.host
          : !isLoopback(url.hostname.replace(/^\[|\]$/g, ""))
      )
        return send(res, 403, { message: "Unrecognized host." });
      // With sign-in on, the phone app may call the API, and ask first;
      // nothing else of the server is open to it. Without sign-in nothing is
      // open across origins, since nothing would ask who is calling.
      if (auth && fromApp(req) && url.pathname.startsWith("/api/")) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "600",
          });
          return res.end();
        }
      }
      if (
        req.method === "POST" &&
        req.headers.origin !== (external?.origin ?? url.origin) &&
        !(fromApp(req) && auth && url.pathname.startsWith("/api/"))
      )
        return send(res, 403, {
          message: "Open Kooks directly to make changes.",
        });
      if (url.pathname.startsWith("/api/auth/")) {
        if (!auth)
          return send(res, 404, {
            error: "SIGN_IN_DISABLED",
            message: "Sign-in is not needed on this computer.",
          });
        return await authRoute(req, res, url);
      }
      const session = auth ? authenticated(req, res) : null;
      if (auth && url.pathname.startsWith("/api/") && !session)
        return askToSignIn(res);
      const account = session ? auth.accountView(session) : null;
      // Someone signed in to no household yet has an account and nothing
      // else: the app offers to start one, or to take an invite.
      if (
        url.pathname === "/api/state" &&
        req.method === "GET" &&
        session &&
        !session.household
      )
        return send(res, 200, {
          revision: null,
          sharing: true,
          assistant: false,
          account,
          records: {},
        });
      if (url.pathname.startsWith("/api/") && session && !session.household)
        return send(res, 403, {
          error: "NO_HOUSEHOLD",
          message: "Start a household or join one first.",
        });
      const kitchen = kitchenOf(session?.household ?? HOME);
      const { store, tools, assistant } = kitchen;
      // Who is asking, recorded on each change they make, and how history
      // names this household's members.
      const context = session
        ? {
            actor: {
              type: "member",
              account: session.account,
              person: session.person,
            },
            links: () => auth.links(kitchen.id),
          }
        : { actor: { type: "local" } };
      if (url.pathname === "/api/state" && req.method === "GET") {
        const state = store.read(() => {
          const sequence = store.sequence();
          // Revisions name this server start and the household, so a tab
          // that was open before a restart, or in another household, reloads
          // fully.
          const started = `${serverStart}.${kitchen.id}`;
          const revision = `${started}-${sequence}`;
          const known = url.searchParams.get("revision") ?? "";
          if (known === revision)
            return { unchanged: true, revision, ...(account && { account }) };
          const view = (k, r) => {
            if (k === "batch") return batchView(r);
            if (k === "shopping") return { ...r, items: shoppingItems(r.data) };
            return r;
          };
          const result = {
            revision,
            sharing: Boolean(auth),
            assistant: Boolean(assistant),
            account,
          };
          // A tab that polled recently gets only the records changed since,
          // each as its current view or null once archived.
          const [prefix, since] = known.split("-");
          if (
            prefix === started &&
            /^\d+$/.test(since) &&
            Number(since) < sequence &&
            sequence - Number(since) <= maxChangedActions
          )
            return {
              ...result,
              changes: store
                .changedSince(Number(since))
                .filter((change) => kind.options.includes(change.kind))
                .map((change) => {
                  const r = store.get(change.kind, change.id, true);
                  return {
                    ...change,
                    record: r.archived ? null : view(change.kind, r),
                  };
                }),
            };
          const all = store.all();
          const records = Object.fromEntries(
            kind.options.map((k) => [
              k,
              all
                .filter((r) => r.kind === k && !r.archived)
                .map((r) => view(k, r)),
            ]),
          );
          return { records, ...result };
        });
        return send(res, 200, state);
      }
      if (url.pathname.startsWith("/api/assets/") && req.method === "GET") {
        const id = decoded(url.pathname.slice("/api/assets/".length));
        if (!id) return send(res, 404, { message: "Not found." });
        const asset = store.read(() => ({
          data: store.get("asset", id, true).data,
          bytes: store.blob("asset", id),
        }));
        res.setHeader(
          "Content-Security-Policy",
          policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
        );
        res.writeHead(200, {
          "Content-Type": asset.data.mime_type,
          "Content-Length": asset.bytes.length,
          "Content-Disposition": disposition(
            asset.data,
            url.searchParams.has("download"),
          ),
        });
        return res.end(asset.bytes);
      }
      // The portable backup streams as it is written, so a shelf of large
      // ebooks downloads like a small cookbook; the page names the file.
      if (url.pathname === "/api/backup" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": "attachment",
        });
        try {
          await pipeline(Readable.from(backupChunks(store)), res);
        } catch (error) {
          // A dropped connection is not a failure worth logging.
          if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") console.error(error);
          res.destroy();
        }
        return;
      }
      // A question for the assistant. The answer streams as lines of JSON:
      // what it is doing, then the answer or why there is none.
      if (url.pathname === "/api/assistant" && req.method === "POST") {
        if (!assistant)
          return send(res, 404, {
            error: "ASSISTANT_OFF",
            message: "The assistant isn’t set up on this kitchen.",
          });
        const who = session?.email ?? "this computer";
        if (asking.has(who))
          return send(res, 429, {
            error: "BUSY",
            message: "Kooks is still answering your last question.",
          });
        if (
          limited(`ask:${who}`, 30, 60 * MINUTE) ||
          limited(`ask:${kitchen.id}`, 300, 24 * 60 * MINUTE)
        )
          return send(res, 429, {
            error: "RATE_LIMITED",
            message:
              "That’s a lot of questions in a short time. Try again in a while.",
          });
        const input = askInput.parse(await body(req, askBody));
        asking.add(who);
        const ended = new AbortController();
        res.on("close", () => ended.abort());
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        const line = (value) => res.write(`${JSON.stringify(value)}\n`);
        try {
          line({
            answer: await assistant.ask({
              ...input,
              signal: ended.signal,
              onStep: (step) => line({ step }),
            }),
          });
        } catch (error) {
          if (!(error instanceof KooksError) && !ended.signal.aborted)
            console.error(error);
          line({
            error:
              error instanceof KooksError
                ? error.message
                : "Kooks couldn’t answer just now. Try again in a moment.",
          });
        } finally {
          asking.delete(who);
          res.end();
        }
        return;
      }
      if (url.pathname.startsWith("/api/tools/") && req.method === "POST") {
        const tool = tools.get(
          decoded(url.pathname.slice("/api/tools/".length)),
        );
        if (!tool) return send(res, 404, { message: "Unknown action." });
        const run = async (limit) => {
          const input = await body(req, limit);
          // A recipe page is fetched from the web: a few at a time, and a
          // few dozen an hour from any one address.
          if (tool.name === "recipe_import_link") {
            if (limited(`page:${clientAddress(req)}`, 30, 60 * MINUTE))
              return send(res, 429, {
                error: "RATE_LIMITED",
                message:
                  "That’s a lot of links in a short time. Wait a while, or paste the recipe instead.",
              });
            if (pagesInProgress >= 2)
              return send(res, 429, {
                error: "BUSY",
                message:
                  "Two pages are being read. Try again when one finishes.",
              });
            pagesInProgress++;
            try {
              return send(res, 200, await tool.execute(input, context));
            } finally {
              pagesInProgress--;
            }
          }
          if (tool.name === "recipe_import_image") {
            if (importsInProgress >= 2)
              return send(res, 429, {
                message:
                  "Two photos are being read. Try again when one finishes.",
              });
            importsInProgress++;
            try {
              return send(res, 200, await tool.execute(input, context));
            } finally {
              importsInProgress--;
            }
          }
          return send(res, 200, await tool.execute(input, context));
        };
        if (!largeBodies.has(tool.name)) return await run(toolBody);
        if (largeUploads >= maxLargeUploads)
          return send(res, 429, {
            error: "BUSY",
            message:
              "Another upload is still on its way. Try again when it finishes.",
          });
        largeUploads++;
        try {
          return await run(largeBodies.get(tool.name));
        } finally {
          largeUploads--;
        }
      }
      // The app was tried out at /next/ before it replaced the previous one;
      // bookmarks from then land on the same page, since the address after
      // # survives the redirect.
      if (
        req.method === "GET" &&
        (url.pathname === "/next" || url.pathname.startsWith("/next/"))
      ) {
        res.writeHead(308, {
          Location: url.pathname.slice("/next".length) || "/",
        });
        return res.end();
      }
      if (req.method === "GET") {
        const name = url.pathname.slice(1) || "index.html";
        const file = resolve(clientDir, name);
        if (!file.startsWith(clientDir) || !mime[extname(file)])
          return send(res, 404, { message: "Not found." });
        try {
          // Built files carry a content hash in their name, so they never
          // change; the page that names them revalidates.
          return await sendStatic(
            req,
            res,
            file,
            name.startsWith("assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          return send(res, 404, {
            message:
              name === "index.html"
                ? "The Kooks app is not built yet. Run npm run build:client."
                : "Not found.",
          });
        }
      }
      send(res, 404, { message: "Not found." });
    } catch (error) {
      const known = error instanceof KooksError || error instanceof ZodError;
      if (!known) console.error(error);
      const status =
        error.status ??
        (error.code === "NOT_FOUND"
          ? 404
          : ["STALE_VERSION", "STALE_PREVIEW", "UNDO_CONFLICT"].includes(
                error.code,
              )
            ? 409
            : known
              ? 400
              : 500);
      send(res, status, {
        error:
          error instanceof KooksError
            ? error.code
            : error instanceof ZodError
              ? "INVALID_INPUT"
              : "INTERNAL_ERROR",
        message:
          error instanceof ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")
            : known
              ? error.message
              : "The action failed. Your changes were not saved.",
      });
    }
  });
  // Receiving a request: a 64 MB ebook arrives as 86 MB of JSON, which a
  // slow household connection may take a few minutes to send.
  server.requestTimeout = 300000;
  server.auth = auth;
  server.assistant = home.assistant;
  // The households opened since the start close with the server; the first
  // one's store belongs to whoever made the server.
  server.on("close", () => {
    for (const kitchen of opened.values())
      if (kitchen !== home) {
        kitchen.assistant?.close();
        kitchen.store.close();
      }
  });
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  const host = process.env.KOOKS_HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 4317);
  let store, server;
  try {
    if (process.env.KOOKS_ACCESS_TOKEN || process.env.KOOKS_ACCESS_TOKEN_FILE)
      throw new Error(
        "KOOKS_ACCESS_TOKEN is no longer used. People now have accounts and sign in with passkeys and emailed links: remove it, and set KOOKS_OWNER_EMAIL and KOOKS_SMTP_HOST instead (see docs/hosting.md).",
      );
    // KOOKS_HOUSEHOLD_EMAILS, from before accounts, seeds the first
    // household once; after that, households grow by invitation.
    const members = parseMembers(process.env.KOOKS_HOUSEHOLD_EMAILS);
    const [owner = "", ...extra] = parseMembers(
      process.env.KOOKS_OWNER_EMAIL,
      "KOOKS_OWNER_EMAIL",
    );
    if (extra.length)
      throw new Error("KOOKS_OWNER_EMAIL takes one email address.");
    const openSignup = /^(1|true|yes|on)$/i.test(
      process.env.KOOKS_OPEN_SIGNUP ?? "",
    );
    const mailer = createMailer({
      smtp: {
        host: process.env.KOOKS_SMTP_HOST,
        port: process.env.KOOKS_SMTP_PORT,
        user: process.env.KOOKS_SMTP_USER,
        password: process.env.KOOKS_SMTP_PASSWORD,
        security: process.env.KOOKS_SMTP_SECURITY,
      },
      from: process.env.KOOKS_MAIL_FROM,
      outbox: process.env.KOOKS_MAIL_OUTBOX
        ? resolve(process.env.KOOKS_MAIL_OUTBOX)
        : "",
    });
    store = new Store(
      process.env.KOOKS_DB_PATH
        ? resolve(process.env.KOOKS_DB_PATH)
        : fileURLToPath(new URL("../.data/kooks.sqlite", import.meta.url)),
    );
    server = createWebServer({
      store,
      host,
      publicOrigin: process.env.KOOKS_PUBLIC_ORIGIN ?? "",
      members,
      owner,
      openSignup,
      mailer,
      assistantOptions: {
        apiKey: process.env.KOOKS_ANTHROPIC_API_KEY,
        ...(process.env.KOOKS_ASSISTANT_MODEL
          ? { model: process.env.KOOKS_ASSISTANT_MODEL }
          : {}),
        ...(process.env.KOOKS_ASSISTANT_DAILY_TOKENS
          ? {
              dailyTokens: dailyTokens(
                process.env.KOOKS_ASSISTANT_DAILY_TOKENS,
              ),
            }
          : {}),
      },
    });
    server.listen(port, host, () => {
      console.log(`Kooks is ready at http://${host}:${port}`);
      if (server.auth)
        console.log(
          `Sign-in is on: ${server.auth.accounts()} account${server.auth.accounts() === 1 ? "" : "s"}, ${openSignup ? "and anyone may make one" : "and new people join by invitation"}; sign-in links go ${mailer.description}.`,
        );
      if (server.assistant)
        console.log(
          `The assistant is on, with ${server.assistant.model}; questions and what it reads to answer them go to Anthropic.`,
        );
    });
  } catch (error) {
    console.error(`Kooks could not start: ${error.message}`);
    store?.close();
    process.exit(1);
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      server.close(() => {
        server.auth?.close();
        server.assistant?.close();
        store.close();
        process.exit(0);
      });
    });
}
