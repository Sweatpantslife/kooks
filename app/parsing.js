// Recipe text parsing for the mobile editor. The parser keeps the pasted
// wording as `raw` and the pasted unit as `original`, converting masses and
// volumes with the shared unit table and a bare cup or spoon with the
// household's kitchen sizes there (cup 240 mL, tbsp 15 mL, tsp 5 mL).
import { ingredient } from "./sample-data.js";
import { formatNumber, originalText } from "./units.js";
import { splitIngredientLine } from "../shared/ingredients.js";
import {
  kitchenVolumes,
  round,
  unitInfo,
  unitSpelling,
} from "../shared/quantities.js";
import { formatLinkLines } from "../shared/links.js";
import { formatLabels } from "../shared/taxonomy.js";

const asWritten = (raw) =>
  ingredient("text-" + raw.toLowerCase(), raw, null, "", "Other", "As written");

// Mobile policy: store metric amounts, converting cups and spoons with the
// kitchen sizes, and remember the pasted unit for the "original" display.
// `known` lists ingredients whose key and shopping group should be reused
// when a pasted line names them, such as the bundled example recipes.
export function parseIngredient(line, known = []) {
  const parts = splitIngredientLine(line);
  const raw = parts.original;
  if (parts.quantity === null || parts.quantity <= 0) return asWritten(raw);
  let q = parts.quantity,
    u;
  const token = unitSpelling(parts.unitToken);
  const size = unitInfo(token);
  if (size?.dimension === "mass" || size?.dimension === "volume") {
    u = size.dimension === "mass" ? "g" : "ml";
    q = round(q * size.factor);
  } else if (kitchenVolumes[token]) {
    u = "ml";
    q = round(q * kitchenVolumes[token]);
  } else u = token;
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
    course: null,
    cuisine: "",
    diets: [],
    tagsText: "",
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
    course: r.course ?? null,
    cuisine: r.cuisine || "",
    diets: r.diets || [],
    tagsText: formatLabels(r.tags || []),
    originalText: originalText(r),
  };
}
