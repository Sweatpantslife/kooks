import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Store } from "../mcp/store.js";
import { createWebServer } from "../web/server.js";
import { embedOrigins } from "../shared/links.js";
import { createAuthenticator } from "./helpers/authenticator.js";

const DAY = 24 * 60 * 60 * 1000;
const member = "cook@example.test";
// Captures sign-in emails instead of sending them.
function mailbox() {
  const box = {
    sent: [],
    broken: false,
    description: "to the test mailbox",
    async send(message) {
      if (box.broken) throw new Error("SMTP is down");
      box.sent.push(message);
    },
  };
  return box;
}
const tokenIn = (message) =>
  message.text.match(/#\/signin\/([A-Za-z0-9_-]+)/)[1];
const sessionCookie = (response) =>
  (response.cookie ?? "").split(";")[0] || null;

async function setup(t, options = {}) {
  const store = new Store(":memory:");
  const server = createWebServer({ store, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    server.auth?.close();
    store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Plain http so tests can set Host and Origin the way a proxy would.
  const call = (path, { method = "GET", input, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        `${origin}${path}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...headers,
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              cookie: response.headers["set-cookie"]?.[0] ?? null,
              json: () =>
                JSON.parse(Buffer.concat(chunks).toString() || "null"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(input === undefined ? undefined : JSON.stringify(input));
    });
  return {
    origin,
    server,
    get: (path, headers) => call(path, { headers }),
    post: (path, input, headers) =>
      call(path, { method: "POST", input, headers }),
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
  assert.equal(initial.sharing, false);
  assert.equal(initial.account, null);
  // A kitchen on this computer alone has no sign-in at all.
  const disabled = await post("/api/auth/link", { email: member });
  assert.equal(disabled.status, 404);
  assert.equal((await disabled.json()).error, "SIGN_IN_DISABLED");
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

test("HTTPS hosting signs members in with emailed links and passkeys behind its configured origin", async (t) => {
  const publicOrigin = "https://kooks.example";
  const box = mailbox();
  const { origin, get, post } = await setup(t, {
    host: "0.0.0.0",
    publicOrigin,
    members: [member],
    mailer: box,
  });
  const headers = { Host: "kooks.example", Origin: publicOrigin };
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  assert.equal((await fetch(`${origin}/api/state`)).status, 403);
  for (const Origin of ["https://outside.example", "http://kooks.example"])
    assert.equal(
      (await post("/api/auth/link", { email: member }, { ...headers, Origin }))
        .status,
      403,
    );
  // Strangers get the same answer as members, and no email.
  assert.equal(
    (await post("/api/auth/link", { email: "stranger@example.test" }, headers))
      .status,
    200,
  );
  assert.equal(box.sent.length, 0);
  assert.equal(
    (
      await post(
        "/api/auth/link",
        { email: ` ${member.toUpperCase()} ` },
        headers,
      )
    ).status,
    200,
  );
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, member);
  assert.match(
    box.sent[0].text,
    /https:\/\/kooks\.example\/#\/signin\/[A-Za-z0-9_-]{43}/,
  );
  const token = tokenIn(box.sent[0]);
  const wrong = await post(
    "/api/auth/link/confirm",
    { token: "nonsense" },
    headers,
  );
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, "LINK_INVALID");
  const login = await post("/api/auth/link/confirm", { token }, headers);
  assert.equal(login.status, 200);
  assert.deepEqual((await login.json()).account, {
    email: member,
    method: "email",
  });
  assert.match(
    login.cookie,
    /^kooks_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000; Secure$/,
  );
  const cookie = sessionCookie(login);
  // A link works once.
  assert.equal(
    (await post("/api/auth/link/confirm", { token }, headers)).status,
    400,
  );
  assert.equal(
    (await get("/api/state", { Host: "kooks.example" })).status,
    401,
  );
  const state = await (
    await get("/api/state", { Host: "kooks.example", Cookie: cookie })
  ).json();
  assert.equal(state.sharing, true);
  assert.deepEqual(state.account, { email: member, method: "email" });
  const saved = await post(
    "/api/tools/recipe_save",
    {
      request_id: "https-recipe",
      recipe: { title: "HTTPS rice", servings: 2 },
    },
    { ...headers, Cookie: cookie },
  );
  assert.equal(saved.status, 200);
  // Add a passkey for the configured site, then use it after signing out.
  const signedIn = { ...headers, Cookie: cookie };
  const { options } = await (
    await post("/api/auth/passkey/register/options", {}, signedIn)
  ).json();
  assert.equal(options.rp.id, "kooks.example");
  assert.equal(options.user.name, member);
  assert.equal(options.authenticatorSelection.userVerification, "required");
  const passkey = createAuthenticator({
    rpId: "kooks.example",
    origin: publicOrigin,
  });
  const registered = await post(
    "/api/auth/passkey/register",
    {
      credential: passkey.attest({ challenge: options.challenge }),
      name: "  Kitchen   phone\n",
    },
    signedIn,
  );
  assert.equal(registered.status, 200);
  assert.equal((await registered.json()).passkey.name, "Kitchen phone");
  const list = await (await get("/api/auth/passkeys", signedIn)).json();
  assert.equal(list.passkeys.length, 1);
  assert.equal(list.passkeys[0].id, passkey.id);
  const out = await post("/api/auth/signout", {}, signedIn);
  assert.equal(out.status, 200);
  assert.match(out.cookie, /^kooks_session=; .*Max-Age=0; Secure$/);
  assert.equal((await get("/api/state", signedIn)).status, 401);
  const challenge = (
    await (await post("/api/auth/passkey/options", {}, headers)).json()
  ).options;
  assert.equal(challenge.rpId, "kooks.example");
  assert.deepEqual(challenge.allowCredentials, []);
  const assertion = passkey.assert({
    challenge: challenge.challenge,
    userHandle: options.user.id,
  });
  const withPasskey = await post(
    "/api/auth/passkey/signin",
    { credential: assertion },
    headers,
  );
  assert.equal(withPasskey.status, 200);
  assert.deepEqual((await withPasskey.json()).account, {
    email: member,
    method: "passkey",
  });
  const again = await get("/api/state", {
    Host: "kooks.example",
    Cookie: sessionCookie(withPasskey),
  });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).account.method, "passkey");
  // A challenge answers once; a replay is refused.
  const replay = await post(
    "/api/auth/passkey/signin",
    { credential: assertion },
    headers,
  );
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, "PASSKEY_EXPIRED");
  const other = (
    await (await post("/api/auth/passkey/options", {}, headers)).json()
  ).options;
  const foreign = await post(
    "/api/auth/passkey/signin",
    {
      credential: passkey.assert({
        challenge: other.challenge,
        userHandle: "AAAA",
      }),
    },
    headers,
  );
  assert.equal(foreign.status, 401);
  assert.equal((await foreign.json()).error, "PASSKEY_INVALID");
});

test("hosted and shared modes refuse insecure origins and missing household configuration", () => {
  const store = new Store(":memory:");
  const box = mailbox();
  try {
    for (const publicOrigin of [
      "http://kooks.example",
      "https://kooks.example/path",
      "https://user:pass@kooks.example",
    ])
      assert.throws(
        () =>
          createWebServer({
            store,
            publicOrigin,
            members: [member],
            mailer: box,
          }),
        /HTTPS origin/,
      );
    assert.throws(
      () =>
        createWebServer({
          store,
          publicOrigin: "https://kooks.example",
          mailer: box,
        }),
      /KOOKS_HOUSEHOLD_EMAILS/,
    );
    assert.throws(
      () => createWebServer({ store, host: "0.0.0.0", mailer: box }),
      /KOOKS_HOUSEHOLD_EMAILS/,
    );
    assert.throws(
      () => createWebServer({ store, host: "0.0.0.0", members: [member] }),
      /KOOKS_SMTP_HOST/,
    );
  } finally {
    store.close();
  }
});

test("household addresses turn sign-in on, links expire, sessions slide and leaving ends access", async (t) => {
  const box = mailbox();
  const household = new Set([member, "second@example.test"]);
  let clock = Date.now();
  const { origin, get, post } = await setup(t, {
    members: household,
    mailer: box,
    authOptions: { now: () => clock, linkLifetime: 1000 },
  });
  assert.equal((await fetch(origin)).status, 200);
  const locked = await get("/api/state");
  assert.equal(locked.status, 401);
  assert.equal((await locked.json()).error, "SIGN_IN");
  assert.equal(
    (await post("/api/auth/link", { email: "not an address" })).status,
    400,
  );
  assert.equal((await post("/api/auth/link", { email: member })).status, 200);
  assert.match(box.sent[0].text, new RegExp(`${origin}/#/signin/`));
  clock += 1001;
  assert.equal(
    (await post("/api/auth/link/confirm", { token: tokenIn(box.sent[0]) }))
      .status,
    400,
  );
  assert.equal((await post("/api/auth/link", { email: member })).status, 200);
  const login = await post("/api/auth/link/confirm", {
    token: tokenIn(box.sent[1]),
  });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /SameSite=Strict; Path=\/; Max-Age=2592000$/);
  const cookie = sessionCookie(login);
  assert.equal((await get("/api/state", { Cookie: cookie })).status, 200);
  // Use within a day keeps the session quiet; later use extends it.
  clock += 2 * DAY;
  const renewed = await get("/api/state", { Cookie: cookie });
  assert.equal(renewed.status, 200);
  assert.equal(sessionCookie(renewed), cookie);
  assert.match(renewed.cookie, /Max-Age=2592000/);
  clock += 31 * DAY;
  assert.equal((await get("/api/state", { Cookie: cookie })).status, 401);
  assert.equal((await post("/api/auth/link", { email: member })).status, 200);
  const fresh = sessionCookie(
    await post("/api/auth/link/confirm", { token: tokenIn(box.sent[2]) }),
  );
  assert.equal((await get("/api/state", { Cookie: fresh })).status, 200);
  // Passkeys can be removed, and a removed passkey no longer signs in.
  const { options } = await (
    await post("/api/auth/passkey/register/options", {}, { Cookie: fresh })
  ).json();
  const passkey = createAuthenticator({ rpId: "127.0.0.1", origin });
  const stranger = createAuthenticator({
    rpId: "kooks.example",
    origin: "https://kooks.example",
  });
  const elsewhere = await post(
    "/api/auth/passkey/register",
    { credential: stranger.attest({ challenge: options.challenge }) },
    { Cookie: fresh },
  );
  assert.equal(elsewhere.status, 400);
  assert.equal((await elsewhere.json()).error, "PASSKEY_INVALID");
  const retry = (
    await (
      await post("/api/auth/passkey/register/options", {}, { Cookie: fresh })
    ).json()
  ).options;
  assert.equal(
    (
      await post(
        "/api/auth/passkey/register",
        { credential: passkey.attest({ challenge: retry.challenge }) },
        { Cookie: fresh },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        "/api/auth/passkey/remove",
        { id: passkey.id },
        { Cookie: fresh },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        "/api/auth/passkey/remove",
        { id: passkey.id },
        { Cookie: fresh },
      )
    ).status,
    404,
  );
  const challenge = (await (await post("/api/auth/passkey/options", {})).json())
    .options;
  const unknown = await post("/api/auth/passkey/signin", {
    credential: passkey.assert({ challenge: challenge.challenge }),
  });
  assert.equal(unknown.status, 401);
  assert.equal((await unknown.json()).error, "PASSKEY_UNKNOWN");
  // Mail trouble is reported to members rather than swallowed.
  box.broken = true;
  const failed = await post("/api/auth/link", { email: member });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error, "MAIL_FAILED");
  box.broken = false;
  // Leaving the household ends the session on its next request.
  household.delete(member);
  assert.equal((await get("/api/state", { Cookie: fresh })).status, 401);
  assert.equal((await post("/api/auth/link", { email: member })).status, 200);
  assert.equal(box.sent.length, 3);
});

test("sign-in requests are throttled per address", async (t) => {
  const box = mailbox();
  const { post } = await setup(t, { members: [member], mailer: box });
  for (let i = 0; i < 5; i++)
    assert.equal((await post("/api/auth/link", { email: member })).status, 200);
  const throttled = await post("/api/auth/link", { email: member });
  assert.equal(throttled.status, 429);
  assert.equal((await throttled.json()).error, "RATE_LIMITED");
  assert.equal(box.sent.length, 5);
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await post("/api/auth/link/confirm", { token: "x" })).status,
      400,
    );
  assert.equal(
    (await post("/api/auth/link/confirm", { token: "x" })).status,
    429,
  );
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
