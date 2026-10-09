import { requireThat } from "./store.js";
import { convertUnits, round } from "../shared/quantities.js";

export {
  canonicalQuantity,
  normalize,
  round,
  unitInfo,
} from "../shared/quantities.js";

export function convert(quantity, from, to) {
  const result = convertUnits(quantity, from, to);
  requireThat(
    result,
    "AMBIGUOUS_CONVERSION",
    "Cannot convert these units without more information. Use explicit us_cup/metric_cup, us_tbsp/metric_tbsp, or us_tsp/metric_tsp. Mass/volume conversion requires ingredient density and is not inferred.",
  );
  return result;
}
export function scaleRecipe(record, targetServings) {
  const original = record.data;
  const target = targetServings ?? original.servings;
  requireThat(
    targetServings == null || original.servings !== null,
    "MISSING_YIELD",
    "Set the original recipe yield before scaling.",
  );
  const multiplier = target === null ? 1 : target / original.servings;
  return {
    recipe_id: record.id,
    recipe_version: record.version,
    title: original.title,
    servings: target,
    original_servings: original.servings,
    multiplier,
    ingredients: original.ingredients.map((item, index) => ({
      ...item,
      ingredient_index: index,
      quantity:
        item.quantity === null ? null : round(item.quantity * multiplier),
      original_quantity: item.quantity,
    })),
    steps: structuredClone(original.steps),
    equipment: structuredClone(original.equipment),
    original_text: original.original_text,
    source_url: original.source_url,
    links: structuredClone(original.links ?? []),
    warnings: [
      ...(original.servings === null
        ? ["Yield is unknown; quantities are unchanged."]
        : []),
      ...(multiplier !== 1
        ? [
            "Cooking time, temperature, and instruction text are unchanged. Use the scaled ingredient table for amounts mentioned in steps, and check equipment capacity for the new batch size.",
          ]
        : []),
      ...(original.ingredients.some((i) => i.quantity === null)
        ? ["Some quantities are unspecified and were left unchanged."]
        : []),
      ...(original.equipment.length === 0
        ? ["Equipment requirements were not specified."]
        : []),
      ...(original.steps.length === 0
        ? ["Cooking instructions were not specified."]
        : []),
    ],
  };
}
