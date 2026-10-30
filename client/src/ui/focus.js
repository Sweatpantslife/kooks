// A row about to move away hands keyboard focus to the same control on the
// row after it, or before it, so a list can be worked through without
// starting again from the top.
export function passFocus(from, fallback) {
  if (from !== document.activeElement) return;
  const group = from.closest("[data-rows]");
  const controls = group
    ? [...group.querySelectorAll(`[data-row="${from.dataset.row}"]`)]
    : [];
  const at = controls.indexOf(from);
  (
    controls[at + 1] ??
    controls[at - 1] ??
    document.querySelector(fallback)
  )?.focus();
}
