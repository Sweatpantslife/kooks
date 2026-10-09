import { z } from "zod";
import * as s from "./schemas.js";
import { Kooks } from "./kooks.js";
import { convert, scaleRecipe } from "./quantities.js";
import { requireThat } from "./store.js";
import {
  exportBackup,
  restoreBackup,
  backupSchema,
  portableAsset,
} from "./backup.js";
import { version } from "./version.js";
import { addFeatureTools } from "./feature-tools.js";
import { noteExtras } from "./feature-schemas.js";
import { batchView } from "./features.js";
import {
  courses,
  diets,
  suggestedCuisines,
  taxonomy,
} from "../shared/taxonomy.js";

export function createTools(store) {
  const kooks = new Kooks(store);
  const definitions = [];
  // Results are open objects; writes always carry the action key and whether
  // a request_id replay was served instead of a fresh action.
  const readOutput = z.looseObject({});
  const writeOutput = z.looseObject({
    action_id: z.string().optional(),
    replayed: z.boolean().optional(),
  });
  function tool(name, description, shape, readOnly, handler, prepare) {
    definitions.push({
      name,
      description,
      schema: z.strictObject(shape),
      outputSchema: readOnly ? readOutput : writeOutput,
      readOnly,
      handler,
      prepare,
    });
  }
  const syncInput = {
    id: s.id,
    source: s.source,
    source_key: s.id.describe(
      "Stable key for this shopping occurrence. Reuse to replace its contributions. Use a different key only for an additional occurrence.",
    ),
    exclude_ingredients: z
      .array(s.id)
      .max(25000)
      .default([])
      .describe(
        "Keys in dish_id:ingredient_index form; read prepare_source or the preview first.",
      ),
  };

  tool(
    "kooks_status",
    "Inspect the local cookbook, counts, capabilities, and limits. Start here on a new connection.",
    {},
    true,
    () => ({
      version,
      storage: "local SQLite",
      counts: Object.fromEntries(
        s.kind.options.map((kind) => [kind, store.list(kind).length]),
      ),
      capabilities: [
        "recipes",
        "scaling",
        "unit_conversion",
        "composed_meals",
        "plan_occurrences",
        "shopping",
        "equipment",
        "cooking_progress",
        "timer_deadlines",
        "notes",
        "history",
        "undo",
        "export_restore",
        "pantry_suggestions",
        "leftover_batches",
        "cooking_memory",
        "preferred_variants",
        "effort_filters",
        "taste_profiles",
        "shared_tasks",
        "cost_estimates",
        "weekly_budgets",
        "local_photo_import",
        "recipe_links",
        "recipe_facets",
      ],
      limits: [
        "One household database. Browser clients share this server; no hosted cloud sync or individual accounts.",
        "No direct WhatsApp, website, video, or model-provider connection. Recipe links are stored and embedded by the apps, never fetched here. Photo OCR runs locally and requires review.",
        "Timers store deadlines but do not deliver background alarms.",
        "Equipment checks are conditional; no automatic serving-time optimizer.",
      ],
    }),
  );
  tool(
    "kooks_list",
    "List/search records by kind. Search includes recipe ingredients, facets, tags and notes. Recipes can also be filtered by course, cuisine, diet labels, tags (all must match) and favorite; a course or cuisine filter excludes recipes where it is not recorded. Returns summaries; use kooks_get for full records.",
    {
      kind: s.kind,
      query: z.string().max(500).default(""),
      include_archived: z.boolean().default(false),
      ...s.facetFilters,
      favorite: z.boolean().optional(),
      ...s.pagination,
    },
    true,
    (args) => kooks.list(args.kind, args),
  );
  tool(
    "recipe_taxonomy",
    "Read the courses, cuisines, diet labels and tags in use across the cookbook with counts, plus the fixed course and diet lists. Reuse these names when saving or filtering instead of inventing new spellings.",
    { include_archived: z.boolean().default(false) },
    true,
    (args) => ({
      ...taxonomy(
        store.list("recipe", args.include_archived).map((r) => r.data),
      ),
      available_courses: courses,
      available_diets: diets,
      suggested_cuisines: suggestedCuisines,
      matching:
        "Courses and diet labels are fixed keys. Cuisines and tags match case-insensitively and keep the spelling they were first saved with. Diet labels are household declarations, not allergen checks.",
    }),
  );
  tool(
    "kooks_get",
    "Read a record and its current version before editing. Shopping records include combined items; cooking records include live remaining timer durations.",
    {
      kind: s.kind,
      id: s.id,
      include_archived: z.boolean().default(false),
    },
    true,
    (args) => {
      if (!args.include_archived && args.kind === "shopping")
        return { record: kooks.shoppingGet(args.id) };
      if (!args.include_archived && args.kind === "session")
        return { record: kooks.cookingGet(args.id) };
      if (!args.include_archived && args.kind === "batch")
        return { record: batchView(store.get("batch", args.id)) };
      if (args.kind === "asset")
        return {
          record: portableAsset(
            store,
            store.get("asset", args.id, args.include_archived),
          ),
        };
      return { record: store.get(args.kind, args.id, args.include_archived) };
    },
  );
  tool(
    "recipe_save",
    "Create a recipe or replace an existing recipe’s full data. Read before editing. Preserve original_text/source_url/links and the course, cuisine, diets and tags, keep uncertain quantities or yield null, and flag inferred equipment. links hold reference pages and YouTube, Vimeo, Facebook, Instagram or TikTok videos that the household apps embed. Check recipe_taxonomy before adding a cuisine or tag. Parse user-provided material in the host agent; this tool does not fetch sources or links.",
    {
      ...s.save,
      recipe: s.recipe,
    },
    false,
    (args) => ({ record: kooks.save("recipe", args, args.recipe) }),
  );
  tool(
    "recipe_scale",
    "Preview scaled quantities without rewriting the original recipe, cooking times, or temperatures. Missing yield blocks scaling.",
    {
      id: s.id,
      servings: s.servings.optional(),
    },
    true,
    (args) => ({
      recipe: scaleRecipe(store.get("recipe", args.id), args.servings),
    }),
  );
  tool(
    "quantity_convert",
    "Convert compatible mass, volume or temperature units. Cup/spoon conversions require explicit us_ or metric_ conventions. Never guesses ingredient density.",
    {
      quantity: z.number().min(-1e9).max(1e9),
      from: s.text,
      to: s.text,
    },
    true,
    (args) => convert(args.quantity, args.from, args.to),
  );
  tool(
    "meal_save",
    "Create or replace a reusable meal composed of recipes, each with its own servings. This does not schedule it, alter existing lists, or rewrite active cooking sessions.",
    {
      ...s.save,
      meal: s.meal,
    },
    false,
    (args) => ({
      record: kooks.save("meal", args, kooks.validateMeal(args.meal)),
    }),
  );
  tool(
    "prepare_source",
    "Preview a recipe, composed meal, or scheduled occurrence: scaled dish snapshots, ingredient keys, equipment availability and conditional conflicts. Keep dish order and original step order when planning.",
    {
      source: s.source,
    },
    true,
    (args) => {
      const resolved = kooks.resolve(args.source);
      return { ...resolved, equipment: kooks.equipmentOverview(resolved) };
    },
  );
  tool(
    "plan_save",
    "Schedule a recipe or meal on a calendar date, or explicitly replace a scheduled occurrence. Each occurrence retains its own recipe snapshots until explicitly replaced.",
    {
      ...s.save,
      source: s.source,
      date: s.date,
      slot: s.text.default("Dinner"),
      notes: z.string().max(30000).default(""),
    },
    false,
    (args) => ({ record: kooks.plan(args) }),
  );
  tool(
    "shopping_create",
    "Create an empty shopping list. Next use shopping_preview and shopping_sync to add a recipe, meal, or occurrence.",
    {
      ...s.write,
      title: s.text,
    },
    false,
    (args) => ({
      record: store.put("shopping", {
        title: args.title,
        sources: [],
        manual_items: [],
        checked: [],
      }),
    }),
  );
  tool(
    "shopping_preview",
    "Preview adding/replacing one source’s contributions. Returns a diff, a preview_token, and list_version. Show relevant changes before shopping_sync. Unknown quantities and incompatible units remain separate.",
    syncInput,
    true,
    (args) => {
      const { data, ...preview } = kooks.shoppingPreview(args);
      return preview;
    },
  );
  tool(
    "shopping_sync",
    "Apply an exact shopping_preview using its token and list_version as expected_version. The same source_key replaces contributions, preventing repeated meal updates from duplicating groceries. Changed items become unchecked.",
    {
      ...syncInput,
      ...s.write,
      expected_version: s.version,
      preview_token: s.id,
    },
    false,
    (args) => kooks.shoppingSync(args),
  );
  tool(
    "shopping_remove_source",
    "Remove one occurrence’s contributions from a list. Other sources, manual items and unchanged checkmarks remain. This action can be undone.",
    {
      ...s.write,
      ...s.edit,
      source_key: s.id,
    },
    false,
    (args) => kooks.shoppingRemove(args),
  );
  tool(
    "shopping_manual_item",
    "Add a manual grocery item, replace it by item_id, or remove it by passing item:null and item_id. Manual items remain separate contributions in combined totals.",
    {
      ...s.write,
      ...s.edit,
      item_id: s.id.optional(),
      item: s.ingredient.nullable(),
    },
    false,
    (args) => kooks.shoppingManual(args),
  );
  tool(
    "shopping_check",
    "Mark combined grocery items bought or unbought using item IDs from the latest list read. Multiple items can be changed atomically.",
    {
      ...s.write,
      ...s.edit,
      item_ids: z.array(s.id).min(1).max(1000),
      checked: z.boolean(),
    },
    false,
    (args) => kooks.shoppingCheck(args),
  );
  tool(
    "equipment_save",
    "Create or replace a household equipment inventory record. Quantity zero means unavailable; missing inventory is unknown. Preserve descriptive capacities instead of assuming compatibility.",
    {
      ...s.save,
      equipment: s.equipment
        .omit({ temperature_celsius: true, inferred: true })
        .extend({ quantity: z.number().int().nonnegative().max(1000) }),
    },
    false,
    (args) => ({ record: kooks.save("equipment", args, args.equipment) }),
  );
  tool(
    "cooking_start",
    "Start a persistent cooking session for a recipe, meal, or occurrence. Snapshot all dishes so later edits cannot change an active session. Each dish gets independent step progress.",
    {
      ...s.write,
      source: s.source,
    },
    false,
    (args) => kooks.startCooking(args),
  );
  tool(
    "cooking_progress",
    "Set a dish’s current step and completed steps. Indices are zero-based. Read the session before editing; progress for other dishes is preserved.",
    {
      ...s.write,
      ...s.edit,
      dish_id: s.id,
      current_step: z.number().int().nonnegative(),
      completed_steps: z.array(z.number().int().nonnegative()).max(500),
    },
    false,
    (args) => kooks.progress(args),
  );
  tool(
    "cooking_timer",
    "Start a named persistent timer deadline, optionally for a dish/step, or cancel one by cancel_timer_id. This server does not deliver background alarms; tell the cook to use a device timer when an audible alert is needed.",
    {
      ...s.write,
      ...s.edit,
      label: s.text.optional(),
      duration_seconds: z.number().int().positive().max(604800).optional(),
      dish_id: s.id.optional(),
      step_index: z.number().int().nonnegative().optional(),
      cancel_timer_id: s.id.optional(),
      member_id: s.id.nullable().optional(),
    },
    false,
    (args) => {
      requireThat(
        !args.cancel_timer_id ||
          (args.label === undefined &&
            args.duration_seconds === undefined &&
            args.dish_id === undefined &&
            args.step_index === undefined &&
            args.member_id === undefined),
        "INVALID_INPUT",
        "Cancel a timer or start one in a call, not both.",
      );
      return kooks.timer(args);
    },
  );
  tool(
    "cooking_finish",
    "Finish a cooking session, record session notes, and cancel its remaining timer deadlines. Use note_save for recipe-specific cooking notes.",
    {
      ...s.write,
      ...s.edit,
      notes: z.string().max(30000).default(""),
    },
    false,
    (args) => {
      const record = store.get("session", args.id);
      return {
        record: store.put(
          "session",
          {
            ...record.data,
            status: "finished",
            notes: args.notes,
            timers: record.data.timers.map((timer) => ({
              ...timer,
              cancelled: true,
            })),
          },
          args.id,
          args.expected_version,
        ),
      };
    },
  );
  tool(
    "note_save",
    "Create or replace a post-cook note attached to a recipe and optionally a cooking session. This does not modify the original recipe.",
    {
      ...s.save,
      recipe_id: s.id,
      session_id: s.id.nullable().default(null),
      text: z.string().trim().min(1).max(30000),
      cooked_on: s.date.nullable().default(null),
      ...noteExtras,
    },
    false,
    (args) => {
      store.get("recipe", args.recipe_id, true);
      if (args.session_id) {
        const session = store.get("session", args.session_id, true);
        requireThat(
          session.data.dishes.some((d) => d.recipe_id === args.recipe_id),
          "INVALID_REFERENCE",
          "This recipe is not part of the referenced cooking session.",
        );
      }
      const extras = Object.fromEntries(
        Object.keys(noteExtras)
          .filter((key) => args[key] !== undefined)
          .map((key) => [key, args[key]]),
      );
      return {
        record: kooks.save("note", args, {
          recipe_id: args.recipe_id,
          session_id: args.session_id,
          text: args.text,
          cooked_on: args.cooked_on,
          ...extras,
        }),
      };
    },
  );
  tool(
    "record_archive",
    "Archive or restore a record reversibly. Recipes used by active meals must be removed from those meals first. Historical plans, shopping contributions and cooking snapshots remain intact.",
    {
      ...s.write,
      ...s.edit,
      kind: s.kind,
      archived: z.boolean(),
    },
    false,
    (args) => kooks.archive(args),
  );
  tool(
    "history_list",
    "Read the local action history, affected IDs and versions, and action IDs for undo.",
    s.pagination,
    true,
    (args) => ({ actions: store.history(args.limit, args.offset) }),
  );
  tool(
    "history_undo",
    "Undo one action atomically if none of its records changed later. Creation is undone by archiving. A newer edit or active dependency blocks undo; it never overwrites another change.",
    {
      ...s.write,
      action_id: s.id,
    },
    false,
    (args) => store.undo(args.action_id),
  );
  tool(
    "backup_export",
    "Export all cookbook records and snapshots as versioned JSON. The host should save the returned backup to a file. This data export excludes action history and credentials.",
    {},
    true,
    () => ({ backup: exportBackup(store) }),
  );
  tool(
    "backup_restore",
    "Validate and restore a Kooks JSON export into an empty database, preserving IDs, versions and snapshots. Existing databases are never overwritten. Use a separate KOOKS_DB_PATH for a restore check.",
    {
      ...s.write,
      backup: backupSchema,
    },
    false,
    (args) => restoreBackup(store, args.backup),
  );

  addFeatureTools(tool, store, kooks);
  return definitions.map((definition) => ({
    ...definition,
    execute(input) {
      const args = definition.schema.parse(input);
      const run = (prepared) => {
        if (definition.readOnly)
          return store.read(() => definition.handler(args, prepared));
        return store.mutate(definition.name, args, () => {
          const result = definition.handler(args, prepared);
          kooks.validateRelations();
          return result;
        });
      };
      // OCR must finish before opening a SQLite transaction. Existing tools
      // stay synchronous for both MCP and direct application callers.
      return definition.prepare ? definition.prepare(args).then(run) : run();
    },
  }));
}
