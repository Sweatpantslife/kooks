import { useState } from "preact/hooks";
import { ArrowLeft, Check, CloudCheck } from "lucide";
import { courseLabel, dietLabel } from "../../../shared/taxonomy.js";
import {
  change,
  kitchenRecord,
  offline,
  sendNow,
  waitingHere,
} from "../lib/store.js";
import { discard, reviseEntry } from "../lib/outbox.js";
import { needsChoice } from "../lib/waiting.js";
import { mergeParts, partName, partOrder, partsPhrase } from "../lib/merge.js";
import { amount } from "../lib/kitchen.js";
import { leave } from "../lib/router.js";
import { toast } from "../lib/toast.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { FormError, useWork } from "../ui/form.jsx";
import { Icon } from "../ui/icon.jsx";

const SPICE = ["Not spicy", "Mild", "Medium", "Hot"];
const CLEANUP = { low: "Light", medium: "Some", high: "A lot" };
const none = (value) =>
  value == null || value === "" || (Array.isArray(value) && !value.length);

// One part of a recipe as the cook reads it, not as it is stored.
function Shown({ part, value }) {
  if (none(value)) return <p class="muted">Nothing</p>;
  if (part === "ingredients")
    return (
      <ul class="compare-lines">
        {value.map((i, n) => (
          <li key={n}>
            {[amount(i), i.name].filter(Boolean).join(" ")}
            {i.preparation && `, ${i.preparation}`}
          </li>
        ))}
      </ul>
    );
  if (part === "steps")
    return (
      <ol class="compare-lines">
        {value.map((step, n) => (
          <li key={n}>{step.text}</li>
        ))}
      </ol>
    );
  if (Array.isArray(value))
    return (
      <p>
        {value
          .map((v) =>
            part === "diets"
              ? (dietLabel(v) ?? v)
              : typeof v === "object"
                ? (v.name ?? v.title ?? v.url ?? JSON.stringify(v))
                : String(v),
          )
          .join(", ")}
      </p>
    );
  if (typeof value === "boolean") return <p>{value ? "Yes" : "No"}</p>;
  if (part === "course") return <p>{courseLabel(value) ?? value}</p>;
  if (part === "spice_level") return <p>{SPICE[value] ?? value}</p>;
  if (part === "cleanup") return <p>{CLEANUP[value] ?? value}</p>;
  if (part === "total_minutes" || part === "active_minutes")
    return <p>{value} min</p>;
  return (
    <p class="preline">
      {typeof value === "object" ? JSON.stringify(value) : String(value)}
    </p>
  );
}

const named = (parts) => parts.map(partName).join(", ");

// An edit made on this phone that met a change made in the kitchen
// meanwhile. Parts only one side changed are kept from that side; for each
// part both changed, the member sees both and chooses. Nothing is sent
// until they do, and nothing is overwritten without their choice.
export function Compare({ id }) {
  const entry = waitingHere.value.find((e) => e.id === id);
  const [choice, setChoice] = useState({});
  const work = useWork();
  if (!entry || entry.kind !== "edit" || !needsChoice(entry))
    return (
      <>
        <PageHeader title="Nothing to choose" />
        <Empty
          icon={CloudCheck}
          title="This change is settled"
          action={
            <a class="btn btn-primary" href="#/waiting">
              See what waits
            </a>
          }
        >
          It went to the kitchen, or it was discarded.
        </Empty>
      </>
    );
  const { id: recipeId, base, recipe: mine } = entry.input;
  const now = kitchenRecord("recipe", recipeId);
  const back = (
    <a class="back" href="#/waiting">
      <Icon icon={ArrowLeft} />
      Waiting to send
    </a>
  );
  const drop = () => {
    const undo = discard(entry.id);
    toast(`Your edit of ${mine.title} is discarded.`, { undo });
    leave("waiting");
  };

  if (!now) {
    const asNew = () =>
      work.run(async () => {
        const { record: made } = await change(
          "recipe_save",
          { recipe: { ...mine, original_recipe_id: null, preferred: false } },
          {
            done: `${mine.title} is in your cookbook as a new recipe.`,
            undo: false,
          },
        );
        discard(entry.id);
        leave(`recipes/${encodeURIComponent(made.id)}`);
      });
    return (
      <div class="stack-lg page-narrow">
        {back}
        <PageHeader eyebrow="Your edit" title={mine.title} />
        <p class="lede">
          {mine.title} was taken out of the cookbook while your edit waited, so
          there is nothing to save it to.
        </p>
        <FormError>{work.error}</FormError>
        <div class="row">
          {offline.value === null && (
            <button
              type="button"
              class="btn btn-primary"
              disabled={work.busy}
              onClick={asNew}
            >
              Save yours as a new recipe
            </button>
          )}
          <button type="button" class="btn" onClick={drop}>
            Discard your edit
          </button>
        </div>
      </div>
    );
  }

  const parts = mergeParts(base.data, mine, now.data);
  const clashes = parts.clashes.sort(partOrder);
  const save = (event) => {
    event.preventDefault();
    void work.run(async () => {
      if (clashes.some((part) => !choice[part]))
        throw new Error("Choose yours or the kitchen’s for each part.");
      const recipe = { ...parts.merged };
      for (const part of clashes) {
        const value = choice[part] === "mine" ? mine[part] : now.data[part];
        if (value === undefined) delete recipe[part];
        else recipe[part] = value;
      }
      // Now an edit of the kitchen's version: sent against it, and met
      // again with anything changed after it.
      reviseEntry(entry.id, ({ problem: _, ...rest }) => ({
        ...rest,
        input: {
          id: recipeId,
          base: { version: now.version, data: now.data },
          recipe,
        },
      }));
      toast(
        offline.value === null
          ? `${recipe.title} is saved with your choices.`
          : `Your choices are kept. ${recipe.title} goes to the kitchen when it answers.`,
      );
      leave(`recipes/${encodeURIComponent(recipeId)}`);
      void sendNow();
    });
  };

  return (
    <div class="stack-lg">
      {back}
      <PageHeader eyebrow={mine.title} title="Choose what to keep" />
      <p class="lede">
        {clashes.length
          ? `Someone changed ${partsPhrase(clashes)} in the kitchen while your edit waited on this phone. Choose which to keep.`
          : "Nothing clashes any more: someone has changed the recipe again."}
      </p>
      {(parts.mine.length > 0 || parts.theirs.length > 0) && (
        <ul class="compare-kept">
          {parts.mine.length > 0 && (
            <li>
              <Icon icon={Check} />
              <span>
                Your changes to{" "}
                {named(parts.mine.sort(partOrder)).toLowerCase()} are kept.
              </span>
            </li>
          )}
          {parts.theirs.length > 0 && (
            <li>
              <Icon icon={Check} />
              <span>
                The kitchen’s changes to{" "}
                {named(parts.theirs.sort(partOrder)).toLowerCase()} are kept.
              </span>
            </li>
          )}
        </ul>
      )}
      <form class="stack-lg" onSubmit={save}>
        {clashes.map((part) => (
          <fieldset key={part} class="card compare-part">
            <legend>{partName(part)}</legend>
            <div class="compare-options">
              {[
                ["mine", "Yours", mine[part]],
                ["theirs", "In the kitchen now", now.data[part]],
              ].map(([side, label, value]) => {
                const inputId = `compare-${part}-${side}`;
                return (
                  <div key={side} class="compare-option">
                    <div class="compare-pick">
                      <input
                        type="radio"
                        id={inputId}
                        name={`compare-${part}`}
                        checked={choice[part] === side}
                        aria-describedby={`${inputId}-value`}
                        onChange={() => setChoice({ ...choice, [part]: side })}
                      />
                      <label for={inputId}>{label}</label>
                    </div>
                    <div id={`${inputId}-value`} class="compare-value">
                      <Shown part={part} value={value} />
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            {clashes.length ? "Save with these choices" : "Save"}
          </button>
          <button type="button" class="btn" onClick={drop}>
            Discard your edit
          </button>
        </div>
      </form>
    </div>
  );
}
