import { useState } from "preact/hooks";
import { normalize } from "../../../shared/quantities.js";
import { records } from "../lib/store.js";

// Recipes chosen from the cookbook: the chosen ones stay ticked, and a search
// finds the others. Recipes chosen before they were archived stay chosen.
export function RecipePicker({ id, legend, chosen, onChange }) {
  const [query, setQuery] = useState("");
  const all = records("recipe")
    .slice()
    .sort((a, b) => a.data.title.localeCompare(b.data.title));
  const words = normalize(query).split(" ").filter(Boolean);
  const picked = all.filter((r) => chosen.includes(r.id));
  const found = words.length
    ? all
        .filter(
          (r) =>
            !chosen.includes(r.id) &&
            words.every((w) => normalize(r.data.title).includes(w)),
        )
        .slice(0, 8)
    : [];
  const toggle = (recipeId) =>
    onChange(
      chosen.includes(recipeId)
        ? chosen.filter((x) => x !== recipeId)
        : [...chosen, recipeId],
    );
  return (
    <fieldset class="field">
      <legend>{legend}</legend>
      <input
        id={id}
        class="input"
        type="search"
        autoComplete="off"
        placeholder="Find a recipe"
        aria-label={`Find a recipe: ${legend}`}
        value={query}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      {picked.length + found.length > 0 ? (
        <div class="checks">
          {[...picked, ...found].map((r) => (
            <label key={r.id} class="check-chip">
              <input
                type="checkbox"
                checked={chosen.includes(r.id)}
                onChange={() => toggle(r.id)}
              />
              {r.data.title}
            </label>
          ))}
        </div>
      ) : (
        words.length > 0 && <p class="hint">No recipe is called that.</p>
      )}
    </fieldset>
  );
}
