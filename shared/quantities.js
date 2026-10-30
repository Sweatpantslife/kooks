// Units and conversions shared by the MCP backend and the mobile app. This
// module has no dependencies and never throws: callers decide how to report
// an ambiguous conversion.

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

// Unit words without a fixed size, each with one spelling and its plural, so
// that "2 cans" and "1 can" compare as the same unit. A bare cup or spoon is
// one of them and stays unconverted, as above.
const spellings = new Map();
const plurals = new Map();
function word(singular, plural, ...others) {
  for (const name of [singular, plural, ...others])
    spellings.set(name, singular);
  plurals.set(singular, plural);
}
word("cup", "cups");
word("tbsp", "tbsp", "tablespoon", "tablespoons");
word("tsp", "tsp", "teaspoon", "teaspoons");
word("piece", "pieces");
for (const singular of [
  "can",
  "clove",
  "sprig",
  "stalk",
  "stick",
  "slice",
  "head",
  "handful",
  "package",
  "packet",
  "jar",
  "tin",
  "bottle",
])
  word(singular, `${singular}s`);
for (const singular of ["bunch", "pinch", "dash"])
  word(singular, `${singular}es`);

export const normalize = (value) =>
  value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const round = (number) => Number(number.toPrecision(12));
// "tbsp." and "oz." are the same units as "tbsp" and "oz".
const unitKey = (name) => normalize(name).replace(/\.$/, "");
export const unitInfo = (name) => units.get(unitKey(name)) ?? null;
// The one spelling of a unit word, lowercased; other units come back
// lowercased as written.
export const unitSpelling = (name) =>
  spellings.get(unitKey(name)) ?? unitKey(name);
// How a unit reads beside an amount already rounded for display: "½ cup",
// "1 can", "2 cans". Symbols, abbreviations and unknown units stay as written.
export function unitLabel(unit, quantity) {
  const singular = spellings.get(unitKey(unit));
  if (!singular) return unit;
  return quantity > 1 ? plurals.get(singular) : singular;
}

export function canonicalQuantity(quantity, unit) {
  const known = units.get(unitKey(unit));
  if (!known || quantity === null)
    return { quantity, unit: known?.unit ?? unitSpelling(unit) };
  return { quantity: round(quantity * known.factor), unit: known.unit };
}

const celsius = ["c", "°c", "celsius"];
const fahrenheit = ["f", "°f", "fahrenheit"];

// Convert between compatible units, or return null when the conversion would
// need information that is not available (density, an unstated convention).
export function convertUnits(quantity, from, to) {
  const a = unitKey(from),
    b = unitKey(to);
  if (a === b) return { quantity, unit: to };
  if (celsius.includes(a) && fahrenheit.includes(b))
    return { quantity: round((quantity * 9) / 5 + 32), unit: to };
  if (fahrenheit.includes(a) && celsius.includes(b))
    return { quantity: round(((quantity - 32) * 5) / 9), unit: to };
  const left = units.get(a),
    right = units.get(b);
  if (!left || !right || left.dimension !== right.dimension) return null;
  return { quantity: round((quantity * left.factor) / right.factor), unit: to };
}
