import { nameKey } from "./aisles.js";
import { auth } from "./api.js";
import { account, record, records, refresh } from "./store.js";

export const SPICE = ["No heat", "Mild", "Medium", "Hot"];

export const byName = (a, b) => a.data.name.localeCompare(b.data.name);

// The person at the table the signed-in member says they are, while that
// person is still at the table; null otherwise, and without sign-in.
export function me() {
  const id = account.value?.household?.person;
  return (id && record("member", id)) || null;
}

// The people at the table with whoever is signed in first.
export function meFirst(people) {
  const mine = me();
  const rest = people.filter((p) => p.id !== mine?.id).sort(byName);
  return mine ? [mine, ...rest] : rest;
}

// Say which person at the table you are, or (null) that you are none.
export async function beAtTable(person) {
  await auth("household/person", { person });
  await refresh({ fresh: true });
}

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
