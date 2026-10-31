import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowLeft, Check, Trash2 } from "lucide";
import {
  courses,
  diets,
  formatLabels,
  parseLabels,
  suggestedCuisines,
  taxonomy,
} from "../../../shared/taxonomy.js";
import {
  editedIngredients,
  editedSteps,
  ingredientLine,
  stepsText,
} from "../../../shared/ingredients.js";
import { formatLinkLines, parseLinkLines } from "../../../shared/links.js";
import {
  change,
  keep,
  record,
  records,
  refresh,
  undoAction,
  waitingHere,
} from "../lib/store.js";
import { phone } from "../lib/device.js";
import { needsChoice } from "../lib/waiting.js";
import { toast } from "../lib/toast.js";
import { guardLeaving, leave } from "../lib/router.js";
import { amount } from "../lib/kitchen.js";
import { plural } from "../lib/format.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Field, FormError, hint, numberOrNull, useWork } from "../ui/form.jsx";
import { Icon } from "../ui/icon.jsx";
import { AssetImage } from "../ui/asset.jsx";
import { Missing } from "./recipe.jsx";
import { linkIdea } from "./library.jsx";

const BLANK = {
  title: "",
  servings: null,
  ingredients: [],
  steps: [],
  equipment: [],
  course: null,
  cuisine: null,
  diets: [],
  tags: [],
  notes: "",
  links: [],
  source_url: null,
};

const SPICE = ["Not spicy", "Mild", "Medium", "Hot"];
const CLEANUP = [
  ["low", "Light"],
  ["medium", "Some"],
  ["high", "A lot"],
];

const text = (value) => (value == null ? "" : String(value));
const lines = (value) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

// An ingredient as a cook writes it: ½ cup parmesan, grated; 2 cloves garlic.
const squash = (line) => line.trim().replace(/\s+/g, " ");
const lineOf = (i) =>
  squash(`${amount(i)} ${i.name}${i.preparation ? `, ${i.preparation}` : ""}`);
// A line left as shown is matched back to its stored form, so the shared
// reader keeps it exactly instead of reading it again.
function storedLines(text, original) {
  const unused = [...original];
  return text
    .split("\n")
    .map((line) => {
      const at = unused.findIndex((i) => lineOf(i) === squash(line));
      return at < 0 ? line : ingredientLine(unused.splice(at, 1)[0]);
    })
    .join("\n");
}

// The form's fields as text, the way the person sees and types them.
function fieldsOf(d, mode) {
  return {
    title: mode === "variation" ? `${d.title}, my way` : d.title,
    servings: text(d.servings),
    total_minutes: text(d.total_minutes),
    active_minutes: text(d.active_minutes),
    ingredients: d.ingredients.map(lineOf).join("\n"),
    steps: stepsText(d.steps),
    course: d.course ?? "",
    cuisine: d.cuisine ?? "",
    diets: d.diets ?? [],
    tags: formatLabels(d.tags),
    pan_count: text(d.pan_count),
    cleanup: d.cleanup ?? "",
    spice_level: text(d.spice_level),
    equipment: (d.equipment ?? []).map((e) => e.name).join("\n"),
    notes: d.notes ?? "",
    source_url: d.source_url ?? "",
    links: formatLinkLines(d.links),
    preferred: true,
    reviewed: false,
  };
}

// Back from the editor: to the recipe it changes, or to where it started.
const exitOf = (mode, id) =>
  mode === "edit" || mode === "variation"
    ? `recipes/${encodeURIComponent(id)}`
    : mode === "draft"
      ? "recipes/add"
      : mode === "idea"
        ? `recipes/idea/${encodeURIComponent(id)}`
        : "recipes";

const WORDS = {
  new: { title: "New recipe", save: "Save recipe" },
  edit: { title: "Edit recipe", save: "Save changes" },
  variation: { title: "Your own version", save: "Save your version" },
  draft: { title: "Check the draft", save: "Save recipe" },
  idea: { title: "Write up the idea", save: "Save recipe" },
};

// How the ingredient lines will be stored, so a misread amount shows before
// it is saved rather than in the middle of cooking.
function Reading({ items }) {
  if (!items.length) return null;
  return (
    <div class="reading">
      <h3 class="eyebrow" id="reading">
        As Kooks reads it
      </h3>
      <ul class="reading-list" role="list" aria-labelledby="reading">
        {items.map((i, index) => (
          <li key={index}>
            {i.quantity == null ? (
              <span class="badge badge-saffron">No amount</span>
            ) : (
              <span class="ingredient-amount">{amount(i)}</span>
            )}
            <span>
              {i.name}
              {i.preparation && <span class="muted">, {i.preparation}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Original({ draft }) {
  const d = draft.data;
  return (
    <aside class="card original" aria-labelledby="original">
      <h2 id="original">Your original</h2>
      {d.warnings.length > 0 && (
        <ul class="warnings" role="list">
          {d.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {d.image_id && (
        <AssetImage
          class="original-image"
          id={d.image_id}
          alt="The photo the draft was read from"
        />
      )}
      <pre class="original-text">{d.original_text}</pre>
    </aside>
  );
}

function Spent({ draft }) {
  return (
    <>
      <PageHeader title="Already saved" />
      <Empty
        icon={Check}
        title="This draft is in your cookbook"
        action={
          <a
            class="btn btn-primary"
            href={`#/recipes/${encodeURIComponent(draft.data.recipe_id)}`}
          >
            Open the recipe
          </a>
        }
      >
        Someone in your kitchen saved it already.
      </Empty>
    </>
  );
}

// An idea to try, as the start of its recipe.
const fromIdea = (idea) =>
  idea && {
    ...BLANK,
    title: idea.data.title,
    notes: idea.data.notes,
    links: idea.data.links,
    tags: idea.data.tags,
  };

// One editor for a new recipe, a change, a variation, an imported draft and
// an idea written up.
export function Editor({ mode, id }) {
  const draft = mode === "draft" ? record("import", id) : null;
  const recipe =
    mode === "edit" || mode === "variation" ? record("recipe", id) : null;
  const idea = mode === "idea" ? record("inspiration", id) : null;
  // What the editor opened with, kept while others change the kitchen.
  const [start] = useState(() => ({
    data: draft?.data.recipe ?? recipe?.data ?? fromIdea(idea) ?? BLANK,
    version: draft?.version ?? recipe?.version ?? idea?.version,
    draft,
  }));
  const [f, setF] = useState(() => fieldsOf(start.data, mode));
  const [stale, setStale] = useState(false);
  // Sections with something in them start open; the person opens the rest.
  const [open] = useState(() => ({
    facets: Boolean(f.course || f.cuisine || f.diets.length || f.tags),
    effort: [f.pan_count, f.cleanup, f.spice_level, f.equipment].some(Boolean),
    notes: Boolean(f.notes || f.source_url || f.links),
  }));
  const dirty = useRef(false);
  const work = useWork();

  useEffect(() => {
    const unload = (event) => {
      if (dirty.current) event.preventDefault();
    };
    addEventListener("beforeunload", unload);
    const stop = guardLeaving(
      () =>
        !dirty.current ||
        confirm(
          "Leave without saving? Your changes to this recipe will be lost.",
        ),
    );
    return () => {
      stop();
      removeEventListener("beforeunload", unload);
    };
  }, []);

  if (mode !== "new" && !start.version)
    return (
      <Missing
        what={mode === "draft" ? "draft" : mode === "idea" ? "idea" : "recipe"}
      />
    );
  if (start.draft && start.draft.data.status !== "draft")
    return <Spent draft={start.draft} />;

  const words = WORDS[mode];
  const exit = exitOf(mode, id);
  const set = (key) => (event) => {
    dirty.current = true;
    const t = event.currentTarget;
    setF({ ...f, [key]: t.type === "checkbox" ? t.checked : t.value });
  };
  const toggleDiet = (key) => (event) => {
    dirty.current = true;
    setF({
      ...f,
      diets: event.currentTarget.checked
        ? [...f.diets, key]
        : f.diets.filter((d) => d !== key),
    });
  };
  const ingredients = editedIngredients(
    storedLines(f.ingredients, start.data.ingredients),
    start.data.ingredients,
  );
  const stepCount = editedSteps(f.steps).length;
  const known = taxonomy(records("recipe")).cuisines.map((c) => c.name);
  const cuisines = [
    ...known,
    ...suggestedCuisines.filter(
      (c) => !known.some((k) => k.toLowerCase() === c.toLowerCase()),
    ),
  ];

  function recipeOf() {
    const links = parseLinkLines(f.links);
    if (links.invalid.length)
      throw new Error(
        `Each link needs a web address such as https://example.com: ${links.invalid.join("; ")}`,
      );
    const source = f.source_url.trim()
      ? parseLinkLines(f.source_url).links[0]?.url
      : null;
    if (source === undefined)
      throw new Error(
        "The source needs a web address such as https://example.com.",
      );
    const base = start.data;
    return {
      ...base,
      title: f.title.trim(),
      servings: numberOrNull(f.servings),
      total_minutes: numberOrNull(f.total_minutes),
      active_minutes: numberOrNull(f.active_minutes),
      ingredients,
      steps: editedSteps(f.steps, base.steps),
      course: f.course || null,
      cuisine: f.cuisine.trim() || null,
      diets: f.diets,
      tags: parseLabels(f.tags),
      pan_count: numberOrNull(f.pan_count),
      cleanup: f.cleanup || null,
      spice_level: numberOrNull(f.spice_level),
      equipment: lines(f.equipment).map(
        (name) => base.equipment?.find((e) => e.name === name) ?? { name },
      ),
      notes: f.notes,
      source_url: source,
      links: links.links,
      ...(mode === "variation" ? { favorite: false } : {}),
    };
  }

  async function save(expected) {
    const recipe = recipeOf();
    const title = recipe.title;
    let result;
    // On a phone an edit can wait for the kitchen, and meets changes made
    // meanwhile part by part.
    if (mode === "edit" && phone) {
      result = await keep("edit", {
        id,
        base: { version: start.version, data: start.data },
        recipe,
      });
      dirty.current = false;
      if (result.choose) {
        toast("Someone changed this recipe meanwhile. Choose what to keep.");
        leave(`waiting/${encodeURIComponent(result.choose)}`);
        return;
      }
      toast(
        result.kept
          ? "Your changes are on this phone. They go to the kitchen when it answers."
          : "Changes saved.",
        {
          undo: result.action_id ? () => undoAction(result.action_id) : null,
        },
      );
      leave(`recipes/${encodeURIComponent(id)}`);
      return;
    }
    if (mode === "edit")
      result = await change(
        "recipe_save",
        { id, expected_version: expected, recipe },
        { done: "Changes saved." },
      );
    else if (mode === "draft")
      result = await change(
        "recipe_import_commit",
        { id, expected_version: expected, reviewed: true, recipe },
        { done: `${title} is in your cookbook.`, undo: false },
      );
    else if (mode === "variation")
      result = await change(
        "recipe_variant_save",
        {
          original_recipe_id: start.data.original_recipe_id ?? id,
          recipe,
          preferred: f.preferred,
        },
        { done: "Your version is saved.", undo: false },
      );
    else
      result = await change(
        "recipe_save",
        { recipe },
        { done: `${title} is in your cookbook.`, undo: false },
      );
    if (mode === "idea") await linkIdea(id, result.record.id);
    dirty.current = false;
    leave(`recipes/${encodeURIComponent(result.record.id)}`);
  }

  // Saving over someone else's change is the same save against the version
  // they saved.
  const attempt = (over) =>
    work.run(async () => {
      setStale(false);
      try {
        let expected = start.version;
        if (over) {
          await refresh();
          expected = record("recipe", id)?.version;
          if (!expected)
            throw new Error("This recipe is no longer in your cookbook.");
        }
        await save(expected);
      } catch (error) {
        if (error.code === "STALE_VERSION" && mode === "edit") {
          setStale(true);
          throw new Error(
            "Someone else saved this recipe while you were editing it.",
            { cause: error },
          );
        }
        throw error;
      }
    });
  const submit = (event) => {
    event.preventDefault();
    void attempt(false);
  };

  const remove = () =>
    work.run(async () => {
      const now = record("recipe", id) ?? start;
      await change(
        "record_archive",
        {
          kind: "recipe",
          id,
          expected_version: now.version,
          archived: true,
        },
        { done: `${start.data.title} is out of your cookbook.` },
      );
      dirty.current = false;
      leave("recipes");
    });

  const cancel = (event) => {
    event.preventDefault();
    if (
      dirty.current &&
      !confirm(
        "Leave without saving? Your changes to this recipe will be lost.",
      )
    )
      return;
    dirty.current = false;
    leave(exit);
  };

  // An earlier edit of this recipe that met a change in the kitchen: saving
  // here starts again from the kitchen's version and replaces it.
  const clashing =
    mode === "edit" &&
    phone &&
    waitingHere.value.find(
      (e) => e.kind === "edit" && e.input.id === id && needsChoice(e),
    );

  return (
    <div class="stack-lg">
      <a class="back" href={`#/${exit}`} onClick={cancel}>
        <Icon icon={ArrowLeft} />
        {mode === "edit" || mode === "variation"
          ? start.data.title
          : mode === "draft"
            ? "Add to your cookbook"
            : "Recipes"}
      </a>
      <PageHeader
        eyebrow={mode === "edit" ? start.data.title : undefined}
        title={words.title}
      />
      {clashing && (
        <p class="notice" role="status">
          <span>
            Your earlier edit met a change made in the kitchen.{" "}
            <a href={`#/waiting/${encodeURIComponent(clashing.id)}`}>
              Choose what to keep
            </a>{" "}
            first, or save here to replace it with an edit of the kitchen’s
            version.
          </span>
        </p>
      )}
      {mode === "draft" && (
        <p class="lede">
          Check the name, amounts and method against your original before you
          save. Anything Kooks could not tell stays blank.
        </p>
      )}
      {mode === "variation" && (
        <p class="lede">
          The original stays as it is. Change what you do differently: an
          ingredient, an amount, a step.
        </p>
      )}
      <div class={mode === "draft" ? "editor editor-review" : "editor"}>
        <form class="stack-lg editor-form" onSubmit={submit}>
          <section class="card" aria-labelledby="basics">
            <h2 id="basics">The basics</h2>
            <Field id="recipe-title" label="Name">
              <input
                id="recipe-title"
                class="input"
                required
                maxLength={500}
                value={f.title}
                onInput={set("title")}
              />
            </Field>
            <div class="fields-3">
              <Field id="recipe-servings" label="Serves">
                <input
                  id="recipe-servings"
                  class="input"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="10000"
                  step="any"
                  value={f.servings}
                  onInput={set("servings")}
                />
              </Field>
              <Field id="recipe-total" label="Total time, minutes">
                <input
                  id="recipe-total"
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="10080"
                  step="1"
                  value={f.total_minutes}
                  onInput={set("total_minutes")}
                />
              </Field>
              <Field id="recipe-active" label="Hands-on, minutes">
                <input
                  id="recipe-active"
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="10080"
                  step="1"
                  value={f.active_minutes}
                  onInput={set("active_minutes")}
                />
              </Field>
            </div>
            <p class="hint">Leave anything you don’t know blank.</p>
          </section>

          <section class="card" aria-labelledby="ingredients-head">
            <h2 id="ingredients-head">Ingredients</h2>
            <Field
              id="recipe-ingredients"
              label="One per line"
              labelledBy="ingredients-head"
              help="The amount, the unit, the ingredient, then how it’s prepared after a comma: 2 cloves garlic, crushed."
            >
              <textarea
                id="recipe-ingredients"
                class="input"
                rows={8}
                aria-describedby={hint("recipe-ingredients")}
                value={f.ingredients}
                onInput={set("ingredients")}
              />
            </Field>
            <Reading items={ingredients} />
          </section>

          <section class="card" aria-labelledby="method-head">
            <h2 id="method-head">Method</h2>
            <Field
              id="recipe-steps"
              label="A blank line between steps"
              labelledBy="method-head"
              help={
                stepCount
                  ? `${plural(stepCount, "step")} so far.`
                  : "Each step can be as long as it needs to be."
              }
            >
              <textarea
                id="recipe-steps"
                class="input"
                rows={10}
                aria-describedby={hint("recipe-steps")}
                value={f.steps}
                onInput={set("steps")}
              />
            </Field>
          </section>

          <details class="card disclosure" open={open.facets}>
            <summary>
              <h2>Course, cuisine and diet</h2>
            </summary>
            <div class="fields-2">
              <Field id="recipe-course" label="Course">
                <select
                  id="recipe-course"
                  class="input"
                  value={f.course}
                  onChange={set("course")}
                >
                  <option value="">Not set</option>
                  {courses.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="recipe-cuisine" label="Cuisine">
                <input
                  id="recipe-cuisine"
                  class="input"
                  list="cuisines"
                  maxLength={100}
                  value={f.cuisine}
                  onInput={set("cuisine")}
                />
                <datalist id="cuisines">
                  {cuisines.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
            </div>
            <fieldset class="field">
              <legend>Diet</legend>
              <div class="checks">
                {diets.map((d) => (
                  <label key={d.key} class="check-chip">
                    <input
                      type="checkbox"
                      checked={f.diets.includes(d.key)}
                      onChange={toggleDiet(d.key)}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
              <p class="hint">
                What you know about this recipe, not an allergen check.
              </p>
            </fieldset>
            <Field
              id="recipe-tags"
              label="Tags"
              help="Separated by commas: weeknight, Shabbat, kids love it."
            >
              <input
                id="recipe-tags"
                class="input"
                aria-describedby={hint("recipe-tags")}
                value={f.tags}
                onInput={set("tags")}
              />
            </Field>
          </details>

          <details class="card disclosure" open={open.effort}>
            <summary>
              <h2>Effort</h2>
            </summary>
            <div class="fields-3">
              <Field id="recipe-pans" label="Pans and pots">
                <input
                  id="recipe-pans"
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  value={f.pan_count}
                  onInput={set("pan_count")}
                />
              </Field>
              <Field id="recipe-cleanup" label="Washing up">
                <select
                  id="recipe-cleanup"
                  class="input"
                  value={f.cleanup}
                  onChange={set("cleanup")}
                >
                  <option value="">Not set</option>
                  {CLEANUP.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="recipe-spice" label="Heat">
                <select
                  id="recipe-spice"
                  class="input"
                  value={f.spice_level}
                  onChange={set("spice_level")}
                >
                  <option value="">Not set</option>
                  {SPICE.map((label, level) => (
                    <option key={level} value={String(level)}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              id="recipe-equipment"
              label="Equipment, one per line"
              help="Only what the recipe needs beyond the usual: a wide pan, a stand mixer."
            >
              <textarea
                id="recipe-equipment"
                class="input"
                rows={3}
                aria-describedby={hint("recipe-equipment")}
                value={f.equipment}
                onInput={set("equipment")}
              />
            </Field>
          </details>

          <details class="card disclosure" open={open.notes}>
            <summary>
              <h2>Notes and links</h2>
            </summary>
            <Field id="recipe-notes" label="Notes">
              <textarea
                id="recipe-notes"
                class="input"
                rows={4}
                value={f.notes}
                onInput={set("notes")}
              />
            </Field>
            {mode !== "variation" && (
              <Field
                id="recipe-source"
                label="Where it’s from"
                help="The web address of the original. A video plays on the recipe page."
              >
                <input
                  id="recipe-source"
                  class="input"
                  inputMode="url"
                  autoComplete="url"
                  aria-describedby={hint("recipe-source")}
                  value={f.source_url}
                  onInput={set("source_url")}
                />
              </Field>
            )}
            <Field
              id="recipe-links"
              label="Links and videos, one per line"
              help="A web address, then a title if you like: youtu.be/abc Folding the dough."
            >
              <textarea
                id="recipe-links"
                class="input"
                rows={3}
                aria-describedby={hint("recipe-links")}
                value={f.links}
                onInput={set("links")}
              />
            </Field>
          </details>

          {mode === "variation" && (
            <label class="check-row">
              <input
                type="checkbox"
                checked={f.preferred}
                onChange={set("preferred")}
              />
              Make this my usual way of making it
            </label>
          )}
          {mode === "draft" && (
            <label class="check-row">
              <input
                type="checkbox"
                required
                checked={f.reviewed}
                onChange={set("reviewed")}
              />
              I checked the amounts and method against my original
            </label>
          )}

          <FormError>{work.error}</FormError>
          {stale && (
            <div class="row">
              <button
                type="button"
                class="btn"
                disabled={work.busy}
                onClick={() => attempt(true)}
              >
                Save mine over theirs
              </button>
            </div>
          )}
          <div class="form-footer">
            <button type="submit" class="btn btn-primary" disabled={work.busy}>
              <Icon icon={Check} />
              {work.busy ? "Saving…" : words.save}
            </button>
            <a class="btn btn-quiet" href={`#/${exit}`} onClick={cancel}>
              Cancel
            </a>
            {mode === "edit" && (
              <button
                type="button"
                class="btn btn-quiet btn-danger form-footer-end"
                disabled={work.busy}
                onClick={remove}
              >
                <Icon icon={Trash2} />
                Remove from cookbook
              </button>
            )}
          </div>
        </form>
        {start.draft && <Original draft={start.draft} />}
      </div>
    </div>
  );
}
