import { closeSync, openSync, readSync } from "node:fs";
import { z } from "zod";
import {
  recipe,
  meal,
  ingredient,
  equipment,
  id,
  key,
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
  source_key: key,
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
          source_key: key,
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
const MAX_RECORDS = 10000;
export const backupSchema = z.object({
  format: z.literal("kooks"),
  schema_version: z.union([z.literal(1), z.literal(2)]),
  exported_at: z.iso.datetime(),
  records: z.array(record).max(MAX_RECORDS),
});
// One MCP result carries the whole backup as a string, twice; past this many
// bytes of photos and ebooks, the browser download or scripts/backup.mjs
// export it instead.
export const MAX_RESULT_FILE_BYTES = 64 * 1024 * 1024;
// File bytes are encoded in slices; a multiple of three keeps the base64 of
// consecutive slices one valid string.
const BASE64_SLICE = 3 * 1024 * 1024;

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

const header = () => ({
  format: "kooks",
  schema_version: 2,
  exported_at: new Date().toISOString(),
});

export function exportBackup(store) {
  const records = store.all();
  const fileBytes = records
    .filter((r) => r.kind === "asset")
    .reduce((sum, r) => sum + (r.data.byte_length ?? 0), 0);
  requireThat(
    fileBytes <= MAX_RESULT_FILE_BYTES,
    "BACKUP_TOO_LARGE",
    `This cookbook's photos and ebooks take ${Math.ceil(fileBytes / 1048576)} MB, more than one reply can carry. Download the backup from Settings › Backup in the browser app, or run node scripts/backup.mjs export on the computer that keeps the cookbook.`,
  );
  return {
    ...header(),
    records: records.map((record) =>
      record.kind === "asset" ? portableAsset(store, record) : record,
    ),
  };
}

// The same backup as exportBackup, as text pieces for a stream: records are
// read in one snapshot and each file's bytes, which never change, when its
// turn comes. No piece holds more than one record or a slice of a file, so a
// shelf of large ebooks never meets the engine's string limit.
export function* backupChunks(store) {
  const records = store.read(() => store.all());
  yield `${JSON.stringify(header()).slice(0, -1)},"records":[`;
  for (const [index, record] of records.entries()) {
    if (index) yield ",";
    if (record.kind !== "asset") {
      yield JSON.stringify(record);
      continue;
    }
    const { name, mime_type } = record.data;
    const text = JSON.stringify({
      ...record,
      data: { name, mime_type, base64: "" },
    });
    // Only the key itself can appear unescaped in the record's JSON.
    const at = text.indexOf('"base64":""') + '"base64":"'.length;
    yield text.slice(0, at);
    const bytes = store.read(() => store.blob("asset", record.id));
    for (let start = 0; start < bytes.length; start += BASE64_SLICE)
      yield bytes.subarray(start, start + BASE64_SLICE).toString("base64");
    yield text.slice(at);
  }
  yield "]}";
}

// Parse a backup file one record at a time. Each element of the top-level
// records array is cut out by its brackets and parsed alone; everything else
// (format, version, date) is kept, with records emptied, and parsed at the
// end into out.header. Structural characters are ASCII, so a multi-byte
// character split between two reads is never misread.
function* backupFileRecords(path, out, chunkSize) {
  const notBackup = () =>
    requireThat(false, "INVALID_BACKUP", "This file is not a Kooks backup.");
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(chunkSize);
  const header = [];
  let headerLength = 0,
    depth = 0,
    inString = false,
    escaped = false,
    inRecords = false,
    element = null;
  const keep = (bytes) => {
    headerLength += bytes.length;
    if (headerLength > 65536) notBackup();
    header.push(Buffer.from(bytes));
  };
  try {
    for (let read; (read = readSync(fd, buffer, 0, chunkSize, null)) > 0;) {
      const chunk = buffer.subarray(0, read);
      // Bytes from here on are not yet in the header or the current element.
      let from = 0;
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === 0x5c) escaped = true;
          else if (c === 0x22) inString = false;
          continue;
        }
        // Between records only separators may appear, and a record starts.
        if (inRecords && depth === 2 && !element) {
          if (c === 0x7b) element = { parts: [], from: i };
          else if (c === 0x5d) {
            inRecords = false;
            from = i;
          } else if (![0x2c, 0x20, 0x0a, 0x0d, 0x09].includes(c)) notBackup();
        }
        if (c === 0x22) inString = true;
        else if (c === 0x7b || c === 0x5b) {
          depth++;
          if (!inRecords && depth === 2 && c === 0x5b) {
            keep(chunk.subarray(from, i + 1));
            from = i + 1;
            inRecords = /"records"\s*:\s*\[$/.test(
              Buffer.concat(header).toString("utf8"),
            );
          }
        } else if (c === 0x7d || c === 0x5d) {
          depth--;
          if (element && depth === 2) {
            element.parts.push(chunk.subarray(element.from, i + 1));
            const text = Buffer.concat(element.parts).toString("utf8");
            element = null;
            yield JSON.parse(text);
          }
        }
      }
      if (element) {
        element.parts.push(Buffer.from(chunk.subarray(element.from)));
        element.from = 0;
      } else if (!inRecords) keep(chunk.subarray(from));
    }
  } finally {
    closeSync(fd);
  }
  try {
    out.header = JSON.parse(Buffer.concat(header).toString("utf8"));
  } catch {
    notBackup();
  }
}

// Restore a backup file of any size into an empty database. Call it inside
// an action, like the backup_restore tool.
export function restoreBackupFile(store, path, chunkSize = 1 << 20) {
  const out = {};
  const records = (function* () {
    let count = 0;
    for (const raw of backupFileRecords(path, out, chunkSize)) {
      requireThat(
        ++count <= MAX_RECORDS,
        "INVALID_BACKUP",
        "A backup holds at most 10,000 records.",
      );
      yield record.parse(raw);
    }
  })();
  const result = restoreRecords(store, records);
  // The header's records array was emptied while reading.
  requireThat(
    backupSchema.safeParse(out.header).success,
    "INVALID_BACKUP",
    "This file is not a Kooks backup.",
  );
  return result;
}

export function restoreBackup(store, input) {
  return restoreRecords(store, backupSchema.parse(input).records);
}

// Restore validated records one at a time, so a file's bytes leave memory as
// soon as they are stored, then check the references between them; any
// failure rolls the whole action back.
function restoreRecords(store, records) {
  requireThat(
    store.isEmpty(),
    "RESTORE_NOT_EMPTY",
    "Restore requires an empty database. Export the existing cookbook first and use a separate KOOKS_DB_PATH to restore.",
  );
  const restored = new Map();
  for (const { kind, ...record } of records) {
    const key = `${kind}:${record.id}`;
    requireThat(
      !restored.has(key),
      "INVALID_BACKUP",
      "Backup contains duplicate record IDs.",
    );
    if (kind === "asset") fileBytes(record.data);
    restored.set(key, { kind, ...store.restoreRecord(kind, record) });
  }
  checkReferences(restored);
  validateFeatureRelations(store);
  validateLibraryRelations(store);
  return { restored_records: restored.size };
}

function checkReferences(restored) {
  for (const record of restored.values()) {
    if (record.kind === "technique" || record.kind === "book")
      for (const recipeId of record.data.recipe_ids)
        requireThat(
          restored.has(`recipe:${recipeId}`),
          "INVALID_BACKUP",
          `A ${record.kind} references a missing recipe.`,
        );
    if (record.kind === "technique" || record.kind === "inspiration")
      for (const photoId of record.data.photo_ids)
        requireThat(
          restored.has(`asset:${photoId}`),
          "INVALID_BACKUP",
          `A ${record.kind} photo is missing.`,
        );
    if (record.kind === "inspiration" && record.data.recipe_id)
      requireThat(
        restored.has(`recipe:${record.data.recipe_id}`),
        "INVALID_BACKUP",
        "An idea references a missing recipe.",
      );
    if (record.kind === "book") {
      requireThat(
        restored.has(`asset:${record.data.file_id}`),
        "INVALID_BACKUP",
        "A book’s file is missing.",
      );
      requireThat(
        record.data.cover_id === null ||
          restored.has(`asset:${record.data.cover_id}`),
        "INVALID_BACKUP",
        "A book cover is missing.",
      );
    }
    if (record.kind === "batch" && record.data.session_id)
      requireThat(
        restored.has(`session:${record.data.session_id}`),
        "INVALID_BACKUP",
        "A batch references a missing cooking session.",
      );
    if (record.kind === "recipe") {
      if (record.data.original_recipe_id)
        requireThat(
          restored.has(`recipe:${record.data.original_recipe_id}`),
          "INVALID_BACKUP",
          "A variant references a missing original.",
        );
      for (const imageId of record.data.source_image_ids ?? [])
        requireThat(
          restored.has(`asset:${imageId}`),
          "INVALID_BACKUP",
          "A recipe image is missing.",
        );
    }
    if (record.kind === "meal")
      for (const part of record.data.dishes) {
        requireThat(
          restored.has(`recipe:${part.recipe_id}`),
          "INVALID_BACKUP",
          "A meal references a missing recipe.",
        );
        const recipeRecord = restored.get(`recipe:${part.recipe_id}`);
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
        restored.has(`recipe:${record.data.recipe_id}`),
        "INVALID_BACKUP",
        "A note references a missing recipe.",
      );
      requireThat(
        record.data.session_id === null ||
          restored.has(`session:${record.data.session_id}`),
        "INVALID_BACKUP",
        "A note references a missing cooking session.",
      );
      if (record.data.session_id) {
        const session = restored.get(`session:${record.data.session_id}`);
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
        restored.has(`${ref.kind}:${ref.id}`),
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
          restored.has(`recipe:${dish.recipe_id}`),
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
          restored.has(`${source.reference.kind}:${source.reference.id}`),
          "INVALID_BACKUP",
          "Shopping source references a missing record.",
        );
        for (const contribution of source.contributions)
          requireThat(
            contribution.source_key === source.source_key &&
              restored.has(`recipe:${contribution.recipe_id}`),
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
}
