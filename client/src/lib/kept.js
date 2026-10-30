import { signal, effect } from "@preact/signals";

// A choice this browser keeps between visits, such as its colours or its
// units. It belongs to the device, not the household; the fallback is never
// written down, so a later default can change it.
export function kept(key, fallback, valid) {
  let saved = null;
  try {
    saved = localStorage.getItem(key);
  } catch {
    // Private windows may refuse storage; the choice lasts for this visit.
  }
  const choice = signal(saved !== null && valid(saved) ? saved : fallback);
  effect(() => {
    const value = choice.value;
    try {
      if (value === fallback) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // As above.
    }
  });
  return choice;
}
