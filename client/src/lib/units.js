import { unitInfo } from "../../../shared/quantities.js";
import { kept } from "./kept.js";

// How amounts read on this device: as the recipe wrote them, in grams and
// millilitres, or in ounces, pounds, cups and spoons.
export const UNITS = [
  { value: "written", label: "As written" },
  { value: "metric", label: "Metric" },
  { value: "us", label: "US" },
];
export const units = kept(
  "kooks.units",
  "written",
  (value) => value === "metric" || value === "us",
);

// Converted amounts are rounded to what a scale or a measuring cup shows.
const near = (value, step) => Math.max(step, Math.round(value / step) * step);

// An amount in the other system, or null when it already reads that way or
// has no fixed size: a can, a clove, or a bare cup or spoon whose size the
// recipe never said.
export function convert(quantity, unit, system) {
  const info = unitInfo(unit ?? "");
  if (system === "written" || quantity == null || !info) return null;
  if (info.dimension === "count") return null;
  const mass = info.dimension === "mass";
  const metric = (mass ? [1, 1000, 0.001] : [1, 1000]).includes(info.factor);
  // Grams or millilitres.
  const base = quantity * info.factor;
  if (system === "metric") {
    if (metric) return null;
    if (base >= 1000)
      return { quantity: near(base / 1000, 0.05), unit: mass ? "kg" : "l" };
    return {
      quantity: near(base, base < 10 ? 0.5 : base < 100 ? 1 : 5),
      unit: mass ? "g" : "ml",
    };
  }
  // Metric cups and spoons are 250, 15 and 5 ml; the rest is already US.
  if (!metric && !(!mass && [250, 15, 5].includes(info.factor))) return null;
  if (mass) {
    const oz = base / 28.349523125;
    return oz >= 16
      ? { quantity: near(base / 453.59237, 0.25), unit: "lb" }
      : { quantity: near(oz, oz < 4 ? 0.25 : 0.5), unit: "oz" };
  }
  if (base < 14)
    return { quantity: near(base / 4.92892159375, 0.25), unit: "tsp" };
  if (base < 59)
    return { quantity: near(base / 14.78676478125, 0.5), unit: "tbsp" };
  return { quantity: near(base / 236.5882365, 0.25), unit: "cup" };
}
