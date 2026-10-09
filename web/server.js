import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { Store, KooksError, digest } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { kind } from "../mcp/schemas.js";
import { batchView } from "../mcp/features.js";
import { shoppingItems } from "../mcp/shopping.js";
import { embedOrigins } from "../shared/links.js";

const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
// The browser client is these files and the shared modules it imports: the
// link module, the facet taxonomy and the unit module the taxonomy builds on.
const staticFiles = new Map([
  ...["/index.html", "/app.js", "/style.css"].map((path) => [
    path,
    resolve(publicRoot, `.${path}`),
  ]),
  ...["links", "taxonomy", "quantities"].map((name) => [
    `/shared/${name}.js`,
    fileURLToPath(new URL(`../shared/${name}.js`, import.meta.url)),
  ]),
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const isLoopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);

export function createWebServer({
  store,
  host = "127.0.0.1",
  accessToken = "",
  publicOrigin = "",
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
  if ((!isLoopback(host) || external) && accessToken.length < 24)
    throw new Error(
      "LAN access requires KOOKS_ACCESS_TOKEN with at least 24 characters.",
    );
  const tools = new Map(createTools(store).map((t) => [t.name, t]));
  const sessions = new Map(),
    attempts = new Map();
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
  function authenticated(req) {
    if (!accessToken) return true;
    const cookie = (req.headers.cookie ?? "").match(
      /(?:^|;\s*)kooks_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const expires = sessions.get(cookie);
    if (!expires || expires < Date.now()) {
      sessions.delete(cookie);
      return false;
    }
    return true;
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
      if (url.pathname === "/api/login" && req.method === "POST") {
        const address = req.socket.remoteAddress;
        const attempt = attempts.get(address) ?? {
          count: 0,
          until: Date.now() + 60000,
        };
        if (attempt.until < Date.now()) {
          attempt.count = 0;
          attempt.until = Date.now() + 60000;
        }
        if (attempt.count >= 10)
          return send(res, 429, { message: "Try again in a minute." });
        const input = await body(req);
        const provided = Buffer.from(String(input.token ?? "")),
          expected = Buffer.from(accessToken);
        if (
          !accessToken ||
          provided.length !== expected.length ||
          !timingSafeEqual(provided, expected)
        ) {
          attempt.count++;
          attempts.set(address, attempt);
          return send(res, 401, {
            message: "The household access key is incorrect.",
          });
        }
        attempts.delete(address);
        const session = randomBytes(32).toString("hex");
        sessions.set(session, Date.now() + 24 * 60 * 60 * 1000);
        res.setHeader(
          "Set-Cookie",
          `kooks_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${external ? "; Secure" : ""}`,
        );
        return send(res, 200, { ok: true });
      }
      if (url.pathname.startsWith("/api/") && !authenticated(req))
        return send(res, 401, {
          error: "SIGN_IN",
          message: "Enter your household access key.",
        });
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
          return { records, revision, sharing: Boolean(accessToken) };
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
        error.code === "NOT_FOUND"
          ? 404
          : ["STALE_VERSION", "STALE_PREVIEW", "UNDO_CONFLICT"].includes(
                error.code,
              )
            ? 409
            : known
              ? 400
              : 500;
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
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  const host = process.env.KOOKS_HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 4317);
  const store = new Store(
    process.env.KOOKS_DB_PATH
      ? resolve(process.env.KOOKS_DB_PATH)
      : fileURLToPath(new URL("../.data/kooks.sqlite", import.meta.url)),
  );
  const server = createWebServer({
    store,
    host,
    accessToken: process.env.KOOKS_ACCESS_TOKEN_FILE
      ? readFileSync(process.env.KOOKS_ACCESS_TOKEN_FILE, "utf8").trim()
      : (process.env.KOOKS_ACCESS_TOKEN ?? ""),
    publicOrigin: process.env.KOOKS_PUBLIC_ORIGIN ?? "",
  });
  server.listen(port, host, () =>
    console.log(`Kooks is ready at http://${host}:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      server.close(() => {
        store.close();
        process.exit(0);
      });
    });
}
