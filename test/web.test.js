import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../mcp/store.js";
import { createWebServer } from "../web/server.js";
import { embedOrigins } from "../shared/links.js";
import { createAuthenticator } from "./helpers/authenticator.js";
import { fakeBuild } from "./helpers/build.js";

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
              headers: response.headers,
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
  assert.match(login.cookie, /SameSite=Strict; Path=\/; Max-Age=2592000$/);
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
  const household = new Set([member, "second@example.test"]);
  let clock = Date.now();
  const { origin, get, post } = await setup(t, {
    members: household,
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
  // Leaving the household ends the session on its next request.
  household.delete(member);
  assert.equal((await get("/api/state", { Cookie: fresh })).status, 401);
  assert.equal((await post("/api/auth/link", { email: member })).status, 200);
  assert.equal(box.sent.length, 3);
});

const codeIn = (message) => message.text.match(/\b(\d{6})\b/)[1];

test("the phone app signs in with an emailed code and sends a device token, across origins to the API only", async (t) => {
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
  // Links and passkeys are the browser's, whatever token comes with them.
  const madeUp = { ...app, Authorization: `Bearer ${"0".repeat(64)}` };
  for (const path of [
    "link",
    "link/confirm",
    "passkey/options",
    "passkey/signin",
    "passkey/register/options",
    "passkey/register",
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

  assert.equal(
    (await post("/api/auth/code", { email: "stranger@example.test" }, app))
      .status,
    200,
  );
  assert.equal(box.sent.length, 0);
  assert.equal(
    (await post("/api/auth/code", { email: member }, app)).status,
    200,
  );
  assert.match(box.sent[0].subject, /^Your Kooks code: \d{6}$/);
  const code = codeIn(box.sent[0]);
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  const confirm = (guess, from = {}) =>
    post(
      "/api/auth/code/confirm",
      { email: member, code: guess },
      { ...app, ...from },
    );
  const missed = await confirm(wrong);
  assert.equal(missed.status, 400);
  assert.equal((await missed.json()).error, "CODE_INVALID");
  const signed = await confirm(`${code.slice(0, 3)} ${code.slice(3)}`);
  assert.equal(signed.status, 200);
  assert.equal(signed.cookie, null, "the device keeps a token, not a cookie");
  const { token, account } = await signed.json();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.deepEqual(account, { email: member, method: "code" });
  assert.equal((await confirm(code)).status, 400, "a code works once");

  const device = { ...app, Authorization: `Bearer ${token}` };
  const state = await get("/api/state", device);
  assert.equal(state.status, 200);
  assert.deepEqual((await state.json()).account, account);
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

  // Five wrong guesses spend a code, and codes expire.
  await post("/api/auth/code", { email: member }, app);
  const second = codeIn(box.sent[1]);
  for (let i = 0; i < 5; i++)
    assert.equal((await confirm("000000")).status, 400);
  assert.equal((await confirm(second)).status, 400);
  await post("/api/auth/code", { email: member }, app);
  clock += 10 * 60 * 1000 + 1;
  assert.equal((await confirm(codeIn(box.sent[2]))).status, 400);
  // However many codes are asked for, and from wherever, an address takes
  // twenty wrong guesses a day; eight so far, since the right one.
  const from = (i) => ({ "X-Forwarded-For": `198.51.100.${i}` });
  for (let i = 0; i < 12; i++)
    assert.equal((await confirm("000000", from(i))).status, 400);
  await post("/api/auth/code", { email: member }, app);
  const capped = await confirm(codeIn(box.sent[3]), from(99));
  assert.equal(capped.status, 429);
  assert.equal((await capped.json()).error, "RATE_LIMITED");

  const out = await post("/api/auth/signout", {}, device);
  assert.equal(out.status, 200);
  assert.equal(out.cookie, null);
  assert.equal((await get("/api/state", device)).status, 401);
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
