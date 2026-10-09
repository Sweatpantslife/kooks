// Ingredient-line tokenizing shared by the MCP backend and the mobile app.
// This splits a line into quantity, unit token, name and preparation without
// deciding what the unit means; each side applies its own measurement policy.

export const fractions = {
  "½": "1/2",
  "¼": "1/4",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

export const expandFractions = (text) =>
  text.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (c) => ` ${fractions[c]}`).trim();

// "1", "1.5", "1,5", "1/2" and "1 1/2". Null when the token is not a finite
// number, including a division by zero.
export function parseQuantity(token) {
  let total = 0;
  for (const part of token.trim().split(/\s+/)) {
    if (part.includes("/")) {
      const [a, b] = part.split("/").map(Number);
      if (!b) return null;
      total += a / b;
    } else total += Number(part.replace(",", "."));
  }
  return Number.isFinite(total) ? total : null;
}

const quantityPrefix =
  /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)(?:\s+|(?=[a-zA-Z]))(.+)$/;
export const unitToken =
  /^(g|grams?|kg|kilograms?|mg|milligrams?|mL|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|ounces?|lb|lbs|pounds?|cups?|tbsp|tablespoons?|tsp|teaspoons?|us_cup|metric_cup|us_tbsp|metric_tbsp|us_tsp|metric_tsp|us_fl_oz|cloves?|cans?|each|pieces?|count)\s+(.+)$/i;

// A bullet is dropped; the unit token keeps the writer's spelling and case.
export function splitIngredientLine(line) {
  const original = line.trim().replace(/^[-•]\s*/, "");
  const base = {
    original,
    quantity: null,
    unitToken: "",
    name: original,
    preparation: "",
  };
  const match = expandFractions(original).match(quantityPrefix);
  if (!match) return base;
  const quantity = parseQuantity(match[1]);
  if (quantity === null) return base;
  let rest = match[2],
    token = "";
  const unitMatch = rest.match(unitToken);
  if (unitMatch) {
    token = unitMatch[1];
    rest = unitMatch[2];
  }
  const [name, ...preparation] = rest.split(/,\s*/);
  return {
    original,
    quantity,
    unitToken: token,
    name: name.trim(),
    preparation: preparation.join(", "),
  };
}
