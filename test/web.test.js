import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../mcp/store.js";
import { createWebServer } from "../web/server.js";
import { createAuth } from "../web/auth.js";
import { embedOrigins } from "../shared/links.js";
import { createAuthenticator } from "./helpers/authenticator.js";
import { fakeBuild } from "./helpers/build.js";
import { fakeClaude, says } from "./helpers/claude.js";

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
    server.assistant?.close();
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
              headers: response.headers,
              cookie: response.headers["set-cookie"]?.[0] ?? null,
              json: () =>
                JSON.parse(Buffer.concat(chunks).toString() || "null"),
              text: () => Buffer.concat(chunks).toString(),
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
    call,
    get: (path, headers) => call(path, { headers }),
    post: (path, input, headers) =>
      call(path, { method: "POST", input, headers }),
  };
}

test("browser API shares persistent actions, reports revisions and rejects stale writes and cross-site posts", async (t) => {
  const { origin, post } = await setup(t, { clientRoot: fakeBuild(t) });
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Kooks<\/title>/);
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
  // The app's build is served, never the rest of the repository.
  assert.equal((await fetch(`${origin}/shared/links.js`)).status, 404);
  assert.equal((await fetch(`${origin}/mcp/store.js`)).status, 404);
  const initial = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(initial.sharing, false);
  assert.equal(initial.account, null);
  assert.equal(page.headers.get("strict-transport-security"), null);
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
  // A tab that knows the previous revision receives only what changed.
  const next = await (
    await fetch(`${origin}/api/state?revision=${initial.revision}`)
  ).json();
  assert.equal(next.records, undefined);
  assert.deepEqual(
    next.changes.map((change) => [change.kind, change.id, change.record.id]),
    [["recipe", saved.record.id, saved.record.id]],
  );
  assert.equal(next.sharing, false);
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
  assert.equal(
    (await fetch(`${origin}/healthz`)).headers.get("strict-transport-security"),
    "max-age=31536000",
  );
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
    /^kooks_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=15552000; Secure$/,
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
  assert.equal(state.account.email, member);
  assert.equal(state.account.method, "email");
  assert.deepEqual(state.account.household, {
    id: "home",
    name: "Our kitchen",
    role: "owner",
    person: null,
    members: 1,
  });
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
    // Plain HTTP is for addresses on the household's own network only.
    for (const publicOrigin of [
      "http://kooks.example",
      "http://8.8.8.8:4317",
      "http://[2001:db8::1]:4317",
      "https://kooks.example/path",
      "https://user:pass@kooks.example",
      "ftp://192.168.1.20",
      "kooks.example",
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
        publicOrigin,
      );
    for (const publicOrigin of [
      "https://kooks.example",
      "http://192.168.1.20:4317",
      "http://10.0.0.5",
      "http://172.20.1.2:4317",
      "http://100.101.102.103:4317",
      "http://[fd12:3456::1]:4317",
      "http://kitchen.local:4317",
      "http://kitchen:4317",
    ])
      createWebServer({
        store,
        host: "0.0.0.0",
        publicOrigin,
        members: [member],
        mailer: box,
      }).auth.close();
    // Beyond this computer the address members open must be configured.
    assert.throws(
      () =>
        createWebServer({
          store,
          host: "0.0.0.0",
          members: [member],
          mailer: box,
        }),
      /KOOKS_PUBLIC_ORIGIN/,
    );
    assert.throws(
      () =>
        createWebServer({
          store,
          publicOrigin: "https://kooks.example",
          mailer: box,
        }),
      /KOOKS_OWNER_EMAIL/,
    );
    assert.throws(
      () => createWebServer({ store, host: "0.0.0.0", mailer: box }),
      /KOOKS_PUBLIC_ORIGIN/,
    );
    assert.throws(
      () => createWebServer({ store, host: "0.0.0.0", members: [member] }),
      /KOOKS_SMTP_HOST/,
    );
  } finally {
    store.close();
  }
});

// Raw requests, for headers fetch and the HTTP client would refuse or fix.
async function rawRequest(origin, text) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => socket.end(text));
    let reply = "";
    socket.on("data", (chunk) => (reply += chunk));
    socket.on("close", () => resolve(Number(reply.split(" ")[1])));
    socket.on("error", reject);
  });
}

test("home-network sharing takes sign-in links and the accepted host from its configured address, never the request", async (t) => {
  const box = mailbox();
  const lan = "http://192.168.1.20:4317";
  const { origin, get, post } = await setup(t, {
    host: "0.0.0.0",
    publicOrigin: lan,
    members: [member],
    mailer: box,
  });
  const headers = { Host: "192.168.1.20:4317", Origin: lan };
  // A request naming another host, even with a matching Origin, is refused
  // before any email goes out.
  const poisoned = await post(
    "/api/auth/link",
    { email: member },
    { Host: "attacker.example", Origin: "http://attacker.example" },
  );
  assert.equal(poisoned.status, 403);
  assert.equal(
    (
      await post(
        "/api/auth/link",
        { email: member },
        { Host: "127.0.0.1", Origin: "http://127.0.0.1" },
      )
    ).status,
    403,
  );
  assert.equal(box.sent.length, 0);
  assert.equal(
    (await post("/api/auth/link", { email: member }, headers)).status,
    200,
  );
  assert.equal(box.sent.length, 1);
  assert.match(
    box.sent[0].text,
    /\nhttp:\/\/192\.168\.1\.20:4317\/#\/signin\/[A-Za-z0-9_-]{43}\n/,
  );
  const login = await post(
    "/api/auth/link/confirm",
    { token: tokenIn(box.sent[0]) },
    headers,
  );
  assert.equal(login.status, 200);
  // Plain HTTP cannot carry a Secure cookie.
  assert.match(login.cookie, /SameSite=Strict; Path=\/; Max-Age=15552000$/);
  assert.equal(
    (
      await get("/api/state", {
        Host: "192.168.1.20:4317",
        Cookie: sessionCookie(login),
      })
    ).status,
    200,
  );
  const { options } = await (
    await post("/api/auth/passkey/options", {}, headers)
  ).json();
  assert.equal(options.rpId, "192.168.1.20");
  // No proxy stands in front of a home-network server, so a forwarded
  // address is the client's own claim and cannot dodge the throttle: with the
  // confirmation above, 19 more fill this connection's 20 tries.
  for (let i = 0; i < 19; i++)
    assert.equal(
      (
        await post(
          "/api/auth/link/confirm",
          { token: "x" },
          { ...headers, "X-Forwarded-For": `203.0.113.${i}` },
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await post(
        "/api/auth/link/confirm",
        { token: "x" },
        { ...headers, "X-Forwarded-For": "203.0.113.99" },
      )
    ).status,
    429,
  );
  // A Host that is not a URL authority is a bad request, not a crash.
  assert.equal(
    await rawRequest(origin, "GET / HTTP/1.1\r\nHost: a b\r\n\r\n"),
    400,
  );
});

test("a loopback server behind a local HTTPS proxy accepts its configured origin only", async (t) => {
  const box = mailbox();
  const publicOrigin = "https://kooks.example";
  const { post } = await setup(t, {
    host: "127.0.0.1",
    publicOrigin,
    members: [member],
    mailer: box,
  });
  const headers = { Host: "kooks.example", Origin: publicOrigin };
  assert.equal(
    (await post("/api/auth/link", { email: member }, headers)).status,
    200,
  );
  assert.match(box.sent[0].text, /https:\/\/kooks\.example\/#\/signin\//);
  const login = await post(
    "/api/auth/link/confirm",
    { token: tokenIn(box.sent[0]) },
    headers,
  );
  assert.match(login.cookie, /; Secure$/);
  assert.equal(
    (await post("/api/auth/link", { email: member })).status,
    403,
    "a loopback Host is not the configured origin",
  );
});

test("household addresses turn sign-in on, links expire, sessions slide and leaving ends access", async (t) => {
  const box = mailbox();
  let clock = Date.now();
  const { origin, get, post } = await setup(t, {
    members: [member, "second@example.test"],
    mailer: box,
    authOptions: { now: () => clock, linkLifetime: 1000 },
    clientRoot: fakeBuild(t),
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
  assert.match(login.cookie, /SameSite=Strict; Path=\/; Max-Age=15552000$/);
  const cookie = sessionCookie(login);
  assert.equal((await get("/api/state", { Cookie: cookie })).status, 200);
  // Use within a day keeps the session quiet; later use extends it.
  clock += 2 * DAY;
  const renewed = await get("/api/state", { Cookie: cookie });
  assert.equal(renewed.status, 200);
  assert.equal(sessionCookie(renewed), cookie);
  assert.match(renewed.cookie, /Max-Age=15552000/);
  // Half a year without use ends it.
  clock += 181 * DAY;
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
  // Mail trouble goes to the log; the answer stays the one strangers get.
  const logged = t.mock.method(console, "error", () => {});
  box.broken = true;
  const failed = await post("/api/auth/link", { email: member });
  assert.equal(failed.status, 200);
  assert.deepEqual(await failed.json(), { ok: true });
  assert.match(
    logged.mock.calls[0].arguments[0],
    /could not email a sign-in link: SMTP is down/,
  );
  logged.mock.restore();
  box.broken = false;
  // Someone taken out of the household is out of its kitchen at their next
  // request, and stays signed in to no household.
  assert.equal(
    (await post("/api/auth/link", { email: "second@example.test" })).status,
    200,
  );
  const second = sessionCookie(
    await post("/api/auth/link/confirm", { token: tokenIn(box.sent.at(-1)) }),
  );
  assert.equal((await get("/api/state", { Cookie: second })).status, 200);
  const notOwner = await post(
    "/api/auth/household/remove",
    { email: member },
    { Cookie: second },
  );
  assert.equal(notOwner.status, 403);
  assert.equal(
    (
      await post(
        "/api/auth/household/remove",
        { email: "second@example.test" },
        { Cookie: fresh },
      )
    ).status,
    200,
  );
  const outside = await (await get("/api/state", { Cookie: second })).json();
  assert.equal(outside.account.household, null);
  assert.deepEqual(outside.records, {});
  const refused = await post(
    "/api/tools/recipe_save",
    { request_id: "outsider", recipe: { title: "Stray soup" } },
    { Cookie: second },
  );
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "NO_HOUSEHOLD");
});

test("the phone app waits for a confirmed email link and sends a device token, across origins to the API only", async (t) => {
  const box = mailbox();
  let clock = Date.now();
  const { call, get, post } = await setup(t, {
    host: "0.0.0.0",
    publicOrigin: "https://kooks.example",
    members: [member],
    mailer: box,
    authOptions: { now: () => clock },
  });
  const app = { Host: "kooks.example", Origin: "capacitor://localhost" };
  const browser = { Host: "kooks.example", Origin: "https://kooks.example" };

  // The app asks before it calls, and only its own origins hear yes.
  const asked = await call("/api/state", {
    method: "OPTIONS",
    headers: { ...app, "Access-Control-Request-Headers": "authorization" },
  });
  assert.equal(asked.status, 204);
  assert.equal(
    asked.headers["access-control-allow-origin"],
    "capacitor://localhost",
  );
  assert.match(asked.headers["access-control-allow-headers"], /Authorization/);
  for (const Origin of ["https://outside.example", "http://localhost"])
    assert.equal(
      (
        await call("/api/state", {
          method: "OPTIONS",
          headers: { ...app, Origin },
        })
      ).headers["access-control-allow-origin"],
      undefined,
    );
  assert.equal(
    (await get("/", { ...app, Origin: "https://localhost" })).headers[
      "access-control-allow-origin"
    ],
    undefined,
    "the app's own pages are in the app, not on the server",
  );
  const locked = await get("/api/state", app);
  assert.equal(locked.status, 401);
  assert.equal(
    locked.headers["access-control-allow-origin"],
    "capacitor://localhost",
  );
  assert.equal((await locked.json()).error, "SIGN_IN");
  // Opening links, invites and passkeys are the browser's, whatever token
  // comes with them.
  const madeUp = { ...app, Authorization: `Bearer ${"0".repeat(64)}` };
  for (const path of [
    "link/confirm",
    "passkey/options",
    "passkey/signin",
    "passkey/register/options",
    "passkey/register",
    "invite/open",
    "invite/accept",
  ])
    for (const headers of [app, madeUp]) {
      const refused = await post(
        `/api/auth/${path}`,
        { email: member },
        headers,
      );
      assert.equal(refused.status, 403, path);
      assert.equal(refused.cookie, null, path);
    }
  assert.equal(box.sent.length, 0);

  // The app asks for a link and waits with a secret of its own; a stranger
  // gets a secret too, and nothing ever comes of it.
  const waitFor = (wait) => post("/api/auth/link/wait", { wait }, app);
  const asking = await post(
    "/api/auth/link",
    { email: "stranger@example.test" },
    app,
  );
  assert.equal(asking.status, 200);
  const strangerWait = (await asking.json()).wait;
  assert.match(strangerWait, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(box.sent.length, 0);
  const asked2 = await post("/api/auth/link", { email: member }, app);
  assert.equal(asked2.status, 200);
  const { wait } = await asked2.json();
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].subject, "Sign in to the Kooks app");
  assert.match(box.sent[0].text, /https:\/\/kooks\.example\/#\/signin\//);
  assert.deepEqual(await (await waitFor(wait)).json(), {
    ok: true,
    waiting: true,
  });
  // Opening the link signs nobody in until the person there confirms.
  const link = tokenIn(box.sent[0]);
  const opened = await post("/api/auth/link/confirm", { token: link }, browser);
  assert.equal(opened.status, 200);
  assert.equal(opened.cookie, null);
  assert.deepEqual(await opened.json(), {
    ok: true,
    app: true,
    email: member,
    approved: false,
  });
  assert.equal((await (await waitFor(wait)).json()).waiting, true);
  const approved = await post(
    "/api/auth/link/confirm",
    { token: link, approve: true },
    browser,
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.cookie, null, "the browser is not signed in");
  assert.equal((await approved.json()).approved, true);
  assert.equal(
    (
      await post(
        "/api/auth/link/confirm",
        { token: link, approve: true },
        browser,
      )
    ).status,
    400,
    "a link works once",
  );
  const signed = await waitFor(wait);
  assert.equal(signed.status, 200);
  assert.equal(signed.cookie, null, "the device keeps a token, not a cookie");
  const { token, account } = await signed.json();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.deepEqual(account, { email: member, method: "email" });
  assert.equal(
    (await (await waitFor(wait)).json()).waiting,
    true,
    "the session is handed over once",
  );
  assert.equal((await (await waitFor(strangerWait)).json()).waiting, true);
  assert.equal((await (await waitFor("nonsense")).json()).waiting, true);

  const device = { ...app, Authorization: `Bearer ${token}` };
  const state = await get("/api/state", device);
  assert.equal(state.status, 200);
  assert.equal((await state.json()).account.email, member);
  assert.equal(
    (
      await post(
        "/api/tools/recipe_save",
        { request_id: "phone-1", recipe: { title: "Phone soup" } },
        device,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        "/api/tools/recipe_save",
        { request_id: "phone-2", recipe: { title: "Stray soup" } },
        app,
      )
    ).status,
    401,
  );
  // The same token as a cookie counts in the browser and never from the app.
  const cookie = { Cookie: `kooks_session=${token}` };
  assert.equal(
    (await get("/api/state", { ...browser, ...cookie })).status,
    200,
  );
  assert.equal((await get("/api/state", { ...app, ...cookie })).status, 401);

  // The devices list names the app, and a link not confirmed in time is
  // spent.
  const devices = await (await get("/api/auth/sessions", device)).json();
  assert.equal(devices.sessions.length, 1);
  assert.equal(devices.sessions[0].label, "Kooks app");
  assert.equal(devices.sessions[0].current, true);
  const late = (
    await (await post("/api/auth/link", { email: member }, app)).json()
  ).wait;
  clock += 15 * 60 * 1000 + 1;
  assert.equal(
    (
      await post(
        "/api/auth/link/confirm",
        { token: tokenIn(box.sent[1]), approve: true },
        browser,
      )
    ).status,
    400,
  );
  assert.equal((await (await waitFor(late)).json()).waiting, true);

  const out = await post("/api/auth/signout", {}, device);
  assert.equal(out.status, 200);
  assert.equal(out.cookie, null);
  assert.equal((await get("/api/state", device)).status, 401);
});

test("households keep their own cookbooks and grow by emailed invitation", async (t) => {
  const box = mailbox();
  let clock = Date.now();
  const { get, post } = await setup(t, {
    owner: member,
    mailer: box,
    authOptions: { now: () => clock },
  });
  const signIn = async (email) => {
    await post("/api/auth/link", { email });
    return {
      Cookie: sessionCookie(
        await post("/api/auth/link/confirm", {
          token: tokenIn(box.sent.at(-1)),
        }),
      ),
    };
  };
  const owner = await signIn(member);
  const state = async (who) => (await get("/api/state", who)).json();
  const first = await state(owner);
  assert.equal(first.account.household.id, "home");
  assert.equal(first.account.household.role, "owner");
  await post(
    "/api/tools/recipe_save",
    { request_id: "home-1", recipe: { title: "Home soup" } },
    owner,
  );

  // Nobody else may sign in: a stranger's link request gets the same answer
  // and no email.
  const before = box.sent.length;
  assert.equal(
    (await post("/api/auth/link", { email: "sam@example.test" })).status,
    200,
  );
  assert.equal(box.sent.length, before);

  // An invite goes by email, names the household, and signs the invited
  // address in when accepted, with an account made for it.
  assert.equal(
    (
      await post(
        "/api/auth/household/invite",
        { email: "not an address" },
        owner,
      )
    ).status,
    400,
  );
  const invited = await post(
    "/api/auth/household/invite",
    { email: " Sam@Example.test " },
    owner,
  );
  assert.equal(invited.status, 200);
  const mail = box.sent.at(-1);
  assert.equal(mail.to, "sam@example.test");
  assert.equal(mail.subject, "Join Our kitchen on Kooks");
  const inviteToken = mail.text.match(/#\/join\/([A-Za-z0-9_-]{43})/)[1];
  const { members, invites } = await (
    await get("/api/auth/household/members", owner)
  ).json();
  assert.deepEqual(
    members.map((m) => [m.email, m.role]),
    [[member, "owner"]],
  );
  assert.deepEqual(
    invites.map((i) => [i.email, i.invited_by]),
    [["sam@example.test", member]],
  );
  const open = await (
    await post("/api/auth/invite/open", { token: inviteToken })
  ).json();
  assert.deepEqual(open.invite, {
    email: "sam@example.test",
    invited_by: member,
    household: "Our kitchen",
    signed_in_as: null,
  });
  const accepted = await post("/api/auth/invite/accept", {
    token: inviteToken,
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).account.email, "sam@example.test");
  const sam = { Cookie: sessionCookie(accepted) };
  const samState = await state(sam);
  assert.equal(samState.account.household.id, "home");
  assert.equal(samState.account.household.role, "member");
  assert.equal(samState.records.recipe[0].data.title, "Home soup");
  assert.equal(
    (await post("/api/auth/invite/accept", { token: inviteToken })).status,
    400,
    "an invite works once",
  );
  // Sam has an account now, so links reach them.
  await post("/api/auth/link", { email: "sam@example.test" });
  assert.equal(box.sent.at(-1).to, "sam@example.test");
  assert.equal(
    (
      await post(
        "/api/auth/household/invite",
        { email: "sam@example.test" },
        owner,
      )
    ).status,
    409,
  );

  // Sam starts a kitchen of their own: an empty cookbook, apart from the
  // first, with a revision of its own.
  const made = await post(
    "/api/auth/household/create",
    { name: "  Sam's   flat " },
    sam,
  );
  assert.equal(made.status, 200);
  const flat = (await made.json()).household;
  assert.match(flat, /^[a-f0-9]{16}$/);
  const own = await state(sam);
  assert.equal(own.account.household.name, "Sam's flat");
  assert.equal(own.account.household.role, "owner");
  assert.deepEqual(own.records.recipe, []);
  assert.notEqual(own.revision.split("-")[0], samState.revision.split("-")[0]);
  await post(
    "/api/tools/recipe_save",
    { request_id: "flat-1", recipe: { title: "Flat noodles" } },
    sam,
  );
  assert.deepEqual(
    (await state(owner)).records.recipe.map((r) => r.data.title),
    ["Home soup"],
  );
  // The owner of the first kitchen is not in Sam's, and cannot switch to it.
  assert.equal(
    (await post("/api/auth/household/switch", { id: flat }, owner)).status,
    403,
  );
  // Sam invites the owner, who takes the invite from inside the app.
  await post("/api/auth/household/invite", { email: member }, sam);
  const waiting = (await state(owner)).account.invites;
  assert.deepEqual(
    waiting.map((i) => [i.household, i.invited_by]),
    [["Sam's flat", "sam@example.test"]],
  );
  assert.equal(
    (await post("/api/auth/household/join", { id: waiting[0].id }, owner))
      .status,
    200,
  );
  const both = await state(owner);
  assert.equal(both.account.household.id, flat);
  assert.deepEqual(
    both.account.households.map((h) => h.id),
    ["home", flat],
  );
  assert.deepEqual(
    both.records.recipe.map((r) => r.data.title),
    ["Flat noodles"],
  );
  assert.equal(
    (await post("/api/auth/household/switch", { id: "home" }, owner)).status,
    200,
  );
  assert.equal((await state(owner)).account.household.id, "home");

  // Withdrawn and expired invites are spent.
  await post(
    "/api/auth/household/invite",
    { email: "kim@example.test" },
    owner,
  );
  const kimToken = box.sent.at(-1).text.match(/#\/join\/([\w-]{43})/)[1];
  const pending = (
    await (await get("/api/auth/household/members", owner)).json()
  ).invites;
  assert.equal(
    (
      await post(
        "/api/auth/household/invite/withdraw",
        { id: pending[0].id },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await post("/api/auth/invite/open", { token: kimToken })).status,
    400,
  );
  await post(
    "/api/auth/household/invite",
    { email: "kim@example.test" },
    owner,
  );
  const late = box.sent.at(-1).text.match(/#\/join\/([\w-]{43})/)[1];
  clock += 7 * DAY + 1;
  const expired = await post("/api/auth/invite/accept", { token: late });
  assert.equal(expired.status, 400);
  assert.equal((await expired.json()).error, "INVITE_INVALID");

  // The last member cannot leave; an owner who leaves hands over.
  await post("/api/auth/household/switch", { id: flat }, sam);
  const ownerOut = await post("/api/auth/household/leave", {}, sam);
  assert.equal(ownerOut.status, 200);
  assert.equal((await state(sam)).account.household.id, "home");
  await post("/api/auth/household/switch", { id: flat }, owner);
  assert.equal((await state(owner)).account.household.role, "owner");
  const last = await post("/api/auth/household/leave", {}, owner);
  assert.equal(last.status, 409);
  assert.equal((await last.json()).error, "LAST_MEMBER");
});

test("members say who they are at the table, history names them, and leaving leaves a plain person", async (t) => {
  const box = mailbox();
  const { get, post } = await setup(t, { owner: member, mailer: box });
  const signIn = async (email) => {
    await post("/api/auth/link", { email });
    return {
      Cookie: sessionCookie(
        await post("/api/auth/link/confirm", {
          token: tokenIn(box.sent.at(-1)),
        }),
      ),
    };
  };
  const owner = await signIn(member);
  await post(
    "/api/auth/household/invite",
    { email: "sam@example.test" },
    owner,
  );
  const sam = {
    Cookie: sessionCookie(
      await post("/api/auth/invite/accept", {
        token: box.sent.at(-1).text.match(/#\/join\/([\w-]{43})/)[1],
      }),
    ),
  };
  let requests = 0;
  const tool = async (name, input, who) =>
    (
      await post(
        `/api/tools/${name}`,
        { request_id: `people-${++requests}`, ...input },
        who,
      )
    ).json();
  const state = async (who) => (await get("/api/state", who)).json();
  const link = (person, who) =>
    post("/api/auth/household/person", { person }, who);

  // Sam changes something before saying who they are.
  const early = await tool(
    "recipe_save",
    { recipe: { title: "Early toast" } },
    sam,
  );
  const ada = (await tool("member_save", { member: { name: "Ada" } }, owner))
    .record.id;
  const soup = await tool(
    "recipe_save",
    { recipe: { title: "Ada's soup" } },
    owner,
  );
  assert.equal((await state(owner)).account.household.person, null);

  // Only a person at this household's table, and each for one member.
  assert.equal((await link("../member", owner)).status, 400);
  assert.equal((await link("no-such-person", owner)).status, 404);
  assert.equal((await link(soup.record.id, owner)).status, 404);
  assert.equal((await link(ada, owner)).status, 200);
  assert.equal((await state(owner)).account.household.person, ada);
  const taken = await link(ada, sam);
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).error, "PERSON_TAKEN");
  // Or a new person, added and then linked.
  const samPerson = (
    await tool("member_save", { member: { name: "Sam" } }, sam)
  ).record.id;
  assert.equal((await link(samPerson, sam)).status, 200);
  const edited = await tool(
    "recipe_save",
    {
      id: soup.record.id,
      expected_version: 1,
      recipe: { title: "Ada's soup, saltier" },
    },
    sam,
  );
  const { members } = await (
    await get("/api/auth/household/members", owner)
  ).json();
  assert.deepEqual(
    members.map((m) => [m.email, m.person]),
    [
      [member, ada],
      ["sam@example.test", samPerson],
    ],
  );

  // History names members by their person at the table, and says which
  // changes were the reader's own; it never shows an address or account.
  const history = async (who) =>
    (await (await post("/api/tools/history_list", { limit: 10 }, who)).json())
      .actions;
  const seenByOwner = await history(owner);
  const actorOf = (actions, action) =>
    actions.find((a) => a.id === action.action_id).actor;
  assert.deepEqual(actorOf(seenByOwner, edited), {
    type: "member",
    person: samPerson,
    name: "Sam",
    you: false,
  });
  assert.deepEqual(actorOf(seenByOwner, soup), {
    type: "member",
    person: ada,
    name: "Ada",
    you: true,
  });
  // Sam's change from before they linked is theirs by name now too.
  assert.equal(actorOf(seenByOwner, early).name, "Sam");
  assert.equal(actorOf(await history(sam), edited).you, true);
  assert.doesNotMatch(JSON.stringify(seenByOwner), /@|example\.test/);
  // Undo of another member's change is the undoer's own change.
  assert.equal(
    (
      await post(
        "/api/tools/history_undo",
        { request_id: "undo-sam", action_id: edited.action_id },
        owner,
      )
    ).status,
    200,
  );
  assert.equal((await history(sam))[0].actor.name, "Ada");

  // A portable backup is the cookbook alone: people, but no addresses or
  // links to accounts.
  const backup = (await get("/api/backup", owner)).text();
  assert.match(backup, /"Sam"/);
  assert.doesNotMatch(backup, /example\.test|"person"/);

  // Unlinking says nobody; linking again is allowed.
  assert.equal((await link(null, owner)).status, 200);
  assert.equal((await state(owner)).account.household.person, null);
  assert.equal((await link(ada, owner)).status, 200);
  // Relinking does not rename what was done as someone else.
  assert.equal((await link(null, sam)).status, 200);
  assert.equal(actorOf(await history(owner), edited).name, "Sam");
  assert.equal((await link(samPerson, sam)).status, 200);

  // An owner can take back another member's claim, and only that; a
  // member cannot unlink anyone else.
  const unlink = (email, who, extra = {}) =>
    post("/api/auth/household/person", { member: email, ...extra }, who);
  assert.equal((await unlink(member, sam)).status, 403);
  assert.equal(
    (await unlink("sam@example.test", owner, { person: ada })).status,
    400,
  );
  assert.equal((await unlink("kim@example.test", owner)).status, 404);
  assert.equal((await unlink("sam@example.test", owner)).status, 200);
  assert.equal((await state(sam)).account.household.person, null);
  assert.equal((await state(owner)).account.household.person, ada);
  assert.equal((await link(samPerson, sam)).status, 200);

  // Removed, Sam takes only the link: their person stays at the table,
  // and history still names their changes by it.
  assert.equal(
    (
      await post(
        "/api/auth/household/remove",
        { email: "sam@example.test" },
        owner,
      )
    ).status,
    200,
  );
  const after = await state(owner);
  assert.deepEqual(after.records.member.map((m) => m.data.name).sort(), [
    "Ada",
    "Sam",
  ]);
  assert.equal(actorOf(await history(owner), edited).name, "Sam");
  // Invited back, Sam is linked to nobody until they say so again, and
  // their old person is free for them.
  await post(
    "/api/auth/household/invite",
    { email: "sam@example.test" },
    owner,
  );
  const back = (await state(sam)).account.invites[0];
  await post("/api/auth/household/join", { id: back.id }, sam);
  assert.equal((await state(sam)).account.household.person, null);
  assert.equal((await link(samPerson, sam)).status, 200);
});

test("without sign-in, changes are the kitchen computer's, and its own", async (t) => {
  const { post } = await setup(t);
  await post("/api/tools/recipe_save", {
    request_id: "local-1",
    recipe: { title: "Toast" },
  });
  const { actions } = await (
    await post("/api/tools/history_list", { limit: 1 })
  ).json();
  assert.deepEqual(actions[0].actor, { type: "local", you: true });
  assert.equal(
    (await post("/api/auth/household/person", { person: null })).status,
    404,
  );
});

test("members see their signed-in devices and sign the others out", async (t) => {
  const box = mailbox();
  const { get, post } = await setup(t, { owner: member, mailer: box });
  const signIn = async (agent) => {
    await post("/api/auth/link", { email: member });
    return {
      "User-Agent": agent,
      Cookie: sessionCookie(
        await post(
          "/api/auth/link/confirm",
          { token: tokenIn(box.sent.at(-1)) },
          { "User-Agent": agent },
        ),
      ),
    };
  };
  const mac = await signIn(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  );
  const phone = await signIn(
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
  );
  const third = await signIn("curl/8");
  const { sessions } = await (await get("/api/auth/sessions", mac)).json();
  assert.deepEqual(sessions.map((s) => s.label).sort(), [
    "A browser",
    "Chrome on Android",
    "Safari on Mac",
  ]);
  assert.equal(sessions.filter((s) => s.current).length, 1);
  const phoneId = sessions.find((s) => s.label === "Chrome on Android").id;
  const self = sessions.find((s) => s.current).id;
  assert.equal(
    (await post("/api/auth/session/end", { id: self }, mac)).status,
    400,
  );
  assert.equal(
    (await post("/api/auth/session/end", { id: phoneId }, mac)).status,
    200,
  );
  assert.equal((await get("/api/state", phone)).status, 401);
  assert.equal((await get("/api/state", third)).status, 200);
  const ended = await (
    await post("/api/auth/sessions/end-others", {}, mac)
  ).json();
  assert.equal(ended.ended, 1);
  assert.equal((await get("/api/state", third)).status, 401);
  assert.equal((await get("/api/state", mac)).status, 200);
});

test("an open server lets anyone make an account, which starts with no household", async (t) => {
  const box = mailbox();
  const { get, post } = await setup(t, { openSignup: true, mailer: box });
  await post("/api/auth/link", { email: "new@example.test" });
  assert.equal(box.sent.length, 1);
  const cookie = {
    Cookie: sessionCookie(
      await post("/api/auth/link/confirm", { token: tokenIn(box.sent[0]) }),
    ),
  };
  const state = await (await get("/api/state", cookie)).json();
  assert.equal(state.account.email, "new@example.test");
  assert.equal(state.account.household, null);
  assert.equal((await get("/api/auth/household/members", cookie)).status, 403);
  assert.equal(
    (await post("/api/auth/household/create", { name: " " }, cookie)).status,
    400,
  );
  assert.equal(
    (await post("/api/auth/household/create", { name: "Ours" }, cookie)).status,
    200,
  );
  assert.equal(
    (await (await get("/api/state", cookie)).json()).account.household.name,
    "Ours",
  );
});

test("the household list of earlier versions becomes the first household, once", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "kooks-accounts-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, "kooks.sqlite");
  // A database as earlier versions left it: accounts, a passkey and a
  // session for a member still on the list and one who was taken off, and
  // the phone's codes.
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE auth_accounts (email TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, signed_in_at TEXT);
    CREATE TABLE auth_passkeys (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, algorithm INTEGER NOT NULL, public_key TEXT NOT NULL, sign_count INTEGER NOT NULL, transports TEXT NOT NULL, backed_up INTEGER NOT NULL, created_at TEXT NOT NULL, used_at TEXT);
    CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, method TEXT NOT NULL, created_at TEXT NOT NULL, renewed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE auth_codes (email TEXT PRIMARY KEY, salt TEXT NOT NULL, code_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL);
  `);
  const now = Date.now();
  for (const email of [member, "gone@example.test"]) {
    old
      .prepare("INSERT INTO auth_accounts VALUES (?, ?, ?, NULL)")
      .run(email, `handle-${email}`, new Date(now).toISOString());
    old
      .prepare(
        "INSERT INTO auth_passkeys VALUES (?, ?, 'Phone', -7, '{}', 0, '[]', 0, ?, NULL)",
      )
      .run(`key-${email}`, email, new Date(now).toISOString());
  }
  const token = "a".repeat(64);
  old
    .prepare("INSERT INTO auth_sessions VALUES (?, ?, 'code', ?, ?, ?)")
    .run(
      createHash("sha256").update(token).digest("hex"),
      member,
      new Date(now).toISOString(),
      now,
      now + 10 * DAY,
    );
  old.close();

  const auth = createAuth({
    path,
    mailer: mailbox(),
    owner: "owner@example.test",
    members: [member, "baker@example.test"],
  });
  // The phone of a member who stays keeps its session, now in the first
  // household; whoever was off the list goes with their passkey.
  const session = auth.session(token);
  assert.equal(session.email, member);
  assert.equal(session.household, "home");
  const view = auth.accountView(session);
  assert.equal(view.household.name, "Our kitchen");
  assert.equal(view.household.members, 3);
  assert.equal(auth.passkeys(member).length, 1);
  assert.equal(auth.passkeys("gone@example.test").length, 0);
  assert.equal(auth.canSignIn("gone@example.test"), false);
  assert.deepEqual(
    auth.members(session).members.map((m) => [m.email, m.role]),
    [
      ["owner@example.test", "owner"],
      [member, "member"],
      ["baker@example.test", "member"],
    ],
  );
  auth.close();
  const tables = new DatabaseSync(path)
    .prepare("SELECT name FROM sqlite_master WHERE name = 'auth_codes'")
    .all();
  assert.deepEqual(tables, []);
  // Later starts leave the households as they are, whatever the old list
  // says; an owner whose account went gets it back.
  const again = createAuth({
    path,
    mailer: mailbox(),
    owner: "new-owner@example.test",
    members: ["someone@example.test"],
  });
  assert.equal(again.canSignIn("someone@example.test"), false);
  assert.equal(again.canSignIn("new-owner@example.test"), true);
  assert.equal(again.members(session).members.length, 3);
  again.close();
});

test("a kitchen at https://localhost is a browser's, not the phone app's", async (t) => {
  const box = mailbox();
  const { call, post } = await setup(t, {
    host: "0.0.0.0",
    publicOrigin: "https://localhost",
    members: [member],
    mailer: box,
  });
  const browser = { Host: "localhost", Origin: "https://localhost" };
  assert.equal(
    (await post("/api/auth/link", { email: member }, browser)).status,
    200,
  );
  const login = await post(
    "/api/auth/link/confirm",
    { token: tokenIn(box.sent[0]) },
    browser,
  );
  assert.equal(login.status, 200);
  const cookie = { Cookie: sessionCookie(login) };
  const state = await call("/api/state", {
    headers: { ...browser, ...cookie },
  });
  assert.equal(state.status, 200);
  assert.equal(state.headers["access-control-allow-origin"], undefined);
});

test("without sign-in, nothing is open to the phone app's origins", async (t) => {
  const { call, get } = await setup(t, { clientRoot: fakeBuild(t) });
  const app = { Origin: "capacitor://localhost" };
  const asked = await call("/api/state", { method: "OPTIONS", headers: app });
  assert.equal(asked.headers["access-control-allow-origin"], undefined);
  const state = await get("/api/state", app);
  assert.equal(state.headers["access-control-allow-origin"], undefined);
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

// Sends the request line and headers, then whatever body has been written;
// resolves with the status as soon as the server answers.
function openRequest(origin, path, headers, firstBytes = "") {
  const { hostname, port } = new URL(origin);
  const socket = net.connect(Number(port), hostname);
  const status = new Promise((resolve, reject) => {
    socket.once("data", (chunk) =>
      resolve(Number(chunk.toString().split(" ")[1])),
    );
    socket.on("error", reject);
  });
  socket.write(
    `POST ${path} HTTP/1.1\r\n${Object.entries({
      Host: `${hostname}:${port}`,
      Origin: origin,
      "Content-Type": "application/json",
      ...headers,
    })
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n")}\r\n\r\n${firstBytes}`,
  );
  return { socket, status };
}

test("request bodies are limited per route, and large uploads take turns", async (t) => {
  const box = mailbox();
  const signIn = await setup(t, { members: [member], mailer: box });
  // Before anyone signs in, a sign-in request may carry a few kilobytes: a
  // declared 50 MB body is refused before it is read...
  const declared = openRequest(
    signIn.origin,
    "/api/auth/link",
    { "Content-Length": 50 * 1024 * 1024 },
    '{"email":',
  );
  assert.equal(await declared.status, 413);
  declared.socket.destroy();
  // ...and an undeclared one as soon as it outgrows the limit.
  const streamed = await fetch(`${signIn.origin}/api/auth/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: signIn.origin },
    body: `{"email":"${"a".repeat(100 * 1024)}"}`,
  });
  assert.equal(streamed.status, 413);
  assert.equal((await streamed.json()).error, "TOO_LARGE");
  assert.equal(box.sent.length, 0);
  assert.equal(
    (await signIn.post("/api/auth/link", { email: member })).status,
    200,
  );

  const { origin, post } = await setup(t);
  const recipe = (size) =>
    post("/api/tools/recipe_save", {
      request_id: `long-${size}`,
      recipe: { title: "Long", original_text: "x".repeat(size) },
    });
  // Ordinary actions get room for the longest recipe text the schema takes.
  assert.equal((await recipe(200000)).status, 200);
  assert.equal((await recipe(3 * 1024 * 1024)).status, 413);
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.alloc(3 * 1024 * 1024, 32),
  ]);
  const book = await post("/api/tools/asset_save", {
    request_id: "large-book",
    file: {
      name: "book.pdf",
      mime_type: "application/pdf",
      base64: pdf.toString("base64"),
    },
  });
  assert.equal(book.status, 200);
  // Two uploads in flight hold both turns; a third waits for one to end.
  const pending = [0, 1].map(() =>
    openRequest(origin, "/api/tools/asset_save", {
      "Content-Length": 1024 * 1024,
    }),
  );
  const probe = () =>
    post("/api/tools/asset_save", { request_id: "probe", file: {} });
  let busy;
  for (let tries = 0; tries < 100; tries++) {
    busy = await probe();
    if (busy.status === 429) break;
    assert.equal(busy.status, 400);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).error, "BUSY");
  // Ordinary actions are not held up.
  assert.equal((await recipe(10)).status, 200);
  for (const { socket } of pending) socket.destroy();
  let free;
  for (let tries = 0; tries < 100; tries++) {
    free = await probe();
    if (free.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(free.status, 400, "abandoned uploads give their turns back");
  // A malformed escape in a path is simply not found.
  assert.equal((await fetch(`${origin}/api/assets/%E0%A4%A`)).status, 404);
  assert.equal((await post("/api/tools/%E0%A4%A", {})).status, 404);
});

test("sign-in link requests get the same immediate answer for members and strangers, who cannot spend the members' email budget", async (t) => {
  const publicOrigin = "https://kooks.example";
  // A mail server that has not answered yet: the reply must not wait for it.
  const pending = [];
  const slow = {
    description: "to a slow mail server",
    send: (message) =>
      new Promise((resolve) => pending.push({ message, resolve })),
  };
  const { post } = await setup(t, {
    host: "0.0.0.0",
    publicOrigin,
    members: [member],
    mailer: slow,
  });
  const from = (client) => ({
    Host: "kooks.example",
    Origin: publicOrigin,
    "X-Forwarded-For": client,
  });
  const ask = async (email, client) => {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("no answer")), 2000).unref(),
    );
    const response = await Promise.race([
      post("/api/auth/link", { email }, from(client)),
      timeout,
    ]);
    return { status: response.status, body: await response.json() };
  };
  const answer = await ask(member, "198.51.100.1");
  assert.deepEqual(answer, { status: 200, body: { ok: true } });
  assert.equal(pending.length, 1, "the member's email is on its way");
  assert.deepEqual(await ask("stranger@example.test", "198.51.100.1"), answer);
  pending[0].resolve();
  // Strangers from many addresses used to spend the hourly budget of 100
  // and lock members out of email links.
  for (let client = 0; client < 12; client++)
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await ask(`guess${client}-${i}@example.test`, `203.0.113.${client}`))
          .status,
        200,
      );
  assert.equal((await ask(member, "198.51.100.2")).status, 200);
  assert.equal(pending.length, 2);
  assert.match(
    pending[1].message.text,
    /https:\/\/kooks\.example\/#\/signin\//,
  );
});

test("the app is served at / from its build folder and nothing outside it, and /next/ leads there", async (t) => {
  const build = fakeBuild(t, {});
  writeFileSync(join(build, "..", "secret.json"), '{"secret":true}');
  const { origin } = await setup(t, { clientRoot: build });
  // Raw requests, so the paths reach the server exactly as written.
  const { hostname, port } = new URL(origin);
  const get = (path, headers = {}) =>
    new Promise((resolve, reject) =>
      http
        .get({ hostname, port, path, headers }, (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body,
            }),
          );
        })
        .on("error", reject),
    );

  const unbuilt = await get("/");
  assert.equal(unbuilt.status, 404);
  assert.match(JSON.parse(unbuilt.body).message, /npm run build:client/);

  mkdirSync(join(build, "assets"), { recursive: true });
  writeFileSync(
    join(build, "index.html"),
    "<!doctype html><title>Kooks</title>",
  );
  writeFileSync(
    join(build, "assets", "index-Ab12.js"),
    `export const words = ${JSON.stringify("kooks ".repeat(1000))};`,
  );
  writeFileSync(join(build, "notes.txt"), "not a served type");

  const page = await get("/");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.equal(page.headers["cache-control"], "no-cache");
  assert.match(page.headers["content-security-policy"], /script-src 'self'/);
  assert.match(page.body, /<title>Kooks<\/title>/);
  assert.equal((await get("/index.html")).body, page.body);

  const script = await get("/assets/index-Ab12.js");
  assert.equal(script.status, 200);
  assert.match(script.headers["content-type"], /^text\/javascript/);
  assert.equal(
    script.headers["cache-control"],
    "public, max-age=31536000, immutable",
  );
  const packed = await get("/assets/index-Ab12.js", {
    "Accept-Encoding": "br",
  });
  assert.equal(packed.headers["content-encoding"], "br");
  assert.ok(Number(packed.headers["content-length"]) < 1000);
  const again = await get("/", { "If-None-Match": page.headers.etag });
  assert.equal(again.status, 304);

  // Addresses from when the app was tried out at /next/ lead to the same
  // file; a page's own address after # is kept by the browser.
  for (const [from, to] of [
    ["/next", "/"],
    ["/next/", "/"],
    ["/next/assets/index-Ab12.js", "/assets/index-Ab12.js"],
  ]) {
    const moved = await get(from);
    assert.equal(moved.status, 308, from);
    assert.equal(moved.headers.location, to, from);
  }
  assert.equal((await get("/nextdoor.js")).status, 404);

  assert.equal((await get("/notes.txt")).status, 404);
  assert.equal((await get("/assets/missing.js")).status, 404);
  for (const path of [
    "/../secret.json",
    "/%2e%2e/secret.json",
    "/..%2fsecret.json",
    "/..%5csecret.json",
    "/assets/../../secret.json",
    "/next/../secret.json",
  ]) {
    const response = await get(path);
    assert.notEqual(response.status, 200, path);
    assert.doesNotMatch(response.body, /secret/, path);
  }
});

test("recipe pages are read two at a time, and a few dozen an hour from one address", async (t) => {
  let started = 0;
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { post } = await setup(t, {
    clientRoot: fakeBuild(t),
    toolOptions: {
      readPage: async (url) => {
        started++;
        await held;
        return {
          url,
          html: '<script type="application/ld+json">{"@type":"Recipe","name":"Toast"}</script>',
        };
      },
    },
  });
  const read = (n) =>
    post("/api/tools/recipe_import_link", {
      request_id: `read-${n}`,
      url: `https://recipes.example/${n}`,
    });
  const first = [read(1), read(2)];
  while (started < 2) await new Promise((resolve) => setImmediate(resolve));
  const third = await read(3);
  assert.equal(third.status, 429);
  assert.equal(third.json().error, "BUSY");
  release();
  for (const response of await Promise.all(first)) {
    assert.equal(response.status, 200);
    assert.equal(response.json().record.data.recipe.title, "Toast");
  }
  // Thirty an hour from one address, the refused one included.
  for (let n = 4; n <= 30; n++) assert.equal((await read(n)).status, 200);
  const over = await read(31);
  assert.equal(over.status, 429);
  assert.equal(over.json().error, "RATE_LIMITED");
});

test("the assistant answers in lines of JSON, one question at a time per member, and only with a key", async (t) => {
  const question = {
    today: "2026-10-30",
    messages: [{ role: "user", text: "What can we make tonight?" }],
  };
  const off = await setup(t, { clientRoot: fakeBuild(t) });
  assert.equal((await off.get("/api/state")).json().assistant, false);
  const missing = await off.post("/api/assistant", question);
  assert.equal(missing.status, 404);
  assert.equal(missing.json().error, "ASSISTANT_OFF");

  let release;
  const held = new Promise((resolve) => (release = resolve));
  const client = fakeClaude([
    async () => {
      await held;
      return says("Toast, with what you have.");
    },
  ]);
  const on = await setup(t, {
    clientRoot: fakeBuild(t),
    assistantOptions: { client },
  });
  assert.equal((await on.get("/api/state")).json().assistant, true);
  const first = on.post("/api/assistant", question);
  while (!client.calls.length)
    await new Promise((resolve) => setImmediate(resolve));
  const busy = await on.post("/api/assistant", question);
  assert.equal(busy.status, 429);
  assert.equal(busy.json().error, "BUSY");
  release();
  const answered = await first;
  assert.equal(answered.status, 200);
  assert.match(answered.headers["content-type"], /^application\/x-ndjson/);
  assert.equal(answered.headers["cache-control"], "no-store");
  assert.deepEqual(
    answered
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [
      { step: "Thinking" },
      { answer: { reply: "Toast, with what you have.", proposals: [] } },
    ],
  );
  // A failure after the answer has begun arrives as its last line.
  const failed = await on.post("/api/assistant", question);
  assert.deepEqual(
    failed
      .text()
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l)),
    [
      { step: "Thinking" },
      { error: "Kooks couldn’t answer just now. Try again in a moment." },
    ],
  );
  for (const input of [
    { ...question, messages: [] },
    {
      ...question,
      messages: [...question.messages, { role: "assistant", text: "Hm" }],
    },
    {
      ...question,
      messages: [{ role: "user", text: "x".repeat(4001) }],
    },
    { ...question, today: "tomorrow" },
  ]) {
    const refused = await on.post("/api/assistant", input);
    assert.equal(refused.status, 400);
    assert.equal(refused.json().error, "INVALID_INPUT");
  }
  // Another site cannot ask on a member's behalf.
  const elsewhere = await on.post("/api/assistant", question, {
    Origin: "https://elsewhere.example",
  });
  assert.equal(elsewhere.status, 403);
  assert.equal(client.calls.length, 2);
});
