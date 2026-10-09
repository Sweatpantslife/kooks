// Recipe text parsing for the mobile editor. The parser keeps the pasted
// wording as `raw` and the pasted unit as `original`, converting volumes with
// the household's stated convention (cup 240 mL, tbsp 15 mL, tsp 5 mL).
import { ingredient } from "./sample-data.js";
import { formatNumber, originalText } from "./units.js";

const fractions = {
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
const asWritten = (raw) =>
  ingredient("text-" + raw.toLowerCase(), raw, null, "", "Other", "As written");

// `known` lists ingredients whose key and shopping group should be reused
// when a pasted line names them, such as the bundled example recipes.
export function parseIngredient(line, known = []) {
  const raw = line.trim().replace(/^[-•]\s*/, "");
  const expanded = raw
    .replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (c) => " " + fractions[c])
    .trim();
  const m = expanded.match(
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s+(.+)$/,
  );
  if (!m) return asWritten(raw);
  let q = m[1].split(/\s+/).reduce((n, p) => {
    if (p.includes("/")) {
      const [a, b] = p.split("/").map(Number);
      return n + (b ? a / b : NaN);
    }
    return n + Number(p.replace(",", "."));
  }, 0);
  if (!Number.isFinite(q) || q <= 0) return asWritten(raw);
  const originalQuantity = q;
  let rest = m[2],
    u = "";
  const unit = rest.match(
    /^(grams?|g|kilograms?|kg|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|tbsp|tablespoons?|tsp|teaspoons?|cups?|oz|ounces?|cloves?|cans?)\s+(.+)$/i,
  );
  if (unit) {
    const token = unit[1].toLowerCase();
    rest = unit[2];
    if (/^(g|grams?)$/.test(token)) u = "g";
    else if (/^(kg|kilograms?)$/.test(token)) {
      u = "g";
      q *= 1000;
    } else if (/^(ml|millilit)/.test(token)) u = "ml";
    else if (/^(l|lit(?:er|re)s?)$/.test(token)) {
      u = "ml";
      q *= 1000;
    } else if (/^(tbsp|tablespoon)/.test(token)) {
      u = "ml";
      q *= 15;
    } else if (/^(tsp|teaspoon)/.test(token)) {
      u = "ml";
      q *= 5;
    } else if (/^cups?$/.test(token)) {
      u = "ml";
      q *= 240;
    } else if (/^(oz|ounce)/.test(token)) {
      u = "g";
      q *= 28.349523125;
    } else u = token.replace(/s$/, "");
  }
  const parts = rest.split(/,\s*/);
  const name = parts.shift().trim();
  const note = parts.join(", ");
  const match = known.find((i) => i.n.toLowerCase() === name.toLowerCase());
  const result = ingredient(
    match?.k || name.toLowerCase().replace(/\s+/g, "-"),
    name,
    q,
    u,
    match?.group || "Other",
    note,
  );
  result.original = { q: originalQuantity, u: unit ? unit[1] : "" };
  result.raw = raw;
  return result;
}

export function pasteDraft(text) {
  const lines = text.split(/\r?\n/).map((x) => x.trim());
  const title = lines.find(Boolean) || "";
  const yieldMatch = text.match(/serv(?:es|ings?)\s*:?\s*(\d+)/i);
  const ingredientAt = lines.findIndex((l) => /^ingredients?\s*:?$/i.test(l));
  const methodAt = lines.findIndex((l) =>
    /^(method|directions|instructions|steps)\s*:?$/i.test(l),
  );
  let ingredientLines = [],
    steps = [];
  if (ingredientAt >= 0) {
    ingredientLines = lines
      .slice(ingredientAt + 1, methodAt > ingredientAt ? methodAt : undefined)
      .filter(Boolean);
  }
  if (methodAt >= 0) steps = lines.slice(methodAt + 1).filter(Boolean);
  if (ingredientAt < 0) {
    for (const l of lines.slice(lines.indexOf(title) + 1)) {
      if (!l || /^serv(?:es|ings?)/i.test(l)) continue;
      if (/^\d+[.)]\s/.test(l)) steps.push(l);
      else if (/^[-•]?\s*[\d½¼¾⅓⅔⅛]/.test(l)) ingredientLines.push(l);
      else steps.push(l);
    }
  }
  return {
    id: null,
    title,
    servings: yieldMatch ? Number(yieldMatch[1]) : null,
    ingredientsText: ingredientLines.join("\n"),
    stepsText: steps.map((s) => s.replace(/^\d+[.)]\s*/, "")).join("\n\n"),
    originalText: text,
  };
}

export function editDraft(r) {
  return {
    id: r.id,
    title: r.title,
    servings: r.servings,
    ingredientsText: r.ingredients
      .map(
        (i) =>
          i.raw ||
          `${i.q === null ? "" : formatNumber(i.q) + " " + (i.u ? i.u + " " : "")}${i.n}${i.note && i.q !== null ? ", " + i.note : ""}`,
      )
      .join("\n"),
    stepsText: r.steps.map((s) => s.text).join("\n\n"),
    equipmentText: (r.equipment || []).join("\n"),
    originalText: originalText(r),
  };
}
