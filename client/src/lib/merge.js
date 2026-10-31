// Meeting an edit made on this device with what changed in the kitchen
// meanwhile, part by part: a part only one side changed takes that side's
// change, and a part both changed differently is a clash for the member to
// settle. `base` is the record as the edit started from it.

// Empty values and the defaults the kitchen fills in (null, "", [], false)
// say nothing, so a part that only gained or lost one did not change.
function canonical(value) {
  if (Array.isArray(value))
    return value.length ? value.map(canonical) : undefined;
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = canonical(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === "" || value === false) return undefined;
  return value;
}
export const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// { merged, mine, theirs, clashes }: the parts merged, the names of the parts
// taken from each side, and those both changed differently. A clashing part
// holds the member's version in `merged` until it is settled.
export function mergeParts(base, mine, theirs) {
  const parts = new Set([
    ...Object.keys(base),
    ...Object.keys(mine),
    ...Object.keys(theirs),
  ]);
  const merged = {};
  const result = { merged, mine: [], theirs: [], clashes: [] };
  for (const part of parts) {
    const b = base[part];
    const m = mine[part];
    const t = theirs[part];
    let take = m;
    if (same(m, b)) {
      take = t;
      if (!same(t, b)) result.theirs.push(part);
    } else if (same(t, b)) result.mine.push(part);
    // Both made the same change: agreed, so neither side's alone.
    else if (!same(t, m)) result.clashes.push(part);
    if (take !== undefined) merged[part] = take;
  }
  return result;
}

// The parts of a recipe as the member knows them, in the editor's order.
export const recipeParts = {
  title: "Title",
  servings: "Servings",
  total_minutes: "Total time",
  active_minutes: "Hands-on time",
  ingredients: "Ingredients",
  steps: "Method",
  course: "Course",
  cuisine: "Cuisine",
  diets: "Diets",
  tags: "Tags",
  pan_count: "Pans",
  cleanup: "Clean-up",
  spice_level: "Spice",
  equipment: "Equipment",
  notes: "Notes",
  source_url: "Source",
  links: "Links",
  favorite: "Favorite",
  preferred: "Preferred version",
  original_text: "Original text",
  source_image_ids: "Photos of the original",
  original_recipe_id: "Original recipe",
};
const order = Object.keys(recipeParts);
export const partOrder = (a, b) =>
  (order.indexOf(a) + 1 || order.length + 1) -
  (order.indexOf(b) + 1 || order.length + 1);
export const partName = (part) => recipeParts[part] ?? part.replace(/_/g, " ");

// "the title", "the ingredients and the method", "the title, servings and
// notes".
export function partsPhrase(parts) {
  const names = [...parts]
    .sort(partOrder)
    .map((part) => partName(part).toLowerCase());
  if (names.length <= 1) return `the ${names[0] ?? "recipe"}`;
  return `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
