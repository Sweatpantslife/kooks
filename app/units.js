// Pure display and measurement helpers for the mobile cookbook. Nothing here
// touches the DOM or app state, so the browser suite can exercise it directly.
import { kitchenVolumes, unitInfo, unitLabel } from "../shared/quantities.js";

// The value an amount shows: the nearest eighth when it is that close,
// otherwise one decimal.
function shown(n) {
  const f = Math.round(n * 8) / 8;
  return Math.abs(n - f) < 0.015 ? f : Math.round(n * 10) / 10;
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return "";
  const f = Math.round(n * 8) / 8;
  if (Math.abs(n - f) < 0.015) {
    const whole = Math.floor(f);
    const fractions = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
    return String(whole || "") + fractions[Math.round((f - whole) * 8)] || "0";
  }
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
}

const ounce = unitInfo("oz").factor;

// Ingredient amount in the chosen display system. Stored quantities are
// metric; "us" converts for display and "original" shows the pasted units.
// Cups and spoons use the same sizes as parsing, so a pasted amount reads
// back as written.
export function amount(i, multiplier = 1, units = "metric") {
  if (i.q === null || i.q === undefined) return i.note || "As needed";
  let q = i.q * multiplier,
    u = i.u;
  if (units === "original" && i.original) {
    q = i.original.q * multiplier;
    u = i.original.u;
  }
  if (units === "us") {
    if (u === "g") {
      q /= ounce;
      u = "oz";
    } else if (u === "kg") {
      q = (q * 1000) / ounce;
      u = "oz";
    } else if (u === "ml") {
      if (q >= kitchenVolumes.cup / 4) {
        q /= kitchenVolumes.cup;
        u = "cup";
      } else if (q >= kitchenVolumes.tbsp) {
        q /= kitchenVolumes.tbsp;
        u = "tbsp";
      } else {
        q /= kitchenVolumes.tsp;
        u = "tsp";
      }
    }
  }
  if (units === "metric" && u === "g" && q >= 1000) {
    q /= 1000;
    u = "kg";
  } else if (units === "metric" && u === "ml" && q >= 1000) {
    q /= 1000;
    u = "L";
  }
  // The plural follows the number shown: 0.986 cups reads "1 cup".
  u = unitLabel(u, shown(q));
  return `${formatNumber(q)}${u ? " " + u : ""}`;
}

export function originalText(r) {
  return (
    r.originalText ||
    `${r.title}\nServes ${r.servings}\n\nIngredients\n${r.ingredients.map((i) => `${amount(i, 1, "original")} ${i.n}${i.note && i.q !== null ? ", " + i.note : ""}`).join("\n")}\n\nMethod\n${r.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n\n")}`
  );
}

// A Celsius temperature in recipe text: "180°C", "180 °C", "175.5ºC", or a
// range such as "180–200 °C" or "180 to 200°C".
const celsius =
  /(\d+(?:[.,]\d+)?)(?:(\s*(?:-|–|to)\s*)(\d+(?:[.,]\d+)?))?\s*[°º]\s*C\b/g;
const degrees = (value) => Number(value.replace(",", "."));
const fahrenheit = (value) => Math.round((degrees(value) * 9) / 5 + 32);

// Every Celsius value the text mentions, both ends of a range included.
export const celsiusValues = (text) =>
  [...text.matchAll(celsius)].flatMap(([, low, , high]) =>
    (high === undefined ? [low] : [low, high]).map(degrees),
  );

export function scaledText(text, units) {
  return units === "us"
    ? text.replace(celsius, (_, low, between, high) =>
        high === undefined
          ? `${fahrenheit(low)}°F`
          : `${fahrenheit(low)}${between}${fahrenheit(high)}°F`,
      )
    : text;
}

export function timeLeft(t, now = Date.now()) {
  return t.pausedMs !== null ? t.pausedMs : Math.max(0, t.endAt - now);
}

export function clockText(ms) {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
