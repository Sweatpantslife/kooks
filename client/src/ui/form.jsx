import { cloneElement } from "preact";
import { useState } from "preact/hooks";

// A labelled control with an optional hint under it. The control itself is
// the child, so it carries its own id and `aria-describedby={hint(id)}`.
// A short label such as "One per line" can borrow its section's heading, so
// the control is named "Ingredients, one per line" out loud.
export const hint = (id) => `${id}-hint`;
export function Field({ id, label, labelledBy, help, children }) {
  const control = labelledBy
    ? cloneElement(children, {
        "aria-labelledby": `${labelledBy} ${id}-label`,
      })
    : children;
  return (
    <div class="field">
      <label for={id} id={`${id}-label`}>
        {label}
      </label>
      {control}
      {help && (
        <p class="hint" id={hint(id)}>
          {help}
        </p>
      )}
    </div>
  );
}

// A form's one piece of work at a time: the button shows it is busy and a
// failure is said where the form is, not in a passing message.
export function useWork() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(work) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function FormError({ children }) {
  return (
    <p class="form-error" role="alert">
      {children}
    </p>
  );
}

// "" for an empty number field, so the server hears "not known".
export const numberOrNull = (value) =>
  String(value ?? "").trim() === "" ? null : Number(value);
