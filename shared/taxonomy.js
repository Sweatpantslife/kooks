// Recipe facets shared by the MCP backend, the browser app and the mobile app:
// a fixed list of courses and diet labels, free-text cuisines and tags, and
// the matching and counting both clients use for their filters. Diet labels
// are what the household declares about a recipe, never an allergen check.
import { normalize } from "./quantities.js";

export const courses = [
  { key: "breakfast", label: "Breakfast" },
  { key: "starter", label: "Starter" },
  { key: "main", label: "Main" },
  { key: "side", label: "Side" },
  { key: "soup", label: "Soup" },
  { key: "salad", label: "Salad" },
  { key: "dessert", label: "Dessert" },
  { key: "baking", label: "Baking" },
  { key: "snack", label: "Snack" },
  { key: "drink", label: "Drink" },
  { key: "basic", label: "Basics" },
];
export const diets = [
  { key: "vegetarian", label: "Vegetarian" },
  { key: "vegan", label: "Vegan" },
  { key: "pescatarian", label: "Pescatarian" },
  { key: "gluten_free", label: "Gluten-free" },
  { key: "dairy_free", label: "Dairy-free" },
  { key: "nut_free", label: "Nut-free" },
  { key: "egg_free", label: "Egg-free" },
  { key: "kosher", label: "Kosher" },
  { key: "halal", label: "Halal" },
  { key: "low_carb", label: "Low-carb" },
];
export const courseKeys = courses.map((course) => course.key);
export const dietKeys = diets.map((diet) => diet.key);
export const MAX_TAGS = 100;
export const MAX_LABEL_LENGTH = 100;

// Cuisines offered while a cookbook has none of its own; the household's own
// names take over as soon as they exist.
export const suggestedCuisines = [
  "Israeli",
  "Middle Eastern",
  "Mediterranean",
  "Italian",
  "French",
  "Greek",
  "Moroccan",
  "Persian",
  "Indian",
  "Thai",
  "Chinese",
  "Japanese",
  "Mexican",
  "American",
  "Eastern European",
];

const labelled = (list) => {
  const labels = new Map(list.map((entry) => [entry.key, entry.label]));
  return (key) => labels.get(key) ?? null;
};
export const courseLabel = labelled(courses);
export const dietLabel = labelled(diets);

// The key two spellings of a label share: "Week-night " and "week-night".
export const labelKey = (value) => normalize(String(value ?? ""));

// Trim, drop empties and keep the first spelling of each label.
export function dedupeLabels(values) {
  const seen = new Set();
  const kept = [];
  for (const value of values ?? []) {
    const label = String(value ?? "").trim();
    const key = labelKey(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    kept.push(label);
  }
  return kept;
}

// "Weeknight, vegetarian,, Shabbat" → ["Weeknight", "vegetarian", "Shabbat"].
export const parseLabels = (text) =>
  dedupeLabels(String(text ?? "").split(","));
export const formatLabels = (values) => (values ?? []).join(", ");

// A recipe's facets in either app's shape; a missing field is unset.
export function facetsOf(recipe) {
  return {
    course: recipe?.course || null,
    cuisine: recipe?.cuisine || null,
    diets: recipe?.diets ?? [],
    tags: recipe?.tags ?? [],
  };
}

export const hasFacetFilters = (filters) =>
  Boolean(
    filters?.course ||
    filters?.cuisine ||
    filters?.diets?.length ||
    filters?.tags?.length,
  );

// Whether a recipe satisfies every selected facet. Several diets or tags all
// have to be present. A course or cuisine filter never matches a recipe whose
// course or cuisine is not recorded: unknown stays unknown.
export function matchesFacets(recipe, filters = {}) {
  const facets = facetsOf(recipe);
  if (filters.course && facets.course !== filters.course) return false;
  if (
    filters.cuisine &&
    labelKey(facets.cuisine ?? "") !== labelKey(filters.cuisine)
  )
    return false;
  for (const diet of filters.diets ?? [])
    if (!facets.diets.includes(diet)) return false;
  const tags = new Set(facets.tags.map(labelKey));
  for (const tag of filters.tags ?? [])
    if (!tags.has(labelKey(tag))) return false;
  return true;
}

// The words a free-text search should see for a recipe's facets.
export function facetText(recipe) {
  const facets = facetsOf(recipe);
  return [
    courseLabel(facets.course),
    facets.cuisine,
    ...facets.diets.map(dietLabel),
    ...facets.tags,
  ]
    .filter(Boolean)
    .join(" ");
}

// The vocabulary in use across recipes, for filter chips and for an agent
// reusing the household's names: counts per course, cuisine, diet and tag.
// A cuisine or tag written two ways is shown with its most used spelling;
// ties go to a spelling that starts with a capital, then to the one seen
// first.
export function taxonomy(recipes) {
  const count = (map, name) => {
    const key = labelKey(name);
    const entry = map.get(key) ?? { spellings: new Map(), count: 0 };
    entry.count++;
    entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
    map.set(key, entry);
  };
  const capitalised = (name) => (name[0] !== name[0].toLowerCase() ? 1 : 0);
  const preferred = (entry) => ({
    name: [...entry.spellings.entries()].sort(
      (a, b) => b[1] - a[1] || capitalised(b[0]) - capitalised(a[0]),
    )[0][0],
    count: entry.count,
  });
  const courseCounts = new Map(),
    cuisines = new Map(),
    dietCounts = new Map(),
    tags = new Map();
  for (const recipe of recipes ?? []) {
    const facets = facetsOf(recipe);
    if (facets.course) count(courseCounts, facets.course);
    if (facets.cuisine) count(cuisines, facets.cuisine);
    for (const diet of facets.diets) count(dietCounts, diet);
    for (const tag of facets.tags) count(tags, tag);
  }
  const byUse = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  const fixed = (list, counts) =>
    list
      .filter((entry) => counts.has(entry.key))
      .map((entry) => ({ ...entry, count: counts.get(entry.key).count }));
  return {
    courses: fixed(courses, courseCounts),
    cuisines: [...cuisines.values()].map(preferred).sort(byUse),
    diets: fixed(diets, dietCounts),
    tags: [...tags.values()].map(preferred).sort(byUse),
  };
}
