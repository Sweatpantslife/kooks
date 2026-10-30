import { effect } from "@preact/signals";
import { kept } from "./kept.js";

// "system" follows the device; "light" and "dark" are chosen by hand in
// Household › Look and units. The choice belongs to this browser, not the
// household.
export const theme = kept("kooks.theme", "system", (value) =>
  ["light", "dark"].includes(value),
);

export function startTheme() {
  effect(() => {
    const value = theme.value;
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  });
}
