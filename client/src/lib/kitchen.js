import {
  BookOpen,
  CakeSlice,
  Carrot,
  ChefHat,
  Coffee,
  CookingPot,
  Cookie,
  Croissant,
  Egg,
  Lightbulb,
  Salad,
  Soup,
  Utensils,
  UtensilsCrossed,
  Wheat,
} from "lucide";
import { courseLabel, dietLabel, facetText } from "../../../shared/taxonomy.js";
import {
  normalize,
  unitLabel,
  unitSpelling,
} from "../../../shared/quantities.js";
import { records, change } from "./store.js";
import { toast } from "./toast.js";

// What the household keeps, as the Recipes tab names it.
export const KINDS = [
  { kind: "recipe", label: "Recipes" },
  { kind: "meal", label: "Meals" },
  { kind: "inspiration", label: "To try" },
  { kind: "technique", label: "Techniques" },
  { kind: "book", label: "Books" },
];

// A tile without a photo is colored by course, with the course's icon, so a
// page of tiles reads at a glance. Every pair keeps 4.5:1 contrast.
const ART = {
  breakfast: ["saffron", Egg],
  starter: ["plum", Utensils],
  main: ["tomato", CookingPot],
  side: ["herb", Carrot],
  soup: ["sky", Soup],
  salad: ["herb", Salad],
  dessert: ["plum", CakeSlice],
  baking: ["saffron", Croissant],
  snack: ["stone", Cookie],
  drink: ["sky", Coffee],
  basic: ["stone", Wheat],
  meal: ["herb", UtensilsCrossed],
  inspiration: ["saffron", Lightbulb],
  technique: ["sky", ChefHat],
  book: ["plum", BookOpen],
};
export function art(kind, data) {
  const [tone, icon] = ART[kind === "recipe" ? data.course : kind] ?? [
    "stone",
    Utensils,
  ];
  return { tone, icon };
}

export const minutes = (n) =>
  n == null
    ? null
    : n < 60
      ? `${n} min`
      : `${Math.floor(n / 60)} hr${n % 60 ? ` ${n % 60} min` : ""}`;

// "25 min · Vegetarian", or the course when nothing else is known.
export function recipeMeta(d) {
  return [
    minutes(d.total_minutes ?? d.active_minutes),
    d.diets?.length ? dietLabel(d.diets[0]) : courseLabel(d.course),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function metaOf(kind, record) {
  const d = record.data;
  if (kind === "recipe") return recipeMeta(d);
  if (kind === "meal")
    return `Meal · ${d.dishes.length} ${d.dishes.length === 1 ? "dish" : "dishes"}`;
  if (kind === "inspiration")
    return d.recipe_id
      ? "In the cookbook"
      : d.status === "tried"
        ? "Tried it"
        : d.source
          ? `To try · ${d.source}`
          : "To try";
  if (kind === "technique") return "Technique";
  if (kind === "book") return d.author || "Book";
  return "";
}

// The words a search sees: the title, facets, ingredients and notes.
export function searchText(kind, record) {
  const d = record.data;
  const parts = [d.title, d.notes, d.summary, d.source, d.author];
  if (kind === "recipe")
    parts.push(facetText(d), ...d.ingredients.map((i) => i.name));
  else parts.push(...(d.tags ?? []));
  if (kind === "meal")
    parts.push(...d.dishes.map((dish) => title("recipe", dish.recipe_id)));
  return normalize(parts.filter(Boolean).join(" "));
}

export const title = (kind, id) =>
  records(kind).find((r) => r.id === id)?.data.title ?? "";

// Where each kind opens. Recipes and meals open here; the others open in the
// current app until their pages move.
export function hrefOf(kind, id) {
  const encoded = encodeURIComponent(id);
  if (kind === "recipe") return `#/recipes/${encoded}`;
  if (kind === "meal") return `#/recipes/meal/${encoded}`;
  if (kind === "inspiration") return `../#/inspiration/${encoded}`;
  if (kind === "technique") return `../#/techniques/${encoded}`;
  return `../#/library/${encoded}`;
}

// Amounts read as a cook writes them: ½ cup, 1¼ tsp, 3 cloves, 250 g.
const FRACTIONS = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];
const METRIC = new Set(["g", "kg", "mg", "ml", "l"]);
export function number(value, unit = "") {
  const whole = Math.floor(value);
  const part = value - whole;
  if (!METRIC.has(unitSpelling(unit)) && whole < 20 && part > 0.01) {
    const near = FRACTIONS.find(([f]) => Math.abs(part - f) < 0.015);
    if (near) return `${whole || ""}${near[1]}`;
  }
  const places = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return String(Number(value.toFixed(places)));
}

export function amount(ingredient, factor = 1) {
  if (ingredient.quantity == null) return "";
  const q = ingredient.quantity * factor;
  const unit = ingredient.unit ?? "";
  return `${number(q, unit)} ${unitLabel(unit, q)}`.trim();
}

// Ingredients the household has said are at home, by name.
export function atHome() {
  return new Set(
    records("pantry")
      .filter((p) => p.data.available)
      .map((p) => normalize(p.data.name)),
  );
}

// Every recipe in a recipe's family: the original and its variations.
export function family(record) {
  const root = record.data.original_recipe_id ?? record.id;
  return records("recipe").filter(
    (r) => r.id === root || r.data.original_recipe_id === root,
  );
}

// What the household wrote after cooking any version of this recipe,
// newest first.
export function memories(record) {
  const ids = new Set(family(record).map((r) => r.id));
  ids.add(record.id);
  const day = (n) => n.data.cooked_on ?? n.created_at?.slice(0, 10) ?? "";
  return records("note")
    .filter((n) => ids.has(n.data.recipe_id))
    .sort((a, b) => day(b).localeCompare(day(a)));
}

export async function toggleFavorite(r) {
  try {
    await change(
      "recipe_save",
      {
        id: r.id,
        expected_version: r.version,
        recipe: { ...r.data, favorite: !r.data.favorite },
      },
      {
        done: r.data.favorite
          ? `${r.data.title} is no longer a favorite.`
          : `${r.data.title} is a favorite.`,
      },
    );
  } catch (error) {
    toast(error.message, { error: true });
  }
}
