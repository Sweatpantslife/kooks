import { requireThat } from "./store.js";

const units = new Map();
function define(names, dimension, factor, unit) {
  for (const name of names) units.set(name, { dimension, factor, unit });
}
define(["g", "gram", "grams"], "mass", 1, "g");
define(["kg", "kilogram", "kilograms"], "mass", 1000, "g");
define(["mg", "milligram", "milligrams"], "mass", 0.001, "g");
define(["oz", "ounce", "ounces"], "mass", 28.349523125, "g");
define(["lb", "lbs", "pound", "pounds"], "mass", 453.59237, "g");
define(
  ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
  "volume",
  1,
  "mL",
);
define(["l", "liter", "liters", "litre", "litres"], "volume", 1000, "mL");
// Deliberately require explicit conventions for cups/spoons. A bare "cup"
// remains unconverted; the household's measurement convention is not settled.
define(["us_cup"], "volume", 236.5882365, "mL");
define(["us_tbsp"], "volume", 14.78676478125, "mL");
define(["us_tsp"], "volume", 4.92892159375, "mL");
define(["us_fl_oz"], "volume", 29.5735295625, "mL");
define(["metric_cup"], "volume", 250, "mL");
define(["metric_tbsp"], "volume", 15, "mL");
define(["metric_tsp"], "volume", 5, "mL");
define(["count", "each", "piece", "pieces"], "count", 1, "each");

export const normalize = (value) =>
  value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const round = (number) => Number(number.toPrecision(12));
export function canonicalQuantity(quantity, unit) {
  const known = units.get(normalize(unit));
  if (!known || quantity === null)
    return { quantity, unit: known?.unit ?? normalize(unit) };
  return { quantity: round(quantity * known.factor), unit: known.unit };
}
export function convert(quantity, from, to) {
  const a = normalize(from),
    b = normalize(to);
  if (a === b) return { quantity, unit: to };
  if (
    ["c", "°c", "celsius"].includes(a) &&
    ["f", "°f", "fahrenheit"].includes(b)
  )
    return { quantity: round((quantity * 9) / 5 + 32), unit: to };
  if (
    ["f", "°f", "fahrenheit"].includes(a) &&
    ["c", "°c", "celsius"].includes(b)
  )
    return { quantity: round(((quantity - 32) * 5) / 9), unit: to };
  const left = units.get(a),
    right = units.get(b);
  requireThat(
    left && right && left.dimension === right.dimension,
    "AMBIGUOUS_CONVERSION",
    "Cannot convert these units without more information. Use explicit us_cup/metric_cup, us_tbsp/metric_tbsp, or us_tsp/metric_tsp. Mass/volume conversion requires ingredient density and is not inferred.",
  );
  return { quantity: round((quantity * left.factor) / right.factor), unit: to };
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
