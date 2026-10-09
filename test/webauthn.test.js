import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decodeCbor,
  generateChallenge,
  parseAuthenticatorData,
  verifyAuthentication,
  verifyRegistration,
} from "../web/webauthn.js";
import { createAuthenticator, encodeCbor } from "./helpers/authenticator.js";

const site = { origin: "https://kooks.example", rpId: "kooks.example" };
const expectations = (challenge) => ({
  expectedChallenge: challenge,
  expectedOrigin: site.origin,
  rpId: site.rpId,
});

test("registers and authenticates passkeys for ES256, RS256 and Ed25519", () => {
  for (const algorithm of [-7, -257, -8]) {
    const passkey = createAuthenticator({ algorithm, ...site, backedUp: true });
    const challenge = generateChallenge();
    const registered = verifyRegistration({
      credential: passkey.attest({ challenge }),
      ...expectations(challenge),
    });
    assert.equal(registered.id, passkey.id);
    assert.equal(registered.publicKey.alg, algorithm);
    assert.deepEqual(registered.publicKey.jwk, passkey.jwk);
    assert.equal(registered.signCount, 0);
    assert.equal(registered.backedUp, true);
    assert.deepEqual(registered.transports, ["internal", "hybrid"]);
    const handle = randomBytes(32).toString("base64url");
    const next = generateChallenge();
    const signedIn = verifyAuthentication({
      credential: passkey.assert({ challenge: next, userHandle: handle }),
      ...expectations(next),
      publicKey: registered.publicKey,
      signCount: registered.signCount,
    });
    assert.equal(signedIn.signCount, 1);
    assert.equal(signedIn.userHandle.toString("base64url"), handle);
    assert.equal(signedIn.backedUp, true);
  }
});

test("rejects responses for another site, challenge or origin, and unverified users", () => {
  const passkey = createAuthenticator(site);
  const challenge = generateChallenge();
  const attempt = (overrides, pattern) =>
    assert.throws(
      () =>
        verifyRegistration({
          credential: passkey.attest({ challenge, ...overrides }),
          ...expectations(challenge),
        }),
      { code: "PASSKEY_INVALID", message: pattern },
    );
  attempt({ origin: "https://evil.example" }, /different website/);
  attempt({ rpId: "evil.example" }, /different website/);
  attempt({ challenge: generateChallenge() }, /different challenge/);
  attempt({ userVerified: false }, /fingerprint, face or screen lock/);
  attempt({ type: "webauthn.get" }, /wrong type/);
  // Unsupported COSE algorithms (here P-384) are refused at registration.
  attempt(
    {
      key: new Map([
        [1, 2],
        [3, -35],
        [-1, 2],
        [-2, randomBytes(48)],
        [-3, randomBytes(48)],
      ]),
    },
    /algorithm/,
  );
  const registered = verifyRegistration({
    credential: passkey.attest({ challenge }),
    ...expectations(challenge),
  });
  const signIn = (overrides, pattern, signCount = 0) => {
    const next = generateChallenge();
    assert.throws(
      () =>
        verifyAuthentication({
          credential: passkey.assert({ challenge: next, ...overrides }),
          ...expectations(next),
          publicKey: registered.publicKey,
          signCount,
        }),
      { code: "PASSKEY_INVALID", message: pattern },
    );
  };
  signIn({ origin: "https://evil.example" }, /different website/);
  signIn({ rpId: "evil.example" }, /different website/);
  signIn({ userVerified: false }, /fingerprint, face or screen lock/);
  signIn({ type: "webauthn.create" }, /wrong type/);
  signIn({ tamper: true }, /signature is invalid/);
  // A counter that moves must move forward; a replayed value means a clone.
  signIn({ counter: 5 }, /copied/, 5);
  signIn({ counter: 3 }, /copied/, 5);
  const still = generateChallenge();
  const zero = createAuthenticator({ ...site, counts: false });
  const zeroRegistered = verifyRegistration({
    credential: zero.attest({ challenge: still }),
    ...expectations(still),
  });
  assert.equal(
    verifyAuthentication({
      credential: zero.assert({ challenge: still }),
      ...expectations(still),
      publicKey: zeroRegistered.publicKey,
      signCount: 0,
    }).signCount,
    0,
  );
  assert.throws(
    () =>
      verifyAuthentication({
        credential: { type: "public-key", id: "x", response: {} },
        ...expectations(still),
        publicKey: registered.publicKey,
        signCount: 0,
      }),
    { code: "PASSKEY_INVALID" },
  );
});

test("decodes the CBOR authenticators emit and refuses everything else", () => {
  const value = new Map([
    ["fmt", "none"],
    ["attStmt", new Map()],
    ["list", [1, -2, "three", Buffer.from([4]), true, null]],
    [-1, 255],
    [2, 65536],
  ]);
  assert.deepEqual(decodeCbor(encodeCbor(value)), value);
  const refuse = (bytes, pattern) =>
    assert.throws(() => decodeCbor(Buffer.from(bytes)), {
      code: "PASSKEY_INVALID",
      message: pattern,
    });
  refuse([0x9f, 0x01, 0xff], /unsupported encoding/);
  refuse([0x82, 0x01], /truncated/);
  refuse([0x01, 0x02], /trailing/);
  refuse([0xfa, 0, 0, 0, 0], /unsupported value/);
  refuse([0xc0, 0x01], /unsupported type/);
  refuse([0xa2, 0x01, 0x01, 0x01, 0x02], /repeats a key/);
  refuse(Array(10).fill(0x81).concat([0x01]), /too deep/);
  assert.throws(() => parseAuthenticatorData(Buffer.alloc(36)), /too short/);
});

test("reads attested credential data and extension data to the last byte", () => {
  const passkey = createAuthenticator(site);
  const challenge = generateChallenge();
  const attestation = decodeCbor(
    Buffer.from(
      passkey.attest({ challenge }).response.attestationObject,
      "base64url",
    ),
  );
  const authData = attestation.get("authData");
  const parsed = parseAuthenticatorData(authData);
  assert.equal(parsed.credential.id.toString("base64url"), passkey.id);
  assert.equal(parsed.credential.aaguid, "0".repeat(32));
  assert.deepEqual(parsed.credential.publicKey.jwk, passkey.jwk);
  const withExtensions = Buffer.concat([
    authData,
    encodeCbor(new Map([["credProtect", 2]])),
  ]);
  withExtensions[32] |= 128;
  assert.equal(parseAuthenticatorData(withExtensions).signCount, 0);
  assert.throws(
    () => parseAuthenticatorData(Buffer.concat([authData, Buffer.from([0])])),
    /trailing/,
  );
});
