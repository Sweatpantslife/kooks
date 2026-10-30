import { nameKey } from "./aisles.js";
import { records } from "./store.js";

export const SPICE = ["No heat", "Mild", "Medium", "Hot"];

export const byName = (a, b) => a.data.name.localeCompare(b.data.name);

// "Ada, Ben and 2 more", for a summary line.
export function names(people) {
  const shown = people.slice(0, 3).map((p) => p.data.name);
  if (people.length > 3) shown.push(`${people.length - 3} more`);
  try {
    return new Intl.ListFormat(undefined, { type: "conjunction" }).format(
      shown,
    );
  } catch {
    return shown.join(", ");
  }
}

// Likes and dislikes are written as a list: "chickpeas, pasta".
export const listOf = (text) =>
  [...new Set(text.split(/[,\n]/).map((t) => t.trim()))].filter(Boolean);

// What the people at the table think of a recipe, by its ingredients and
// tags. A taste names the thing or the last words of it, so "olives" finds
// "kalamata olives" but never "olive oil".
export function tastes(d) {
  const things = [
    ...d.ingredients.map((i) => nameKey(i.name)),
    ...(d.tags ?? []).map(nameKey),
  ];
  const found = (list) =>
    list.filter((taste) => {
      const key = nameKey(taste);
      return key && things.some((t) => t === key || t.endsWith(` ${key}`));
    });
  return records("member")
    .slice()
    .sort(byName)
    .flatMap((m) => [
      ...found(m.data.likes).map((like) => ({
        liked: true,
        text: `${m.data.name} likes ${like}`,
      })),
      ...found(m.data.dislikes).map((dislike) => ({
        liked: false,
        text: `${m.data.name} doesn’t like ${dislike}`,
      })),
      ...(m.data.spice_tolerance != null &&
      d.spice_level != null &&
      d.spice_level > m.data.spice_tolerance
        ? [{ liked: false, text: `Hotter than ${m.data.name} likes` }]
        : []),
    ]);
}
