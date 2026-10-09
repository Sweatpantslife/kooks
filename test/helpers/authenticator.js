import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

// A software passkey for tests: it produces the registration and assertion
// responses a browser would hand the server, for ES256, RS256 and Ed25519.

function head(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const wide = Buffer.alloc(length < 65536 ? 3 : 5);
  wide[0] = (major << 5) | (length < 65536 ? 25 : 26);
  if (length < 65536) wide.writeUInt16BE(length, 1);
  else wide.writeUInt32BE(length, 1);
  return wide;
}
export function encodeCbor(value) {
  if (typeof value === "number")
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value))
    return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") {
    const text = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, text.length), text]);
  }
  if (Array.isArray(value))
    return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  if (value instanceof Map)
    return Buffer.concat([
      head(5, value.size),
      ...[...value].flatMap(([k, v]) => [encodeCbor(k), encodeCbor(v)]),
    ]);
  if (value === false) return Buffer.from([0xf4]);
  if (value === true) return Buffer.from([0xf5]);
  if (value === null) return Buffer.from([0xf6]);
  if (value && typeof value === "object")
    return encodeCbor(new Map(Object.entries(value)));
  throw new Error(`Cannot encode ${typeof value} as CBOR.`);
}

const coseKey = (algorithm, jwk) => {
  const bytes = (text) => Buffer.from(text, "base64url");
  if (algorithm === -7)
    return new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, bytes(jwk.x)],
      [-3, bytes(jwk.y)],
    ]);
  if (algorithm === -257)
    return new Map([
      [1, 3],
      [3, -257],
      [-1, bytes(jwk.n)],
      [-2, bytes(jwk.e)],
    ]);
  if (algorithm === -8)
    return new Map([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, bytes(jwk.x)],
    ]);
  throw new Error(`Unsupported algorithm ${algorithm}.`);
};

export function createAuthenticator({
  algorithm = -7,
  rpId = "localhost",
  origin = "http://localhost",
  credentialId = randomBytes(32),
  aaguid = Buffer.alloc(16),
  userVerified = true,
  backedUp = false,
  counts = true,
} = {}) {
  const pair =
    algorithm === -7
      ? generateKeyPairSync("ec", { namedCurve: "P-256" })
      : algorithm === -257
        ? generateKeyPairSync("rsa", { modulusLength: 2048 })
        : generateKeyPairSync("ed25519");
  const jwk = pair.publicKey.export({ format: "jwk" });
  const id = credentialId.toString("base64url");
  let counter = 0;
  const flags = ({ uv, attested }) =>
    1 | (uv ? 4 : 0) | (backedUp ? 24 : 0) | (attested ? 64 : 0);
  const authData = ({
    rp,
    uv,
    count,
    attested,
    key = coseKey(algorithm, jwk),
  }) => {
    const header = Buffer.alloc(37);
    createHash("sha256").update(rp).digest().copy(header, 0);
    header[32] = flags({ uv, attested });
    header.writeUInt32BE(count, 33);
    if (!attested) return header;
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(credentialId.length);
    return Buffer.concat([
      header,
      aaguid,
      idLength,
      credentialId,
      encodeCbor(key),
    ]);
  };
  const clientData = (type, challenge, site) =>
    Buffer.from(
      JSON.stringify({ type, challenge, origin: site, crossOrigin: false }),
    );
  return {
    id,
    jwk,
    algorithm,
    attest({
      challenge,
      origin: site = origin,
      rpId: rp = rpId,
      userVerified: uv = userVerified,
      type = "webauthn.create",
      key,
    } = {}) {
      const data = authData({ rp, uv, count: 0, attested: true, key });
      return {
        id,
        rawId: id,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: clientData(type, challenge, site).toString(
            "base64url",
          ),
          attestationObject: encodeCbor(
            new Map([
              ["fmt", "none"],
              ["attStmt", new Map()],
              ["authData", data],
            ]),
          ).toString("base64url"),
          transports: ["internal", "hybrid", "not a transport!"],
        },
      };
    },
    assert({
      challenge,
      origin: site = origin,
      rpId: rp = rpId,
      userVerified: uv = userVerified,
      userHandle = null,
      counter: count,
      type = "webauthn.get",
      tamper = false,
    } = {}) {
      const used = count ?? (counts ? ++counter : 0);
      const data = authData({ rp, uv, count: used, attested: false });
      const client = clientData(type, challenge, site);
      const signature = sign(
        algorithm === -8 ? null : "sha256",
        Buffer.concat([data, createHash("sha256").update(client).digest()]),
        pair.privateKey,
      );
      if (tamper) signature[signature.length - 1] ^= 1;
      return {
        id,
        rawId: id,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: client.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
          userHandle,
        },
      };
    },
  };
}
