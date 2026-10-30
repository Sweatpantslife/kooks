import { useEffect, useRef, useState } from "preact/hooks";
import { X } from "lucide";
import { current, dismiss } from "../lib/toast.js";
import { Icon } from "./icon.jsx";

// The live region stays in the page so screen readers hear each message.
// Focus that was on a message goes back to the page when it closes instead
// of being dropped.
export function Toasts() {
  const t = current.value;
  const box = useRef(null);
  const left = useRef(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  const close = () => {
    const hadFocus = box.current?.contains(document.activeElement);
    dismiss(t?.id);
    if (hadFocus) document.getElementById("main")?.focus();
  };

  useEffect(() => {
    left.current = t?.duration ?? 0;
    // A message that leaves under the pointer never hears it leave.
    if (!t) {
      setHovered(false);
      setFocused(false);
    }
  }, [t?.id]);
  useEffect(() => {
    if (!t || paused) return;
    const since = Date.now();
    const timer = setTimeout(close, left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - since;
    };
  }, [t?.id, paused]);

  return (
    <div class="toast-region" role="status" aria-live="polite">
      {t && (
        <div
          ref={box}
          class={`toast ${t.error ? "toast-error" : ""}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocusIn={() => setFocused(true)}
          onFocusOut={(event) =>
            setFocused(box.current?.contains(event.relatedTarget) ?? false)
          }
          onKeyDown={(event) => event.key === "Escape" && close()}
        >
          <span class="toast-text">{t.text}</span>
          {t.undo && (
            <button
              type="button"
              class="btn"
              onClick={() => {
                close();
                t.undo();
              }}
            >
              Undo
            </button>
          )}
          <button
            type="button"
            class="btn btn-icon"
            aria-label="Dismiss message"
            onClick={close}
          >
            <Icon icon={X} />
          </button>
        </div>
      )}
    </div>
  );
}
