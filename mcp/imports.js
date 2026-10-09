import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KooksError, requireThat } from "./store.js";
import { recipe } from "./schemas.js";

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
export function parseIngredient(line) {
  const original = line.trim().replace(/^[-•]\s*/, "");
  const expanded = original
    .replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (c) => ` ${fractions[c]}`)
    .trim();
  const match = expanded.match(
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)(?:\s+|(?=[a-zA-Z]))(.+)$/,
  );
  const base = {
    name: original || "Unclear ingredient",
    quantity: null,
    unit: "",
    original_text: line,
    preparation: "",
  };
  if (!match) return base;
  let quantity = match[1].split(/\s+/).reduce((sum, part) => {
    if (!part.includes("/")) return sum + Number(part.replace(",", "."));
    const [a, b] = part.split("/").map(Number);
    return sum + a / b;
  }, 0);
  if (!Number.isFinite(quantity) || quantity > 1e9) return base;
  let rest = match[2],
    unit = "";
  const unitMatch = rest.match(
    /^(g|grams?|kg|kilograms?|mg|mL|ml|milliliters?|millilitres?|l|liters?|litres?|oz|ounces?|lb|lbs|pounds?|cups?|tbsp|tablespoons?|tsp|teaspoons?|us_cup|metric_cup|us_tbsp|metric_tbsp|us_tsp|metric_tsp|cloves?|cans?|each|pieces?|count)\s+(.+)$/i,
  );
  if (unitMatch) {
    unit = unitMatch[1]
      .toLowerCase()
      .replace(/^cups$/, "cup")
      .replace(/^tablespoons?$/, "tbsp")
      .replace(/^teaspoons?$/, "tsp");
    rest = unitMatch[2];
  }
  const [name, ...preparation] = rest.split(/,\s*/);
  return {
    ...base,
    name: name.trim(),
    quantity,
    unit,
    preparation: preparation.join(", "),
  };
}

// Conservative extraction: keep the entire source and never invent yield,
// times, ingredients or instructions when headings cannot be recognized.
export function extractRecipe(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const ingredientHeading = /^(ingredients?|מצרכים|מרכיבים)\s*:?$/i;
  const methodHeading =
    /^(method|directions|instructions|steps|הוראות הכנה|אופן ההכנה|אופן הכנה)\s*:?$/i;
  const firstIngredients = lines.findIndex((l) => ingredientHeading.test(l));
  const firstMethod = lines.findIndex((l) => methodHeading.test(l));
  const yieldMatch = text.match(
    /(?:serv(?:es|ings?)|yield)\s*:?\s*(\d+(?:\.\d+)?)/i,
  );
  const ingredientLines =
    firstIngredients >= 0
      ? lines.slice(
          firstIngredients + 1,
          firstMethod > firstIngredients ? firstMethod : undefined,
        )
      : [];
  const steps =
    firstMethod >= 0
      ? lines
          .slice(firstMethod + 1)
          .map((text) => ({ text: text.replace(/^\d+[.)]\s*/, "") }))
      : [];
  const title =
    lines
      .find(
        (l) =>
          !ingredientHeading.test(l) &&
          !methodHeading.test(l) &&
          !/^serv(?:es|ings?)/i.test(l),
      )
      ?.slice(0, 500) || "Untitled recipe";
  const servings =
    yieldMatch &&
    Number(yieldMatch[1]) >= 0.01 &&
    Number(yieldMatch[1]) <= 10000
      ? Number(yieldMatch[1])
      : null;
  const ingredients = ingredientLines
    .filter((l) => !/^serv(?:es|ings?)/i.test(l))
    .map(parseIngredient);
  const warnings = [];
  if (!ingredients.length)
    warnings.push(
      "Ingredient headings were not found. Copy the ingredient lines from the source into the editor.",
    );
  if (!steps.length)
    warnings.push(
      "Method headings were not found. Copy the instructions from the source into the editor.",
    );
  if (servings === null)
    warnings.push("Serving count is unknown. Set it before scaling.");
  if (ingredients.some((i) => i.quantity === null))
    warnings.push(
      "Some ingredient amounts are unclear and remain unquantified.",
    );
  if (ingredients.some((i) => ["cup", "tbsp", "tsp"].includes(i.unit)))
    warnings.push(
      "Cup and spoon conventions are unspecified. Original units are preserved.",
    );
  return {
    recipe: recipe.parse({
      title,
      servings,
      ingredients,
      steps,
      original_text: text,
    }),
    warnings,
  };
}

export function imageBytes(image) {
  requireThat(
    /^[A-Za-z0-9+/]*={0,2}$/.test(image.base64) &&
      image.base64.length % 4 === 0,
    "INVALID_IMAGE",
    "Image data must be valid base64.",
  );
  const bytes = Buffer.from(image.base64, "base64");
  requireThat(
    bytes.length > 0 && bytes.length <= 8 * 1024 * 1024,
    "IMAGE_TOO_LARGE",
    "Choose an image smaller than 8 MB.",
  );
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  requireThat(
    { "image/png": png, "image/jpeg": jpeg, "image/webp": webp }[
      image.mime_type
    ],
    "INVALID_IMAGE",
    "Image contents do not match the selected image type.",
  );
  return bytes;
}

function run(command, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      env: process.env,
    });
    let stdout = "",
      stderr = "",
      overflow = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 400000) {
        overflow = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2000) stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 && !overflow
        ? resolve(stdout)
        : reject(
            new Error(`OCR process failed (${code}): ${stderr.slice(0, 500)}`),
          ),
    );
  });
}

export async function recognizeImage(image) {
  const bytes = imageBytes(image);
  const directory = await mkdtemp(join(tmpdir(), "kooks-ocr-"));
  try {
    const path = join(directory, "recipe-image");
    await writeFile(path, bytes, { mode: 0o600 });
    let text;
    if (process.platform === "darwin") {
      const source = fileURLToPath(
        new URL("../ocr/recognize.m", import.meta.url),
      );
      const executable = join(directory, "recognize");
      await run(
        "/usr/bin/clang",
        [
          "-fobjc-arc",
          "-framework",
          "Foundation",
          "-framework",
          "Vision",
          "-framework",
          "ImageIO",
          source,
          "-o",
          executable,
        ],
        60000,
      );
      text = await run(executable, [path], 60000);
    } else text = await run("tesseract", [path, "stdout", "--psm", "3"]);
    text = text.trim();
    requireThat(
      text.length > 0,
      "NO_TEXT",
      "No readable text was found. Try a sharper, upright photo or paste the recipe text.",
    );
    requireThat(
      text.length <= 200000,
      "TOO_MUCH_TEXT",
      "This image contains too much text. Crop it to one recipe.",
    );
    return {
      text,
      engine: process.platform === "darwin" ? "Apple Vision" : "Tesseract",
    };
  } catch (error) {
    if (error instanceof KooksError) throw error;
    throw new KooksError(
      "OCR_UNAVAILABLE",
      "Local photo reading failed. On macOS, install the Xcode command line tools; elsewhere, install Tesseract. You can also paste recipe text.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
