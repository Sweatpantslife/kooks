import { z } from "zod";
import {
  recipe,
  meal,
  ingredient,
  equipment,
  id,
  servings,
  date,
  version,
} from "./schemas.js";
import { requireThat } from "./store.js";
import { shoppingItems } from "./shopping.js";
import * as f from "./feature-schemas.js";
import { validateFeatureRelations } from "./features.js";
import * as l from "./library-schemas.js";
import { fileBytes, validateLibraryRelations } from "./library.js";

const reference = z.object({
  kind: z.enum(["recipe", "meal", "plan"]),
  id,
  version,
  servings: servings.optional(),
});
const snapshotIngredient = ingredient.extend({
  ingredient_index: z.number().int().nonnegative(),
  original_quantity: z.number().nonnegative().nullable(),
});
const dish = z.object({
  dish_id: id,
  recipe_id: id,
  recipe_version: version,
  title: z.string(),
  servings: servings.nullable(),
  original_servings: servings.nullable(),
  multiplier: z.number().positive(),
  ingredients: z.array(snapshotIngredient).max(500),
  steps: recipe.shape.steps,
  equipment: recipe.shape.equipment,
  original_text: recipe.shape.original_text,
  source_url: recipe.shape.source_url,
  links: recipe.shape.links.optional(),
  warnings: z.array(z.string()).max(100),
  label: z.string().optional(),
});
const contribution = snapshotIngredient.extend({
  contribution_id: z.string(),
  source_key: id,
  recipe_id: id,
  recipe_version: version,
  recipe_title: z.string(),
  dish_id: id,
  ingredient_key: z.string(),
});
const dataSchemas = {
  recipe,
  meal,
  pantry: f.pantry,
  member: f.member,
  price: f.price,
  budget: f.budget,
  asset: l.file,
  import: f.importDraft,
  technique: l.technique,
  inspiration: l.inspiration,
  book: l.book,
  batch: z.object({
    title: z.string(),
    recipe_id: id,
    dish,
    portions: servings,
    cooked_on: date,
    session_id: id.nullable(),
    storage: z.enum(["fridge", "freezer"]),
    allocations: z.array(f.allocation).max(10000),
    notes: z.string().max(3000),
  }),
  equipment: equipment
    .omit({ temperature_celsius: true, inferred: true })
    .extend({ quantity: z.number().int().nonnegative().max(1000) }),
  plan: z.object({
    date,
    slot: z.string(),
    notes: z.string(),
    title: z.string(),
    reference,
    dishes: z.array(dish).min(1).max(50),
  }),
  shopping: z.object({
    title: z.string(),
    sources: z
      .array(
        z.object({
          source_key: id,
          title: z.string(),
          reference,
          contributions: z.array(contribution).max(25000),
        }),
      )
      .max(1000),
    manual_items: z.array(ingredient.extend({ id })).max(10000),
    checked: z.array(id).max(10000),
  }),
  session: z.object({
    title: z.string(),
    reference,
    dishes: z.array(dish).min(1).max(50),
    status: z.enum(["active", "finished"]),
    notes: z.string(),
    progress: z
      .array(
        z.object({
          dish_id: id,
          current_step: z.number().int().nonnegative(),
          completed_steps: z.array(z.number().int().nonnegative()),
        }),
      )
      .max(50),
    tasks: z.array(f.task).max(1000).optional(),
    timers: z
      .array(
        z.object({
          id,
          label: z.string(),
          duration_seconds: z.number().int().positive().max(604800),
          member_id: id.nullable().optional(),
          dish_id: id.nullable(),
          step_index: z.number().int().nonnegative().nullable(),
          cancelled: z.boolean(),
          deadline: z.iso.datetime(),
        }),
      )
      .max(1000),
  }),
  note: z.object({
    recipe_id: id,
    session_id: id.nullable(),
    text: z.string().max(30000),
    cooked_on: date.nullable(),
    ...f.noteExtras,
  }),
};
const base = {
  id,
  version,
  archived: z.boolean(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
};
const record = z.discriminatedUnion(
  "kind",
  Object.entries(dataSchemas).map(([kind, data]) =>
    z.object({ ...base, kind: z.literal(kind), data }),
  ),
);
export const backupSchema = z.object({
  format: z.literal("kooks"),
  schema_version: z.union([z.literal(1), z.literal(2)]),
  exported_at: z.iso.datetime(),
  records: z.array(record).max(10000),
});

// The portable shape of an asset: the bytes travel inside the record again.
export function portableAsset(store, record) {
  return {
    ...record,
    data: {
      name: record.data.name,
      mime_type: record.data.mime_type,
      base64: store.blob("asset", record.id).toString("base64"),
    },
  };
}

export function exportBackup(store) {
  return {
    format: "kooks",
    schema_version: 2,
    exported_at: new Date().toISOString(),
    records: store
      .all()
      .map((record) =>
        record.kind === "asset" ? portableAsset(store, record) : record,
      ),
  };
}

export function restoreBackup(store, input) {
  const backup = backupSchema.parse(input);
  requireThat(
    store.isEmpty(),
    "RESTORE_NOT_EMPTY",
    "Restore requires an empty database. Export the existing cookbook first and use a separate KOOKS_DB_PATH to restore.",
  );
  const keys = new Set(
    backup.records.map((record) => `${record.kind}:${record.id}`),
  );
  requireThat(
    keys.size === backup.records.length,
    "INVALID_BACKUP",
    "Backup contains duplicate record IDs.",
  );
  for (const record of backup.records) {
    if (record.kind === "asset") fileBytes(record.data);
    if (record.kind === "technique" || record.kind === "book")
      for (const recipeId of record.data.recipe_ids)
        requireThat(
          keys.has(`recipe:${recipeId}`),
          "INVALID_BACKUP",
          `A ${record.kind} references a missing recipe.`,
        );
    if (record.kind === "technique" || record.kind === "inspiration")
      for (const photoId of record.data.photo_ids)
        requireThat(
          keys.has(`asset:${photoId}`),
          "INVALID_BACKUP",
          `A ${record.kind} photo is missing.`,
        );
    if (record.kind === "inspiration" && record.data.recipe_id)
      requireThat(
        keys.has(`recipe:${record.data.recipe_id}`),
        "INVALID_BACKUP",
        "An idea references a missing recipe.",
      );
    if (record.kind === "book") {
      requireThat(
        keys.has(`asset:${record.data.file_id}`),
        "INVALID_BACKUP",
        "A book’s file is missing.",
      );
      requireThat(
        record.data.cover_id === null ||
          keys.has(`asset:${record.data.cover_id}`),
        "INVALID_BACKUP",
        "A book cover is missing.",
      );
    }
    if (record.kind === "batch" && record.data.session_id)
      requireThat(
        keys.has(`session:${record.data.session_id}`),
        "INVALID_BACKUP",
        "A batch references a missing cooking session.",
      );
    if (record.kind === "recipe") {
      if (record.data.original_recipe_id)
        requireThat(
          keys.has(`recipe:${record.data.original_recipe_id}`),
          "INVALID_BACKUP",
          "A variant references a missing original.",
        );
      for (const imageId of record.data.source_image_ids ?? [])
        requireThat(
          keys.has(`asset:${imageId}`),
          "INVALID_BACKUP",
          "A recipe image is missing.",
        );
    }
    if (record.kind === "meal")
      for (const part of record.data.dishes) {
        requireThat(
          keys.has(`recipe:${part.recipe_id}`),
          "INVALID_BACKUP",
          "A meal references a missing recipe.",
        );
        const recipeRecord = backup.records.find(
          (r) => r.kind === "recipe" && r.id === part.recipe_id,
        );
        requireThat(
          record.archived || !recipeRecord.archived,
          "INVALID_BACKUP",
          "An active meal references an archived recipe.",
        );
        requireThat(
          part.servings === null || recipeRecord.data.servings !== null,
          "INVALID_BACKUP",
          "A meal cannot scale a recipe without a yield.",
        );
      }
    if (record.kind === "note") {
      requireThat(
        keys.has(`recipe:${record.data.recipe_id}`),
        "INVALID_BACKUP",
        "A note references a missing recipe.",
      );
      requireThat(
        record.data.session_id === null ||
          keys.has(`session:${record.data.session_id}`),
        "INVALID_BACKUP",
        "A note references a missing cooking session.",
      );
      if (record.data.session_id) {
        const session = backup.records.find(
          (r) => r.kind === "session" && r.id === record.data.session_id,
        );
        requireThat(
          session.data.dishes.some(
            (d) => d.recipe_id === record.data.recipe_id,
          ),
          "INVALID_BACKUP",
          "A note’s recipe does not belong to its cooking session.",
        );
      }
    }
    if (record.kind === "plan" || record.kind === "session") {
      const ref = record.data.reference;
      requireThat(
        keys.has(`${ref.kind}:${ref.id}`),
        "INVALID_BACKUP",
        "An occurrence references a missing source.",
      );
      const dishIds = new Set(record.data.dishes.map((d) => d.dish_id));
      requireThat(
        dishIds.size === record.data.dishes.length,
        "INVALID_BACKUP",
        "Duplicate dish IDs in a snapshot.",
      );
      for (const dish of record.data.dishes)
        requireThat(
          keys.has(`recipe:${dish.recipe_id}`),
          "INVALID_BACKUP",
          "A snapshot references a missing recipe.",
        );
      if (record.kind === "session") {
        requireThat(
          new Set(record.data.timers.map((timer) => timer.id)).size ===
            record.data.timers.length,
          "INVALID_BACKUP",
          "Duplicate timer IDs.",
        );
        const progressIds = new Set(record.data.progress.map((p) => p.dish_id));
        requireThat(
          progressIds.size === dishIds.size &&
            record.data.progress.length === dishIds.size,
          "INVALID_BACKUP",
          "Cooking progress must contain each dish once.",
        );
        for (const progress of record.data.progress) {
          const dish = record.data.dishes.find(
            (d) => d.dish_id === progress.dish_id,
          );
          requireThat(
            dish &&
              progress.current_step < Math.max(1, dish.steps.length) &&
              progress.completed_steps.every((i) => i < dish.steps.length),
            "INVALID_BACKUP",
            "Cooking progress references an invalid dish or step.",
          );
        }
        for (const timer of record.data.timers) {
          const dish = record.data.dishes.find(
            (d) => d.dish_id === timer.dish_id,
          );
          requireThat(
            timer.dish_id === null || dish,
            "INVALID_BACKUP",
            "Timer references an invalid dish.",
          );
          requireThat(
            timer.step_index === null ||
              (dish && timer.step_index < dish.steps.length),
            "INVALID_BACKUP",
            "Timer references an invalid step.",
          );
        }
      }
    }
    if (record.kind === "shopping") {
      requireThat(
        new Set(record.data.sources.map((s) => s.source_key)).size ===
          record.data.sources.length,
        "INVALID_BACKUP",
        "Duplicate shopping source keys.",
      );
      const manualIds = record.data.manual_items.map((item) => item.id);
      requireThat(
        new Set(manualIds).size === manualIds.length,
        "INVALID_BACKUP",
        "Duplicate manual item IDs.",
      );
      const contributionIds = record.data.sources.flatMap((s) =>
        s.contributions.map((c) => c.contribution_id),
      );
      requireThat(
        new Set(contributionIds).size === contributionIds.length,
        "INVALID_BACKUP",
        "Duplicate shopping contributions.",
      );
      for (const source of record.data.sources) {
        requireThat(
          keys.has(`${source.reference.kind}:${source.reference.id}`),
          "INVALID_BACKUP",
          "Shopping source references a missing record.",
        );
        for (const contribution of source.contributions)
          requireThat(
            contribution.source_key === source.source_key &&
              keys.has(`recipe:${contribution.recipe_id}`),
            "INVALID_BACKUP",
            "Invalid shopping contribution.",
          );
      }
      const itemIds = new Set(
        shoppingItems(record.data).map((item) => item.id),
      );
      requireThat(
        record.data.checked.every((id) => itemIds.has(id)),
        "INVALID_BACKUP",
        "A shopping checkmark references a missing item.",
      );
    }
  }
  for (const { kind, ...record } of backup.records)
    store.restoreRecord(kind, record);
  validateFeatureRelations(store);
  validateLibraryRelations(store);
  return { restored_records: backup.records.length };
}
