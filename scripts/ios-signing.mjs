import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Gets the iPhone app ready to sign for TestFlight on a Mac that has never
// seen the Apple account: the Phone release workflow runs it on a fresh
// GitHub runner. With the App Store Connect API key it finds (or registers)
// the app's bundle ID, finds the Apple Distribution certificate that belongs
// to the certificate key in KOOKS_IOS_CERTIFICATE_KEY (or creates it from that
// key), and finds (or creates) the App Store provisioning profile for both.
// The certificate's private key never goes to Apple; only a signing request
// made from it does, so every run signs with the same certificate and none
// piles up in the account. docs/native-app.md describes the whole release.
//
//   node scripts/ios-signing.mjs <folder>
//
// It writes the key, certificate, profile, API key and ExportOptions.plist to
// <folder> and switches the App target in the Xcode project to manual signing
// with that profile. The workflow then imports them into a temporary keychain
// and deletes the folder; the project change is never committed.

const root = new URL("../", import.meta.url);
export const bundleId = "app.kooks.household";
export const projectFile = "ios/App/App.xcodeproj/project.pbxproj";
const api = "https://api.appstoreconnect.apple.com/v1";
const day = 24 * 60 * 60 * 1000;

const base64url = (value) => Buffer.from(value).toString("base64url");

// A GitHub secret pasted through a browser sometimes loses its line breaks;
// a PEM block parses only with them, so put them back.
export function pem(text, what) {
  const value = String(text ?? "")
    .replace(/\\n/g, "\n")
    .trim();
  const match =
    /^-----BEGIN ([A-Z0-9 ]+)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----$/.exec(
      value,
    );
  if (!match)
    throw new Error(
      `${what} is not a PEM block: paste the whole file, from its BEGIN line to its END line.`,
    );
  const body = match[2]
    .replace(/\s+/g, "")
    .match(/.{1,64}/g)
    ?.join("\n");
  return `-----BEGIN ${match[1]}-----\n${body}\n-----END ${match[1]}-----\n`;
}

// App Store Connect takes a JSON Web Token signed with the API key, valid for
// at most 20 minutes.
export function appStoreToken(
  { keyId, issuerId, privateKey },
  now = Date.now(),
) {
  const issued = Math.floor(now / 1000);
  const input = `${base64url(
    JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
  )}.${base64url(
    JSON.stringify({
      iss: issuerId,
      iat: issued,
      exp: issued + 15 * 60,
      aud: "appstoreconnect-v1",
    }),
  )}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

// Whether a certificate from App Store Connect (base64 DER) holds the public
// half of this private key.
export function certificateMatchesKey(certificateContent, privateKey) {
  const der = (key) => key.export({ type: "spki", format: "der" });
  const certificate = new X509Certificate(
    Buffer.from(certificateContent, "base64"),
  );
  return der(certificate.publicKey).equals(
    der(createPublicKey(createPrivateKey(privateKey))),
  );
}

export function certificatePem(certificateContent) {
  return pem(
    `-----BEGIN CERTIFICATE-----\n${certificateContent}\n-----END CERTIFICATE-----`,
    "The certificate",
  );
}

// A .mobileprovision is a plist inside a signature that leaves it readable.
export function profileDetails(profile) {
  const text = Buffer.from(profile).toString("latin1");
  const plist = text.slice(
    text.indexOf("<?xml"),
    text.indexOf("</plist>") + "</plist>".length,
  );
  const value = (key, pattern) =>
    new RegExp(`<key>${key}</key>\\s*${pattern}`).exec(plist)?.[1];
  const details = {
    team: value("TeamIdentifier", "<array>\\s*<string>([^<]+)</string>"),
    uuid: value("UUID", "<string>([^<]+)</string>"),
    name: value("Name", "<string>([^<]+)</string>"),
  };
  if (!details.team || !details.uuid || !details.name)
    throw new Error("The provisioning profile has no team, UUID or name.");
  return details;
}

const xml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function exportOptions({ team, profileName }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>teamID</key>
  <string>${xml(team)}</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${bundleId}</key>
    <string>${xml(profileName)}</string>
  </dict>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
`;
}

// Switches only the App target to manual signing. Build settings given to
// xcodebuild would reach the Swift packages too, and a package's resource
// bundle refuses a provisioning profile.
export function withManualSigning(pbxproj, { team, profileName }) {
  let count = 0;
  const quoted = (value) => `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
  const next = pbxproj.replace(
    /(isa = XCBuildConfiguration;[\s\S]*?buildSettings = \{)([\s\S]*?)(\n(\t*)\};)/g,
    (block, head, settings, tail, indent) => {
      if (!settings.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`))
        return block;
      count += 1;
      const pad = `\n${indent}\t`;
      const kept = settings.replace(
        /\n\s*("?CODE_SIGN_IDENTITY(\[[^\]]*\])?"?|CODE_SIGN_STYLE|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER|PROVISIONING_PROFILE) = [^;]*;/g,
        "",
      );
      return `${head}${kept}${pad}CODE_SIGN_IDENTITY = "Apple Distribution";${pad}CODE_SIGN_STYLE = Manual;${pad}DEVELOPMENT_TEAM = ${quoted(team)};${pad}PROVISIONING_PROFILE_SPECIFIER = ${quoted(profileName)};${tail}`;
    },
  );
  if (!count)
    throw new Error(`No build configuration for ${bundleId} in the project.`);
  return next;
}

async function request(token, method, path, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (json.errors ?? [])
      .map((error) => error.detail || error.title)
      .join(" ");
    const hint =
      response.status === 401
        ? " Check the APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_KEY_ID and APP_STORE_CONNECT_PRIVATE_KEY secrets."
        : response.status === 403
          ? " The API key needs the App Manager or Admin role."
          : "";
    throw new Error(
      `App Store Connect: ${method} ${path.split("?")[0]} failed (${response.status}). ${detail}${hint}`,
    );
  }
  return json;
}

function signingRequest(keyFile) {
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-new",
      "-key",
      keyFile,
      "-subj",
      "/CN=Kooks/O=Kooks household",
      "-outform",
      "PEM",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      `openssl could not make a signing request: ${result.stderr}`,
    );
  return result.stdout;
}

export async function prepare(folder, env = process.env, now = Date.now()) {
  const missing = [
    "APP_STORE_CONNECT_ISSUER_ID",
    "APP_STORE_CONNECT_KEY_ID",
    "APP_STORE_CONNECT_PRIVATE_KEY",
    "KOOKS_IOS_CERTIFICATE_KEY",
  ].filter((name) => !env[name]?.trim());
  if (missing.length)
    throw new Error(
      `Missing ${missing.join(", ")}. scripts/ios-release-key.sh makes them (docs/native-app.md).`,
    );
  const keyId = env.APP_STORE_CONNECT_KEY_ID.trim();
  const apiKey = pem(
    env.APP_STORE_CONNECT_PRIVATE_KEY,
    "APP_STORE_CONNECT_PRIVATE_KEY",
  );
  const certificateKey = pem(
    env.KOOKS_IOS_CERTIFICATE_KEY,
    "KOOKS_IOS_CERTIFICATE_KEY",
  );
  const token = appStoreToken(
    {
      keyId,
      issuerId: env.APP_STORE_CONNECT_ISSUER_ID.trim(),
      privateKey: apiKey,
    },
    now,
  );
  mkdirSync(join(folder, "private_keys"), { recursive: true, mode: 0o700 });
  const keyFile = join(folder, "certificate-key.pem");
  writeFileSync(keyFile, certificateKey, { mode: 0o600 });
  // altool looks for the API key as ./private_keys/AuthKey_<id>.p8.
  writeFileSync(join(folder, "private_keys", `AuthKey_${keyId}.p8`), apiKey, {
    mode: 0o600,
  });

  const bundles = await request(
    token,
    "GET",
    `/bundleIds?filter[identifier]=${bundleId}&limit=200`,
  );
  let bundle = bundles.data.find(
    (item) => item.attributes.identifier === bundleId,
  );
  if (!bundle) {
    console.log(`Registering the bundle ID ${bundleId}.`);
    bundle = (
      await request(token, "POST", "/bundleIds", {
        data: {
          type: "bundleIds",
          attributes: { identifier: bundleId, name: "Kooks", platform: "IOS" },
        },
      })
    ).data;
  }

  // An upload needs the app's record in App Store Connect, which only a
  // person can create; say so before the build, not after it.
  const apps = await request(
    token,
    "GET",
    `/apps?filter[bundleId]=${bundleId}&limit=200`,
  );
  if (!apps.data.some((item) => item.attributes.bundleId === bundleId))
    throw new Error(
      `App Store Connect has no app for ${bundleId} yet. In App Store Connect, open Apps, choose + › New App, and pick the bundle ID ${bundleId} (docs/native-app.md, iPhone).`,
    );

  const fresh = (item) =>
    Date.parse(item.attributes.expirationDate) > now + day;
  const certificates = await request(
    token,
    "GET",
    "/certificates?filter[certificateType]=DISTRIBUTION&limit=200",
  );
  let certificate = certificates.data.find(
    (item) =>
      fresh(item) &&
      certificateMatchesKey(item.attributes.certificateContent, certificateKey),
  );
  if (!certificate) {
    console.log("Creating the Apple Distribution certificate from the key.");
    try {
      certificate = (
        await request(token, "POST", "/certificates", {
          data: {
            type: "certificates",
            attributes: {
              certificateType: "DISTRIBUTION",
              csrContent: signingRequest(keyFile),
            },
          },
        })
      ).data;
    } catch (error) {
      // Apple answers 409 when the team has as many as it may have.
      if (!(error instanceof Error) || !error.message.includes("(409)"))
        throw error;
      throw new Error(
        `${error.message} If the team already has as many Apple Distribution certificates as Apple allows, revoke one it no longer uses in Certificates, Identifiers & Profiles and run this again.`,
        { cause: error },
      );
    }
  }
  const serial = certificate.attributes.serialNumber || certificate.id;
  writeFileSync(
    join(folder, "certificate.pem"),
    certificatePem(certificate.attributes.certificateContent),
  );

  // The profile is named after the certificate, so a profile with this name
  // always holds it.
  const profileName = `Kooks App Store ${serial}`;
  const profiles = await request(
    token,
    "GET",
    `/profiles?filter[profileType]=IOS_APP_STORE&filter[name]=${encodeURIComponent(profileName)}&limit=200`,
  );
  const named = profiles.data.filter(
    (item) => item.attributes.name === profileName,
  );
  let profile = named.find(
    (item) => item.attributes.profileState === "ACTIVE" && fresh(item),
  );
  if (!profile) {
    for (const stale of named)
      await request(token, "DELETE", `/profiles/${stale.id}`);
    console.log(`Creating the provisioning profile "${profileName}".`);
    profile = (
      await request(token, "POST", "/profiles", {
        data: {
          type: "profiles",
          attributes: { name: profileName, profileType: "IOS_APP_STORE" },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundle.id } },
            certificates: {
              data: [{ type: "certificates", id: certificate.id }],
            },
          },
        },
      })
    ).data;
  }
  const profileFile = join(folder, "profile.mobileprovision");
  const content = Buffer.from(profile.attributes.profileContent, "base64");
  writeFileSync(profileFile, content);
  const details = profileDetails(content);
  writeFileSync(
    join(folder, "ExportOptions.plist"),
    exportOptions({ team: details.team, profileName: details.name }),
  );
  return {
    team: details.team,
    profileName: details.name,
    profileUuid: details.uuid,
    certificateExpires: certificate.attributes.expirationDate,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Usage: node scripts/ios-signing.mjs <folder>");
    process.exit(2);
  }
  try {
    const result = await prepare(folder);
    const project = new URL(projectFile, root);
    writeFileSync(
      project,
      withManualSigning(readFileSync(project, "utf8"), result),
    );
    console.log(
      `Signing as team ${result.team} with "${result.profileName}"; the certificate expires ${result.certificateExpires}.`,
    );
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `team=${result.team}\nprofile-uuid=${result.profileUuid}\n`,
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
