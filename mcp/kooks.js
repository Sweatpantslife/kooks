import { randomUUID } from "node:crypto";
import { digest, requireThat } from "./store.js";
import { normalize, scaleRecipe } from "./quantities.js";
import {
  buildSource,
  shoppingItems,
  shoppingDiff,
  preserveChecked,
} from "./shopping.js";
import { validateFeatureRelations, Features } from "./features.js";
import {
  facetText,
  hasFacetFilters,
  matchesFacets,
} from "../shared/taxonomy.js";

// Searchable text of a record: its string and number values, never its keys.
function searchText(value) {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value !== "object") return String(value);
  return (Array.isArray(value) ? value : Object.values(value))
    .map(searchText)
    .join(" ");
}

export class Kooks {
  constructor(store) {
    this.store = store;
  }

  save(kind, args, data) {
    requireThat(
      Boolean(args.id) === (args.expected_version !== undefined),
      "INVALID_INPUT",
      "Supply both id and expected_version for an edit, or neither for a new record.",
    );
    if (args.id) this.store.get(kind, args.id); // Archived records require explicit restore.
    return this.store.put(kind, data, args.id, args.expected_version);
  }

  list(
    kind,
    {
      query = "",
      include_archived = false,
      limit = 30,
      offset = 0,
      favorite,
      ...facets
    },
  ) {
    requireThat(
      kind === "recipe" || (favorite === undefined && !hasFacetFilters(facets)),
      "INVALID_INPUT",
      "course, cuisine, diets, tags and favorite filter recipes only.",
    );
    const q = normalize(query);
    const records = this.store
      .list(kind, include_archived)
      .filter(
        (record) =>
          (!q ||
            normalize(
              `${searchText(record.data)} ${kind === "recipe" ? facetText(record.data) : ""}`,
            ).includes(q)) &&
          (favorite === undefined || record.data.favorite === favorite) &&
          matchesFacets(record.data, facets),
      );
    return {
      total: records.length,
      records: records.slice(offset, offset + limit).map((record) => ({
        id: record.id,
        version: record.version,
        archived: record.archived,
        updated_at: record.updated_at,
        title:
          record.data.title ??
          record.data.name ??
          record.data.text?.slice(0, 200),
        ...(record.data.date
          ? { date: record.data.date, slot: record.data.slot }
          : {}),
        ...(record.data.status ? { status: record.data.status } : {}),
        ...(kind === "recipe"
          ? {
              course: record.data.course ?? null,
              cuisine: record.data.cuisine ?? null,
              diets: record.data.diets ?? [],
              tags: record.data.tags,
              favorite: record.data.favorite,
              servings: record.data.servings,
              total_minutes: record.data.total_minutes ?? null,
            }
          : {}),
      })),
      next_offset: offset + limit < records.length ? offset + limit : null,
    };
  }

  validateRelations() {
    // This also protects against an undo archiving a recipe that a later meal uses.
    for (const meal of this.store.list("meal")) this.validateMeal(meal.data);
    validateFeatureRelations(this.store);
  }

  resolve(source) {
    requireThat(
      source.servings === undefined || source.kind === "recipe",
      "INVALID_INPUT",
      "Only a direct recipe source accepts a servings override. Edit a meal’s individual dishes or create a new plan occurrence instead.",
    );
    const record = this.store.get(source.kind, source.id);
    if (source.kind === "recipe")
      return {
        title: record.data.title,
        reference: { ...source, version: record.version },
        dishes: [
          { dish_id: "dish-1", ...scaleRecipe(record, source.servings) },
        ],
      };
    if (source.kind === "plan")
      return {
        title: record.data.title,
        reference: { ...source, version: record.version },
        dishes: structuredClone(record.data.dishes),
      };
    return {
      title: record.data.title,
      reference: { ...source, version: record.version },
      dishes: record.data.dishes.map((dish, index) => ({
        dish_id: `dish-${index + 1}`,
        ...scaleRecipe(this.store.get("recipe", dish.recipe_id), dish.servings),
        label: dish.label,
      })),
    };
  }

  validateMeal(data) {
    for (const dish of data.dishes)
      scaleRecipe(this.store.get("recipe", dish.recipe_id), dish.servings);
    return data;
  }

  equipmentOverview(resolved) {
    const inventory = this.store.list("equipment");
    const needs = new Map();
    const warnings = resolved.dishes.flatMap((dish) =>
      dish.warnings.map((warning) => `${dish.title}: ${warning}`),
    );
    for (const dish of resolved.dishes)
      for (const required of dish.equipment) {
        const key = normalize(required.name);
        if (!needs.has(key))
          needs.set(key, {
            name: required.name,
            uses: [],
            inventory: inventory.filter(
              (record) => normalize(record.data.name) === key,
            ),
          });
        needs.get(key).uses.push({
          dish_id: dish.dish_id,
          recipe_title: dish.title,
          ...required,
        });
      }
    const requirements = [...needs.values()].map((need) => {
      const available = need.inventory.length
        ? need.inventory.reduce((sum, r) => sum + r.data.quantity, 0)
        : null;
      const simultaneousQuantity = need.uses.reduce(
        (sum, use) => sum + use.quantity,
        0,
      );
      const temperatures = [
        ...new Set(
          need.uses
            .map((use) => use.temperature_celsius)
            .filter((t) => t !== null),
        ),
      ];
      const conflicts = [];
      if (available === null) conflicts.push("Availability is unknown.");
      else if (available < simultaneousQuantity)
        conflicts.push(
          `If these uses overlap, ${simultaneousQuantity} are needed but ${available} are recorded. Plan sharing or sequential use.`,
        );
      if (
        temperatures.length > 1 &&
        (available === null || available < temperatures.length)
      )
        conflicts.push(
          `Different temperatures (${temperatures.join(", ")} °C) may require separate appliances or sequential cooking.`,
        );
      if (need.uses.some((use) => use.capacity))
        conflicts.push(
          "Check required capacities against the recorded equipment; capacity compatibility has not been inferred.",
        );
      if (need.uses.some((use) => use.inferred))
        conflicts.push("Some requirements were inferred and need review.");
      return {
        ...need,
        available_quantity: available,
        simultaneous_quantity: simultaneousQuantity,
        conflicts,
      };
    });
    return {
      requirements,
      warnings,
      timing:
        "This is a conditional overlap check, not an optimized cooking schedule. Original step order is preserved.",
    };
  }

  plan(args) {
    requireThat(
      args.source.kind !== "plan",
      "INVALID_INPUT",
      "Schedule a recipe or meal, not another plan occurrence.",
    );
    const resolved = this.resolve(args.source);
    return this.save("plan", args, {
      date: args.date,
      slot: args.slot,
      notes: args.notes,
      title: resolved.title,
      reference: resolved.reference,
      dishes: resolved.dishes,
    });
  }

  shoppingGet(id) {
    const record = this.store.get("shopping", id);
    return { ...record, items: shoppingItems(record.data) };
  }

  shoppingPreview(args) {
    const list = this.store.get("shopping", args.id);
    const resolved = this.resolve(args.source);
    const group = buildSource(
      args.source_key,
      resolved,
      args.exclude_ingredients,
    );
    const data = structuredClone(list.data);
    data.sources = data.sources.filter(
      (item) => item.source_key !== args.source_key,
    );
    data.sources.push(group);
    preserveChecked(list.data, data);
    return {
      list_version: list.version,
      preview_token: digest({ id: list.id, version: list.version, data }),
      diff: shoppingDiff(list.data, data),
      items: shoppingItems(data),
      source: resolved,
      equipment: this.equipmentOverview(resolved),
      data,
    };
  }

  shoppingSync(args) {
    const preview = this.shoppingPreview(args);
    requireThat(
      args.expected_version === preview.list_version,
      "STALE_VERSION",
      "The shopping list changed. Preview it again before applying.",
    );
    requireThat(
      args.preview_token === preview.preview_token,
      "STALE_PREVIEW",
      "The source or list changed, or the preview arguments differ. Preview again before applying.",
    );
    const record = this.store.put(
      "shopping",
      preview.data,
      args.id,
      args.expected_version,
    );
    return { record, items: shoppingItems(record.data), diff: preview.diff };
  }

  shoppingRemove(args) {
    const list = this.store.get("shopping", args.id);
    requireThat(
      list.data.sources.some((group) => group.source_key === args.source_key),
      "NOT_FOUND",
      "Shopping source does not exist.",
    );
    const data = structuredClone(list.data);
    data.sources = data.sources.filter(
      (group) => group.source_key !== args.source_key,
    );
    preserveChecked(list.data, data);
    const record = this.store.put(
      "shopping",
      data,
      args.id,
      args.expected_version,
    );
    return {
      record,
      items: shoppingItems(data),
      diff: shoppingDiff(list.data, data),
    };
  }

  shoppingManual(args) {
    const list = this.store.get("shopping", args.id);
    const data = structuredClone(list.data);
    if (args.item_id)
      requireThat(
        data.manual_items.some((item) => item.id === args.item_id),
        "NOT_FOUND",
        "Manual item does not exist.",
      );
    const itemId = args.item_id ?? randomUUID();
    data.manual_items = data.manual_items.filter((item) => item.id !== itemId);
    if (args.item) data.manual_items.push({ id: itemId, ...args.item });
    else
      requireThat(
        args.item_id,
        "INVALID_INPUT",
        "Removing an item requires item_id.",
      );
    preserveChecked(list.data, data);
    const record = this.store.put(
      "shopping",
      data,
      args.id,
      args.expected_version,
    );
    return { record, item_id: itemId, items: shoppingItems(data) };
  }

  shoppingCheck(args) {
    const list = this.store.get("shopping", args.id);
    const known = new Set(shoppingItems(list.data).map((item) => item.id));
    for (const id of args.item_ids)
      requireThat(
        known.has(id),
        "NOT_FOUND",
        `Shopping item ${id} does not exist.`,
      );
    const checked = new Set(list.data.checked);
    for (const id of args.item_ids) {
      if (args.checked) checked.add(id);
      else checked.delete(id);
    }
    const record = this.store.put(
      "shopping",
      { ...list.data, checked: [...checked] },
      args.id,
      args.expected_version,
    );
    return { record, items: shoppingItems(record.data) };
  }

  startCooking(args) {
    const resolved = this.resolve(args.source);
    const overview = this.equipmentOverview(resolved);
    const record = this.store.put("session", {
      title: resolved.title,
      reference: resolved.reference,
      dishes: resolved.dishes,
      status: "active",
      progress: resolved.dishes.map((dish) => ({
        dish_id: dish.dish_id,
        current_step: 0,
        completed_steps: [],
      })),
      timers: [],
      tasks: [],
      notes: "",
    });
    return {
      record,
      equipment: overview,
      memories: resolved.dishes.map((d) =>
        new Features(this.store, this).memory(d.recipe_id),
      ),
    };
  }

  cookingGet(id) {
    const record = this.store.get("session", id);
    return {
      ...record,
      timers: record.data.timers.map((timer) => ({
        ...timer,
        remaining_seconds: timer.cancelled
          ? null
          : Math.max(
              0,
              Math.ceil((Date.parse(timer.deadline) - Date.now()) / 1000),
            ),
        state: timer.cancelled
          ? "cancelled"
          : Date.parse(timer.deadline) <= Date.now()
            ? "elapsed"
            : "running",
      })),
      notification_support:
        "Deadlines persist, but this MCP process does not deliver background alarms. Use a device timer for an audible alert.",
    };
  }

  progress(args) {
    const record = this.store.get("session", args.id);
    requireThat(
      record.data.status === "active",
      "SESSION_FINISHED",
      "This cooking session is finished.",
    );
    const data = structuredClone(record.data);
    const dish = data.dishes.find((dish) => dish.dish_id === args.dish_id);
    requireThat(dish, "NOT_FOUND", "Dish does not exist in this session.");
    requireThat(
      args.current_step < dish.steps.length,
      "INVALID_STEP",
      "Step index is outside this recipe. Steps are zero-based.",
    );
    for (const index of args.completed_steps)
      requireThat(
        index < dish.steps.length,
        "INVALID_STEP",
        "Completed step index is outside this recipe.",
      );
    data.progress = data.progress.map((p) =>
      p.dish_id === args.dish_id
        ? {
            dish_id: p.dish_id,
            current_step: args.current_step,
            completed_steps: [...new Set(args.completed_steps)].sort(
              (a, b) => a - b,
            ),
          }
        : p,
    );
    return {
      record: this.store.put("session", data, args.id, args.expected_version),
    };
  }

  timer(args) {
    const record = this.store.get("session", args.id);
    requireThat(
      record.data.status === "active",
      "SESSION_FINISHED",
      "This cooking session is finished.",
    );
    const data = structuredClone(record.data);
    if (args.cancel_timer_id) {
      const timer = data.timers.find(
        (timer) => timer.id === args.cancel_timer_id,
      );
      requireThat(timer, "NOT_FOUND", "Timer does not exist.");
      timer.cancelled = true;
    } else {
      requireThat(
        args.label && args.duration_seconds,
        "INVALID_INPUT",
        "Starting a timer requires label and duration_seconds.",
      );
      if (args.member_id) this.store.get("member", args.member_id);
      if (args.dish_id) {
        const dish = data.dishes.find((dish) => dish.dish_id === args.dish_id);
        requireThat(dish, "NOT_FOUND", "Dish does not exist in this session.");
        if (args.step_index !== undefined)
          requireThat(
            args.step_index < dish.steps.length,
            "INVALID_STEP",
            "Step index is outside this dish.",
          );
      } else
        requireThat(
          args.step_index === undefined,
          "INVALID_INPUT",
          "step_index requires dish_id.",
        );
      data.timers.push({
        id: randomUUID(),
        label: args.label,
        duration_seconds: args.duration_seconds,
        dish_id: args.dish_id ?? null,
        step_index: args.step_index ?? null,
        member_id: args.member_id ?? null,
        cancelled: false,
        deadline: new Date(
          Date.now() + args.duration_seconds * 1000,
        ).toISOString(),
      });
    }
    return {
      record: this.store.put("session", data, args.id, args.expected_version),
      notification_support:
        "Persisted deadline only; no background alarm is delivered.",
    };
  }

  archive(args) {
    const record = this.store.get(args.kind, args.id, true);
    if (args.archived) {
      const references = [];
      if (args.kind === "recipe")
        for (const meal of this.store.list("meal"))
          if (meal.data.dishes.some((d) => d.recipe_id === args.id))
            references.push({
              kind: "meal",
              id: meal.id,
              title: meal.data.title,
            });
      requireThat(
        references.length === 0,
        "IN_USE",
        `This recipe is used by active meals: ${references.map((r) => `${r.title} (${r.id})`).join(", ")}. Edit or archive those meals first.`,
      );
    } else if (args.kind === "meal") this.validateMeal(record.data);
    return {
      record: this.store.put(
        args.kind,
        record.data,
        args.id,
        args.expected_version,
        args.archived,
      ),
    };
  }
}
