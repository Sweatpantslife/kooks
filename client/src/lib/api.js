// The household server's HTTP API. Every change goes through a named tool at
// /api/tools/<name>; sign-in has its own routes under /api/auth/.

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, input) {
  let response;
  try {
    response = await fetch(
      path,
      input === undefined
        ? { credentials: "same-origin" }
        : {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
    );
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

export const tool = (name, input = {}) =>
  request(`/api/tools/${encodeURIComponent(name)}`, input);

export const auth = (path, input) => request(`/api/auth/${path}`, input);

export async function state(revision) {
  let response;
  try {
    response = await fetch(
      `/api/state${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
      { credentials: "same-origin" },
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
  const request_id = pending.get(key) ?? uid();
  pending.set(key, request_id);
  const result = await tool(name, { ...input, request_id });
  pending.delete(key);
  return result;
}
