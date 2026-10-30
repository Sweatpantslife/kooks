import { signal, effect } from "@preact/signals";

// "system" follows the device; "light" and "dark" are chosen by hand in
// Household › Look. The choice belongs to this browser, not the household.
const KEY = "kooks.theme";
const saved = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const theme = signal(
  ["light", "dark"].includes(saved()) ? saved() : "system",
);

export function startTheme() {
  effect(() => {
    const value = theme.value;
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try {
      if (value === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      // Private windows may refuse storage; the choice lasts for this visit.
    }
  });
}
