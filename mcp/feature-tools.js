import { z } from "zod";
import * as s from "./schemas.js";
import * as f from "./feature-schemas.js";
import { Features, batchView } from "./features.js";
import { requireThat } from "./store.js";
import { extractRecipe, imageBytes, recognizeImage } from "./imports.js";

export function addFeatureTools(tool, store, kooks) {
  const features = new Features(store, kooks);
  tool(
    "pantry_save",
    "Save an ingredient you have, optionally its known amount and a use-soon flag. An unknown amount is a checklist entry, not exact inventory.",
    { ...s.save, pantry: f.pantry },
    false,
    (args) => ({ record: kooks.save("pantry", args, args.pantry) }),
  );
  tool(
    "member_save",
    "Save a household taste profile. Preferences match ingredient names or tags; these are taste preferences, not verified allergen checks.",
    { ...s.save, member: f.member },
    false,
    (args) => ({ record: kooks.save("member", args, args.member) }),
  );
  tool(
    "recipe_suggest",
    "Rank saved recipes by shopping gaps, use-soon ingredients, selected eaters and effort. Unknown effort is excluded when that filter is active; unknown pantry quantities are shown for checking.",
    {
      query: z.string().max(500).default(""),
      use_pantry: z.boolean().default(true),
      available_ingredients: z.array(s.text).max(500).default([]),
      member_ids: z.array(s.id).max(100).default([]),
      avoid_dislikes: z.boolean().default(true),
      servings: s.servings.optional(),
      max_active_minutes: z.number().int().nonnegative().max(10080).optional(),
      max_total_minutes: z.number().int().nonnegative().max(10080).optional(),
      max_pans: z.number().int().nonnegative().max(100).optional(),
      cleanup: z.enum(["low", "medium", "high"]).optional(),
      limit: s.pagination.limit,
    },
    true,
    (args) => features.recommend(args),
  );
  tool(
    "recipe_memory",
    "Read cooking notes, changes, next-time reminders and preferred variants for a recipe family. Notes never silently rewrite the original.",
    { id: s.id },
    true,
    (args) => features.memory(args.id),
  );
  tool(
    "recipe_variant_save",
    "Save a reviewed variation, retaining the original recipe and source. Marking it preferred unsets other preferred versions atomically.",
    {
      ...s.save,
      original_recipe_id: s.id,
      recipe: s.recipe,
      preferred: z.boolean().default(true),
    },
    false,
    (args) => features.variant(args),
  );
  tool(
    "batch_create",
    "Record an actually cooked batch, its portions, date and storage. Optionally use a finished session snapshot. Batches and leftover allocations never add shopping contributions.",
    {
      ...s.write,
      recipe_id: s.id,
      portions: s.servings,
      cooked_on: s.date,
      storage: z.enum(["fridge", "freezer"]).default("fridge"),
      session_id: s.id.optional(),
      dish_id: s.id.optional(),
      notes: z.string().max(3000).default(""),
    },
    false,
    (args) => features.createBatch(args),
  );
  tool(
    "batch_allocate",
    "Reserve or record eating portions from a batch, with an optional date and fridge/freezer location. Replace by allocation_id or remove with allocation:null. Over-allocation and stale edits are rejected.",
    {
      ...s.write,
      ...s.edit,
      allocation_id: s.id.optional(),
      allocation: f.allocation.omit({ id: true }).nullable(),
    },
    false,
    (args) => features.allocate(args),
  );
  tool(
    "batch_list",
    "List cooked batches with remaining, reserved and unallocated portions, including leftovers assigned to future meals.",
    {},
    true,
    () => ({ records: store.list("batch").map(batchView) }),
  );
  tool(
    "cooking_task_save",
    "Create, claim, reassign, complete or remove a shared cooking task. Read the session first. Updates use its version and never overwrite a newer cook’s changes.",
    {
      ...s.write,
      ...s.edit,
      task_id: s.id.optional(),
      task: f.task.omit({ id: true }).nullable(),
    },
    false,
    (args) => features.task(args),
  );
  tool(
    "price_save",
    "Save a user-confirmed package price in one currency, optionally transcribed from a receipt. Cost estimates use compatible units and never infer density or exchange rates.",
    {
      ...s.save,
      price: f.price,
    },
    false,
    (args) => ({ record: kooks.save("price", args, args.price) }),
  );
  tool(
    "cost_estimate",
    "Estimate ingredient-use cost and cost per portion. Missing prices or quantities leave totals incomplete, not zero. Uses latest compatible confirmed prices on/before as_of.",
    {
      source: s.source,
      currency: f.currency,
      as_of: s.date,
    },
    true,
    (args) => features.estimate(args),
  );
  tool(
    "budget_save",
    "Save or edit a weekly meal budget. week_start must be Monday. A week has one budget per currency.",
    { ...s.save, budget: f.budget },
    false,
    (args) => ({ record: kooks.save("budget", args, args.budget) }),
  );
  tool(
    "cost_week",
    "Compare planned cooking costs with the selected weekly budget. Show incomplete estimates and list leftover allocations without buying or costing the same cooked batch again.",
    {
      week_start: s.date,
      currency: f.currency,
      as_of: s.date,
    },
    true,
    (args) => features.weeklyCost(args),
  );
  function makeDraft(args, text, image = null) {
    const extracted = extractRecipe(text);
    let imageRecord = null;
    if (image) {
      imageBytes(image);
      imageRecord = store.put("asset", image);
      extracted.recipe.source_image_ids = [imageRecord.id];
    }
    const record = store.put("import", {
      title: extracted.recipe.title,
      original_text: text,
      image_id: imageRecord?.id ?? null,
      recipe: extracted.recipe,
      warnings: [
        ...(image
          ? [
              "Check the extracted text against the original photo before saving.",
            ]
          : []),
        ...extracted.warnings,
      ],
      status: "draft",
      recipe_id: null,
    });
    return { record, image_id: imageRecord?.id ?? null };
  }
  tool(
    "recipe_parse",
    "Preview conservative extraction of recipe text without saving. Keep unknown values and original units for review.",
    {
      text: z.string().trim().min(1).max(200000),
    },
    true,
    (args) => extractRecipe(args.text),
  );
  tool(
    "recipe_import_text",
    "Extract a reviewable draft from pasted text, preserving the entire original. Missing or unclear fields remain visible. Commit only after review.",
    {
      ...s.write,
      text: z.string().trim().min(1).max(200000),
    },
    false,
    (args) => makeDraft(args, args.text),
  );
  tool(
    "recipe_import_image",
    "Read an uploaded PNG/JPEG/WebP locally using Apple Vision (macOS) or Tesseract. Retains the original image and an editable recipe draft. No provider key or remote image upload is used.",
    {
      ...s.write,
      image: f.asset,
    },
    false,
    (args, recognized) => ({
      ...makeDraft(args, recognized.text, args.image),
      engine: recognized.engine,
    }),
    (args) => recognizeImage(args.image),
  );
  tool(
    "recipe_import_commit",
    "Save a reviewed import draft as a recipe exactly once. Preserve the original photo/text alongside the corrected recipe.",
    {
      ...s.write,
      ...s.edit,
      reviewed: z.literal(true),
      recipe: s.recipe,
    },
    false,
    (args) => {
      const draft = store.get("import", args.id);
      requireThat(
        draft.version === args.expected_version,
        "STALE_VERSION",
        "This draft changed. Reopen it before saving.",
      );
      requireThat(
        draft.data.status === "draft",
        "ALREADY_IMPORTED",
        "This draft is already saved. Open its recipe instead.",
      );
      const recipe = store.put("recipe", {
        ...args.recipe,
        original_text: draft.data.original_text,
        source_image_ids: draft.data.image_id ? [draft.data.image_id] : [],
        original_recipe_id: null,
        preferred: false,
      });
      store.put(
        "import",
        {
          ...draft.data,
          recipe: recipe.data,
          status: "saved",
          recipe_id: recipe.id,
        },
        draft.id,
        draft.version,
      );
      return { record: recipe };
    },
  );
}
