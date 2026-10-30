import { KooksError } from "./store.js";

// What a recipe page says about its recipe in schema.org's terms: the
// JSON-LD most recipe sites publish for search engines. The page itself is
// data; nothing in it is followed, run or fetched.

const MAX_LINES = 500;

const entities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
// Text with any markup taken out and its entities read, on one line.
export function plain(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] !== "#") return entities[name.toLowerCase()] ?? match;
      const code = Number.parseInt(
        name.slice(name[1].toLowerCase() === "x" ? 2 : 1),
        name[1].toLowerCase() === "x" ? 16 : 10,
      );
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

const list = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];

// Every JSON-LD block on the page, as values; a block that is not JSON is
// passed over. Found by scanning for script tags rather than by one pattern
// over the whole page, so a large page costs one pass.
function blocks(html) {
  const lower = html.toLowerCase();
  const found = [];
  for (let at = lower.indexOf("<script"); at >= 0;) {
    const open = lower.indexOf(">", at);
    if (open < 0) break;
    const close = lower.indexOf("</script", open);
    if (close < 0) break;
    if (lower.slice(at, open).includes("application/ld+json")) {
      const body = html.slice(open + 1, close);
      try {
        found.push(JSON.parse(body));
      } catch {
        try {
          // Some sites leave raw line breaks inside strings.
          found.push(JSON.parse(body.replace(/[\r\n\t]+/g, " ")));
        } catch {
          // Not readable; another block may be.
        }
      }
    }
    at = lower.indexOf("<script", close);
  }
  return found;
}

// The objects in a block, wherever they sit: in an array, in @graph, or as
// the main entity of a page.
function* nodes(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item, depth + 1);
    return;
  }
  yield value;
  yield* nodes(value["@graph"], depth + 1);
  yield* nodes(value.mainEntity, depth + 1);
}

const isRecipe = (node) =>
  list(node["@type"]).some((type) =>
    /^(https?:\/\/schema\.org\/|schema:)?recipe$/i.test(String(type)),
  );

// Instructions come as one text, a list of texts, HowToSteps, or
// HowToSections of steps; a section's name leads its first step.
function steps(value, depth = 0) {
  if (depth > 4) return [];
  return list(value).flatMap((item) => {
    if (typeof item === "string")
      return item
        .split(/\r?\n|<br\s*\/?>|<\/p>|<\/li>/i)
        .map(plain)
        .filter(Boolean);
    if (!item || typeof item !== "object") return [];
    if (item.itemListElement) {
      const inner = steps(item.itemListElement, depth + 1);
      const name = plain(item.name);
      if (name && inner.length) inner[0] = `${name}: ${inner[0]}`;
      return inner;
    }
    const text = plain(item.text ?? item.name ?? item.description);
    return text ? [text] : [];
  });
}

// "4", 4, "4 servings", ["4", "4 servings"] or "Makes 12 cookies".
function servingsOf(value) {
  for (const item of list(value)) {
    const n = Number(
      /\d+(?:[.,]\d+)?/.exec(plain(item))?.[0]?.replace(",", "."),
    );
    if (n >= 0.01 && n <= 10000) return n;
  }
  return null;
}

// An ISO 8601 duration such as PT1H30M, in whole minutes.
export function minutesOf(value) {
  const match =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      String(value ?? "").trim(),
    );
  if (!match || match[0] === "P" || match[0].toUpperCase() === "PT")
    return null;
  const [d, h, m, s] = match.slice(1).map((part) => Number(part ?? 0));
  const total = Math.round(d * 1440 + h * 60 + m + s / 60);
  return total > 0 && total <= 10080 ? total : null;
}

const coursePatterns = [
  ["breakfast", /breakfast|brunch/i],
  ["starter", /starter|appeti[sz]er|hors d/i],
  ["main", /\bmain|dinner|supper|lunch/i],
  ["side", /\bside/i],
  ["soup", /\bsoup/i],
  ["salad", /\bsalad/i],
  ["dessert", /dessert|pudding|sweets?\b/i],
  ["baking", /baking|bread|baked goods/i],
  ["snack", /snack/i],
  ["drink", /drink|beverage|cocktail|smoothie/i],
];
const courseOf = (value) => {
  for (const category of list(value).map(plain))
    for (const [key, pattern] of coursePatterns)
      if (pattern.test(category)) return key;
  return null;
};

// The recipe on a page, in the words the page uses, with its own text for
// the draft's original: { title, servings, ingredients, steps,
// total_minutes, course, cuisine, text }.
export function readRecipePage(html) {
  const recipe = blocks(html)
    .flatMap((block) => [...nodes(block)])
    .find(isRecipe);
  if (!recipe)
    throw new KooksError(
      "NO_RECIPE",
      "That page doesn’t describe its recipe in a way Kooks can read. Copy the recipe from the page and paste it instead.",
    );
  const title = plain(recipe.name).slice(0, 500) || "Untitled recipe";
  const ingredients = list(recipe.recipeIngredient ?? recipe.ingredients)
    .map((line) => plain(line).slice(0, 500))
    .filter(Boolean)
    .slice(0, MAX_LINES);
  const method = steps(recipe.recipeInstructions)
    .map((step) => step.slice(0, 10000))
    .slice(0, MAX_LINES);
  const servings = servingsOf(recipe.recipeYield);
  const total =
    minutesOf(recipe.totalTime) ??
    ((minutesOf(recipe.prepTime) ?? 0) + (minutesOf(recipe.cookTime) ?? 0) ||
      null);
  const description = plain(recipe.description);
  const yieldText = list(recipe.recipeYield).map(plain).find(Boolean);
  const text = [
    title,
    description,
    yieldText && `Yield: ${yieldText}`,
    ingredients.length && ["Ingredients", ...ingredients].join("\n"),
    method.length &&
      ["Method", ...method.map((step, i) => `${i + 1}. ${step}`)].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 200000);
  return {
    title,
    servings,
    ingredients,
    steps: method,
    total_minutes: total && total <= 10080 ? total : null,
    course: courseOf(recipe.recipeCategory),
    cuisine:
      list(recipe.recipeCuisine).map(plain).find(Boolean)?.slice(0, 100) ??
      null,
    text,
  };
}
