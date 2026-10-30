import http from "node:http";
import { isIPv4, isIPv6 } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { ZodError } from "zod";
import { Store, KooksError } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { kind } from "../mcp/schemas.js";
import { batchView } from "../mcp/features.js";
import { shoppingItems } from "../mcp/shopping.js";
import { embedOrigins } from "../shared/links.js";
import { AuthError, createAuth, normalizeEmail, parseMembers } from "./auth.js";
import { createMailer, isEmail } from "./mail.js";

const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
// The browser client is these files and the shared modules it imports: the
// link module, the facet taxonomy and the unit module the taxonomy builds on,
// the ingredient-line module the recipe editor reads lines back with, the icon
// module, the accessibility helpers, and the design tokens and components both
// apps use.
const staticFiles = new Map([
  ...["/index.html", "/app.js", "/style.css", "/favicon.svg"].map((path) => [
    path,
    resolve(publicRoot, `.${path}`),
  ]),
  ...[
    "links.js",
    "taxonomy.js",
    "quantities.js",
    "ingredients.js",
    "icons.js",
    "a11y.js",
    "tokens.css",
    "ui.css",
  ].map((name) => [
    `/shared/${name}`,
    fileURLToPath(new URL(`../shared/${name}`, import.meta.url)),
  ]),
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const MINUTE = 60000;
// A tab that is this many actions behind gets everything again instead of
// the changed records.
const maxChangedActions = 200;
const isLoopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);
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
// when household addresses are configured on purpose. Members prove an
// address with an emailed link and then add passkeys for one-tap sign-in.
// Beyond this computer the address members open must be configured: links,
// passkeys and the accepted Host all follow it, never the request.
export function createWebServer({
  store,
  host = "127.0.0.1",
  publicOrigin = "",
  members = [],
  mailer = null,
  authOptions = {},
}) {
  const external = publicOrigin ? parseOrigin(publicOrigin) : null;
  // Kooks speaks plain HTTP, so an HTTPS origin means a proxy in front.
  const proxied = external?.protocol === "https:";
  const household = members instanceof Set ? members : new Set(members);
  const signIn = household.size > 0 || !isLoopback(host) || Boolean(external);
  if (signIn && !household.size)
    throw new Error(
      "Sharing Kooks beyond this computer needs KOOKS_HOUSEHOLD_EMAILS: the addresses allowed to sign in.",
    );
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
        members: household,
        mailer,
        ...authOptions,
      })
    : null;
  const tools = new Map(createTools(store).map((t) => [t.name, t]));
  const limits = new Map();
  // Revisions are this server start plus the action sequence, so a tab that
  // was open before a restart, or against another database, reloads fully.
  const started = randomUUID().slice(0, 8);
  // Video players load only from the embed origins the shared module
  // produces, and only once the person presses play; the book reader frames
  // PDFs from this origin, which asset responses allow in turn.
  const policy = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-src 'self' ${embedOrigins.join(" ")}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
  let importsInProgress = 0,
    largeUploads = 0;
  function send(res, status, data) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
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
    const input = () => body(req, authBody);
    const throttle = (key, max, windowMs) => {
      if (limited(key, max, windowMs))
        throw new AuthError(
          "RATE_LIMITED",
          "Too many sign-in attempts. Wait a few minutes and try again.",
          429,
        );
    };
    if (route === "POST link") {
      const email = normalizeEmail((await input()).email);
      if (!isEmail(email))
        throw new AuthError("INVALID_INPUT", "Enter a valid email address.");
      throttle(`link:${address}`, 10, 10 * MINUTE);
      throttle(`link:${email}`, 5, 15 * MINUTE);
      // Every address gets the same answer at once; only then does a
      // member's link go out, so neither the reply nor its timing tells who
      // belongs. Strangers cannot spend the hourly email budget either:
      // spending it on them would lock members out of links.
      send(res, 200, { ok: true });
      if (!auth.isMember(email)) return;
      if (limited("mail", 100, 60 * MINUTE))
        return console.error(
          "Kooks held back a sign-in email: 100 went out in the last hour.",
        );
      return void auth
        .requestLink({ email, origin })
        .catch((error) =>
          console.error(
            `Kooks could not prepare a sign-in link: ${error.message}`,
          ),
        );
    }
    if (route === "POST link/confirm") {
      throttle(`confirm:${address}`, 20, 10 * MINUTE);
      const email = auth.confirmLink((await input()).token);
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
        credential: (await input()).credential,
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
          const sequence = store.sequence();
          const revision = `${started}-${sequence}`;
          const known = url.searchParams.get("revision") ?? "";
          if (known === revision) return { unchanged: true, revision };
          const view = (k, r) => {
            if (k === "batch") return batchView(r);
            if (k === "shopping") return { ...r, items: shoppingItems(r.data) };
            return r;
          };
          const result = {
            revision,
            sharing: Boolean(auth),
            account: session
              ? { email: session.email, method: session.method }
              : null,
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
      if (url.pathname.startsWith("/api/tools/") && req.method === "POST") {
        const tool = tools.get(
          decoded(url.pathname.slice("/api/tools/".length)),
        );
        if (!tool) return send(res, 404, { message: "Unknown action." });
        const run = async (limit) => {
          const input = await body(req, limit);
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
  // Receiving a request: a 64 MB ebook arrives as 86 MB of JSON, which a
  // slow household connection may take a few minutes to send.
  server.requestTimeout = 300000;
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
        "KOOKS_ACCESS_TOKEN is no longer used. Household members now sign in with passkeys and emailed links: set KOOKS_HOUSEHOLD_EMAILS and KOOKS_SMTP_HOST instead (see docs/hosting.md).",
      );
    const members = parseMembers(process.env.KOOKS_HOUSEHOLD_EMAILS);
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
