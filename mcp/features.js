import { randomUUID } from "node:crypto";
import {
  canonicalQuantity,
  normalize,
  round,
  scaleRecipe,
} from "./quantities.js";
import { requireThat } from "./store.js";

const sameIngredient = (a, b) =>
  normalize(a.name) === normalize(b.name) &&
  normalize(a.preparation ?? "") === normalize(b.preparation ?? "");
const unique = (values) => [...new Set(values)];
const totalPortions = (allocations) =>
  round(allocations.reduce((n, a) => n + a.portions, 0));

export function batchView(record) {
  const allocated = totalPortions(record.data.allocations);
  const eaten = totalPortions(
    record.data.allocations.filter((a) => a.status === "eaten"),
  );
  return {
    ...record,
    available_portions: round(record.data.portions - allocated),
    remaining_portions: round(record.data.portions - eaten),
    reserved_portions: round(allocated - eaten),
    eaten_portions: eaten,
  };
}

export function validateFeatureRelations(store) {
  const preferred = new Set();
  for (const record of store.list("recipe")) {
    const data = record.data;
    requireThat(
      data.active_minutes == null ||
        data.total_minutes == null ||
        data.active_minutes <= data.total_minutes,
      "INVALID_EFFORT",
      "Hands-on time cannot exceed total time.",
    );
    if (data.original_recipe_id) {
      const original = store.get("recipe", data.original_recipe_id);
      requireThat(
        original.id !== record.id && !original.data.original_recipe_id,
        "INVALID_VARIANT",
        "A variant must reference an original recipe, not another variant.",
      );
    }
    if (data.preferred) {
      const family = data.original_recipe_id ?? record.id;
      requireThat(
        !preferred.has(family),
        "INVALID_VARIANT",
        "Only one version of a recipe can be preferred.",
      );
      preferred.add(family);
    }
    for (const imageId of data.source_image_ids ?? [])
      store.get("asset", imageId, true);
  }
  for (const batch of store.list("batch")) {
    store.get("recipe", batch.data.recipe_id, true);
    requireThat(
      batch.data.dish.recipe_id === batch.data.recipe_id &&
        batch.data.dish.servings === batch.data.portions,
      "INVALID_BATCH",
      "The cooked recipe snapshot must match the batch and its portions.",
    );
    requireThat(
      batch.data.dish.ingredients.length <= 500,
      "INVALID_BATCH",
      "Too many batch ingredients.",
    );
    requireThat(
      totalPortions(batch.data.allocations) <= batch.data.portions + 1e-9,
      "INSUFFICIENT_PORTIONS",
      "These allocations exceed the cooked portions.",
    );
    requireThat(
      new Set(batch.data.allocations.map((a) => a.id)).size ===
        batch.data.allocations.length,
      "INVALID_BATCH",
      "Allocation IDs must be unique.",
    );
    for (const a of batch.data.allocations)
      requireThat(
        !a.date || a.date >= batch.data.cooked_on,
        "INVALID_DATE",
        "A portion cannot be planned before its cooking date.",
      );
  }
  for (const session of store.list("session")) {
    const tasks = session.data.tasks ?? [];
    requireThat(
      unique(tasks.map((t) => t.id)).length === tasks.length,
      "INVALID_TASK",
      "Task IDs must be unique.",
    );
    for (const task of tasks) {
      const dish = session.data.dishes.find((d) => d.dish_id === task.dish_id);
      requireThat(
        task.dish_id === null || dish,
        "INVALID_TASK",
        "Task dish is not in this cooking session.",
      );
      requireThat(
        task.step_index === null ||
          (dish && task.step_index < dish.steps.length),
        "INVALID_TASK",
        "Task step is not in this dish.",
      );
      if (task.member_id) store.get("member", task.member_id, true);
    }
    for (const timer of session.data.timers)
      if (timer.member_id) store.get("member", timer.member_id, true);
  }
  for (const draft of store.list("import")) {
    if (draft.data.image_id) store.get("asset", draft.data.image_id, true);
    if (draft.data.recipe_id) store.get("recipe", draft.data.recipe_id, true);
    requireThat(
      (draft.data.status === "saved") === Boolean(draft.data.recipe_id),
      "INVALID_IMPORT",
      "Saved imports must reference their recipe.",
    );
  }
  const budgetKeys = new Set();
  for (const record of store.list("budget")) {
    requireThat(
      new Date(`${record.data.week_start}T00:00:00Z`).getUTCDay() === 1,
      "INVALID_WEEK",
      "Choose a Monday as the beginning of the week.",
    );
    const key = `${record.data.week_start}:${record.data.currency}`;
    requireThat(
      !budgetKeys.has(key),
      "DUPLICATE_BUDGET",
      "Edit the existing budget for this week and currency.",
    );
    budgetKeys.add(key);
  }
}

// A pantry checklist is presence, not an assertion about exact stock. Known
// amounts are consumed once within this preview; duplicate ingredient lines
// cannot each claim the full amount of the same pantry entry.
function pantryCoverage(ingredients, pantry) {
  const stock = pantry
    .filter((p) => p.available && p.quantity !== 0)
    .map((p) => ({ ...p, canonical: canonicalQuantity(p.quantity, p.unit) }));
  const needed = [];
  for (const item of ingredients) {
    const c = canonicalQuantity(item.quantity, item.unit);
    const prior = needed.find(
      (n) =>
        sameIngredient(n, item) &&
        n.unit === c.unit &&
        n.quantity !== null &&
        c.quantity !== null,
    );
    if (prior) prior.quantity = round(prior.quantity + c.quantity);
    else needed.push({ ...item, ...c });
  }
  const missing = [],
    matched = [],
    checkQuantities = [],
    useSoon = [];
  for (const ingredient of needed) {
    const matches = stock.filter((p) => sameIngredient(ingredient, p));
    if (!matches.length) {
      missing.push(ingredient);
      continue;
    }
    let remaining = ingredient.quantity;
    let touched = false;
    if (remaining !== null)
      for (const entry of matches) {
        if (
          entry.canonical.quantity === null ||
          entry.canonical.unit !== ingredient.unit
        )
          continue;
        const used = Math.min(entry.canonical.quantity, remaining);
        entry.canonical.quantity = round(entry.canonical.quantity - used);
        remaining = round(remaining - used);
        if (used > 0) {
          touched = true;
          if (entry.use_soon) useSoon.push(ingredient.name);
        }
      }
    const unmeasured = matches.find(
      (p) => p.quantity === null || p.canonical.unit !== ingredient.unit,
    );
    if (remaining === null || (remaining > 0 && unmeasured)) {
      checkQuantities.push(ingredient);
      touched = true;
      if (matches.some((p) => p.use_soon)) useSoon.push(ingredient.name);
    } else if (remaining > 0)
      missing.push({ ...ingredient, quantity: remaining });
    if (touched || remaining === 0) matched.push(ingredient.name);
  }
  return {
    missing,
    matched: unique(matched),
    check_quantities: checkQuantities,
    use_soon: unique(useSoon),
  };
}

export class Features {
  constructor(store, kooks) {
    this.store = store;
    this.kooks = kooks;
  }

  recommend(args) {
    const members = args.member_ids.map((id) => this.store.get("member", id));
    const pantry = [
      ...(args.use_pantry ? this.store.list("pantry").map((r) => r.data) : []),
      ...args.available_ingredients.map((name) => ({
        name,
        quantity: null,
        unit: "",
        preparation: "",
        available: true,
        use_soon: false,
      })),
    ];
    const skipped = {
      effort_unknown: 0,
      effort_over_limit: 0,
      preferences: 0,
      missing_yield: 0,
      incomplete: 0,
    };
    const results = [];
    for (const record of this.store.list("recipe")) {
      const r = record.data;
      if (!r.ingredients.length || !r.steps.length) {
        skipped.incomplete++;
        continue;
      }
      if (
        args.query &&
        !normalize(
          [r.title, ...r.ingredients.map((i) => i.name), ...r.tags].join(" "),
        ).includes(normalize(args.query))
      )
        continue;
      const filters = [
        ["active_minutes", args.max_active_minutes],
        ["total_minutes", args.max_total_minutes],
        ["pan_count", args.max_pans],
      ];
      if (
        filters.some(([key, max]) => max !== undefined && r[key] == null) ||
        (args.cleanup && !r.cleanup)
      ) {
        skipped.effort_unknown++;
        continue;
      }
      if (
        filters.some(([key, max]) => max !== undefined && r[key] > max) ||
        (args.cleanup && r.cleanup !== args.cleanup)
      ) {
        skipped.effort_over_limit++;
        continue;
      }
      if (args.servings && r.servings === null) {
        skipped.missing_yield++;
        continue;
      }
      const terms = new Set([
        ...r.ingredients.map((i) => normalize(i.name)),
        ...r.tags.map(normalize),
      ]);
      const likes = [],
        conflicts = [],
        unknown = [];
      for (const member of members) {
        for (const like of member.data.likes)
          if (terms.has(normalize(like)))
            likes.push(`${member.data.name} likes ${like}`);
        for (const dislike of member.data.dislikes)
          if (terms.has(normalize(dislike)))
            conflicts.push(`${member.data.name} dislikes ${dislike}`);
        if (member.data.spice_tolerance !== null) {
          if (r.spice_level == null)
            unknown.push(`Spice level is not recorded for ${member.data.name}`);
          else if (r.spice_level > member.data.spice_tolerance)
            conflicts.push(`Spicier than ${member.data.name}'s preference`);
        }
      }
      if (args.avoid_dislikes && conflicts.length) {
        skipped.preferences++;
        continue;
      }
      const scaled = scaleRecipe(record, args.servings);
      const coverage = pantryCoverage(scaled.ingredients, pantry);
      results.push({
        record,
        servings: scaled.servings,
        ...coverage,
        preferences: { likes, conflicts, unknown },
        score:
          coverage.use_soon.length * 5 +
          likes.length * 2 -
          conflicts.length * 8,
        memory: this.memory(record.id),
      });
    }
    results.sort(
      (a, b) =>
        a.missing.length - b.missing.length ||
        b.score - a.score ||
        a.check_quantities.length - b.check_quantities.length ||
        a.record.data.title.localeCompare(b.record.data.title),
    );
    return {
      total: results.length,
      results: results.slice(0, args.limit),
      skipped,
      matching:
        "Ingredient names and preparation must match. Checklist entries confirm presence; check their quantities. Unknown effort is excluded when a corresponding filter is active.",
    };
  }

  memory(recipeId) {
    const recipe = this.store.get("recipe", recipeId, true);
    const root = recipe.data.original_recipe_id ?? recipe.id;
    const family = this.store
      .list("recipe")
      .filter((r) => r.id === root || r.data.original_recipe_id === root);
    const ids = new Set([root, ...family.map((r) => r.id)]);
    const notes = this.store
      .list("note")
      .filter((n) => ids.has(n.data.recipe_id))
      .sort(
        (a, b) =>
          (b.data.cooked_on ?? b.created_at.slice(0, 10)).localeCompare(
            a.data.cooked_on ?? a.created_at.slice(0, 10),
          ) ||
          b.created_at.localeCompare(a.created_at) ||
          b.id.localeCompare(a.id),
      );
    return {
      recipe_id: recipeId,
      original_recipe_id: root,
      preferred_recipe: family.find((r) => r.data.preferred) ?? null,
      variants: family.filter((r) => r.id !== root),
      notes,
      latest: notes[0] ?? null,
    };
  }

  variant(args) {
    const original = this.store.get("recipe", args.original_recipe_id);
    requireThat(
      !original.data.original_recipe_id,
      "INVALID_VARIANT",
      "Choose the original recipe as the parent.",
    );
    if (args.id)
      requireThat(
        this.store.get("recipe", args.id).data.original_recipe_id ===
          original.id,
        "INVALID_VARIANT",
        "This variant belongs to another recipe.",
      );
    if (args.preferred)
      for (const sibling of this.store.list("recipe")) {
        if (
          sibling.id !== args.id &&
          (sibling.id === original.id ||
            sibling.data.original_recipe_id === original.id) &&
          sibling.data.preferred
        )
          this.store.put(
            "recipe",
            { ...sibling.data, preferred: false },
            sibling.id,
            sibling.version,
          );
      }
    return {
      record: this.kooks.save("recipe", args, {
        ...args.recipe,
        original_recipe_id: original.id,
        preferred: args.preferred,
        original_text: original.data.original_text,
        source_url: original.data.source_url,
        source_image_ids: original.data.source_image_ids ?? [],
      }),
    };
  }

  createBatch(args) {
    let dish;
    if (args.session_id) {
      const session = this.store.get("session", args.session_id);
      requireThat(
        session.data.status === "finished",
        "SESSION_ACTIVE",
        "Finish cooking before recording a cooked batch.",
      );
      dish = session.data.dishes.find(
        (d) => d.dish_id === args.dish_id && d.recipe_id === args.recipe_id,
      );
      requireThat(
        dish,
        "INVALID_REFERENCE",
        "Choose the cooked dish from this session.",
      );
      requireThat(
        dish.servings === args.portions,
        "INVALID_BATCH",
        "Batch portions must match the cooked session.",
      );
      requireThat(
        !this.store
          .list("batch")
          .some(
            (b) =>
              b.data.session_id === args.session_id &&
              b.data.dish.dish_id === args.dish_id,
          ),
        "DUPLICATE_BATCH",
        "This cooked dish already has a batch.",
      );
    } else {
      requireThat(
        !args.dish_id,
        "INVALID_INPUT",
        "dish_id requires a cooking session.",
      );
      dish = {
        dish_id: "dish-1",
        ...scaleRecipe(this.store.get("recipe", args.recipe_id), args.portions),
      };
    }
    return {
      record: batchView(
        this.store.put("batch", {
          title: dish.title,
          recipe_id: args.recipe_id,
          dish,
          portions: args.portions,
          cooked_on: args.cooked_on,
          session_id: args.session_id ?? null,
          storage: args.storage,
          allocations: [],
          notes: args.notes,
        }),
      ),
    };
  }

  allocate(args) {
    const record = this.store.get("batch", args.id);
    const data = structuredClone(record.data);
    if (args.allocation_id)
      requireThat(
        data.allocations.some((a) => a.id === args.allocation_id),
        "NOT_FOUND",
        "Allocation does not exist.",
      );
    const allocationId = args.allocation_id ?? randomUUID();
    data.allocations = data.allocations.filter((a) => a.id !== allocationId);
    if (args.allocation)
      data.allocations.push({ ...args.allocation, id: allocationId });
    else
      requireThat(
        args.allocation_id,
        "INVALID_INPUT",
        "Removing an allocation requires allocation_id.",
      );
    requireThat(
      totalPortions(data.allocations) <= data.portions + 1e-9,
      "INSUFFICIENT_PORTIONS",
      "Not enough unallocated portions remain. Reduce another allocation first.",
    );
    return {
      record: batchView(
        this.store.put("batch", data, args.id, args.expected_version),
      ),
      allocation_id: allocationId,
    };
  }

  task(args) {
    const record = this.store.get("session", args.id);
    requireThat(
      record.data.status === "active",
      "SESSION_FINISHED",
      "Tasks cannot change after cooking has finished.",
    );
    const data = structuredClone(record.data);
    data.tasks ??= [];
    if (args.task_id)
      requireThat(
        data.tasks.some((t) => t.id === args.task_id),
        "NOT_FOUND",
        "Task does not exist.",
      );
    if (args.task?.member_id) this.store.get("member", args.task.member_id);
    const taskId = args.task_id ?? randomUUID();
    data.tasks = data.tasks.filter((t) => t.id !== taskId);
    if (args.task) data.tasks.push({ ...args.task, id: taskId });
    else
      requireThat(
        args.task_id,
        "INVALID_INPUT",
        "Removing a task requires task_id.",
      );
    requireThat(
      data.tasks.length <= 1000,
      "TOO_MANY_TASKS",
      "A session can contain up to 1,000 tasks.",
    );
    return {
      record: this.store.put("session", data, args.id, args.expected_version),
      task_id: taskId,
    };
  }

  estimateDishes(dishes, currency, asOf) {
    const prices = this.store
      .list("price")
      .filter(
        (p) => p.data.currency === currency && p.data.purchased_on <= asOf,
      )
      .sort(
        (a, b) =>
          b.data.purchased_on.localeCompare(a.data.purchased_on) ||
          b.updated_at.localeCompare(a.updated_at) ||
          b.id.localeCompare(a.id),
      );
    const estimates = dishes.map((dish) => {
      const lines = dish.ingredients.map((ingredient) => {
        const required = canonicalQuantity(
          ingredient.quantity,
          ingredient.unit,
        );
        if (ingredient.quantity === 0)
          return { ingredient, cost: 0, price_id: null };
        const price = prices.find(
          (p) =>
            sameIngredient(ingredient, p.data) &&
            canonicalQuantity(p.data.package_quantity, p.data.unit).unit ===
              required.unit,
        );
        if (!price || ingredient.quantity === null)
          return {
            ingredient,
            cost: null,
            reason:
              ingredient.quantity === null
                ? "Quantity is not recorded"
                : "No compatible price in this currency",
          };
        const packageAmount = canonicalQuantity(
          price.data.package_quantity,
          price.data.unit,
        ).quantity;
        return {
          ingredient,
          cost: round((required.quantity / packageAmount) * price.data.price),
          price_id: price.id,
          purchased_on: price.data.purchased_on,
        };
      });
      const known = round(lines.reduce((sum, l) => sum + (l.cost ?? 0), 0));
      const complete = lines.length > 0 && lines.every((l) => l.cost !== null);
      return {
        dish_id: dish.dish_id,
        title: dish.title,
        servings: dish.servings,
        lines,
        known_cost: known,
        complete,
        total: complete ? known : null,
        per_portion:
          complete && dish.servings ? round(known / dish.servings) : null,
      };
    });
    const known = round(estimates.reduce((n, e) => n + e.known_cost, 0));
    const complete = estimates.length > 0 && estimates.every((e) => e.complete);
    return {
      currency,
      as_of: asOf,
      dishes: estimates,
      known_cost: known,
      complete,
      total: complete ? known : null,
      missing_prices: estimates.flatMap((e) =>
        e.lines
          .filter((l) => l.cost === null)
          .map((l) => ({ recipe: e.title, ...l })),
      ),
      basis:
        "Estimated cost of ingredients used, not checkout cost. Uses the latest compatible confirmed price on or before the estimate date; currencies are never mixed.",
    };
  }

  estimate(args) {
    return this.estimateDishes(
      this.kooks.resolve(args.source).dishes,
      args.currency,
      args.as_of,
    );
  }

  weeklyCost(args) {
    requireThat(
      new Date(`${args.week_start}T00:00:00Z`).getUTCDay() === 1,
      "INVALID_WEEK",
      "Choose a Monday as the beginning of the week.",
    );
    const end = new Date(`${args.week_start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    const endDate = end.toISOString().slice(0, 10);
    const plans = this.store
      .list("plan")
      .filter((p) => p.data.date >= args.week_start && p.data.date < endDate);
    const estimates = plans.map((p) => ({
      id: p.id,
      title: p.data.title,
      date: p.data.date,
      ...this.estimateDishes(p.data.dishes, args.currency, args.as_of),
    }));
    const leftovers = this.store
      .list("batch")
      .flatMap((b) =>
        b.data.allocations
          .filter((a) => a.date >= args.week_start && a.date < endDate)
          .map((a) => ({ batch_id: b.id, title: b.data.title, ...a })),
      );
    const known = round(estimates.reduce((n, e) => n + e.known_cost, 0));
    const complete = estimates.every((e) => e.complete);
    const budget =
      this.store
        .list("budget")
        .find(
          (b) =>
            b.data.week_start === args.week_start &&
            b.data.currency === args.currency,
        ) ?? null;
    return {
      week_start: args.week_start,
      currency: args.currency,
      plans: estimates,
      leftovers,
      known_cost: known,
      complete,
      total: complete ? known : null,
      budget,
      remaining: complete && budget ? round(budget.data.amount - known) : null,
      basis:
        "Counts each planned cooking occurrence once. Leftover portions are already cooked and do not add groceries or a second cooking cost.",
    };
  }
}
