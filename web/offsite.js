// Off-site copies: each automatic copy also goes to a bucket on storage that
// speaks the S3 protocol (Amazon S3, Cloudflare R2, Backblaze B2, MinIO and
// others), so losing the server doesn't lose the kitchen. The server only
// writes: it never lists, reads or deletes anything there, so its key can be
// one that can't, and the bucket's own lifecycle rule decides how long copies
// stay. Listing and fetching are for a recovery, from the backup script.
//
// Requests are signed with AWS Signature Version 4 by hand, so Kooks needs
// no SDK, and each upload carries its SHA-256, which the storage checks.
import { createHash, createHmac } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

export class OffsiteError extends Error {}

const EMPTY = createHash("sha256").update("").digest("hex");
const COPY_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-\d+)?$/;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
// S3 wants every byte but A-Z a-z 0-9 - _ . ~ percent-encoded.
const encode = (text) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// The region in a host name such as s3.eu-central-1.amazonaws.com or
// s3.us-west-004.backblazeb2.com; elsewhere us-east-1, which R2 and MinIO
// take as their own.
function regionOf(host) {
  const match =
    /(?:^|\.)s3[.-]([a-z0-9-]+)\.amazonaws\.com$/.exec(host) ??
    /(?:^|\.)s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(host);
  return match && match[1] !== "dualstack" ? match[1] : "us-east-1";
}

export function offsiteSettings(env) {
  const value = (name) => String(env[name] ?? "").trim();
  const names = [
    "KOOKS_BACKUP_S3_URL",
    "KOOKS_BACKUP_S3_ACCESS_KEY_ID",
    "KOOKS_BACKUP_S3_SECRET_ACCESS_KEY",
  ];
  const set = names.filter((name) => value(name));
  if (!set.length) return null;
  if (set.length < names.length)
    throw new Error(
      `Off-site copies need ${names.join(", ")}; ${names
        .filter((name) => !set.includes(name))
        .join(" and ")} ${set.length === 2 ? "is" : "are"} missing.`,
    );
  let url = null;
  try {
    url = new URL(value("KOOKS_BACKUP_S3_URL"));
  } catch {
    // Reported below.
  }
  const local =
    url?.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !url ||
    !(url.protocol === "https:" || local) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "KOOKS_BACKUP_S3_URL is the bucket's https address, such as https://my-bucket.s3.eu-central-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com/my-bucket.",
    );
  const prefix = value("KOOKS_BACKUP_S3_PREFIX") || "kooks/";
  if (!/^[A-Za-z0-9!\-_.*'()/]*$/.test(prefix) || prefix.startsWith("/"))
    throw new Error(
      "KOOKS_BACKUP_S3_PREFIX is a folder in the bucket, such as kooks/, of letters, digits and - _ . / only.",
    );
  return {
    url: url.href.replace(/\/+$/, ""),
    region: value("KOOKS_BACKUP_S3_REGION") || regionOf(url.hostname),
    accessKeyId: value("KOOKS_BACKUP_S3_ACCESS_KEY_ID"),
    secretAccessKey: value("KOOKS_BACKUP_S3_SECRET_ACCESS_KEY"),
    prefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix,
  };
}

// Where copies go, without the key: for the log and the owner's page.
export const offsiteLabel = (settings) =>
  `${new URL(settings.url).host}${new URL(settings.url).pathname.replace(/\/$/, "")}/${settings.prefix}`;

// The headers that sign one request.
export function signRequest({
  method,
  url,
  payloadHash = EMPTY,
  accessKeyId,
  secretAccessKey,
  region,
  now = Date.now(),
}) {
  const target = new URL(url);
  const stamp = new Date(now)
    .toISOString()
    .replace(/\.\d{3}/, "")
    .replace(/[-:]/g, "");
  const day = stamp.slice(0, 8);
  const path =
    target.pathname
      .split("/")
      .map((part) => encode(decodeURIComponent(part)))
      .join("/") || "/";
  const query = [...target.searchParams]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const headers = {
    host: target.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonical = [
    method,
    path,
    query,
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  let key = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key)
    .update(["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n"))
    .digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

const keyUrl = (settings, key) =>
  `${settings.url}/${`${settings.prefix}${key}`.split("/").map(encode).join("/")}`;

// One request. The body is a file to stream or a buffer; the reply comes
// back as text, or goes to a file.
function send(
  settings,
  method,
  url,
  { file = null, data = null, hash = EMPTY, to = null, now = Date.now } = {},
) {
  const target = new URL(url);
  const headers = signRequest({
    method,
    url,
    payloadHash: hash,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    region: settings.region,
    now: now(),
  });
  if (file || data)
    headers["content-length"] = file ? statSync(file).size : data.length;
  const where = target.host;
  return new Promise((resolvePromise, reject) => {
    const request = (target.protocol === "https:" ? https : http).request(
      target,
      { method, headers, timeout: 120000 },
      async (response) => {
        try {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            if (to) {
              await pipeline(response, createWriteStream(to, { mode: 0o600 }));
              return resolvePromise("");
            }
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            return resolvePromise(Buffer.concat(chunks).toString("utf8"));
          }
          const chunks = [];
          for await (const chunk of response) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString("utf8");
          const code = /<Code>([^<]*)<\/Code>/.exec(body)?.[1];
          const message = /<Message>([^<]*)<\/Message>/.exec(body)?.[1];
          reject(
            new OffsiteError(
              `${where} answered ${response.statusCode}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`,
            ),
          );
        } catch (error) {
          reject(new OffsiteError(`${where} broke off: ${error.message}`));
        }
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("no answer for two minutes")),
    );
    request.on("error", (error) =>
      reject(
        error instanceof OffsiteError
          ? error
          : new OffsiteError(
              `Kooks could not reach ${where}: ${error.message}`,
            ),
      ),
    );
    if (file)
      pipeline(createReadStream(file), request).catch((error) =>
        request.destroy(error),
      );
    else request.end(data ?? undefined);
  });
}

// Sends a copy: its databases first and its manifest last, so a copy in the
// bucket with a manifest is a whole one.
export async function pushCopy(settings, copy, { now = Date.now } = {}) {
  for (const file of copy.manifest.files)
    await send(settings, "PUT", keyUrl(settings, `${copy.name}/${file.path}`), {
      file: join(copy.path, file.path),
      hash: file.sha256,
      now,
    });
  const manifest = readFileSync(join(copy.path, "manifest.json"));
  await send(settings, "PUT", keyUrl(settings, `${copy.name}/manifest.json`), {
    data: manifest,
    hash: sha256(manifest),
    now,
  });
  return copy.manifest.files.reduce((sum, f) => sum + f.bytes, 0);
}

// The copies in the bucket, newest first. Needs a key that may list.
export async function remoteCopies(settings, { now = Date.now } = {}) {
  const names = new Set();
  let token = "";
  do {
    const query = new URLSearchParams({
      "list-type": "2",
      prefix: settings.prefix,
      delimiter: "/",
    });
    if (token) query.set("continuation-token", token);
    const base = new URL(settings.url);
    const xml = await send(
      settings,
      "GET",
      `${base.origin}${base.pathname === "/" ? "/" : base.pathname}?${query}`,
      { now },
    );
    for (const [, prefix] of xml.matchAll(
      /<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>/g,
    )) {
      const name = prefix.slice(settings.prefix.length).replace(/\/$/, "");
      if (COPY_NAME.test(name)) names.add(name);
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(
          xml,
        )?.[1] ?? "")
      : "";
  } while (token);
  return [...names].sort().reverse();
}

// A copy's manifest in the bucket, as text and as read. Needs a key that
// may read.
export async function remoteManifest(settings, name, { now = Date.now } = {}) {
  if (!COPY_NAME.test(name))
    throw new OffsiteError(
      `${name} is not a copy's name; they look like 2026-11-01T03-00-00Z.`,
    );
  const text = await send(
    settings,
    "GET",
    keyUrl(settings, `${name}/manifest.json`),
    { now },
  ).catch((error) => {
    throw new OffsiteError(
      `Copy ${name} is not in the bucket, or not whole (${error.message}).`,
    );
  });
  let manifest = null;
  try {
    manifest = JSON.parse(text);
  } catch {
    // Reported below.
  }
  const files = manifest?.files;
  if (
    !Array.isArray(files) ||
    files.some(
      (f) =>
        typeof f?.path !== "string" ||
        !/^(kooks\.sqlite|households\/[a-f0-9]{16}\.sqlite)\.gz$/.test(f.path),
    )
  )
    throw new OffsiteError(`Copy ${name}'s manifest lists unexpected files.`);
  return { text, manifest };
}

// Brings a copy from the bucket into the copies folder, manifest last, so
// that it can be checked and staged as any other. Needs a key that may read.
export async function fetchCopy(settings, name, dir, { now = Date.now } = {}) {
  const { text, manifest } = await remoteManifest(settings, name, { now });
  const { files } = manifest;
  const final = join(dir, name);
  if (existsSync(final))
    throw new OffsiteError(`There is a copy ${name} here already.`);
  const partial = join(dir, `.fetching-${name}`);
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(join(partial, "households"), { recursive: true, mode: 0o700 });
  try {
    for (const file of files) {
      mkdirSync(dirname(join(partial, file.path)), { recursive: true });
      await send(settings, "GET", keyUrl(settings, `${name}/${file.path}`), {
        to: join(partial, file.path),
        now,
      });
    }
    // The manifest goes in last, as when the copy was taken.
    writeFileSync(join(partial, "manifest.json"), text, { mode: 0o600 });
    renameSync(partial, final);
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }
  return final;
}
