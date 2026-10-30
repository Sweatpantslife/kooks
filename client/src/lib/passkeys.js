import { auth } from "./api.js";

export const supported = () =>
  Boolean(window.PublicKeyCredential && navigator.credentials?.create);

const bytes = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const base64url = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Browser credential objects hold ArrayBuffers; the server reads base64url.
function serialize(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: base64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    response: {
      clientDataJSON: base64url(r.clientDataJSON),
      ...(r.attestationObject
        ? {
            attestationObject: base64url(r.attestationObject),
            transports: r.getTransports?.() ?? [],
          }
        : {
            authenticatorData: base64url(r.authenticatorData),
            signature: base64url(r.signature),
            userHandle: r.userHandle ? base64url(r.userHandle) : null,
          }),
    },
  };
}

export const message = (error) =>
  error.name === "NotAllowedError"
    ? "The passkey request was cancelled or timed out. Try again."
    : error.name === "InvalidStateError"
      ? "This device already holds a passkey for your account."
      : error.name === "SecurityError"
        ? "Passkeys need a secure (HTTPS) address. Use an email link instead."
        : error.message;

// Sign in with a passkey. With a signal, the request is a quiet one: the
// browser lists the passkey among the email field's suggestions, and the
// request is abandoned when the signal aborts. Returns whether it signed in.
export async function signIn(signal) {
  let options, credential;
  try {
    ({ options } = await auth("passkey/options", {}));
  } catch (error) {
    if (signal) return false;
    throw error;
  }
  if (signal?.aborted) return false;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: bytes(options.challenge),
        allowCredentials: (options.allowCredentials ?? []).map((c) => ({
          ...c,
          id: bytes(c.id),
        })),
      },
      ...(signal ? { mediation: "conditional", signal } : {}),
    });
  } catch (error) {
    // A quiet request that the browser cannot make, or that is abandoned,
    // is nobody's business: the button is still there, and a real reason on
    // the page, such as an expired link, stays.
    if (signal) return false;
    throw error;
  }
  await auth("passkey/signin", { credential: serialize(credential) });
  return true;
}

export async function conditionalAvailable() {
  try {
    return Boolean(
      supported() &&
      (await PublicKeyCredential.isConditionalMediationAvailable?.()),
    );
  } catch {
    return false;
  }
}

const deviceName = () => {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "This device";
  return `${device} · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
};

export async function add() {
  const { options } = await auth("passkey/register/options", {});
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: bytes(options.challenge),
      user: { ...options.user, id: bytes(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
        ...c,
        id: bytes(c.id),
      })),
    },
  });
  await auth("passkey/register", {
    credential: serialize(credential),
    name: deviceName(),
  });
}
