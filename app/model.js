import { z } from "zod";
import { clone as structuredClone } from "./compat.js";
import { initial, recipes } from "./sample-data.js";
import { MAX_LINKS, isWebUrl } from "../shared/links.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
const text = z.string().max(200000);
const positive = z.number().positive().max(10000);
const mapKey = z
  .string()
  .max(2000)
  .refine((key) => !["__proto__", "constructor", "prototype"].includes(key));
const dictionary = (schema) => z.record(mapKey, schema);
const ingredientSchema = z.object({
  k: text.optional(),
  n: text,
  q: z.number().nonnegative().nullable(),
  u: text,
  group: z
    .enum(["Produce", "Dairy & eggs", "Pantry", "Other"])
    .default("Other"),
  note: text.optional(),
  original: z.object({ q: z.number(), u: text }).nullable().optional(),
  raw: text.optional(),
  key: text.optional(),
  manual: z.boolean().optional(),
});
const link = z.object({
  url: z.string().max(4000).refine(isWebUrl, "Links must be web addresses."),
  title: z.string().max(4000).default(""),
});
const recipeSchema = z.object({
  id,
  title: text.min(1),
  description: text,
  tag: text,
  time: z.number().nonnegative().nullable(),
  servings: positive.nullable(),
  source: text,
  favorite: z.boolean().optional(),
  ingredients: z.array(ingredientSchema).max(500),
  steps: z
    .array(
      z.object({
        title: text,
        text,
        ids: z.array(text).default([]),
        mins: z.number().positive().max(10080).optional(),
      }),
    )
    .max(500),
  note: text,
  originalText: text.optional(),
  equipment: z.array(text).max(100),
  links: z.array(link).max(MAX_LINKS).default([]),
});
const component = z.object({
  id,
  recipeId: id,
  role: text,
  servings: positive,
});
const meal = z.object({
  id,
  title: text.min(1),
  note: text,
  components: z.array(component).min(1).max(50),
});
const plan = z.object({
  id,
  day: z.number().int().min(0).max(6),
  mealId: id.optional(),
  title: text.optional(),
  components: z.array(component).min(1).max(50).optional(),
  recipeId: id.optional(),
  servings: positive.optional(),
});
const timer = z.object({
  id,
  notificationId: z.number().int().min(1).max(2147483647),
  label: text,
  step: z.number().int().nonnegative().nullable(),
  dishId: id.nullable(),
  endAt: z.number().nonnegative(),
  pausedMs: z.number().nonnegative().nullable(),
  announced: z.boolean(),
});
const units = z.enum(["metric", "us", "original"]);
const session = z.object({
  recipeId: id,
  snapshot: recipeSchema,
  servings: positive,
  units,
  step: z.number().int().nonnegative(),
  timers: z.array(timer).max(60),
  mealId: id.optional(),
  mealTitle: text.optional(),
  activeDish: id.optional(),
  dishes: z
    .array(
      component.extend({
        snapshot: recipeSchema,
        step: z.number().int().nonnegative(),
        finished: z.boolean(),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
});
const stateSchema = z.object({
  view: z.enum([
    "library",
    "detail",
    "shop",
    "plan",
    "cook",
    "finished",
    "meals",
    "meal",
    "byk",
    "settings",
  ]),
  selected: id,
  query: text,
  filter: z.enum(["all", "favorites", "quick"]),
  servings: dictionary(positive),
  units,
  favorites: z.array(id).max(10000),
  contributions: dictionary(
    z.object({ title: text, items: z.array(ingredientSchema).max(500) }),
  ),
  bought: dictionary(z.boolean()),
  manual: z.array(ingredientSchema).max(10000),
  plan: z.array(plan).max(1000),
  session: session.nullable(),
  notes: dictionary(text),
  custom: z.array(recipeSchema).max(10000),
  meals: z.array(meal).max(1000),
  selectedMeal: id.optional(),
  planPickMeal: id.nullable().optional(),
  planPickRecipe: id.nullable().optional(),
});
const backupSchema = z.object({
  format: z.literal("kooks-mobile"),
  schemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  state: stateSchema,
  design: z.object({
    palette: z.enum(["Olive", "Clay"]),
    layout: z.enum(["Cards", "Rows"]),
    density: z.enum(["Comfortable", "Compact"]),
    preview: z.literal("Responsive"),
  }),
});

export const defaultDesign = {
  palette: "Olive",
  layout: "Cards",
  density: "Comfortable",
  preview: "Responsive",
};
export const newCookbook = () => ({
  format: "kooks-mobile",
  schemaVersion: 1,
  savedAt: new Date().toISOString(),
  state: structuredClone(initial),
  design: { ...defaultDesign },
});

export function snapshot(state, design) {
  return validateBackup({
    format: "kooks-mobile",
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    design,
    state: {
      ...state,
      query: "",
      view: ["capture", "editor", "review", "meal-editor"].includes(state.view)
        ? "library"
        : state.view,
    },
  });
}

function requireValid(condition, message) {
  if (!condition) throw new Error(`Invalid cookbook: ${message}`);
}

export function validateBackup(input) {
  const backup = backupSchema.parse(input);
  const state = backup.state;
  const ids = new Set([...recipes, ...state.custom].map((recipe) => recipe.id));
  requireValid(
    new Set(state.custom.map((r) => r.id)).size === state.custom.length,
    "duplicate recipes.",
  );
  requireValid(
    new Set(state.meals.map((m) => m.id)).size === state.meals.length,
    "duplicate meals.",
  );
  requireValid(
    new Set(state.plan.map((p) => p.id)).size === state.plan.length,
    "duplicate plan entries.",
  );
  const checkComponents = (components) => {
    requireValid(
      new Set(components.map((c) => c.id)).size === components.length,
      "duplicate dishes.",
    );
    components.forEach((c) =>
      requireValid(ids.has(c.recipeId), "a dish references a missing recipe."),
    );
  };
  state.meals.forEach((meal) => checkComponents(meal.components));
  state.plan.forEach((entry) => {
    if (entry.mealId) {
      requireValid(entry.title && entry.components, "incomplete planned meal.");
      requireValid(
        state.meals.some((meal) => meal.id === entry.mealId),
        "missing planned meal.",
      );
      checkComponents(entry.components);
    } else
      requireValid(
        ids.has(entry.recipeId) && entry.servings,
        "missing planned recipe.",
      );
  });
  requireValid(ids.has(state.selected), "missing selected recipe.");
  if (state.session) {
    const cooking = state.session;
    requireValid(
      cooking.step < cooking.snapshot.steps.length,
      "invalid cooking step.",
    );
    requireValid(
      new Set(cooking.timers.map((t) => t.notificationId)).size ===
        cooking.timers.length,
      "duplicate notification identifiers.",
    );
    requireValid(
      new Set(cooking.timers.map((t) => t.id)).size === cooking.timers.length,
      "duplicate timers.",
    );
    if (cooking.mealId) {
      requireValid(
        cooking.dishes &&
          cooking.dishes.some((d) => d.id === cooking.activeDish),
        "missing active dish.",
      );
      checkComponents(cooking.dishes);
      cooking.dishes.forEach((dish) =>
        requireValid(
          dish.step < dish.snapshot.steps.length,
          "invalid dish step.",
        ),
      );
    }
  }
  return backup;
}

export function parseBackup(text) {
  if (new TextEncoder().encode(text).length > 20 * 1024 * 1024)
    throw new Error("This backup exceeds the 20 MB limit.");
  return validateBackup(JSON.parse(text));
}
