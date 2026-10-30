// Accessibility helpers both apps use. Both apps draw a page by replacing its
// markup, which throws away what the person was doing in it: the focused
// control, the caret in a text box, the sections they opened and how far they
// scrolled. keepPlace captures those before a redraw and restores them
// afterwards, matching elements by what they are rather than by node identity.

// The attributes that say what a control is. Labels and pressed states are
// left out because a redraw may change them while the control stays the same.
const IDENTITY = [
  "id",
  "name",
  "href",
  "for",
  "data-action",
  "data-change",
  "data-search",
  "data-setting",
  "data-id",
  "data-kind",
  "data-dish",
  "data-step",
  "data-task",
  "data-timer",
  "data-item",
  "data-allocation",
  "data-source",
  "data-index",
  "data-page",
  "data-facet",
  "data-value",
  "data-key",
  "data-delta",
  "data-view",
  "data-tab",
  "data-method",
  "data-target",
  "data-buy",
  "data-review",
  "data-day",
];
const TEXT_TYPES = new Set(["text", "search", "url", "tel", "password"]);

function identity(el) {
  const parts = [el.localName];
  for (const name of IDENTITY)
    if (el.hasAttribute(name)) parts.push(`${name}=${el.getAttribute(name)}`);
  if (el.type === "checkbox" || el.type === "radio")
    parts.push(`value=${el.getAttribute("value")}`);
  return parts.join("|");
}
// A summary's words without its counts, so "In the basket · 3" stays itself.
const summaryText = (details) =>
  (details.querySelector(":scope > summary")?.textContent ?? "")
    .replace(/\d+/g, "#")
    .trim();

// Where an element sits: its identity and which of the elements sharing that
// identity it is, in document order.
export function placeOf(el, root = document) {
  const id = identity(el);
  const same = [...root.querySelectorAll(el.localName)].filter(
    (other) => identity(other) === id,
  );
  return { id, index: same.indexOf(el), tag: el.localName };
}
export function findPlace(place, root = document) {
  if (!place) return null;
  const same = [...root.querySelectorAll(place.tag)].filter(
    (el) => identity(el) === place.id,
  );
  return same[place.index] ?? same[0] ?? null;
}
const focusable = (el) =>
  el?.isConnected && !el.disabled && !el.closest("[hidden], [inert]");

// Runs draw(), which replaces markup inside root, and puts back the focus,
// caret, open disclosures, expanded toggles and scroll position from before.
// When the focused control is gone, focus moves to the element `fallback`
// returns (the main landmark) instead of being dropped onto the page body.
export function keepPlace(root, draw, { fallback = null } = {}) {
  const active = document.activeElement;
  const focused =
    active && active !== document.body && root.contains(active)
      ? {
          place: placeOf(active, root),
          selection:
            (active.localName === "textarea" || TEXT_TYPES.has(active.type)) &&
            active.selectionStart != null
              ? [
                  active.value,
                  active.selectionStart,
                  active.selectionEnd,
                  active.selectionDirection,
                  active.scrollTop,
                ]
              : null,
        }
      : null;
  const disclosures = [...root.querySelectorAll("details")].map((d) => ({
    key: summaryText(d),
    open: d.open,
  }));
  const toggles = [
    ...root.querySelectorAll("[aria-controls][aria-expanded]"),
  ].map((el) => ({
    place: placeOf(el, root),
    expanded: el.getAttribute("aria-expanded") === "true",
  }));
  const { scrollX, scrollY } = window;

  draw();

  // Disclosures are matched by their summary words and, for repeats, order.
  const seen = new Map();
  for (const details of root.querySelectorAll("details")) {
    const key = summaryText(details);
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    const before = disclosures.filter((d) => d.key === key)[nth];
    if (before) details.open = before.open;
  }
  for (const toggle of toggles) {
    const el = findPlace(toggle.place, root);
    const target =
      el && document.getElementById(el.getAttribute("aria-controls"));
    if (
      !target ||
      (el.getAttribute("aria-expanded") === "true") === toggle.expanded
    )
      continue;
    target.hidden = !toggle.expanded;
    el.setAttribute("aria-expanded", String(toggle.expanded));
  }
  window.scrollTo(scrollX, scrollY);
  if (!focused) return;
  const el = findPlace(focused.place, root);
  if (focusable(el)) {
    el.focus({ preventScroll: true });
    const [value, start, end, direction, scrollTop] = focused.selection ?? [];
    if (focused.selection && el.value === value) {
      el.setSelectionRange(start, end, direction);
      el.scrollTop = scrollTop;
    }
  } else fallback?.()?.focus({ preventScroll: true });
}

// Reads a short message to screen readers through a polite live region.
// Clearing it first lets the same words be read again.
let announcement;
export function announce(
  message,
  region = document.getElementById("announcer"),
) {
  if (!region) return;
  clearTimeout(announcement);
  region.textContent = "";
  announcement = setTimeout(() => {
    region.textContent = message;
  }, 100);
}
