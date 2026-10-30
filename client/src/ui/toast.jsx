import { X } from "lucide";
import { current, dismiss, hold } from "../lib/toast.js";
import { Icon } from "./icon.jsx";

// The live region stays in the page so screen readers hear each message.
// The pointer or the focus on a message holds its countdown.
export function Toasts() {
  const t = current.value;
  const close = () => dismiss(t.id);
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {t && (
        <div
          class={`toast ${t.error ? "toast-error" : ""}`}
          onPointerEnter={() => hold("pointer", true)}
          onPointerLeave={() => hold("pointer", false)}
          onFocusIn={() => hold("focus", true)}
          onFocusOut={(event) =>
            hold("focus", event.currentTarget.contains(event.relatedTarget))
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
