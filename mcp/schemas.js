import { z } from "zod";

export const text = z.string().trim().min(1).max(500);
export const id = z.string().min(1).max(128);
export const version = z.number().int().positive();
export const servings = z.number().min(0.01).max(10000);
const note = z.string().max(30000);
export const ingredient = z.object({
  name: text,
  quantity: z.number().nonnegative().max(1e9).nullable().default(null),
  unit: z.string().trim().max(80).default(""),
  preparation: z.string().trim().max(500).default(""),
  category: z.string().trim().max(100).default("Other"),
  original_text: z.string().max(2000).default(""),
});
export const equipment = z.object({
  name: text,
  quantity: z.number().int().positive().max(1000).default(1),
  capacity: z.string().max(500).default(""),
  temperature_celsius: z
    .number()
    .min(-273.15)
    .max(1000)
    .nullable()
    .default(null),
  inferred: z.boolean().default(false),
});
const webUrl = z
  .url()
  .max(4000)
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Use an HTTP or HTTPS URL.",
  );
export const link = z.object({
  url: webUrl,
  title: z.string().trim().max(500).default(""),
});
export const recipe = z.object({
  title: text,
  servings: servings.nullable().default(null),
  original_text: z.string().max(200000).default(""),
  source_url: webUrl.nullable().default(null),
  links: z
    .array(link)
    .max(50)
    .default([])
    .describe(
      "Reference pages and videos for this recipe. The household apps embed YouTube, Vimeo, Facebook, Instagram and TikTok players and open other links in the browser; the server never fetches them.",
    ),
  ingredients: z.array(ingredient).max(500).default([]),
  steps: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(10000),
        duration_seconds: z
          .number()
          .int()
          .positive()
          .max(604800)
          .nullable()
          .default(null),
        equipment_names: z.array(text).max(50).default([]),
      }),
    )
    .max(500)
    .default([]),
  equipment: z.array(equipment).max(100).default([]),
  tags: z.array(text).max(100).default([]),
  notes: note.default(""),
  favorite: z.boolean().default(false),
  active_minutes: z
    .number()
    .int()
    .nonnegative()
    .max(10080)
    .nullable()
    .optional(),
  total_minutes: z
    .number()
    .int()
    .nonnegative()
    .max(10080)
    .nullable()
    .optional(),
  pan_count: z.number().int().nonnegative().max(100).nullable().optional(),
  cleanup: z.enum(["low", "medium", "high"]).nullable().optional(),
  spice_level: z.number().int().min(0).max(3).nullable().optional(),
  original_recipe_id: id.nullable().optional(),
  preferred: z.boolean().optional(),
  source_image_ids: z.array(id).max(20).optional(),
});
export const meal = z.object({
  title: text,
  dishes: z
    .array(
      z.object({
        recipe_id: id,
        servings: servings.nullable().default(null),
        label: z.string().max(500).default(""),
      }),
    )
    .min(1)
    .max(50),
  notes: note.default(""),
});
export const source = z.object({
  kind: z.enum(["recipe", "meal", "plan"]),
  id,
  servings: servings
    .optional()
    .describe(
      "Recipe sources only. Meal dishes have their own servings; plans keep their snapshot.",
    ),
});
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }, "Use a real calendar date in YYYY-MM-DD format.");
export const kind = z.enum([
  "recipe",
  "meal",
  "plan",
  "shopping",
  "equipment",
  "session",
  "note",
  "pantry",
  "member",
  "batch",
  "price",
  "budget",
  "asset",
  "import",
]);
export const write = {
  request_id: id.describe(
    "Unique key for this action. Reuse the same key and arguments on a retry.",
  ),
};
export const edit = {
  id,
  expected_version: version.describe(
    "Version from the latest read; stale edits are rejected.",
  ),
};
export const save = {
  ...write,
  id: id.optional(),
  expected_version: version.optional(),
};
export const pagination = {
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().nonnegative().default(0),
};
