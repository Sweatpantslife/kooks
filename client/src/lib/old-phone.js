import { MAX_LINKS, isWebUrl } from "../../../shared/links.js";
import { courseKeys, dietKeys, MAX_TAGS } from "../../../shared/taxonomy.js";

// The phone app before this one kept a cookbook of its own on the phone, in
// kooks/cookbook.json. The recipes written there come into the household's
// kitchen once, as recipes like any other; its six sample recipes, plans and
// meals stay behind.

const clip = (value, max) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

function recipeOf(r) {
  const source = clip(r.source, 4000);
  const sourceUrl = isWebUrl(source) ? source : null;
  const tags = r.tags ?? (r.tag && r.tag !== "Your collection" ? [r.tag] : []);
  return {
    title: clip(r.title, 500),
    servings: r.servings > 0 ? Math.min(10000, r.servings) : null,
    original_text: String(r.originalText ?? "").slice(0, 200000),
    source_url: sourceUrl,
    links: (r.links ?? [])
      .filter((link) => isWebUrl(link?.url) && link.url.length <= 4000)
      .slice(0, MAX_LINKS)
      .map((link) => ({ url: link.url, title: clip(link.title, 500) })),
    ingredients: (r.ingredients ?? [])
      .filter((i) => clip(i?.n, 500))
      .slice(0, 500)
      .map((i) => ({
        name: clip(i.n, 500),
        quantity:
          typeof i.q === "number" && i.q >= 0 && i.q <= 1e9 ? i.q : null,
        unit: clip(i.u, 80),
        preparation: clip(i.note, 500),
        category: clip(i.group, 100) || "Other",
        original_text: String(i.raw ?? "").slice(0, 2000),
      })),
    steps: (r.steps ?? [])
      .map((s) => ({
        text: [clip(s?.title, 500), clip(s?.text, 10000)]
          .filter(Boolean)
          .join(": ")
          .slice(0, 10000),
        duration_seconds:
          s?.mins > 0 ? Math.min(604800, Math.round(s.mins * 60)) : null,
      }))
      .filter((s) => s.text)
      .slice(0, 500),
    equipment: (r.equipment ?? [])
      .map((name) => clip(name, 500))
      .filter(Boolean)
      .slice(0, 100)
      .map((name) => ({ name })),
    course: courseKeys.includes(r.course) ? r.course : null,
    cuisine: clip(r.cuisine, 100) || null,
    diets: (r.diets ?? []).filter((diet) => dietKeys.includes(diet)),
    tags: tags
      .map((tag) => clip(tag, 100))
      .filter(Boolean)
      .slice(0, MAX_TAGS),
    notes: [
      clip(r.description, 15000),
      clip(r.note, 15000),
      !sourceUrl && source ? `From ${source}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 30000),
    favorite: Boolean(r.favorite),
    total_minutes: r.time > 0 ? Math.min(10080, Math.round(r.time)) : null,
  };
}

// The recipes written on the old phone app, each with the key that saves it
// once however often it is sent, or none when the file is not the old app's.
export function oldPhoneRecipes(text) {
  let saved;
  try {
    saved = JSON.parse(text);
  } catch {
    return [];
  }
  if (saved?.format !== "kooks-mobile") return [];
  return (saved.state?.custom ?? [])
    .filter((r) => clip(r?.title, 500))
    .map((r) => ({
      key: `old-phone-${String(r.id).slice(0, 100)}`,
      recipe: recipeOf(r),
    }));
}
