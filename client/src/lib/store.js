import { signal, computed, batch } from "@preact/signals";
import * as api from "./api.js";
import { toast } from "./toast.js";
import { deviceToken, keepToken, phone } from "./device.js";
import { dropCopies, keepCopy, readCopy } from "./offline.js";
import { forgetWaiting } from "./outbox.js";

// The kitchen as this tab last saw it: every record by kind, in the server's
// id order. Pages read it through `records()`; nothing else holds a copy.
export const db = signal({});
// "loading" until the first answer, then "ready", "signin" or "error", or
// "welcome" for someone signed in to no household yet.
export const status = signal("loading");
export const loadError = signal("");
// Who is signed in, or null on a server without sign-in: their address,
// the household this device is in, all of theirs, and invites waiting.
export const account = signal(null);
// An emailed link the phone app asked for, opened here: it signs the app
// in once the person here confirms.
export const appLink = signal(null);
// An invite link opened here, with what it is for.
export const invitation = signal(null);
// True when the server is shared beyond this computer (sign-in is on).
export const sharing = signal(false);
// Whether the kitchen has the assistant: its host gave it an API key.
export const assistant = signal(false);
// Why the last sign-in attempt failed, shown on the sign-in page.
export const signInError = signal("");
// When the kitchen last answered, while it does not: what the tab shows is
// the kitchen as it was then. null while the kitchen answers.
export const offline = signal(null);
// Counts the kitchen's answers, for what waits to be sent when it answers.
export const answered = signal(0);
let revision = "";
let heard = 0;

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
// its token too, which the kitchen no longer takes, and its copy of the
// kitchen.
function signedOut() {
  revision = "";
  if (phone) keepToken("");
  void dropCopies();
  forgetWaiting();
  batch(() => {
    db.value = {};
    account.value = null;
    assistant.value = false;
    offline.value = null;
    status.value = "signin";
  });
}

// A phone shows its copy of the kitchen at once, then catches up from the
// revision the copy was made at.
async function restore() {
  const copy = await readCopy();
  if (!copy || status.value !== "loading") return;
  batch(() => {
    db.value = copy.records;
    sharing.value = copy.sharing;
    account.value = copy.account;
    status.value = "ready";
  });
  revision = copy.revision;
  heard = copy.saved_at;
}

async function load() {
  // A phone that has not signed in has nothing to ask the kitchen yet.
  if (phone && !deviceToken()) return signedOut();
  if (phone && status.value === "loading") await restore();
  let value;
  try {
    value = await api.state(revision);
  } catch (error) {
    // A tab that already shows the kitchen keeps it, says since when, and
    // tries again on the next poll; only the first load has nothing else to
    // show.
    if (status.value === "loading") {
      loadError.value = error.message;
      status.value = "error";
    } else offline.value = heard || Date.now();
    return;
  }
  heard = Date.now();
  if (value.signedOut) return signedOut();
  // Signed in, to no household yet: nothing of a kitchen to keep.
  if (value.account && !value.account.household) {
    revision = "";
    void dropCopies();
    batch(() => {
      db.value = {};
      account.value = value.account;
      sharing.value = true;
      assistant.value = false;
      offline.value = null;
      status.value = "welcome";
    });
    return;
  }
  if (value.unchanged && value.account) account.value = value.account;
  if (!value.unchanged) {
    batch(() => {
      db.value = value.changes
        ? applyChanges(db.value, value.changes)
        : value.records;
      sharing.value = value.sharing;
      account.value = value.account ?? null;
      assistant.value = Boolean(value.assistant);
      status.value = "ready";
    });
    revision = value.revision;
    keepCopy({
      records: db.value,
      revision,
      sharing: sharing.value,
      account: account.value,
    });
  }
  batch(() => {
    offline.value = null;
    answered.value++;
  });
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
    const result = await api.auth("link/confirm", { token });
    // A link the phone app asked for waits for this person to say so.
    if (result.app) {
      appLink.value = { token, email: result.email, approved: false };
      if (status.value === "loading") await refresh();
      return;
    }
    await signedIn("You’re signed in.");
  } catch (error) {
    await refresh();
    // A server without sign-in has nothing to confirm: carry on inside.
    if (error.code === "SIGN_IN_DISABLED") return;
    if (status.value === "signin") signInError.value = error.message;
    else toast(error.message, { error: true });
  }
}

// Confirm that the phone app waiting for this link may sign in.
export async function approveAppLink() {
  const link = appLink.value;
  await api.auth("link/confirm", { token: link.token, approve: true });
  appLink.value = { ...link, approved: true };
}

// An invite opens #/join/<token>. Like a sign-in link, the token leaves the
// address at once; the page then says what the invite is for.
export async function openInvite(token, leaveTo) {
  leaveTo();
  try {
    const { invite } = await api.auth("invite/open", { token });
    invitation.value = { token, ...invite };
  } catch (error) {
    invitation.value = { token, error: error.message };
  }
  if (status.value === "loading") await refresh();
}

// Accepting the invite signs this browser in as the address it was sent
// to, inside that household.
export async function acceptInvite() {
  const { token, household } = invitation.value;
  await api.auth("invite/accept", { token });
  invitation.value = null;
  await signedIn(`Welcome to ${household}.`);
}

// Moving between households, or into a new one: the tab forgets the kitchen
// it showed and loads the one it is in now.
export async function enterHousehold(path, input, message) {
  const result = await api.auth(path, input);
  revision = "";
  await dropCopies();
  forgetWaiting();
  batch(() => {
    db.value = {};
    status.value = "loading";
  });
  await refresh();
  if (message) toast(message);
  return result;
}
