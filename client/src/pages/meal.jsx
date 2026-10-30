import { useState } from "preact/hooks";
import {
  ArrowLeft,
  CalendarPlus,
  Pencil,
  ShoppingBasket,
  UtensilsCrossed,
} from "lucide";
import { change, record } from "../lib/store.js";
import { leave } from "../lib/router.js";
import { hrefOf, metaOf } from "../lib/kitchen.js";
import { PageHeader } from "../ui/page.jsx";
import { Tile } from "../ui/tile.jsx";
import { Icon } from "../ui/icon.jsx";
import { CookButton } from "../ui/cook-button.jsx";
import { Field, FormError, useDirty, useWork } from "../ui/form.jsx";
import { RecipePicker } from "../ui/recipe-picker.jsx";
import { Missing } from "./recipe.jsx";
import { RemoveButton } from "./library.jsx";

const back = (href, label) => (
  <a class="back" href={href}>
    <Icon icon={ArrowLeft} />
    {label}
  </a>
);

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
      {back("#/recipes", "Recipes")}
      <PageHeader eyebrow="Meal" title={m.data.title}>
        <a class="btn" href={`#/groceries/add/meal/${encodeURIComponent(id)}`}>
          <Icon icon={ShoppingBasket} />
          Add to groceries
        </a>
        <a class="btn" href={`#/week/when/meal/${encodeURIComponent(id)}`}>
          <Icon icon={CalendarPlus} />
          Add to the week
        </a>
        <CookButton source={{ kind: "meal", id }} primary />
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
      <div class="row">
        <a class="btn btn-quiet" href={`${hrefOf("meal", id)}/edit`}>
          <Icon icon={Pencil} />
          Edit meal
        </a>
        <RemoveButton
          kind="meal"
          item={m}
          label="Remove meal"
          done={`${m.data.title} is off your meals.`}
        />
      </div>
    </article>
  );
}

const dishOf = (recipe_id) => ({ recipe_id, label: "", servings: "" });

// Put a meal together from recipes in the cookbook, each with what it is in
// the meal and, when it differs from the recipe, how many it serves.
export function MealForm({ id }) {
  const m = id === "new" ? null : record("meal", id);
  const start = m?.data;
  const [f, setF] = useState(() => ({
    title: start?.title ?? "",
    notes: start?.notes ?? "",
    dishes: (start?.dishes ?? []).map((dish) => ({
      recipe_id: dish.recipe_id,
      label: dish.label,
      servings: dish.servings == null ? "" : String(dish.servings),
    })),
  }));
  const dirty = useDirty();
  const work = useWork();
  if (id !== "new" && !m) return <Missing what="meal" />;
  const edit = (next) => {
    dirty.current = true;
    setF({ ...f, ...next });
  };
  const setDish = (index, key) => (event) =>
    edit({
      dishes: f.dishes.map((dish, i) =>
        i === index ? { ...dish, [key]: event.currentTarget.value } : dish,
      ),
    });
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      if (!f.dishes.length)
        throw new Error("Choose at least one recipe for the meal.");
      const title = f.title.trim();
      const { record: saved } = await change(
        "meal_save",
        {
          ...(m && { id, expected_version: m.version }),
          meal: {
            title,
            notes: f.notes,
            dishes: f.dishes.map((dish) => ({
              recipe_id: dish.recipe_id,
              label: dish.label.trim(),
              servings: dish.servings === "" ? null : Number(dish.servings),
            })),
          },
        },
        { done: m ? "Changes saved." : `${title} is in your cookbook.` },
      );
      dirty.current = false;
      leave(hrefOf("meal", saved.id).slice(2));
    });
  };
  return (
    <div class="stack-lg page-narrow">
      {m
        ? back(hrefOf("meal", id), m.data.title)
        : back("#/recipes/add", "Add to your cookbook")}
      <PageHeader title={m ? "Edit meal" : "New meal"} />
      <form class="card" onSubmit={submit}>
        <Field id="meal-title" label="Name">
          <input
            id="meal-title"
            class="input"
            required
            maxLength={500}
            placeholder="Sunday roast"
            value={f.title}
            onInput={(event) => edit({ title: event.currentTarget.value })}
          />
        </Field>
        <RecipePicker
          id="meal-recipes"
          legend="Dishes"
          chosen={f.dishes.map((dish) => dish.recipe_id)}
          onChange={(ids) =>
            edit({
              dishes: ids.map(
                (recipeId) =>
                  f.dishes.find((dish) => dish.recipe_id === recipeId) ??
                  dishOf(recipeId),
              ),
            })
          }
        />
        {f.dishes.map((dish, index) => {
          const key = `meal-dish-${index}`;
          const recipe = record("recipe", dish.recipe_id);
          return (
            <fieldset key={dish.recipe_id} class="field">
              <legend>
                {recipe?.data.title ?? "A recipe that was archived"}
              </legend>
              <div class="fields-2">
                <Field id={`${key}-label`} label="Served as">
                  <input
                    id={`${key}-label`}
                    class="input"
                    maxLength={500}
                    placeholder="Main, side, salad"
                    value={dish.label}
                    onInput={setDish(index, "label")}
                  />
                </Field>
                <Field id={`${key}-servings`} label="Servings">
                  <input
                    id={`${key}-servings`}
                    class="input"
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    max={10000}
                    step="any"
                    placeholder={
                      recipe?.data.servings
                        ? `As the recipe: ${recipe.data.servings}`
                        : "As the recipe"
                    }
                    value={dish.servings}
                    onInput={setDish(index, "servings")}
                  />
                </Field>
              </div>
            </fieldset>
          );
        })}
        <Field id="meal-notes" label="Notes">
          <textarea
            id="meal-notes"
            class="input"
            rows={3}
            value={f.notes}
            onInput={(event) => edit({ notes: event.currentTarget.value })}
          />
        </Field>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={UtensilsCrossed} />
            {work.busy ? "Saving…" : "Save meal"}
          </button>
        </div>
      </form>
    </div>
  );
}
