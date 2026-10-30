import { ArrowLeft, CalendarPlus, ShoppingBasket } from "lucide";
import { record } from "../lib/store.js";
import { metaOf } from "../lib/kitchen.js";
import { PageHeader } from "../ui/page.jsx";
import { Tile } from "../ui/tile.jsx";
import { Icon } from "../ui/icon.jsx";
import { Missing } from "./recipe.jsx";

// A meal is dishes cooked together: a main, a side, a salad.
export function Meal({ id }) {
  const m = record("meal", id);
  if (!m) return <Missing what="meal" />;
  const dishes = m.data.dishes.map((dish) => ({
    dish,
    recipe: record("recipe", dish.recipe_id),
  }));
  return (
    <article class="stack">
      <a class="back" href="#/recipes">
        <Icon icon={ArrowLeft} />
        Recipes
      </a>
      <PageHeader eyebrow="Meal" title={m.data.title}>
        <a class="btn" href={`#/groceries/add/meal/${encodeURIComponent(id)}`}>
          <Icon icon={ShoppingBasket} />
          Add to groceries
        </a>
        <a
          class="btn btn-primary"
          href={`#/week/when/meal/${encodeURIComponent(id)}`}
        >
          <Icon icon={CalendarPlus} />
          Add to the week
        </a>
      </PageHeader>
      {m.data.notes && <p class="lede preline">{m.data.notes}</p>}
      <section aria-labelledby="dishes" class="stack">
        <h2 id="dishes">Dishes</h2>
        <ul class="tiles" role="list">
          {dishes.map(({ dish, recipe }) =>
            recipe ? (
              <Tile
                key={dish.recipe_id}
                kind="recipe"
                record={recipe}
                href={`#/recipes/${encodeURIComponent(recipe.id)}`}
                meta={[
                  dish.label,
                  dish.servings && `Serves ${dish.servings}`,
                  metaOf("recipe", recipe),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ) : (
              <li key={dish.recipe_id} class="tile tile-gone">
                <span class="tile-text">
                  <span class="tile-title">A recipe that was archived</span>
                </span>
              </li>
            ),
          )}
        </ul>
      </section>
    </article>
  );
}
