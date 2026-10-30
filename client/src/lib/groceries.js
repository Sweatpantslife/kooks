import { signal } from "@preact/signals";
import * as api from "./api.js";
import { change, record, records, refresh } from "./store.js";
import { amount, number } from "./kitchen.js";
import { normalize } from "../../../shared/quantities.js";

// The household keeps one list. A kitchen with more from the previous app
// shows the first, or the one chosen on the page.
export const chosen = signal("");
export const theList = () => {
  const lists = records("shopping");
  return lists.find((l) => l.id === chosen.value) ?? lists[0] ?? null;
};

// Changes to the list go one at a time, each against the version the last
// one left, so quick taps never trip over each other. Another cook's change
// in between costs one retry.
let queue = Promise.resolve();
export function onList(work) {
  const run = async () => {
    try {
      return await work(await ensureList());
    } catch (error) {
      if (error.code !== "STALE_VERSION" && error.code !== "STALE_PREVIEW")
        throw error;
      await refresh({ fresh: true });
      return work(theList());
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

async function ensureList() {
  const list = theList();
  if (list) return list;
  const { record: made } = await change("shopping_create", {
    title: "Groceries",
  });
  return record("shopping", made.id);
}

const edit = (list) => ({ id: list.id, expected_version: list.version });

export const check = (ids, checked) =>
  onList((list) =>
    change("shopping_check", { ...edit(list), item_ids: ids, checked }),
  );

export const addItem = (item, options) =>
  onList((list) =>
    change("shopping_manual_item", { ...edit(list), item }, options),
  );

// What a recipe, meal or planned day puts on the list, dish by dish, with
// the amounts the server will add: a plan keeps the dishes it was planned
// with, a meal scales each recipe to its dish.
export function dishesOf({ kind, id }) {
  const r = record(kind, id);
  if (!r) return null;
  if (kind === "plan")
    return r.data.dishes.map((dish) => ({ ...dish, factor: 1 }));
  if (kind === "recipe")
    return [
      {
        dish_id: "dish-1",
        title: r.data.title,
        ingredients: r.data.ingredients,
        factor: 1,
      },
    ];
  return r.data.dishes.flatMap((dish, index) => {
    const recipe = record("recipe", dish.recipe_id);
    if (!recipe) return [];
    const { servings } = recipe.data;
    return [
      {
        dish_id: `dish-${index + 1}`,
        title: recipe.data.title,
        ingredients: recipe.data.ingredients,
        factor: dish.servings && servings ? dish.servings / servings : 1,
      },
    ];
  });
}

export const ingredientKeys = (dishes) =>
  dishes.flatMap((dish) =>
    dish.ingredients.map((_, index) => `${dish.dish_id}:${index}`),
  );

// The source a group on the list was added from, as shopping_preview takes it.
const sourceOf = (group) => {
  const { kind, id, servings } = group.reference;
  return servings == null ? { kind, id } : { kind, id, servings };
};

// The ingredients a source has on the list now.
export const keysOn = (list, key) =>
  new Set(
    list?.data.sources
      .find((g) => g.source_key === key)
      ?.contributions.map((c) => c.ingredient_key) ?? [],
  );

// Put a source's ingredients on the list, leaving out the excluded ones; all
// of them excluded takes the source off. Adding it again replaces it.
export function putSource({ source, source_key, exclude, all }) {
  return onList(async (list) => {
    const on = list.data.sources.some((g) => g.source_key === source_key);
    if (exclude.length >= all.length)
      return on
        ? change("shopping_remove_source", { ...edit(list), source_key })
        : null;
    const input = {
      id: list.id,
      source,
      source_key,
      exclude_ingredients: exclude,
    };
    const preview = await api.tool("shopping_preview", input);
    return change("shopping_sync", {
      ...input,
      expected_version: preview.list_version,
      preview_token: preview.preview_token,
    });
  });
}

// Take rows off the list: a grocery added by hand goes, and a recipe's or
// plan's share of it is left out of that source from now on. Returns the
// results of the changes made, one per item or source.
export async function takeOut(rows) {
  const manual = [];
  const shares = new Map();
  for (const row of rows)
    for (const c of row.contributions) {
      if (c.source_key === "manual") manual.push(c.contribution_id);
      else
        shares.set(
          c.source_key,
          (shares.get(c.source_key) ?? new Set()).add(c.ingredient_key),
        );
    }
  const results = [];
  for (const item_id of manual)
    results.push(
      await onList((list) =>
        change("shopping_manual_item", { ...edit(list), item_id, item: null }),
      ),
    );
  for (const [source_key, gone] of shares) {
    const group = theList().data.sources.find(
      (g) => g.source_key === source_key,
    );
    if (!group) continue;
    const dishes = dishesOf(group.reference);
    const keep = [...keysOn(theList(), source_key)].filter(
      (key) => !gone.has(key),
    );
    // A plan taken off the week, or an archived recipe, can no longer be
    // read again, so its groceries only come off the list all together.
    if (!dishes && keep.length) continue;
    const all = dishes ? ingredientKeys(dishes) : [];
    results.push(
      await putSource({
        source: sourceOf(group),
        source_key,
        exclude: all.filter((key) => !keep.includes(key)),
        all,
      }),
    );
  }
  return results.filter(Boolean);
}

// An amount as a shop sells it: 1.5 kg rather than 1500 g, 3 rather than
// 3 each.
export function shopAmount({ quantity, unit }) {
  if (quantity == null) return "";
  if (unit === "each") return number(quantity);
  if (unit === "g" && quantity >= 1000)
    return `${number(quantity / 1000, "kg")} kg`;
  if (unit === "mL")
    return quantity >= 1000
      ? `${number(quantity / 1000, "l")} l`
      : `${number(quantity, "ml")} ml`;
  return amount({ quantity, unit });
}

// The recipes a grocery is for, as a short phrase.
export function forWhat(row) {
  const titles = [
    ...new Set(
      row.contributions
        .filter((c) => c.source_key !== "manual")
        .map((c) => c.recipe_title),
    ),
  ];
  return titles.length ? `for ${titles.join(", ")}` : "";
}

// What the household has said is at home, by name.
export const pantryEntry = (name) =>
  records("pantry").find((p) => normalize(p.data.name) === normalize(name));
