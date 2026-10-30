import { computed } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { tool } from "./api.js";
import { change, db, records } from "./store.js";
import { localDay, monday } from "./format.js";
import { kept } from "./kept.js";

// Prices and budgets count in one currency at a time: the one chosen on this
// device, or else the one the household last priced something in.
const chosen = kept("kooks.currency", "", (code) => /^[A-Z]{3}$/.test(code));
const lastUsed = () =>
  [...records("price"), ...records("budget")].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  )[0]?.data.currency;
export const currency = computed(() => chosen.value || lastUsed() || "USD");
export const chooseCurrency = (code) => (chosen.value = code.toUpperCase());

export function money(value, code = currency.value) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

// A budget holds from its week until a newer one is set, so the household
// sets it once rather than every Monday.
export const budgetFor = (start) =>
  records("budget")
    .filter(
      (b) => b.data.currency === currency.value && b.data.week_start <= start,
    )
    .sort((a, b) => b.data.week_start.localeCompare(a.data.week_start))[0] ??
  null;

export function saveBudget(amount) {
  const start = monday();
  const same = records("budget").find(
    (b) => b.data.week_start === start && b.data.currency === currency.value,
  );
  return change(
    "budget_save",
    {
      ...(same && { id: same.id, expected_version: same.version }),
      budget: { week_start: start, currency: currency.value, amount },
    },
    { done: `The weekly budget is ${money(amount)} from this week on.` },
  );
}

// What the week's planned food comes to at the prices the household knows,
// and the ingredients still without a price there.
export async function weekCost(start) {
  const cost = await tool("cost_week", {
    week_start: start,
    currency: currency.value,
    as_of: localDay(),
  });
  const seen = new Set();
  const unpriced = [];
  for (const plan of cost.plans)
    for (const line of plan.missing_prices) {
      // An amount like "to taste" can't be priced, whatever the shop says.
      if (line.ingredient.quantity === null) continue;
      const { name, preparation = "" } = line.ingredient;
      const key = `${name.toLowerCase()}|${preparation.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unpriced.push({ ...line.ingredient, recipe: line.recipe });
    }
  return { ...cost, unpriced };
}

// What the week's planned food comes to, again whenever the kitchen changes;
// nothing is asked while `wanted` is false.
export function useWeekCost(start, wanted = true) {
  const [cost, setCost] = useState(null);
  const code = currency.value;
  useEffect(() => {
    if (!wanted) return setCost(null);
    let live = true;
    weekCost(start).then(
      (c) => live && setCost(c),
      () => live && setCost(null),
    );
    return () => {
      live = false;
    };
  }, [start, code, wanted, db.value]);
  return cost;
}

// "$42.10", or "at least $42.10" while some of it has no price.
export const planned = (cost) =>
  cost.complete ? money(cost.known_cost) : `at least ${money(cost.known_cost)}`;
