// Recipe text parsing for the mobile editor. The parser keeps the pasted
// wording as `raw` and the pasted unit as `original`, converting volumes with
// the household's stated convention (cup 240 mL, tbsp 15 mL, tsp 5 mL).
import { ingredient } from "./sample-data.js";
import { formatNumber, originalText } from "./units.js";
import { splitIngredientLine } from "../shared/ingredients.js";
import { formatLinkLines } from "../shared/links.js";

const asWritten = (raw) =>
  ingredient("text-" + raw.toLowerCase(), raw, null, "", "Other", "As written");

// Mobile policy: store metric amounts, converting cups and spoons with the
// stated convention, and remember the pasted unit for the "original" display.
// `known` lists ingredients whose key and shopping group should be reused
// when a pasted line names them, such as the bundled example recipes.
export function parseIngredient(line, known = []) {
  const parts = splitIngredientLine(line);
  const raw = parts.original;
  if (parts.quantity === null || parts.quantity <= 0) return asWritten(raw);
  let q = parts.quantity,
    u = "";
  const token = parts.unitToken.toLowerCase();
  if (token) {
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
  const name = parts.name;
  const match = known.find((i) => i.n.toLowerCase() === name.toLowerCase());
  const result = ingredient(
    match?.k || name.toLowerCase().replace(/\s+/g, "-"),
    name,
    q,
    u,
    match?.group || "Other",
    parts.preparation,
  );
  result.original = { q: parts.quantity, u: parts.unitToken };
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
    linksText: "",
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
    linksText: formatLinkLines(r.links || []),
    originalText: originalText(r),
  };
}
