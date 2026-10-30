import { signal } from "@preact/signals";

// One message at a time. Messages stay 7 seconds; errors and messages that
// offer Undo stay 20, so that a keyboard or screen-reader user can reach them.
// The countdown pauses while the pointer or keyboard focus is on the message.
export const current = signal(null);
let next = 0;

export function toast(text, { error = false, undo = null } = {}) {
  current.value = {
    id: ++next,
    text,
    error,
    undo,
    duration: error || undo ? 20000 : 7000,
  };
}

export function dismiss(id) {
  if (!id || current.value?.id === id) current.value = null;
}
