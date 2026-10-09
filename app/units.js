// Pure display and measurement helpers for the mobile cookbook. Nothing here
// touches the DOM or app state, so the browser suite can exercise it directly.

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

// Ingredient amount in the chosen display system. Stored quantities are
// metric; "us" converts for display and "original" shows the pasted units.
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
      q /= 28.349523125;
      u = "oz";
    } else if (u === "kg") {
      q = (q * 1000) / 28.349523125;
      u = "oz";
    } else if (u === "ml") {
      if (q >= 60) {
        q /= 240;
        u = "cup";
      } else if (q >= 15) {
        q /= 15;
        u = "tbsp";
      } else {
        q /= 5;
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
  if (["cup", "can", "clove"].includes(u) && q !== 1) u += "s";
  return `${formatNumber(q)}${u ? " " + u : ""}`;
}

export function originalText(r) {
  return (
    r.originalText ||
    `${r.title}\nServes ${r.servings}\n\nIngredients\n${r.ingredients.map((i) => `${amount(i, 1, "original")} ${i.n}${i.note && i.q !== null ? ", " + i.note : ""}`).join("\n")}\n\nMethod\n${r.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n\n")}`
  );
}

export function scaledText(text, units) {
  return units === "us"
    ? text.replace(
        /(\d+)°C/g,
        (_, c) => `${Math.round((Number(c) * 9) / 5 + 32)}°F`,
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
