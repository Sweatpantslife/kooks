import { base, deviceToken, phone } from "./device.js";

// The household server's HTTP API. Every change goes through a named tool at
// /api/tools/<name>; sign-in has its own routes under /api/auth/.

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// A phone sends its device token and never a cookie; a browser sends its
// cookie to its own server.
function send(path, input, signal, timeout) {
  const token = deviceToken();
  const headers = {
    ...(input === undefined ? {} : { "Content-Type": "application/json" }),
    ...(phone && token ? { Authorization: `Bearer ${token}` } : {}),
  };
  // A connection that hangs, as one with a bar of signal can, counts as
  // none after a while.
  if (timeout) {
    const late = AbortSignal.timeout(timeout);
    signal = signal ? AbortSignal.any([signal, late]) : late;
  }
  return fetch(`${base()}${path}`, {
    credentials: phone ? "omit" : "same-origin",
    headers,
    signal,
    ...(input === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(input) }),
  });
}

// A file from the kitchen, such as a photo, read the way the page is
// allowed to: by its address in a browser, with the token on a phone.
export async function file(path) {
  let response;
  try {
    response = await send(path);
  } catch {
    throw new ApiError("Could not reach the kitchen.", "OFFLINE", 0);
  }
  if (!response.ok)
    throw new ApiError(
      "Could not open this file.",
      "UNAVAILABLE",
      response.status,
    );
  return response.blob();
}

async function request(path, input, timeout) {
  let response;
  try {
    response = await send(path, input, undefined, timeout);
  } catch {
    throw new ApiError(
      "Could not reach the kitchen. Check your connection and try again.",
      "OFFLINE",
      0,
    );
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      value.message ?? "Could not complete this action.",
      value.error,
      response.status,
    );
  return value;
}

export const tool = (name, input = {}, { timeout } = {}) =>
  request(`/api/tools/${encodeURIComponent(name)}`, input, timeout);

export const auth = (path, input) => request(`/api/auth/${path}`, input);

// A question for the assistant. The answer streams as lines of JSON: what
// it is doing, as it does it, then the answer or why there is none.
export async function ask(input, { signal, onStep }) {
  const stopped = () => new ApiError("Stopped.", "STOPPED", 0);
  let response;
  try {
    response = await send("/api/assistant", input, signal);
  } catch {
    if (signal?.aborted) throw stopped();
    throw new ApiError(
      "Could not reach the kitchen. Check your connection and try again.",
      "OFFLINE",
      0,
    );
  }
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new ApiError(
      value.message ?? "Kooks couldn’t answer just now.",
      value.error,
      response.status,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch {
      if (signal?.aborted) throw stopped();
      throw new ApiError("The answer was cut off. Try again.", "CUT_OFF", 0);
    }
    if (chunk.done) break;
    pending += decoder.decode(chunk.value, { stream: true });
    for (let end; (end = pending.indexOf("\n")) >= 0;) {
      const line = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      if (line.step) onStep(line.step);
      if (line.answer) return line.answer;
      if (line.error) throw new ApiError(line.error, "NO_ANSWER", 200);
    }
  }
  throw new ApiError("The answer was cut off. Try again.", "CUT_OFF", 0);
}

export async function state(revision) {
  let response;
  try {
    response = await send(
      `/api/state${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
      undefined,
      undefined,
      20000,
    );
  } catch {
    throw new ApiError("Could not reach the kitchen.", "OFFLINE", 0);
  }
  if (response.status === 401) return { signedOut: true };
  if (!response.ok)
    throw new ApiError(
      "Could not open the kitchen. Check that the server is running.",
      "UNAVAILABLE",
      response.status,
    );
  return response.json();
}

const uid = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// A retried change keeps its request id, so the server applies it once even
// when the first attempt reached it and only the answer was lost.
const pending = new Map();
export async function write(name, input) {
  const key = JSON.stringify([name, input]);
  // A caller whose action must happen once even across restarts names its
  // own key; otherwise a retry of the same change reuses the first one.
  const request_id = input.request_id ?? pending.get(key) ?? uid();
  pending.set(key, request_id);
  const result = await tool(name, { ...input, request_id });
  pending.delete(key);
  return result;
}
