// Required-tool overview for one or more dishes: shared tools, dishes with no
// recorded equipment, and oven temperatures that cannot run at the same time.
export function equipmentSummary(components, recipeById) {
  const rows = new Map(),
    unknown = [];
  const resolve = (c) => c.snapshot || recipeById(c.recipeId);
  components.forEach((c) => {
    const r = resolve(c);
    if (!r.equipment?.length) unknown.push(r.title);
    (r.equipment || []).forEach((name) => {
      const key = name.toLowerCase().trim();
      if (!rows.has(key)) rows.set(key, { name, uses: [] });
      if (!rows.get(key).uses.includes(r.title))
        rows.get(key).uses.push(r.title);
    });
  });
  const ovens = components
    .map(resolve)
    .filter((r) => (r.equipment || []).some((t) => /oven/i.test(t)))
    .map((r) => ({
      title: r.title,
      temps: [
        ...new Set(
          r.steps.flatMap((s) =>
            [...s.text.matchAll(/(\d+)°C/g)].map((m) => m[1]),
          ),
        ),
      ],
    }))
    .filter((r) => r.temps.length);
  const conflict = new Set(ovens.flatMap((r) => r.temps)).size > 1;
  return { rows: [...rows.values()], unknown, ovens, conflict };
}
