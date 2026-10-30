import { signal, computed, batch } from "@preact/signals";
import * as api from "./api.js";
import { toast } from "./toast.js";
import { deviceToken, keepToken, phone } from "./device.js";

// The kitchen as this tab last saw it: every record by kind, in the server's
// id order. Pages read it through `records()`; nothing else holds a copy.
export const db = signal({});
// "loading" until the first answer, then "ready", "signin" or "error".
export const status = signal("loading");
export const loadError = signal("");
// Who is signed in, or null on a server without sign-in.
export const account = signal(null);
// True when the server is shared beyond this computer (sign-in is on).
export const sharing = signal(false);
// Why the last sign-in attempt failed, shown on the sign-in page.
export const signInError = signal("");
let revision = "";

export const records = (kind) => db.value[kind] ?? [];
export const record = (kind, id) => records(kind).find((r) => r.id === id);
export const counts = computed(() =>
  Object.fromEntries(
    Object.entries(db.value).map(([kind, list]) => [kind, list.length]),
  ),
);

// Merge the records changed since this tab's revision, keeping each list in
// the server's id order; an archived record arrives as null and leaves.
export function applyChanges(current, changes) {
  const next = { ...current };
  for (const { kind, id, record } of changes) {
    const list = (next[kind] ?? []).filter((r) => r.id !== id);
    if (record) {
      const index = list.findIndex((r) => r.id > id);
      list.splice(index < 0 ? list.length : index, 0, record);
    }
    next[kind] = list;
  }
  return next;
}

let inFlight = null;
// Bring the tab up to date. Concurrent callers share one request, except
// after a change: a poll already on its way may have left before it.
export async function refresh({ fresh = false } = {}) {
  if (fresh) await inFlight;
  inFlight ??= load().finally(() => (inFlight = null));
  return inFlight;
}
// Back to the sign-in page, forgetting what this tab knew. A phone forgets
// its token too, which the kitchen no longer takes.
function signedOut() {
  revision = "";
  if (phone) keepToken("");
  batch(() => {
    db.value = {};
    account.value = null;
    status.value = "signin";
  });
}

async function load() {
  // A phone that has not signed in has nothing to ask the kitchen yet.
  if (phone && !deviceToken()) return signedOut();
  let value;
  try {
    value = await api.state(revision);
  } catch (error) {
    // A tab that already shows the kitchen keeps it and tries again on the
    // next poll; only the first load has nothing else to show.
    if (status.value === "loading") {
      loadError.value = error.message;
      status.value = "error";
    }
    return;
  }
  if (value.signedOut) return signedOut();
  if (value.unchanged) return;
  batch(() => {
    db.value = value.changes
      ? applyChanges(db.value, value.changes)
      : value.records;
    sharing.value = value.sharing;
    account.value = value.account ?? null;
    status.value = "ready";
  });
  revision = value.revision;
}

// Other cooks' changes arrive every few seconds while the tab is in view,
// and at once when it comes back into view.
const POLL = 3000;
let timer = null;
function schedule() {
  clearTimeout(timer);
  if (document.visibilityState === "visible")
    timer = setTimeout(async () => {
      if (status.value === "ready") await refresh();
      schedule();
    }, POLL);
}
export function startPolling() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && status.value === "ready")
      void refresh();
    schedule();
  });
  schedule();
}

// Make a change, bring the tab up to date, and say what happened. A change
// the server can take back offers Undo for as long as the message shows.
export async function change(name, input, { done, undo = true } = {}) {
  try {
    const result = await api.write(name, input);
    await refresh({ fresh: true });
    if (done)
      toast(done, {
        undo:
          undo && result.action_id ? () => undoAction(result.action_id) : null,
      });
    return result;
  } catch (error) {
    if (error.status === 401) signedOut();
    throw error;
  }
}

export async function undoAction(action_id) {
  try {
    await api.write("history_undo", { action_id });
    await refresh({ fresh: true });
    toast("Undone.");
  } catch (error) {
    toast(error.message, { error: true });
  }
}

// A phone forgets its token even when the kitchen cannot be reached; a
// browser's cookie stays until the kitchen ends it.
export async function signOut() {
  try {
    await api.auth("signout", {});
  } catch (error) {
    if (!phone) throw error;
  }
  signedOut();
}

// After a sign-in, load the kitchen as this person.
export async function signedIn(message) {
  revision = "";
  signInError.value = "";
  status.value = "loading";
  await refresh();
  toast(message);
}

// The emailed link opens #/signin/<token>. The token leaves the address at
// once, so it is never bookmarked or shared, and never reaches a server log.
export async function confirmLink(token, leaveTo) {
  leaveTo();
  try {
    await api.auth("link/confirm", { token });
    await signedIn("You’re signed in.");
  } catch (error) {
    await refresh();
    // A server without sign-in has nothing to confirm: carry on inside.
    if (error.code === "SIGN_IN_DISABLED") return;
    if (status.value === "signin") signInError.value = error.message;
    else toast(error.message, { error: true });
  }
}
