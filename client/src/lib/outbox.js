import { signal } from "@preact/signals";

// Ticks on the grocery list made while the kitchen is out of reach, kept on
// this device until it answers. A tick only says "in the basket" or "back on
// the list", so the latest one for each grocery is all there is to keep,
// and sending one twice changes nothing.
//
// By list, then by grocery: { [listId]: { [itemId]: checked } }.
const KEY = "kooks.outbox";
const read = () => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};
export const waiting = signal(read());

function save(next) {
  waiting.value = next;
  try {
    if (Object.keys(next).length)
      localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for as long as the app is open.
  }
}

export function hold(listId, ids, checked) {
  const list = { ...waiting.value[listId] };
  for (const id of ids) list[id] = checked;
  save({ ...waiting.value, [listId]: list });
}

// Sent, or no longer on the list: a tick made since stays.
export function release(listId, ticks) {
  const list = { ...waiting.value[listId] };
  for (const [id, checked] of Object.entries(ticks))
    if (list[id] === checked) delete list[id];
  const next = { ...waiting.value, [listId]: list };
  if (!Object.keys(list).length) delete next[listId];
  save(next);
}

// A tick made since, with the kitchen answering, says the last word.
export function drop(listId, ids) {
  if (!waiting.value[listId]) return;
  release(
    listId,
    Object.fromEntries(ids.map((id) => [id, waiting.value[listId][id]])),
  );
}

export const waitingCount = () =>
  Object.values(waiting.value).reduce(
    (n, list) => n + Object.keys(list).length,
    0,
  );

export const forgetWaiting = () => save({});
