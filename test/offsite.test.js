import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { createWebServer } from "../web/server.js";
import {
  backupSettings,
  checkCopy,
  createBackups,
  findCopy,
  sendCopy,
  takeCopy,
} from "../web/backups.js";
import {
  OffsiteError,
  fetchCopy,
  offsiteLabel,
  offsiteSettings,
  pushCopy,
  remoteCopies,
  signRequest,
} from "../web/offsite.js";

const HOUR = 3600000;
const quiet = { log() {}, error() {} };
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

test("requests are signed as the AWS SDK signs them", () => {
  // Signatures computed with botocore 1.43's S3SigV4Auth for the same
  // requests, key and time.
  const key = {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    now: Date.parse("2026-11-01T03:00:00Z"),
  };
  const empty = sha256("");
  for (const [method, url, region, payloadHash, signature] of [
    [
      "PUT",
      "https://kooks-backups.s3.eu-central-1.amazonaws.com/kooks/2026-11-01T03-00-00Z/kooks.sqlite.gz",
      "eu-central-1",
      sha256("gzip bytes"),
      "2da594c5c21a696cbb128eca6ed9190554a53260c9e99dbb555247493d71a8df",
    ],
    [
      "PUT",
      "https://abc123.r2.cloudflarestorage.com/kooks-backups/kitchen%20one/2026-11-01T03-00-00Z/households/0123456789abcdef.sqlite.gz",
      "auto",
      empty,
      "d3f5016692482c45e99b8d0c468842dc7e2d9c1813c590669d5767e9c71d386d",
    ],
    [
      "GET",
      "https://abc123.r2.cloudflarestorage.com/kooks-backups?list-type=2&prefix=kooks%2F&delimiter=%2F",
      "auto",
      empty,
      "288b4c8521cd9624a5885df181aa99278b3f73071f820ea964b1f00776f81276",
    ],
    [
      "GET",
      "https://s3.example.test:9000/bucket/kooks/2026-11-01T03-00-00Z/manifest.json",
      "us-east-1",
      empty,
      "9ce2e41ee5afa5aa8192ba9a8245c709a9fbad3c1bb8497382370297097f0850",
    ],
  ]) {
    const headers = signRequest({ method, url, region, payloadHash, ...key });
    assert.equal(
      headers.authorization,
      `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261101/${region}/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      url,
    );
    assert.equal(headers["x-amz-date"], "20261101T030000Z");
    assert.equal(headers["x-amz-content-sha256"], payloadHash);
  }
});

test("off-site settings need all three of address, key id and secret, and check them", () => {
  const key = {
    KOOKS_BACKUP_S3_ACCESS_KEY_ID: "id",
    KOOKS_BACKUP_S3_SECRET_ACCESS_KEY: "secret",
  };
  assert.equal(offsiteSettings({}), null);
  assert.throws(
    () =>
      offsiteSettings({
        KOOKS_BACKUP_S3_URL: "https://b.s3.eu-west-1.amazonaws.com",
      }),
    /KOOKS_BACKUP_S3_ACCESS_KEY_ID and KOOKS_BACKUP_S3_SECRET_ACCESS_KEY are missing/,
  );
  assert.throws(
    () => offsiteSettings({ ...key }),
    /KOOKS_BACKUP_S3_URL is missing/,
  );
  for (const url of [
    "http://bucket.example.com",
    "https://bucket.example.com/?x=1",
    "https://user:pass@bucket.example.com",
    "not a url",
  ])
    assert.throws(
      () => offsiteSettings({ KOOKS_BACKUP_S3_URL: url, ...key }),
      /KOOKS_BACKUP_S3_URL is the bucket's https address/,
      url,
    );
  const regions = Object.fromEntries(
    [
      "https://my-bucket.s3.eu-central-1.amazonaws.com",
      "https://s3.us-west-004.backblazeb2.com/my-bucket",
      "https://abc.r2.cloudflarestorage.com/my-bucket/",
      "http://127.0.0.1:9000/my-bucket",
    ].map((url) => [
      url,
      offsiteSettings({ KOOKS_BACKUP_S3_URL: url, ...key }).region,
    ]),
  );
  assert.deepEqual(Object.values(regions), [
    "eu-central-1",
    "us-west-004",
    "us-east-1",
    "us-east-1",
  ]);
  const r2 = offsiteSettings({
    KOOKS_BACKUP_S3_URL: "https://abc.r2.cloudflarestorage.com/my-bucket/",
    KOOKS_BACKUP_S3_REGION: "auto",
    KOOKS_BACKUP_S3_PREFIX: "home/kooks",
    ...key,
  });
  assert.equal(r2.url, "https://abc.r2.cloudflarestorage.com/my-bucket");
  assert.equal(r2.region, "auto");
  assert.equal(r2.prefix, "home/kooks/");
  assert.equal(
    offsiteLabel(r2),
    "abc.r2.cloudflarestorage.com/my-bucket/home/kooks/",
  );
  assert.throws(
    () =>
      offsiteSettings({
        KOOKS_BACKUP_S3_URL: "https://abc.r2.cloudflarestorage.com/b",
        KOOKS_BACKUP_S3_PREFIX: "/kooks",
        ...key,
      }),
    /KOOKS_BACKUP_S3_PREFIX is a folder/,
  );
  // Backups off means no off-site copies either; on, they come along.
  assert.equal(
    backupSettings(
      { KOOKS_BACKUPS: "off", KOOKS_BACKUP_S3_URL: "https://x.example" },
      "/data/kooks.sqlite",
    ),
    null,
  );
});

// A bucket that speaks enough of S3 for Kooks: it keeps objects in memory,
// refuses an upload whose body does not match its declared SHA-256, lists
// one folder a page, and fails the next few requests on request.
async function bucket(t) {
  const objects = new Map();
  const requests = [];
  let failures = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://bucket");
    requests.push({
      method: req.method,
      path: decodeURIComponent(url.pathname),
      authorization: req.headers.authorization,
    });
    const xml = (status, text) =>
      res.writeHead(status, { "content-type": "application/xml" }).end(text);
    if (failures > 0) {
      failures--;
      return xml(
        503,
        "<Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>",
      );
    }
    // The signature is checked against the request as it arrived, so what
    // Kooks signs is what it sends.
    const stamp = req.headers["x-amz-date"] ?? "";
    const expected = signRequest({
      method: req.method,
      url: `http://${req.headers.host}${req.url}`,
      payloadHash: req.headers["x-amz-content-sha256"],
      accessKeyId: "id",
      secretAccessKey: "secret",
      region: "us-east-1",
      now: Date.parse(
        stamp.replace(
          /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
          "$1-$2-$3T$4:$5:$6Z",
        ),
      ),
    }).authorization;
    if (req.headers.authorization !== expected)
      return xml(
        403,
        "<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error>",
      );
    const key = decodeURIComponent(url.pathname).replace(/^\/bucket\//, "");
    if (req.method === "PUT") {
      if (req.headers["x-amz-content-sha256"] !== sha256(body))
        return xml(
          400,
          "<Error><Code>XAmzContentSHA256Mismatch</Code></Error>",
        );
      objects.set(key, body);
      return res.writeHead(200).end();
    }
    if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix");
      const folders = [
        ...new Set(
          [...objects.keys()]
            .filter((k) => k.startsWith(prefix))
            .map((k) => `${prefix}${k.slice(prefix.length).split("/")[0]}/`),
        ),
      ].sort();
      const from = Number(url.searchParams.get("continuation-token") || 0);
      const more = from + 1 < folders.length;
      return xml(
        200,
        `<ListBucketResult><IsTruncated>${more}</IsTruncated>${folders
          .slice(from, from + 1)
          .map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`)
          .join(
            "",
          )}${more ? `<NextContinuationToken>${from + 1}</NextContinuationToken>` : ""}</ListBucketResult>`,
      );
    }
    if (req.method === "GET" && objects.has(key))
      return res.writeHead(200).end(objects.get(key));
    return xml(404, "<Error><Code>NoSuchKey</Code></Error>");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  return {
    objects,
    requests,
    fail(n) {
      failures = n;
    },
    env: {
      KOOKS_BACKUP_S3_URL: `http://127.0.0.1:${server.address().port}/bucket`,
      KOOKS_BACKUP_S3_ACCESS_KEY_ID: "id",
      KOOKS_BACKUP_S3_SECRET_ACCESS_KEY: "secret",
    },
  };
}

function kitchen(t, env) {
  const data = mkdtempSync(join(tmpdir(), "kooks-offsite-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const dbPath = join(data, "kooks.sqlite");
  const store = new Store(dbPath);
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  tools.get("recipe_save").execute({
    request_id: "save-soup",
    recipe: { title: "Soup", servings: 2 },
  });
  store.close();
  mkdirSync(join(data, "households"));
  new Store(join(data, "households", "0123456789abcdef.sqlite")).close();
  return { data, dbPath, settings: backupSettings(env, dbPath) };
}

test("a copy goes to the bucket whole, manifest last, and comes back checked", async (t) => {
  const remote = await bucket(t);
  const { dbPath, settings } = kitchen(t, remote.env);
  const taken = await takeCopy({ dbPath, dir: settings.dir, reserve: 0 });
  const copy = findCopy(settings.dir, taken.name);
  await pushCopy(settings.offsite, copy);
  assert.deepEqual(
    remote.requests.map((r) => `${r.method} ${r.path}`),
    [
      `PUT /bucket/kooks/${copy.name}/kooks.sqlite.gz`,
      `PUT /bucket/kooks/${copy.name}/households/0123456789abcdef.sqlite.gz`,
      `PUT /bucket/kooks/${copy.name}/manifest.json`,
    ],
  );
  assert.deepEqual(
    remote.objects.get(`kooks/${copy.name}/kooks.sqlite.gz`),
    readFileSync(join(copy.path, "kooks.sqlite.gz")),
  );
  await assert.rejects(
    pushCopy({ ...settings.offsite, secretAccessKey: "wrong" }, copy),
    /answered 403 SignatureDoesNotMatch: The request signature we calculated/,
  );

  // A recovery on a new volume: list, fetch, check.
  const elsewhere = mkdtempSync(join(tmpdir(), "kooks-offsite-new-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  await pushCopy(settings.offsite, { ...copy, name: "2026-10-30T03-00-00Z" });
  assert.deepEqual(await remoteCopies(settings.offsite), [
    copy.name,
    "2026-10-30T03-00-00Z",
  ]);
  await fetchCopy(settings.offsite, copy.name, elsewhere);
  const fetched = findCopy(elsewhere, copy.name);
  const checked = await checkCopy(fetched);
  assert.equal(checked.files.length, 2);
  await assert.rejects(
    fetchCopy(settings.offsite, copy.name, elsewhere),
    /There is a copy .* here already/,
  );
  await assert.rejects(
    fetchCopy(settings.offsite, "2026-01-01T00-00-00Z", elsewhere),
    (error) =>
      error instanceof OffsiteError &&
      /not in the bucket, or not whole \(127\.0\.0\.1:\d+ answered 404 NoSuchKey\)/.test(
        error.message,
      ),
  );
  await assert.rejects(
    fetchCopy(settings.offsite, "../../etc", elsewhere),
    /is not a copy's name/,
  );
});

test("a manifest that names other files is not fetched", async (t) => {
  const remote = await bucket(t);
  const { settings } = kitchen(t, remote.env);
  remote.objects.set(
    "kooks/2026-11-01T03-00-00Z/manifest.json",
    Buffer.from(JSON.stringify({ format: 1, files: [{ path: "../../x" }] })),
  );
  const elsewhere = mkdtempSync(join(tmpdir(), "kooks-offsite-new-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  await assert.rejects(
    fetchCopy(settings.offsite, "2026-11-01T03-00-00Z", elsewhere),
    /manifest lists unexpected files/,
  );
});

test("the schedule sends each copy off-site, keeps it when the bucket fails, and sends it later", async (t) => {
  const remote = await bucket(t);
  const { settings } = kitchen(t, {
    ...remote.env,
    KOOKS_BACKUP_PING_URL: "https://hc-ping.com/abc",
  });
  let now = Date.parse("2026-11-01T03:00:00Z");
  const pings = [];
  const backups = createBackups(settings, {
    now: () => now,
    log: quiet,
    ping: async (url) => pings.push(url),
    reserve: 0,
    inThread: false,
  });
  assert.equal(backups.health().offsite.late, false);

  const first = await backups.run();
  let health = backups.health();
  assert.equal(health.offsite.last_sent, first.name);
  assert.equal(health.offsite.failure, null);
  assert.deepEqual(pings, ["https://hc-ping.com/abc"]);
  assert.equal(backups.sendDue(), false);

  // The bucket is down for the next copy: it is kept here, and says so.
  now += 25 * HOUR;
  remote.fail(1);
  const second = await backups.run();
  health = backups.health();
  assert.equal(health.copies[0].name, second.name);
  assert.equal(health.offsite.last_sent, first.name);
  assert.match(
    health.offsite.failure.error,
    /answered 503 SlowDown: Please reduce your request rate\./,
  );
  assert.equal(health.offsite.failure.copy, second.name);
  assert.equal(pings.at(-1), "https://hc-ping.com/abc/fail");
  // Not again within the hour, then it goes.
  assert.equal(backups.sendDue(), false);
  now += HOUR;
  assert.equal(backups.sendDue(), true);
  assert.equal(await backups.resend(), true);
  health = backups.health();
  assert.equal(health.offsite.last_sent, second.name);
  assert.equal(health.offsite.failure, null);
  assert.equal(pings.at(-1), "https://hc-ping.com/abc");
  assert.ok(remote.objects.has(`kooks/${second.name}/manifest.json`));

  // Copies that stop reaching the bucket make the backups late.
  remote.fail(1000);
  now += 25 * HOUR;
  await backups.run();
  now += 12 * HOUR;
  health = backups.health();
  assert.equal(health.late, false);
  assert.equal(health.offsite.late, true);
  assert.equal(health.ok, false);
  backups.stop();

  // The script's way: sendCopy notes how it went too.
  remote.fail(0);
  const copy = findCopy(settings.dir, health.copies[0].name);
  await sendCopy(settings, copy, { now: () => now });
  assert.equal(
    createBackups(settings, { now: () => now, log: quiet }).health().offsite
      .last_sent,
    copy.name,
  );
});

test("whoever runs the server sees where copies go and when one didn't get there", async (t) => {
  const remote = await bucket(t);
  const { dbPath, settings } = kitchen(t, remote.env);
  let now = Date.parse("2026-11-01T03:00:00Z");
  const backups = createBackups(settings, {
    now: () => now,
    log: quiet,
    reserve: 0,
    inThread: false,
  });
  const store = new Store(dbPath);
  const server = createWebServer({ store, backups });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => {
    const response = await fetch(`${origin}${path}`);
    return { status: response.status, json: await response.json() };
  };
  remote.fail(1);
  await backups.run();
  const { offsite } = (await get("/api/backups")).json;
  assert.equal(
    offsite.to,
    `127.0.0.1:${new URL(remote.env.KOOKS_BACKUP_S3_URL).port}/bucket/kooks/`,
  );
  assert.equal(offsite.last_sent_at, null);
  assert.match(offsite.failure.error, /503 SlowDown/);
  assert.equal(JSON.stringify(offsite).includes("secret"), false);
  assert.equal((await get("/healthz/backups")).status, 200);
  // Copies keep coming, but none reaches the bucket for a day and a half.
  now += 25 * HOUR;
  remote.fail(1);
  await backups.run();
  now += 12 * HOUR;
  assert.equal(backups.health().late, false);
  assert.equal((await get("/healthz/backups")).status, 503);
});
