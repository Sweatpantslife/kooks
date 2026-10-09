// Shopping-list arithmetic for the mobile cookbook. Every function takes the
// relevant slice of app state and returns new values instead of mutating.

// Combine every recipe contribution and manual item into one list. Matching
// ingredients (same key, unit, note and kind of quantity) merge their amounts.
export function listItems({ contributions, manual }) {
  const map = new Map();
  Object.entries(contributions).forEach(([source, c]) =>
    c.items.forEach((i) => {
      const key = `${i.k}|${i.u}|${i.note || ""}|${i.q === null ? "text" : "number"}`;
      const found = map.get(key);
      if (found) {
        if (i.q !== null) found.q += i.q;
        if (!found.sources.includes(c.title)) found.sources.push(c.title);
      } else map.set(key, { ...i, key, sources: [c.title], source });
    }),
  );
  manual.forEach((i) => map.set(i.key, { ...i, sources: ["Added by you"] }));
  return Array.from(map.values());
}

// Scale each requested recipe to its portions for the review screen.
export function buildReview(entries, recipeById) {
  return entries.map((e) => {
    const r = recipeById(e.recipeId),
      mult = r.servings ? e.servings / r.servings : 1;
    return {
      source: e.source,
      title: r.title + (e.context ? " · " + e.context : ""),
      servings: e.servings,
      yieldKnown: !!r.servings,
      items: r.ingredients.map((i) => ({
        ...i,
        q: i.q === null ? null : i.q * mult,
        original: null,
      })),
    };
  });
}

// Apply a reviewed selection: replace the group's earlier contributions, keep
// only the reviewed items, and keep checkmarks whose amounts did not change.
export function applyShoppingReview({ contributions, manual, bought }, review) {
  const before = new Map(
    listItems({ contributions, manual }).map((item) => [item.key, item.q]),
  );
  const next = { ...contributions };
  if (review.replaceGroup)
    Object.keys(next)
      .filter((key) => key.startsWith(review.replaceGroup + ":"))
      .forEach((key) => delete next[key]);
  review.entries.forEach((e, ei) => {
    const items = e.items.filter(
      (i, ii) => !review.excluded.has(ei + "-" + ii),
    );
    if (items.length) next[e.source] = { title: e.title, items };
    else delete next[e.source];
  });
  const kept = Object.fromEntries(
    listItems({ contributions: next, manual })
      .filter(
        (item) =>
          bought[item.key] &&
          before.has(item.key) &&
          before.get(item.key) === item.q,
      )
      .map((item) => [item.key, true]),
  );
  return { contributions: next, bought: kept };
}
