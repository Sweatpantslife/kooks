import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appStoreToken,
  bundleId,
  certificateMatchesKey,
  certificatePem,
  exportOptions,
  pem,
  prepare,
  profileDetails,
  projectFile,
  withManualSigning,
} from "../scripts/ios-signing.mjs";

const pemKey = (key) => key.export({ type: "pkcs8", format: "pem" });
const apiKey = pemKey(
  generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey,
);
const rsa = () =>
  pemKey(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey);
const certificateKey = rsa();

// A self-signed certificate for a key, as base64 DER the way App Store
// Connect returns certificateContent; null without openssl.
function certificateFor(key) {
  const folder = mkdtempSync(join(tmpdir(), "kooks-ios-"));
  try {
    const keyFile = join(folder, "key.pem");
    writeFileSync(keyFile, key, { mode: 0o600 });
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-new",
        "-key",
        keyFile,
        "-subj",
        "/CN=Test",
        "-days",
        "1",
        "-outform",
        "DER",
      ],
      { maxBuffer: 1 << 20 },
    );
    return result.status === 0 ? result.stdout.toString("base64") : null;
  } catch {
    return null;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const plist = ({ team = "TEAM123456", uuid = "1111-2222", name } = {}) =>
  Buffer.concat([
    Buffer.from([0x30, 0x80, 0x06, 0x09, 0xff, 0x00]),
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Name</key><string>${name}</string>
<key>TeamIdentifier</key>
<array>
  <string>${team}</string>
</array>
<key>UUID</key><string>${uuid}</string>
</dict></plist>`),
    Buffer.from([0x00, 0xa0, 0x82, 0xfe]),
  ]);

test("the App Store Connect token is an ES256 JWT for the API key", () => {
  const now = Date.UTC(2026, 10, 1, 12);
  const token = appStoreToken(
    { keyId: "ABC123", issuerId: "issuer-uuid", privateKey: apiKey },
    now,
  );
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "ES256",
    kid: "ABC123",
    typ: "JWT",
  });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), {
    iss: "issuer-uuid",
    iat: now / 1000,
    exp: now / 1000 + 900,
    aud: "appstoreconnect-v1",
  });
  // ES256 signatures are the raw 64-byte r and s, not DER.
  assert.equal(Buffer.from(signature, "base64url").length, 64);
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: createPublicKey(apiKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  );
});

test("a key pasted without its line breaks is put back together", () => {
  const flat = apiKey.replace(/\n/g, " ");
  assert.equal(pem(flat, "key"), apiKey);
  assert.equal(pem(apiKey.replace(/\n/g, "\\n"), "key"), apiKey);
  assert.throws(() => pem("AuthKey_ABC123.p8", "The key"), /PEM block/);
});

test("a certificate is recognised by the key it was made from", (t) => {
  const content = certificateFor(certificateKey);
  if (!content) return t.skip("openssl is not available");
  assert.ok(certificateMatchesKey(content, certificateKey));
  assert.ok(!certificateMatchesKey(content, rsa()));
  assert.match(certificatePem(content), /^-----BEGIN CERTIFICATE-----\n/);
});

test("the profile's team, UUID and name are read from its plist", () => {
  assert.deepEqual(profileDetails(plist({ name: "Kooks App Store 01" })), {
    team: "TEAM123456",
    uuid: "1111-2222",
    name: "Kooks App Store 01",
  });
  assert.throws(() => profileDetails(Buffer.from("not a profile")), /team/);
});

test("the export options sign for App Store Connect with the profile", () => {
  const options = exportOptions({ team: "TEAM123456", profileName: "A & B" });
  assert.match(options, /<key>method<\/key>\s*<string>app-store-connect</);
  assert.match(options, /<key>signingStyle<\/key>\s*<string>manual</);
  assert.match(options, /<key>teamID<\/key>\s*<string>TEAM123456</);
  assert.match(
    options,
    new RegExp(`<key>${bundleId}</key>\\s*<string>A &amp; B</string>`),
  );
});

test("manual signing changes only the App target's configurations", () => {
  const before = readFileSync(
    new URL(`../${projectFile}`, import.meta.url),
    "utf8",
  );
  const after = withManualSigning(before, {
    team: "TEAM123456",
    profileName: "Kooks App Store 01",
  });
  const blocks = (text) =>
    [...text.matchAll(/isa = XCBuildConfiguration;[\s\S]*?\n\t\t\};/g)].map(
      (match) => match[0],
    );
  const changed = blocks(after).filter(
    (block, index) => block !== blocks(before)[index],
  );
  assert.equal(blocks(after).length, blocks(before).length);
  assert.equal(changed.length, 2);
  for (const block of changed) {
    assert.match(block, new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`));
    assert.match(block, /\n\t\t\t\tCODE_SIGN_STYLE = Manual;\n/);
    assert.match(block, /\n\t\t\t\tDEVELOPMENT_TEAM = "TEAM123456";\n/);
    assert.match(
      block,
      /\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "Kooks App Store 01";\n/,
    );
    assert.match(
      block,
      /\n\t\t\t\tCODE_SIGN_IDENTITY = "Apple Distribution";\n/,
    );
    assert.doesNotMatch(block, /CODE_SIGN_STYLE = Automatic/);
  }
  // Running it twice changes nothing more.
  assert.equal(
    withManualSigning(after, {
      team: "TEAM123456",
      profileName: "Kooks App Store 01",
    }),
    after,
  );
  assert.throws(
    () =>
      withManualSigning("isa = PBXProject;", { team: "T", profileName: "P" }),
    /No build configuration/,
  );
});

// A stand-in for App Store Connect that keeps what was asked of it.
function fakeAppStore({
  bundles = [],
  apps = [{ id: "A-1", attributes: { bundleId } }],
  certificates = [],
  profiles = [],
  created,
}) {
  const calls = [];
  const reply = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });
  const fetch = async (url, init) => {
    const path = new URL(url).pathname.replace("/v1", "");
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, url: String(url), body });
    assert.match(init.headers.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    if (method === "GET" && path === "/bundleIds")
      return reply(200, { data: bundles });
    if (method === "POST" && path === "/bundleIds")
      return reply(201, {
        data: { id: "B-new", attributes: body.data.attributes },
      });
    if (method === "GET" && path === "/apps") return reply(200, { data: apps });
    if (method === "GET" && path === "/certificates")
      return reply(200, { data: certificates });
    if (method === "POST" && path === "/certificates")
      return created
        ? reply(201, { data: created })
        : reply(409, {
            errors: [
              {
                detail:
                  "You already have a current Distribution certificate or a pending certificate request.",
              },
            ],
          });
    if (method === "GET" && path === "/profiles")
      return reply(200, { data: profiles });
    if (method === "DELETE" && path.startsWith("/profiles/")) return reply(204);
    if (method === "POST" && path === "/profiles")
      return reply(201, {
        data: {
          id: "P-new",
          attributes: {
            ...body.data.attributes,
            profileState: "ACTIVE",
            profileContent: plist({ name: body.data.attributes.name }).toString(
              "base64",
            ),
          },
        },
      });
    return reply(404, { errors: [{ detail: `Nothing at ${method} ${path}` }] });
  };
  return { calls, fetch };
}

const env = {
  APP_STORE_CONNECT_ISSUER_ID: "issuer-uuid",
  APP_STORE_CONNECT_KEY_ID: "ABC123",
  APP_STORE_CONNECT_PRIVATE_KEY: apiKey,
  KOOKS_IOS_CERTIFICATE_KEY: certificateKey,
};
const now = Date.UTC(2026, 10, 1);
const later = new Date(now + 300 * 24 * 60 * 60 * 1000).toISOString();

async function withFake(fake, run) {
  const original = globalThis.fetch;
  const folder = mkdtempSync(join(tmpdir(), "kooks-ios-"));
  globalThis.fetch = fake.fetch;
  try {
    return await run(folder);
  } finally {
    globalThis.fetch = original;
    rmSync(folder, { recursive: true, force: true });
  }
}

test("a later release reuses the certificate and profile it finds", async (t) => {
  const content = certificateFor(certificateKey);
  if (!content) return t.skip("openssl is not available");
  const other = certificateFor(rsa());
  const name = "Kooks App Store 5A";
  const fake = fakeAppStore({
    bundles: [
      { id: "B-other", attributes: { identifier: `${bundleId}.widget` } },
      { id: "B-1", attributes: { identifier: bundleId } },
    ],
    certificates: [
      {
        id: "C-other",
        attributes: {
          certificateContent: other,
          expirationDate: later,
          serialNumber: "77",
        },
      },
      {
        id: "C-1",
        attributes: {
          certificateContent: content,
          expirationDate: later,
          serialNumber: "5A",
        },
      },
    ],
    profiles: [
      {
        id: "P-1",
        attributes: {
          name,
          profileState: "ACTIVE",
          expirationDate: later,
          profileContent: plist({ name, uuid: "abc" }).toString("base64"),
        },
      },
    ],
  });
  await withFake(fake, async (folder) => {
    const result = await prepare(folder, env, now);
    assert.deepEqual(result, {
      team: "TEAM123456",
      profileName: name,
      profileUuid: "abc",
      certificateExpires: later,
    });
    assert.deepEqual(
      fake.calls.map((call) => `${call.method} ${call.path}`),
      ["GET /bundleIds", "GET /apps", "GET /certificates", "GET /profiles"],
    );
    assert.equal(
      new URL(fake.calls[3].url).searchParams.get("filter[name]"),
      name,
    );
    assert.equal(
      statSync(join(folder, "certificate-key.pem")).mode & 0o777,
      0o600,
    );
    assert.equal(
      readFileSync(join(folder, "private_keys", "AuthKey_ABC123.p8"), "utf8"),
      apiKey,
    );
    assert.match(
      readFileSync(join(folder, "ExportOptions.plist"), "utf8"),
      /Kooks App Store 5A/,
    );
    assert.match(
      readFileSync(join(folder, "certificate.pem"), "utf8"),
      /BEGIN CERTIFICATE/,
    );
  });
});

test("the first release registers the app and makes its certificate and profile", async (t) => {
  const content = certificateFor(certificateKey);
  if (!content) return t.skip("openssl is not available");
  const fake = fakeAppStore({
    certificates: [
      // Expired, so not used even though it matches.
      {
        id: "C-old",
        attributes: {
          certificateContent: content,
          expirationDate: new Date(now - 1000).toISOString(),
          serialNumber: "01",
        },
      },
    ],
    profiles: [
      {
        id: "P-stale",
        attributes: {
          name: "Kooks App Store 9B",
          profileState: "INVALID",
          expirationDate: later,
        },
      },
    ],
    created: {
      id: "C-new",
      attributes: {
        certificateContent: content,
        expirationDate: later,
        serialNumber: "9B",
      },
    },
  });
  await withFake(fake, async (folder) => {
    const result = await prepare(folder, env, now);
    assert.equal(result.profileName, "Kooks App Store 9B");
    assert.deepEqual(
      fake.calls.map((call) => `${call.method} ${call.path}`),
      [
        "GET /bundleIds",
        "POST /bundleIds",
        "GET /apps",
        "GET /certificates",
        "POST /certificates",
        "GET /profiles",
        "DELETE /profiles/P-stale",
        "POST /profiles",
      ],
    );
    assert.deepEqual(fake.calls[1].body.data.attributes, {
      identifier: bundleId,
      name: "Kooks",
      platform: "IOS",
    });
    const csr = fake.calls[4].body.data.attributes;
    assert.equal(csr.certificateType, "DISTRIBUTION");
    assert.match(csr.csrContent, /^-----BEGIN CERTIFICATE REQUEST-----/);
    assert.deepEqual(fake.calls[7].body.data.relationships, {
      bundleId: { data: { type: "bundleIds", id: "B-new" } },
      certificates: { data: [{ type: "certificates", id: "C-new" }] },
    });
    assert.equal(
      fake.calls[7].body.data.attributes.profileType,
      "IOS_APP_STORE",
    );
  });
});

test("a missing App Store Connect app stops the release before the build", async () => {
  const fake = fakeAppStore({
    bundles: [{ id: "B-1", attributes: { identifier: bundleId } }],
    apps: [{ id: "A-2", attributes: { bundleId: `${bundleId}.other` } }],
  });
  await withFake(fake, async (folder) => {
    await assert.rejects(
      prepare(folder, env, now),
      /App Store Connect has no app for app\.kooks\.household yet\. In App Store Connect, open Apps, choose \+ › New App/,
    );
    assert.deepEqual(
      fake.calls.map((call) => `${call.method} ${call.path}`),
      ["GET /bundleIds", "GET /apps"],
    );
  });
});

test("a team with no room for another certificate is told how to make room", async (t) => {
  if (!certificateFor(certificateKey))
    return t.skip("openssl is not available");
  const fake = fakeAppStore({
    bundles: [{ id: "B-1", attributes: { identifier: bundleId } }],
  });
  await withFake(fake, async (folder) => {
    await assert.rejects(
      prepare(folder, env, now),
      /POST \/certificates failed \(409\)\. You already have a current Distribution certificate[^]*revoke one it no longer uses in Certificates, Identifiers & Profiles/,
    );
  });
});

test("missing secrets and refusals from Apple say what to do", async () => {
  await assert.rejects(
    prepare("/nowhere", { APP_STORE_CONNECT_KEY_ID: "ABC123" }, now),
    /Missing APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_PRIVATE_KEY, KOOKS_IOS_CERTIFICATE_KEY\. scripts\/ios-release-key\.sh/,
  );
  const refusing = {
    calls: [],
    fetch: async () =>
      new Response(
        JSON.stringify({
          errors: [
            { detail: "Authentication credentials are missing or invalid." },
          ],
        }),
        {
          status: 401,
        },
      ),
  };
  await withFake(refusing, async (folder) => {
    await assert.rejects(
      prepare(folder, env, now),
      /GET \/bundleIds failed \(401\)\. Authentication credentials are missing or invalid\. Check the APP_STORE_CONNECT_ISSUER_ID/,
    );
  });
});
