import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { ZodError } from "zod";
import { Store, KooksError, digest } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { kind } from "../mcp/schemas.js";
import { batchView } from "../mcp/features.js";
import { shoppingItems } from "../mcp/shopping.js";
import { embedOrigins } from "../shared/links.js";
import { AuthError, createAuth, normalizeEmail, parseMembers } from "./auth.js";
import { createMailer, isEmail } from "./mail.js";

const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
// The browser client is these files and the shared link module it imports.
const staticFiles = new Map([
  ...["/index.html", "/app.js", "/style.css"].map((path) => [
    path,
    resolve(publicRoot, `.${path}`),
  ]),
  [
    "/shared/links.js",
    fileURLToPath(new URL("../shared/links.js", import.meta.url)),
  ],
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const MINUTE = 60000;
const isLoopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);

// Sign-in is on whenever the kitchen is reachable beyond this computer, or
// when household addresses are configured on purpose. Members prove an
// address with an emailed link and then add passkeys for one-tap sign-in.
export function createWebServer({
  store,
  host = "127.0.0.1",
  publicOrigin = "",
  members = [],
  mailer = null,
  authOptions = {},
}) {
  const external = publicOrigin ? new URL(publicOrigin) : null;
  if (
    external &&
    (external.protocol !== "https:" ||
      external.username ||
      external.password ||
      external.pathname !== "/" ||
      external.search ||
      external.hash)
  )
    throw new Error(
      "KOOKS_PUBLIC_ORIGIN must be an HTTPS origin without a path.",
    );
  const household = members instanceof Set ? members : new Set(members);
  const signIn = household.size > 0 || !isLoopback(host) || Boolean(external);
  if (signIn && !household.size)
    throw new Error(
      "Sharing Kooks beyond this computer needs KOOKS_HOUSEHOLD_EMAILS: the addresses allowed to sign in.",
    );
  if (signIn && !mailer)
    throw new Error(
      "Sign-in links need KOOKS_SMTP_URL (with KOOKS_MAIL_FROM), or KOOKS_MAIL_OUTBOX during development.",
    );
  const auth = signIn
    ? createAuth({
        path: store.path,
        members: household,
        mailer,
        ...authOptions,
      })
    : null;
  const tools = new Map(createTools(store).map((t) => [t.name, t]));
  const limits = new Map();
  let importsInProgress = 0;
  function send(res, status, data) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
      throw new KooksError("INVALID_INPUT", "Send JSON.");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 64 * 1024 * 1024)
        throw new KooksError("TOO_LARGE", "Request is too large.");
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
  // appends the real client's address last.
  const clientAddress = (req) =>
    (external &&
      String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .pop()
        .trim()) ||
    req.socket.remoteAddress ||
    "unknown";
  const cookieFor = (token, maxAge) =>
    `kooks_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${external ? "; Secure" : ""}`;
  const sessionToken = (req) =>
    (req.headers.cookie ?? "").match(
      /(?:^|;\s*)kooks_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
  function authenticated(req, res) {
    const token = sessionToken(req);
    const session = auth.session(token);
    if (session?.renewed)
      res.setHeader(
        "Set-Cookie",
        cookieFor(token, auth.sessionLifetime / 1000),
      );
    return session;
  }
  function signedIn(req, res, email, method) {
    auth.endSession(sessionToken(req));
    const token = auth.createSession(email, method);
    res.setHeader("Set-Cookie", cookieFor(token, auth.sessionLifetime / 1000));
    send(res, 200, { ok: true, account: { email, method } });
  }
  const askToSignIn = (res) =>
    send(res, 401, {
      error: "SIGN_IN",
      message: "Sign in to open the kitchen.",
    });
  async function authRoute(req, res, url) {
    const route = `${req.method} ${url.pathname.slice("/api/auth/".length)}`;
    const origin = external?.origin ?? url.origin;
    const address = clientAddress(req);
    const throttle = (key, max, windowMs) => {
      if (limited(key, max, windowMs))
        throw new AuthError(
          "RATE_LIMITED",
          "Too many sign-in attempts. Wait a few minutes and try again.",
          429,
        );
    };
    if (route === "POST link") {
      const email = normalizeEmail((await body(req)).email);
      if (!isEmail(email))
        throw new AuthError("INVALID_INPUT", "Enter a valid email address.");
      throttle(`link:${address}`, 10, 10 * MINUTE);
      throttle(`link:${email}`, 5, 15 * MINUTE);
      throttle("link", 100, 60 * MINUTE);
      await auth.requestLink({ email, origin });
      return send(res, 200, { ok: true });
    }
    if (route === "POST link/confirm") {
      throttle(`confirm:${address}`, 20, 10 * MINUTE);
      const email = auth.confirmLink((await body(req)).token);
      return signedIn(req, res, email, "email");
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
        credential: (await body(req)).credential,
      });
      return signedIn(req, res, email, "passkey");
    }
    if (route === "POST signout") {
      auth.endSession(sessionToken(req));
      res.setHeader("Set-Cookie", cookieFor("", 0));
      return send(res, 200, { ok: true });
    }
    const session = authenticated(req, res);
    if (!session) return askToSignIn(res);
    if (route === "POST passkey/register/options")
      return send(res, 200, {
        options: auth.registrationOptions({ email: session.email, origin }),
      });
    if (route === "POST passkey/register") {
      const { credential, name } = await body(req);
      return send(res, 200, {
        passkey: auth.register({ email: session.email, credential, name }),
      });
    }
    if (route === "GET passkeys")
      return send(res, 200, { passkeys: auth.passkeys(session.email) });
    if (route === "POST passkey/remove") {
      auth.removePasskey(session.email, (await body(req)).id);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { message: "Not found." });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      // Video players load only from the embed origins the shared module
      // produces, and only once the person presses play.
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-src ${embedOrigins.join(" ")}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === "/healthz" && req.method === "GET")
        return send(res, 200, { ok: true });
      if (external && req.headers.host !== external.host)
        return send(res, 403, { message: "Unrecognized host." });
      if (isLoopback(host) && !isLoopback(url.hostname.replace(/^\[|\]$/g, "")))
        return send(res, 403, { message: "Unrecognized host." });
      if (
        req.method === "POST" &&
        req.headers.origin !== (external?.origin ?? url.origin)
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
      if (url.pathname === "/api/state" && req.method === "GET") {
        const state = store.read(() => {
          const all = store.all();
          const revision = digest(
            all.map((r) => [r.kind, r.id, r.version, r.archived]),
          );
          if (url.searchParams.get("revision") === revision)
            return { unchanged: true, revision };
          const records = Object.fromEntries(
            kind.options.map((k) => [
              k,
              all
                .filter((r) => r.kind === k && !r.archived)
                .map((r) => {
                  if (k === "batch") return batchView(r);
                  if (k === "shopping")
                    return { ...r, items: shoppingItems(r.data) };
                  return r;
                }),
            ]),
          );
          return {
            records,
            revision,
            sharing: Boolean(auth),
            account: session
              ? { email: session.email, method: session.method }
              : null,
          };
        });
        return send(res, 200, state);
      }
      if (url.pathname.startsWith("/api/assets/") && req.method === "GET") {
        const id = decodeURIComponent(
          url.pathname.slice("/api/assets/".length),
        );
        const asset = store.read(() => ({
          mime_type: store.get("asset", id, true).data.mime_type,
          bytes: store.blob("asset", id),
        }));
        res.writeHead(200, {
          "Content-Type": asset.mime_type,
          "Content-Length": asset.bytes.length,
        });
        return res.end(asset.bytes);
      }
      if (url.pathname.startsWith("/api/tools/") && req.method === "POST") {
        const tool = tools.get(
          decodeURIComponent(url.pathname.slice("/api/tools/".length)),
        );
        if (!tool) return send(res, 404, { message: "Unknown action." });
        const input = await body(req);
        if (tool.name === "recipe_import_image") {
          if (importsInProgress >= 2)
            return send(res, 429, {
              message:
                "Two photos are being read. Try again when one finishes.",
            });
          importsInProgress++;
          try {
            return send(res, 200, await tool.execute(input));
          } finally {
            importsInProgress--;
          }
        }
        return send(res, 200, await tool.execute(input));
      }
      if (req.method === "GET") {
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        if (staticFiles.has(path)) {
          let data;
          try {
            data = await readFile(staticFiles.get(path));
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
            return send(res, 404, { message: "Not found." });
          }
          res.writeHead(200, { "Content-Type": mime[extname(path)] });
          return res.end(data);
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
  server.requestTimeout = 90000;
  server.auth = auth;
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
        "KOOKS_ACCESS_TOKEN is no longer used. Household members now sign in with passkeys and emailed links: set KOOKS_HOUSEHOLD_EMAILS and KOOKS_SMTP_URL instead (see docs/hosting.md).",
      );
    const members = parseMembers(process.env.KOOKS_HOUSEHOLD_EMAILS);
    const mailer = createMailer({
      smtpUrl: process.env.KOOKS_SMTP_URL,
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
      mailer,
    });
    server.listen(port, host, () => {
      console.log(`Kooks is ready at http://${host}:${port}`);
      if (server.auth)
        console.log(
          `Sign-in is on for ${members.length} household address${members.length === 1 ? "" : "es"}; sign-in links go ${mailer.description}.`,
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
        store.close();
        process.exit(0);
      });
    });
}
