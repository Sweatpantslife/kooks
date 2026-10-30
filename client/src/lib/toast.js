import { signal } from "@preact/signals";

// One message at a time. Messages stay 7 seconds; errors and messages that
// offer Undo stay 20, so that a keyboard or screen-reader user can reach them.
// The countdown pauses while the pointer or keyboard focus is on the message,
// and runs from the moment the message appears, however long the page takes
// to draw it. Each message remembers where the focus was when it appeared,
// to hand it back when it closes.
export const current = signal(null);
let next = 0;
let timer = null;
let deadline = 0;
let left = 0;
// What is holding the countdown: "pointer", "focus" or both.
const holds = new Set();

function countDown() {
  clearTimeout(timer);
  deadline = Date.now() + left;
  timer = setTimeout(() => dismiss(), left);
}

export function toast(text, { error = false, undo = null } = {}) {
  const focused = document.activeElement;
  current.value = {
    id: ++next,
    text,
    error,
    undo,
    from: focused?.closest(".toast-region") ? null : focused,
  };
  left = error || undo ? 20000 : 7000;
  if (holds.size) clearTimeout(timer);
  else countDown();
}

// The pointer or the focus arrived on the message (held) or left it.
export function hold(reason, held) {
  const was = holds.size > 0;
  if (held) holds.add(reason);
  else holds.delete(reason);
  if (!current.value) return;
  if (!was && holds.size) {
    clearTimeout(timer);
    left = Math.max(0, deadline - Date.now());
  } else if (was && !holds.size) countDown();
}

// Close the message with this id, or whichever is showing. Focus that was on
// it goes back where it was before, such as the button Undo just reversed, or
// else to the page, instead of being dropped.
export function dismiss(id) {
  const message = current.value;
  if (!message || (id && message.id !== id)) return;
  const hadFocus = document.activeElement?.closest(".toast-region");
  clearTimeout(timer);
  // A message that leaves under the pointer never hears it leave.
  holds.clear();
  current.value = null;
  if (!hadFocus) return;
  const back =
    message.from?.isConnected && message.from !== document.body
      ? message.from
      : document.getElementById("main");
  back?.focus();
}
