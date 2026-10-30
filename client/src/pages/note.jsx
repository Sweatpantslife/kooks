import { useState } from "preact/hooks";
import { ArrowLeft, NotebookPen } from "lucide";
import { change, record } from "../lib/store.js";
import { leave } from "../lib/router.js";
import { localDay } from "../lib/format.js";
import { PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";
import { Field, FormError, hint, useDirty, useWork } from "../ui/form.jsx";
import { Missing } from "./recipe.jsx";

// A note about cooking a recipe without the stove: how it went, what was
// changed and what to remember. It shows on the recipe with the rest.
export function NoteForm({ id }) {
  const r = record("recipe", id);
  const today = localDay();
  const [n, setN] = useState({
    cooked_on: today,
    rating: null,
    text: "",
    changes: "",
    next_time: "",
  });
  const dirty = useDirty();
  const work = useWork();
  if (!r) return <Missing what="recipe" />;
  const set = (field, value) => {
    dirty.current = true;
    setN({ ...n, [field]: value });
  };
  const text = (field) => (event) => set(field, event.currentTarget.value);
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      await change(
        "note_save",
        {
          recipe_id: id,
          cooked_on: n.cooked_on || today,
          text: n.text.trim() || "Cooked.",
          ...(n.rating ? { rating: n.rating } : {}),
          ...(n.changes.trim() ? { changes: n.changes.trim() } : {}),
          ...(n.next_time.trim() ? { next_time: n.next_time.trim() } : {}),
        },
        { done: "Your note is with the recipe." },
      );
      dirty.current = false;
      leave(`recipes/${encodeURIComponent(id)}`);
    });
  };
  return (
    <div class="stack-lg page-narrow">
      <a class="back" href={`#/recipes/${encodeURIComponent(id)}`}>
        <Icon icon={ArrowLeft} />
        {r.data.title}
      </a>
      <PageHeader eyebrow={r.data.title} title="Add a note" />
      <form class="card" onSubmit={submit}>
        <Field id="note-day" label="Cooked on">
          <input
            id="note-day"
            class="input"
            type="date"
            required
            max={today}
            value={n.cooked_on}
            onInput={text("cooked_on")}
          />
        </Field>
        <fieldset class="field">
          <legend>How was it?</legend>
          <div class="segmented rating">
            {[1, 2, 3, 4, 5].map((rating) => (
              <label key={rating}>
                <input
                  type="radio"
                  name="note-rating"
                  checked={n.rating === rating}
                  onChange={() => set("rating", rating)}
                />
                {rating}
                <span class="sr-only"> of 5</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="note-text" label="Notes">
          <textarea
            id="note-text"
            class="input"
            rows={3}
            maxLength={30000}
            placeholder="A keeper. Everyone went back for seconds."
            value={n.text}
            onInput={text("text")}
          />
        </Field>
        <Field id="note-changes" label="What you changed">
          <textarea
            id="note-changes"
            class="input"
            rows={2}
            maxLength={10000}
            value={n.changes}
            onInput={text("changes")}
          />
        </Field>
        <Field
          id="note-next"
          label="Next time"
          help="A change to try, or something to remember."
        >
          <textarea
            id="note-next"
            class="input"
            rows={2}
            maxLength={10000}
            aria-describedby={hint("note-next")}
            value={n.next_time}
            onInput={text("next_time")}
          />
        </Field>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={NotebookPen} />
            {work.busy ? "Saving…" : "Save note"}
          </button>
        </div>
      </form>
    </div>
  );
}
