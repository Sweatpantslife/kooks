import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { KooksError } from "../mcp/store.js";

// Passkey (WebAuthn) checks with Node's own crypto: the slice of CBOR that
// authenticators emit, the authenticator data layout, COSE keys as JWKs, and
// the relying-party steps of the specification. Kooks asks for no attestation
// and never verifies an attestation statement; it only needs the public key.

const fail = (message) => new KooksError("PASSKEY_INVALID", message);
export const toBase64Url = (bytes) => Buffer.from(bytes).toString("base64url");
export function fromBase64Url(text, what) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text))
    throw fail(`${what} must be base64url text.`);
  return Buffer.from(text, "base64url");
}
export const generateChallenge = () => toBase64Url(randomBytes(32));

// Definite-length major types 0-5 and the simple values; CTAP2 uses nothing
// else. Maps are returned as Map because COSE keys use integer keys.
function decodeItem(bytes, offset, depth) {
  if (depth > 8) throw fail("CBOR nesting is too deep.");
  if (offset >= bytes.length) throw fail("CBOR data is truncated.");
  const major = bytes[offset] >> 5,
    info = bytes[offset] & 31;
  let pos = offset + 1,
    length = info;
  if (info >= 24) {
    const size = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!size) throw fail("CBOR data uses an unsupported encoding.");
    if (pos + size > bytes.length) throw fail("CBOR data is truncated.");
    const big =
      size === 8
        ? bytes.readBigUInt64BE(pos)
        : BigInt(bytes.readUIntBE(pos, size));
    if (big > BigInt(Number.MAX_SAFE_INTEGER))
      throw fail("CBOR data holds a number that is too large.");
    length = Number(big);
    pos += size;
  }
  switch (major) {
    case 0:
      return [length, pos];
    case 1:
      return [-1 - length, pos];
    case 2:
    case 3: {
      if (pos + length > bytes.length) throw fail("CBOR data is truncated.");
      const slice = bytes.subarray(pos, pos + length);
      return [major === 2 ? slice : slice.toString("utf8"), pos + length];
    }
    case 4: {
      const items = [];
      for (let i = 0; i < length; i++) {
        const [item, next] = decodeItem(bytes, pos, depth + 1);
        items.push(item);
        pos = next;
      }
      return [items, pos];
    }
    case 5: {
      const map = new Map();
      for (let i = 0; i < length; i++) {
        const [key, afterKey] = decodeItem(bytes, pos, depth + 1);
        const [value, next] = decodeItem(bytes, afterKey, depth + 1);
        if (typeof key === "object")
          throw fail("CBOR map key is not a scalar.");
        if (map.has(key)) throw fail("CBOR map repeats a key.");
        map.set(key, value);
        pos = next;
      }
      return [map, pos];
    }
    case 7: {
      const simple = { 20: false, 21: true, 22: null };
      if (info in simple) return [simple[info], pos];
      throw fail("CBOR data uses an unsupported value.");
    }
    default:
      throw fail("CBOR data uses an unsupported type.");
  }
}
export function decodeCbor(bytes) {
  const [value, end] = decodeItem(bytes, 0, 0);
  if (end !== bytes.length) throw fail("CBOR data has trailing bytes.");
  return value;
}

// COSE_Key to JWK for the algorithms Kooks offers: ES256, RS256 and Ed25519.
export function coseToJwk(key) {
  if (!(key instanceof Map))
    throw fail("The credential key is not a COSE key.");
  const kty = key.get(1),
    alg = key.get(3);
  const part = (label, name) => {
    const value = key.get(label);
    if (!Buffer.isBuffer(value) || !value.length)
      throw fail(`The credential key lacks ${name}.`);
    return toBase64Url(value);
  };
  let jwk;
  if (kty === 2 && alg === -7 && key.get(-1) === 1)
    jwk = { kty: "EC", crv: "P-256", x: part(-2, "x"), y: part(-3, "y") };
  else if (kty === 3 && alg === -257)
    jwk = { kty: "RSA", n: part(-1, "n"), e: part(-2, "e") };
  else if (kty === 1 && alg === -8 && key.get(-1) === 6)
    jwk = { kty: "OKP", crv: "Ed25519", x: part(-2, "x") };
  else throw fail("The passkey uses an algorithm Kooks does not support.");
  try {
    createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw fail("The passkey public key is invalid.");
  }
  return { alg, jwk };
}
export function verifyWithPublicKey({ alg, jwk }, data, signature) {
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return verifySignature(alg === -8 ? null : "sha256", data, key, signature);
  } catch {
    return false;
  }
}

export function parseAuthenticatorData(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 37)
    throw fail("Authenticator data is too short.");
  const flags = bytes[32];
  const data = {
    rpIdHash: bytes.subarray(0, 32),
    userPresent: Boolean(flags & 1),
    userVerified: Boolean(flags & 4),
    backupEligible: Boolean(flags & 8),
    backedUp: Boolean(flags & 16),
    signCount: bytes.readUInt32BE(33),
    credential: null,
  };
  let pos = 37;
  if (flags & 64) {
    if (bytes.length < pos + 18)
      throw fail("Attested credential data is truncated.");
    const aaguid = bytes.subarray(pos, pos + 16).toString("hex");
    const idLength = bytes.readUInt16BE(pos + 16);
    pos += 18;
    if (!idLength || idLength > 1023 || bytes.length < pos + idLength)
      throw fail("The credential id length is invalid.");
    const id = bytes.subarray(pos, pos + idLength);
    pos += idLength;
    const [key, next] = decodeItem(bytes, pos, 0);
    data.credential = { aaguid, id, publicKey: coseToJwk(key) };
    pos = next;
  }
  if (flags & 128) [, pos] = decodeItem(bytes, pos, 0);
  if (pos !== bytes.length)
    throw fail("Authenticator data has trailing bytes.");
  return data;
}

function checkShape(credential) {
  if (
    !credential ||
    typeof credential !== "object" ||
    credential.type !== "public-key" ||
    typeof credential.id !== "string" ||
    !credential.response ||
    typeof credential.response !== "object"
  )
    throw fail("The passkey response is malformed.");
}
// The challenge a response answers, so the server can look up what it issued.
export function challengeOf(credential) {
  checkShape(credential);
  const raw = fromBase64Url(
    credential.response.clientDataJSON,
    "clientDataJSON",
  );
  let data;
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    throw fail("Client data is not JSON.");
  }
  if (!data || typeof data !== "object" || typeof data.challenge !== "string")
    throw fail("Client data lacks a challenge.");
  fromBase64Url(data.challenge, "challenge");
  return { raw, data };
}
function parseClientData(credential, type, expectedChallenge, expectedOrigin) {
  const { raw, data } = challengeOf(credential);
  if (data.type !== type)
    throw fail("The passkey response has the wrong type.");
  const challenge = fromBase64Url(data.challenge, "challenge"),
    expected = fromBase64Url(expectedChallenge, "challenge");
  if (
    !expected.length ||
    challenge.length !== expected.length ||
    !timingSafeEqual(challenge, expected)
  )
    throw fail("The passkey response answers a different challenge.");
  if (data.origin !== expectedOrigin)
    throw fail("The passkey response came from a different website.");
  if (data.crossOrigin === true)
    throw fail("Passkeys cannot be used from an embedded page.");
  return raw;
}
function checkAuthenticator(auth, rpId) {
  const expected = createHash("sha256").update(rpId).digest();
  if (!timingSafeEqual(auth.rpIdHash, expected))
    throw fail("The passkey belongs to a different website.");
  if (!auth.userPresent || !auth.userVerified)
    throw fail(
      "The passkey was not confirmed with a fingerprint, face or screen lock.",
    );
}

// Registration (specification 7.1). Returns what to store for the passkey.
export function verifyRegistration({
  credential,
  expectedChallenge,
  expectedOrigin,
  rpId,
}) {
  checkShape(credential);
  const response = credential.response;
  parseClientData(
    credential,
    "webauthn.create",
    expectedChallenge,
    expectedOrigin,
  );
  const attestation = decodeCbor(
    fromBase64Url(response.attestationObject, "attestationObject"),
  );
  if (
    !(attestation instanceof Map) ||
    typeof attestation.get("fmt") !== "string" ||
    !Buffer.isBuffer(attestation.get("authData"))
  )
    throw fail("The attestation object is malformed.");
  const auth = parseAuthenticatorData(attestation.get("authData"));
  checkAuthenticator(auth, rpId);
  if (!auth.credential) throw fail("No credential was created.");
  const id = toBase64Url(auth.credential.id);
  if (credential.id !== id)
    throw fail("The credential id does not match the attested credential.");
  const transports = Array.isArray(response.transports)
    ? response.transports
        .filter((t) => typeof t === "string" && /^[a-z-]{1,32}$/.test(t))
        .slice(0, 8)
    : [];
  return {
    id,
    publicKey: auth.credential.publicKey,
    signCount: auth.signCount,
    transports,
    backedUp: auth.backedUp,
    backupEligible: auth.backupEligible,
    aaguid: auth.credential.aaguid,
  };
}

// Authentication (specification 7.2). signCount is the stored counter.
export function verifyAuthentication({
  credential,
  expectedChallenge,
  expectedOrigin,
  rpId,
  publicKey,
  signCount,
}) {
  checkShape(credential);
  const response = credential.response;
  const clientData = parseClientData(
    credential,
    "webauthn.get",
    expectedChallenge,
    expectedOrigin,
  );
  const authData = fromBase64Url(
    response.authenticatorData,
    "authenticatorData",
  );
  const auth = parseAuthenticatorData(authData);
  checkAuthenticator(auth, rpId);
  const signed = Buffer.concat([
    authData,
    createHash("sha256").update(clientData).digest(),
  ]);
  if (
    !verifyWithPublicKey(
      publicKey,
      signed,
      fromBase64Url(response.signature, "signature"),
    )
  )
    throw fail("The passkey signature is invalid.");
  // A counter that moves must move forward; passkeys that never count report 0.
  if ((auth.signCount !== 0 || signCount !== 0) && auth.signCount <= signCount)
    throw fail(
      "This passkey looks copied and was refused. Remove it and add a new one.",
    );
  return {
    signCount: auth.signCount,
    backedUp: auth.backedUp,
    userHandle:
      response.userHandle == null
        ? null
        : fromBase64Url(response.userHandle, "userHandle"),
  };
}
