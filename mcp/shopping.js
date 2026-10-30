import { canonicalQuantity, normalize, round } from "./quantities.js";
import { digest, requireThat } from "./store.js";

export function shoppingItems(data) {
  const contributions = [
    ...data.sources.flatMap((group) => group.contributions),
    ...data.manual_items.map((item) => ({
      ...item,
      contribution_id: item.id,
      source_key: "manual",
      recipe_id: null,
      recipe_title: null,
    })),
  ];
  const rows = new Map();
  // Many contributions share a row; hash each row's key once.
  const keys = new Map();
  const checked = new Set(data.checked);
  for (const item of contributions) {
    const normalized = canonicalQuantity(item.quantity, item.unit);
    const parts = [
      normalize(item.name),
      normalize(item.preparation),
      normalized.unit,
      item.quantity === null ? item.contribution_id : "quantified",
    ];
    const text = JSON.stringify(parts);
    let key = keys.get(text);
    if (!key) keys.set(text, (key = digest(parts)));
    if (!rows.has(key))
      rows.set(key, {
        id: key,
        name: item.name,
        preparation: item.preparation,
        category: item.category,
        quantity: item.quantity === null ? null : 0,
        unit: normalized.unit,
        checked: checked.has(key),
        contributions: [],
      });
    const row = rows.get(key);
    if (normalized.quantity !== null)
      row.quantity = round(row.quantity + normalized.quantity);
    row.contributions.push({
      ...item,
      canonical_quantity: normalized.quantity,
      canonical_unit: normalized.unit,
    });
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

// What must be bought for a row, as text that two rows share exactly when
// that is the same. A title or source revision can change without changing it.
function comparable(row) {
  const { checked, ...value } = row;
  return JSON.stringify({
    name: normalize(value.name),
    preparation: normalize(value.preparation),
    unit: value.unit,
    quantity: value.quantity,
    contributions: value.contributions
      .map((item) => ({
        id: item.contribution_id,
        quantity: item.canonical_quantity,
        unit: item.canonical_unit,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export function shoppingDiff(before, after) {
  const oldRows = new Map(shoppingItems(before).map((item) => [item.id, item]));
  const newRows = new Map(shoppingItems(after).map((item) => [item.id, item]));
  return {
    added: [...newRows.values()].filter((item) => !oldRows.has(item.id)),
    removed: [...oldRows.values()].filter((item) => !newRows.has(item.id)),
    changed: [...newRows.values()]
      .filter(
        (item) =>
          oldRows.has(item.id) &&
          comparable(item) !== comparable(oldRows.get(item.id)),
      )
      .map((after) => ({ before: oldRows.get(after.id), after })),
  };
}

export function preserveChecked(before, after) {
  const oldRows = new Map(shoppingItems(before).map((item) => [item.id, item]));
  after.checked = shoppingItems(after)
    .filter((item) => {
      const prior = oldRows.get(item.id);
      return prior?.checked && comparable(prior) === comparable(item);
    })
    .map((item) => item.id);
  return after;
}

export function buildSource(sourceKey, resolved, excluded) {
  const available = new Set(
    resolved.dishes.flatMap((dish) =>
      dish.ingredients.map((_, index) => `${dish.dish_id}:${index}`),
    ),
  );
  for (const key of excluded)
    requireThat(
      available.has(key),
      "INVALID_EXCLUSION",
      `Unknown ingredient key ${key}. Use the dish_id and ingredient_index from a source preview.`,
    );
  return {
    source_key: sourceKey,
    title: resolved.title,
    reference: resolved.reference,
    contributions: resolved.dishes.flatMap((dish) =>
      dish.ingredients.flatMap((item, index) => {
        const key = `${dish.dish_id}:${index}`;
        return excluded.includes(key)
          ? []
          : [
              {
                ...item,
                contribution_id: `${sourceKey}:${key}`,
                source_key: sourceKey,
                recipe_id: dish.recipe_id,
                recipe_version: dish.recipe_version,
                recipe_title: dish.title,
                dish_id: dish.dish_id,
                ingredient_key: key,
              },
            ];
      }),
    ),
  };
}
