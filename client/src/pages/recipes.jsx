import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { BookOpen, Plus, Search, SearchX } from "lucide";
import { normalize } from "../../../shared/quantities.js";
import { tool } from "../lib/api.js";
import { records, db } from "../lib/store.js";
import { plural } from "../lib/format.js";
import {
  KINDS,
  hrefOf,
  metaOf,
  searchText,
  toggleFavorite,
} from "../lib/kitchen.js";
import { PageHeader, Empty } from "../ui/page.jsx";
import { OldPhoneRecipes } from "../ui/old-phone.jsx";
import { Tile } from "../ui/tile.jsx";
import { Icon } from "../ui/icon.jsx";

// What the page shows survives a visit to a recipe and back.
const query = signal("");
const kind = signal("all");
const favorites = signal(false);
const quick = signal(false);
const canMake = signal(false);
// recipe_suggest's answer for "What can I make?": recipe id → what's missing.
const suggestions = signal(null);

// Open the tab on one kind, as after saving an idea to try.
export function showKind(k) {
  query.value = "";
  favorites.value = quick.value = canMake.value = false;
  kind.value = k;
}

const quickEnough = (d) => (d.total_minutes ?? d.active_minutes ?? 999) <= 30;

async function suggest() {
  try {
    const { results, skipped } = await tool("recipe_suggest", {
      use_pantry: true,
      // The people at the table: what they like breaks a tie.
      member_ids: records("member").map((m) => m.id),
      avoid_dislikes: false,
      limit: 100,
    });
    suggestions.value = {
      order: results.map((r) => r.record.id),
      // Ingredients at home without an amount count as at home.
      missing: new Map(results.map((r) => [r.record.id, r.missing.length])),
      unranked: skipped.missing_yield ?? 0,
    };
  } catch (error) {
    suggestions.value = { error: error.message };
  }
}

function Chip({ pressed, onClick, children }) {
  return (
    <button
      type="button"
      class="chip"
      aria-pressed={pressed ? "true" : "false"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Recipes() {
  // A new answer whenever the kitchen changes while the ranking is shown.
  useEffect(() => {
    if (canMake.value) void suggest();
  }, [canMake.value, db.value]);

  const counts = Object.fromEntries(
    KINDS.map(({ kind: k }) => [k, records(k).length]),
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const words = normalize(query.value).split(" ").filter(Boolean);
  const ranking = canMake.value ? suggestions.value : null;
  const recipeOnly = favorites.value || quick.value || canMake.value;

  let items = KINDS.filter(
    ({ kind: k }) => kind.value === "all" || kind.value === k,
  )
    .filter(({ kind: k }) => !recipeOnly || k === "recipe")
    .flatMap(({ kind: k }) => records(k).map((record) => ({ kind: k, record })))
    .filter(({ kind: k, record }) => {
      const d = record.data;
      if (favorites.value && !d.favorite) return false;
      if (quick.value && !quickEnough(d)) return false;
      if (ranking && !ranking.error && !ranking.missing.has(record.id))
        return false;
      const text = searchText(k, record);
      return words.every((w) => text.includes(w));
    });
  if (ranking?.order)
    items.sort(
      (a, b) =>
        ranking.order.indexOf(a.record.id) - ranking.order.indexOf(b.record.id),
    );
  else
    items.sort(
      (a, b) =>
        Number(Boolean(b.record.data.favorite)) -
          Number(Boolean(a.record.data.favorite)) ||
        a.record.data.title.localeCompare(b.record.data.title),
    );

  const badge = (id) => {
    const n = ranking?.missing?.get(id);
    if (n == null) return null;
    return n === 0
      ? { label: "All at home", tone: "herb" }
      : { label: `Need ${n} more`, tone: "saffron" };
  };
  const clear = () => {
    query.value = "";
    favorites.value = quick.value = canMake.value = false;
    kind.value = "all";
  };

  const add = (
    <a class="btn btn-primary" href="#/recipes/add">
      <Icon icon={Plus} />
      Add a recipe
    </a>
  );

  if (!total)
    return (
      <>
        <PageHeader title="Recipes" />
        <OldPhoneRecipes />
        <Empty icon={BookOpen} title="Your cookbook is empty" action={add}>
          Start with something you already love to cook: paste it from a
          message, photograph the page, or write it down.
        </Empty>
      </>
    );

  return (
    <>
      <PageHeader eyebrow={plural(counts.recipe, "recipe")} title="Recipes">
        {add}
      </PageHeader>
      <OldPhoneRecipes />
      <div class="stack">
        <label class="search">
          <Icon icon={Search} />
          <span class="sr-only">Search recipes</span>
          <input
            type="search"
            class="search-input"
            placeholder="Recipes, ingredients, ideas, techniques"
            value={query.value}
            onInput={(event) => (query.value = event.currentTarget.value)}
          />
        </label>
        <div class="chips" role="group" aria-label="Show">
          <Chip
            pressed={kind.value === "all"}
            onClick={() => (kind.value = "all")}
          >
            All
          </Chip>
          {KINDS.filter(
            ({ kind: k }) =>
              k === "recipe" || counts[k] > 0 || kind.value === k,
          ).map(({ kind: k, label }) => (
            <Chip
              key={k}
              pressed={kind.value === k}
              onClick={() => (kind.value = kind.value === k ? "all" : k)}
            >
              {label} <span class="chip-count">{counts[k]}</span>
            </Chip>
          ))}
        </div>
        <div class="chips" role="group" aria-label="Recipes that are">
          <Chip
            pressed={favorites.value}
            onClick={() => (favorites.value = !favorites.value)}
          >
            Favorites
          </Chip>
          <Chip
            pressed={quick.value}
            onClick={() => (quick.value = !quick.value)}
          >
            Under 30 min
          </Chip>
          <Chip
            pressed={canMake.value}
            onClick={() => {
              canMake.value = !canMake.value;
              if (!canMake.value) suggestions.value = null;
            }}
          >
            What can I make?
          </Chip>
        </div>
      </div>
      <p class="results-note muted" role="status">
        {canMake.value && !ranking
          ? "Checking what’s at home…"
          : ranking?.error
            ? ranking.error
            : `${plural(items.length, "result")}${
                ranking
                  ? `, sorted by what’s already at home${
                      ranking.unranked
                        ? `. ${plural(ranking.unranked, "recipe")} without a yield can’t be checked`
                        : ""
                    }`
                  : ""
              }.`}
      </p>
      {items.length ? (
        <ul class="tiles" role="list">
          {items.map(({ kind: k, record }) => (
            <Tile
              key={record.id}
              kind={k}
              record={record}
              href={hrefOf(k, record.id)}
              meta={metaOf(k, record)}
              badge={k === "recipe" ? badge(record.id) : null}
              onFavorite={
                k === "recipe" ? () => toggleFavorite(record) : undefined
              }
            />
          ))}
        </ul>
      ) : (
        !(canMake.value && !ranking) && (
          <Empty
            icon={SearchX}
            title="Nothing matches"
            action={
              <button type="button" class="btn" onClick={clear}>
                Show everything
              </button>
            }
          >
            Try fewer words, or turn off a filter.
          </Empty>
        )
      )}
    </>
  );
}
