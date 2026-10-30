import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { Store } from "../mcp/store.js";
import { createWebServer } from "../web/server.js";
import { fakeBuild } from "./helpers/build.js";

// The page is large enough to compress; the icon is too small to bother.
const page = `<!doctype html><title>Kooks</title>${"<p>Kooks</p>".repeat(4000)}`;
const icon = '<svg xmlns="http://www.w3.org/2000/svg"/>';

async function setup(t) {
  const store = new Store(":memory:");
  const server = createWebServer({
    store,
    clientRoot: fakeBuild(t, { "index.html": page, "favicon.svg": icon }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Plain http, so the test sees encodings exactly as sent.
  const get = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      http
        .get(`${origin}${path}`, { headers }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        })
        .on("error", reject);
    });
  return { store, get };
}
const decode = ({ headers, body }) =>
  headers["content-encoding"] === "br"
    ? brotliDecompressSync(body)
    : headers["content-encoding"] === "gzip"
      ? gunzipSync(body)
      : body;

test("the app's page revalidates cheaply and travels compressed", async (t) => {
  const { get } = await setup(t);
  const source = Buffer.from(page);
  const plain = await get("/");
  assert.equal(plain.status, 200);
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.equal(plain.headers["cache-control"], "no-cache");
  assert.equal(plain.headers.vary, "Accept-Encoding");
  assert.match(plain.headers.etag, /^W\/"\d+-\d+"$/);
  assert.match(plain.headers["content-security-policy"], /default-src 'self'/);
  assert.ok(plain.body.equals(source));
  for (const [accept, expected] of [
    ["gzip, deflate, br", "br"],
    ["gzip", "gzip"],
    ["br;q=0, gzip;q=0.5", "gzip"],
    ["identity", undefined],
  ]) {
    const response = await get("/", { "Accept-Encoding": accept });
    assert.equal(response.headers["content-encoding"], expected, accept);
    assert.ok(decode(response).equals(source), accept);
    if (expected) assert.ok(response.body.length < source.length / 3);
  }
  // A browser that has the file gets an empty 304.
  const again = await get("/", {
    "If-None-Match": plain.headers.etag,
    "Accept-Encoding": "br",
  });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers.etag, plain.headers.etag);
  // Tiny files are not worth encoding.
  const favicon = await get("/favicon.svg", { "Accept-Encoding": "br" });
  assert.equal(favicon.headers["content-encoding"], undefined);
  assert.equal(favicon.body.toString(), icon);
  assert.equal((await get("/missing.js")).status, 404);
});

test("a large cookbook load is compressed and API replies are never cached", async (t) => {
  const { store, get } = await setup(t);
  const empty = await get("/api/state", { "Accept-Encoding": "br" });
  assert.equal(empty.headers["content-encoding"], undefined);
  assert.equal(empty.headers["cache-control"], "no-store");
  store.mutate("seed", { request_id: "seed" }, () => {
    for (let i = 0; i < 200; i++)
      store.put("pantry", {
        name: `Spice ${i}`,
        quantity: null,
        unit: "",
        preparation: "",
        category: "Spices",
        original_text: "",
        available: true,
        use_soon: false,
        notes: "",
      });
    return {};
  });
  for (const encoding of ["br", "gzip"]) {
    const full = await get("/api/state", { "Accept-Encoding": encoding });
    assert.equal(full.headers["content-encoding"], encoding);
    assert.equal(full.headers["cache-control"], "no-store");
    assert.equal(JSON.parse(decode(full)).records.pantry.length, 200);
  }
  const plain = await get("/api/state");
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.equal(JSON.parse(plain.body).records.pantry.length, 200);
});
