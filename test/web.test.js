import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../mcp/store.js";
import { createWebServer } from "../web/server.js";
import { embedOrigins } from "../shared/links.js";
import http from "node:http";

async function setup(t, accessToken = "", options = {}) {
  const store = new Store(":memory:");
  const server = createWebServer({ store, accessToken, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    post(path, input, extra = {}) {
      return fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...extra,
        },
        body: JSON.stringify(input),
      });
    },
  };
}
test("browser API shares persistent actions, reports revisions and rejects stale writes and cross-site posts", async (t) => {
  const { origin, post } = await setup(t);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Your everyday kitchen/);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  // Video players may load only from the embed origins; everything else keeps
  // the strict policy.
  const policy = page.headers.get("content-security-policy");
  assert.match(policy, /default-src 'self'; script-src 'self';/);
  for (const embedOrigin of embedOrigins)
    assert.ok(
      policy.includes(`frame-src 'self' ${embedOrigins.join(" ")}`) &&
        policy.includes(embedOrigin),
      `CSP allows ${embedOrigin}`,
    );
  const shared = await fetch(`${origin}/shared/links.js`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get("content-type"), /javascript/);
  assert.match(await shared.text(), /export function describeLink/);
  assert.equal((await fetch(`${origin}/shared/quantities.js`)).status, 404);
  const initial = await (await fetch(`${origin}/api/state`)).json();
  const response = await post("/api/tools/recipe_save", {
    request_id: "http-create",
    recipe: { title: "Shared rice", servings: 2 },
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  const next = await (
    await fetch(`${origin}/api/state?revision=${initial.revision}`)
  ).json();
  assert.equal(next.records.recipe[0].id, saved.record.id);
  assert.notEqual(next.revision, initial.revision);
  const unchanged = await (
    await fetch(`${origin}/api/state?revision=${next.revision}`)
  ).json();
  assert.equal(unchanged.unchanged, true);
  const stale = await post("/api/tools/recipe_save", {
    request_id: "stale",
    id: saved.record.id,
    expected_version: 999,
    recipe: { title: "Overwritten" },
  });
  assert.equal(stale.status, 409);
  const rejected = await post(
    "/api/tools/recipe_save",
    { request_id: "cross-site", recipe: { title: "Unwanted" } },
    { Origin: "https://outside.example" },
  );
  assert.equal(rejected.status, 403);
  // Fetch normalizes Host; use the HTTP client to exercise an actual rebinding request.
  const badHost = await new Promise((resolve, reject) => {
    const req = http.get(
      `${origin}/api/state`,
      { headers: { Host: "outside.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on("error", reject);
  });
  assert.equal(badHost, 403);
  const final = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(final.records.recipe.length, 1);
});
test("HTTPS proxy hosting accepts only its configured origin and uses secure sessions", async (t) => {
  const token = "a-long-household-access-key-for-tests";
  const publicOrigin = "https://kooks.example";
  const { origin } = await setup(t, token, {
    host: "0.0.0.0",
    publicOrigin,
  });
  // Use HTTP directly: fetch normalizes Host instead of simulating the proxy.
  const request = (path, method = "GET", input, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        `${origin}${path}`,
        {
          method,
          headers: { "Content-Type": "application/json", ...headers },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: new Headers(response.headers),
              json: () => JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(input === undefined ? undefined : JSON.stringify(input));
    });
  const post = (path, input, headers) => request(path, "POST", input, headers);
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  assert.equal((await fetch(`${origin}/api/state`)).status, 403);
  const headers = { Host: "kooks.example", Origin: publicOrigin };
  assert.equal(
    (
      await post(
        "/api/login",
        { token },
        { ...headers, Origin: "https://outside.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        "/api/login",
        { token },
        {
          ...headers,
          Origin: "http://kooks.example",
          "X-Forwarded-Proto": "https",
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (await post("/api/login", { token: "wrong" }, headers)).status,
    401,
  );
  const login = await post("/api/login", { token }, headers);
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.equal(
    (await request("/api/state", "GET", undefined, { Host: "kooks.example" }))
      .status,
    401,
  );
  const saved = await post(
    "/api/tools/recipe_save",
    {
      request_id: "https-recipe",
      recipe: { title: "HTTPS rice", servings: 2 },
    },
    { ...headers, Cookie: cookie.split(";")[0] },
  );
  assert.equal(saved.status, 200);
  const state = await (
    await request("/api/state", "GET", undefined, {
      Host: "kooks.example",
      Cookie: cookie.split(";")[0],
    })
  ).json();
  assert.equal(state.records.recipe[0].data.title, "HTTPS rice");
});

test("hosted mode refuses insecure origins and missing access protection", () => {
  const store = new Store(":memory:");
  try {
    for (const publicOrigin of [
      "http://kooks.example",
      "https://kooks.example/path",
      "https://user:pass@kooks.example",
    ]) {
      assert.throws(
        () => createWebServer({ store, publicOrigin }),
        /HTTPS origin/,
      );
    }
    assert.throws(
      () => createWebServer({ store, publicOrigin: "https://kooks.example" }),
      /KOOKS_ACCESS_TOKEN/,
    );
  } finally {
    store.close();
  }
});
test("optional household access key protects records and issues a scoped browser session", async (t) => {
  const { origin, post } = await setup(
    t,
    "a-long-household-access-key-for-tests",
  );
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await post("/api/login", { token: "wrong" })).status, 401);
  const login = await post("/api/login", {
    token: "a-long-household-access-key-for-tests",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(
    (
      await fetch(`${origin}/api/state`, {
        headers: { Cookie: cookie.split(";")[0] },
      })
    ).status,
    200,
  );
  const isolated = new Store(":memory:");
  try {
    assert.throws(
      () => createWebServer({ store: isolated, host: "0.0.0.0" }),
      /access_token/i,
    );
  } finally {
    isolated.close();
  }
});

test("ebooks are served with their names for the in-app reader and for download", async (t) => {
  const { origin, post } = await setup(t);
  const upload = async (name, mime_type, bytes) =>
    (
      await (
        await post("/api/tools/asset_save", {
          request_id: `upload-${name}`,
          file: { name, mime_type, base64: bytes.toString("base64") },
        })
      ).json()
    ).record;
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const book = await upload("Family cookbook (2019) é", "application/pdf", pdf);
  assert.equal(book.data.base64, undefined);
  const inline = await fetch(`${origin}/api/assets/${book.id}`);
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get("content-type"), "application/pdf");
  assert.equal(
    inline.headers.get("content-disposition"),
    `inline; filename="Family cookbook (2019) _.pdf"; filename*=UTF-8''Family%20cookbook%20%282019%29%20%C3%A9.pdf`,
  );
  // The page may frame its own PDFs; nothing else changes in the policy.
  assert.match(
    inline.headers.get("content-security-policy"),
    /frame-ancestors 'self'/,
  );
  assert.match(
    inline.headers.get("content-security-policy"),
    /^default-src 'self'; script-src 'self';/,
  );
  assert.ok(Buffer.from(await inline.arrayBuffer()).equals(pdf));
  const download = await fetch(`${origin}/api/assets/${book.id}?download=1`);
  assert.match(download.headers.get("content-disposition"), /^attachment; /);
  const epub = Buffer.concat([
    Buffer.from([0x50, 0x4b, 3, 4, 10, 0, 0, 0, 0, 0]),
    Buffer.alloc(16),
    Buffer.from([20, 0, 0, 0, 20, 0, 0, 0, 8, 0, 0, 0]),
    Buffer.from("mimetypeapplication/epub+zip"),
  ]);
  const novel = await upload("novel", "application/epub+zip", epub);
  const served = await fetch(`${origin}/api/assets/${novel.id}`);
  assert.equal(served.headers.get("content-type"), "application/epub+zip");
  assert.equal(
    served.headers.get("content-disposition"),
    `attachment; filename="novel.epub"; filename*=UTF-8''novel.epub`,
  );
  const rejected = await post("/api/tools/asset_save", {
    request_id: "upload-bad",
    file: {
      name: "x.pdf",
      mime_type: "application/pdf",
      base64: epub.toString("base64"),
    },
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "INVALID_FILE");
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(state.records.asset.length, 2);
  for (const kind of ["technique", "inspiration", "book"])
    assert.deepEqual(state.records[kind], []);
});
