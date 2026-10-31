import { signal } from "@preact/signals";
import { kinds } from "./waiting.js";

// Changes made while the kitchen is out of reach, kept on this device in the
// order they were made, and sent in that order once it answers. Each is a
// call to one of the kitchen's tools with a request id fixed when the
// change was made. The kitchen makes a request id's change once and answers
// it again with what it did then, so a change whose answer was lost is
// never made twice; it checks the request id before anything else, so the
// same call refused as stale was never made at all.
//
// An entry, by the kind of change it is (`waiting.js`):
// - id: the request id its first call goes with; a later call for the same
//   change, such as ticking a grocery once it is on the list, adds ".2",
//   ".3".
// - made_at, household: when, and in which household, it was made.
// - sent: the call last made for it, exactly as made, until its answer
//   arrives. A call whose answer never came is made again as it was.
// - problem: why the kitchen would not take it, until the member decides.
const KEY = "kooks.outbox";

export const uid = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// What this device kept before changes were kept by kind, when only grocery
// ticks were, by list and then grocery, becomes one entry per list.
export function upgrade(value) {
  if (Array.isArray(value?.entries))
    return value.entries.filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        Object.hasOwn(kinds, entry.kind) &&
        entry.input &&
        typeof entry.input === "object",
    );
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(
      ([, ticks]) =>
        ticks && typeof ticks === "object" && Object.keys(ticks).length,
    )
    .map(([list, ticks]) => ({
      id: uid(),
      kind: "ticks",
      input: { list, ticks },
      made_at: Date.now(),
      household: null,
    }));
}

const stored = () => {
  try {
    return upgrade(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return [];
  }
};
export const waiting = signal(stored());
// Another tab of this browser changed what waits.
globalThis.addEventListener?.("storage", (event) => {
  if (event.key === KEY || event.key === null) waiting.value = stored();
});

function save(entries) {
  waiting.value = entries;
  try {
    if (entries.length) localStorage.setItem(KEY, JSON.stringify({ entries }));
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for as long as the app is open.
  }
}

// Change one entry by what `change` makes of it; null removes it. Returns
// the entry as it is now, or null when it is gone.
function put(id, change) {
  let now = null;
  const next = [];
  for (const entry of waiting.value) {
    if (entry.id !== id) next.push(entry);
    else if ((now = change(entry))) next.push(now);
  }
  save(next);
  return now;
}
const find = (id) => waiting.value.find((entry) => entry.id === id) ?? null;

// An entry made with no household is a kitchen without sign-in, or ticks an
// earlier version kept: it goes to whichever household this device is in.
export const belongs = (entry, household) =>
  (entry.household ?? household) === household;

export function keepChange(kind, input, { household = null, id = uid() } = {}) {
  const entry = { id, kind, input, made_at: Date.now(), household };
  save([...waiting.value, entry]);
  return entry;
}

export function updateInput(id, change) {
  return put(id, (entry) => ({ ...entry, input: change(entry.input) }));
}

// Forget a change: it is not sent. Returns a way to put it back where it was.
export function discard(id) {
  const index = waiting.value.findIndex((entry) => entry.id === id);
  if (index < 0) return () => {};
  const entry = waiting.value[index];
  save(waiting.value.filter((e) => e.id !== id));
  return () => {
    if (find(id)) return;
    const next = waiting.value.slice();
    next.splice(Math.min(index, next.length), 0, entry);
    save(next);
  };
}

// Send a change the kitchen would not take once more, as it is now.
export const retry = (id) => put(id, ({ problem: _, ...entry }) => entry);

export const forgetWaiting = () => save([]);

// A tick on the grocery list, kept with the others on that list: the latest
// for each grocery is all there is to keep.
export function hold(list, ids, checked, household = null) {
  const set = Object.fromEntries(ids.map((id) => [id, checked]));
  const entry = waiting.value.find(
    (e) => e.kind === "ticks" && e.input.list === list && !e.problem,
  );
  if (!entry) return keepChange("ticks", { list, ticks: set }, { household });
  return updateInput(entry.id, (input) => ({
    ...input,
    ticks: { ...input.ticks, ...set },
  }));
}

// A tick that reached the kitchen since says the last word for its grocery.
export function drop(list, ids) {
  for (const entry of waiting.value)
    if (entry.kind === "ticks" && entry.input.list === list)
      put(entry.id, (e) => {
        const ticks = { ...e.input.ticks };
        for (const id of ids) delete ticks[id];
        return Object.keys(ticks).length
          ? { ...e, input: { ...e.input, ticks } }
          : null;
      });
}

// What the kitchen said to each change sent, for whoever made it and waits
// to hear: { done: result } or { problem: error }.
export const outcomes = new Map();

// An answer that says nothing about the change: the kitchen did not answer,
// failed, or asked to wait. The call is made again, as it was, later.
const unanswered = (error) =>
  !error.status ||
  error.status >= 500 ||
  error.status === 408 ||
  error.status === 429;

// One change, sent until it is done, the kitchen says no, or the kitchen
// stops answering. `deps` is how this reaches the kitchen:
// - call(tool, input) makes a call, throwing an error with the kitchen's
//   `code` and HTTP `status` (0 when it did not answer);
// - read(kind, id) is a record as this device last heard it;
// - refresh() hears the kitchen again;
// - ended() is called when the kitchen no longer takes this device.
// Returns "done", "kept" (it needs the member), "away" (the kitchen did not
// answer) or "later" (others kept changing the same thing).
async function sendOne(id, deps) {
  for (let round = 0; round < 6; round++) {
    let entry = find(id);
    if (!entry) return "done";
    if (entry.sent) {
      const { sent } = entry;
      let result;
      try {
        result = await deps.call(sent.tool, {
          ...sent.input,
          request_id: sent.request_id,
        });
      } catch (error) {
        if (error.status === 401) {
          deps.ended();
          return "away";
        }
        if (unanswered(error)) return "away";
        // A clear no: that call was not made, and its request id is free.
        put(id, ({ sent: _, ...rest }) => rest);
        if (error.code === "STALE_VERSION") {
          await deps.refresh();
          continue;
        }
        // Made before with other arguments: it went in then.
        if (error.code !== "REQUEST_ID_REUSED") {
          // The kitchen checks a version last, so a refusal of a call made
          // against an old version may be about the old version: with the
          // kitchen heard again, the change may go after all, may have
          // nothing left to do, or may be refused in plainer words.
          await deps.refresh();
          const now = find(id);
          const next = now && kinds[now.kind].next(now, deps.read);
          if (!next) {
            put(id, () => null);
            outcomes.set(id, { done: null });
            return "done";
          }
          const moved =
            !next.problem &&
            sent.input.expected_version !== undefined &&
            next.input.expected_version !== sent.input.expected_version;
          if (moved) continue;
          const message = next.problem ?? error.message;
          put(id, (e) => ({ ...e, problem: { message } }));
          outcomes.set(id, {
            problem: next.problem ? new Error(message) : error,
          });
          return "kept";
        }
      }
      // In, perhaps long ago with only its answer lost. The kitchen is heard
      // again before what is left of the change is worked out from it.
      await deps.refresh();
      entry = put(id, (e) => {
        const { sent: _, ...rest } = e;
        const left = kinds[e.kind].after(rest, sent, result);
        return left && { ...left, calls: (e.calls ?? 0) + 1 };
      });
      if (!entry) {
        outcomes.set(id, { done: result });
        return "done";
      }
      continue;
    }
    const next = kinds[entry.kind].next(entry, deps.read);
    if (!next) {
      put(id, () => null);
      outcomes.set(id, { done: null });
      return "done";
    }
    if (next.problem) {
      put(id, (e) => ({ ...e, problem: { message: next.problem } }));
      outcomes.set(id, { problem: new Error(next.problem) });
      return "kept";
    }
    const calls = entry.calls ?? 0;
    // Written down before it leaves, so a call that never hears back is
    // made again exactly as it was.
    put(id, (e) => ({
      ...e,
      sent: {
        tool: next.tool,
        input: next.input,
        request_id: calls ? `${id}.${calls + 1}` : id,
      },
    }));
  }
  return "later";
}

async function sendAll(deps) {
  const tried = new Set();
  for (;;) {
    const household = deps.household();
    const entry = waiting.value.find(
      (e) => !e.problem && !tried.has(e.id) && belongs(e, household),
    );
    if (!entry) return;
    tried.add(entry.id);
    if ((await sendOne(entry.id, deps)) === "away") return;
  }
}

// Send what waits, in order. Called again while sending, it sends what was
// added meanwhile before it finishes.
let sending = null;
let again = false;
export function sendWaiting(deps) {
  again = true;
  sending ??= (async () => {
    try {
      while (again) {
        again = false;
        await sendAll(deps);
      }
    } finally {
      sending = null;
    }
  })();
  return sending;
}
