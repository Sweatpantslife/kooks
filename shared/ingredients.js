// Ingredient-line tokenizing shared by the MCP backend and the mobile app.
// This splits a line into quantity, unit token, name and preparation without
// deciding what the unit means; each side applies its own measurement policy.
// The backend's policy lives here too, because the browser editor reads its
// lines back into backend records without a round trip.
import { unitSpelling } from "./quantities.js";

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
// An abbreviation may end in a full stop ("2 tbsp. sugar").
export const unitToken =
  /^((?:g|grams?|kg|kilograms?|mg|milligrams?|mL|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|ounces?|lb|lbs|pounds?|cups?|tbsp|tablespoons?|tsp|teaspoons?|us_cup|metric_cup|us_tbsp|metric_tbsp|us_tsp|metric_tsp|us_fl_oz|cloves?|cans?|each|pieces?|count|bunch(?:es)?|pinch(?:es)?|dash(?:es)?|sprigs?|stalks?|sticks?|slices?|heads?|handfuls?|packages?|packets?|jars?|tins?|bottles?)\.?)\s+(.+)$/i;

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

// Backend policy: keep the writer's unit in its shared spelling (lowercased,
// singular) and never convert a bare cup or spoon; the household convention
// is not settled. A line without a clear amount is kept whole as the name.
export function parseIngredient(line) {
  const parts = splitIngredientLine(line);
  const base = {
    name: parts.original || "Unclear ingredient",
    quantity: null,
    unit: "",
    original_text: line,
    preparation: "",
  };
  if (parts.quantity === null || parts.quantity > 1e9) return base;
  return {
    ...base,
    name: parts.name,
    quantity: parts.quantity,
    unit: unitSpelling(parts.unitToken),
    preparation: parts.preparation,
  };
}

const squash = (text) =>
  String(text ?? "")
    .trim()
    .replace(/\s+/g, " ");
const sameWords = (a, b) => squash(a).toLowerCase() === squash(b).toLowerCase();

// The line the browser editor shows for a stored ingredient.
export const ingredientLine = (i) =>
  squash(
    `${i.quantity == null ? "" : `${i.quantity} ${i.unit ?? ""} `}${i.name}${i.preparation ? `, ${i.preparation}` : ""}`,
  );

// Read the editor's ingredient lines back into records. A line left as shown
// keeps its stored ingredient exactly, so a unit the parser does not know, the
// preparation of an unmeasured line and the source wording all survive. A
// changed line is parsed again and keeps the category of the ingredient it most
// likely replaced: the same name and preparation, then the same name (both also
// keep its source wording), then the line that stood in its place.
export function editedIngredients(text, original = []) {
  const lines = String(text ?? "")
    .split("\n")
    .map(squash)
    .filter(Boolean);
  const unused = new Set(original.keys());
  const take = (matches) => {
    for (const index of unused)
      if (matches(original[index], index)) {
        unused.delete(index);
        return original[index];
      }
    return null;
  };
  const kept = lines.map((line) => take((i) => ingredientLine(i) === line));
  return lines.map((line, at) => {
    if (kept[at]) return kept[at];
    const parsed = parseIngredient(line);
    const same =
      take(
        (i) =>
          sameWords(i.name, parsed.name) &&
          sameWords(i.preparation, parsed.preparation),
      ) ?? take((i) => sameWords(i.name, parsed.name));
    if (same)
      return {
        ...parsed,
        category: same.category,
        original_text: same.original_text || parsed.original_text,
      };
    const replaced = take((_, index) => index === at);
    return replaced ? { ...parsed, category: replaced.category } : parsed;
  });
}

// Steps in the browser editor are separated by a blank line, so a blank line
// inside a step shows as a single line break.
const stepText = (text) => text.trim().replace(/\n\s*\n/g, "\n");
export const stepsText = (steps) =>
  steps.map((step) => stepText(step.text)).join("\n\n");

// Read the editor's steps back: a step whose text is unchanged keeps its
// stored form, with its timer, its equipment and any blank line inside it.
export function editedSteps(text, original = []) {
  const unused = [...original];
  return String(text ?? "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const at = unused.findIndex((step) => stepText(step.text) === block);
      return at >= 0 ? unused.splice(at, 1)[0] : { text: block };
    });
}
