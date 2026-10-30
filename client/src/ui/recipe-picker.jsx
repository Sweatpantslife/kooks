import { useState } from "preact/hooks";
import { normalize } from "../../../shared/quantities.js";
import { records } from "../lib/store.js";

// Recipes chosen from the cookbook: the chosen ones stay ticked, and a search
// finds the others. Recipes chosen before they were archived stay chosen. A
// recipe ticked while the form is open stays in place when it is unticked,
// so the focus stays on it and it can be ticked again.
export function RecipePicker({ id, legend, chosen, onChange }) {
  const [query, setQuery] = useState("");
  const [seen, setSeen] = useState(chosen);
  const all = records("recipe")
    .slice()
    .sort((a, b) => a.data.title.localeCompare(b.data.title));
  const words = normalize(query).split(" ").filter(Boolean);
  const listed = (r) => chosen.includes(r.id) || seen.includes(r.id);
  const picked = all.filter(listed);
  const found = words.length
    ? all
        .filter(
          (r) =>
            !listed(r) &&
            words.every((w) => normalize(r.data.title).includes(w)),
        )
        .slice(0, 8)
    : [];
  const toggle = (recipeId) => {
    if (!seen.includes(recipeId)) setSeen([...seen, recipeId]);
    onChange(
      chosen.includes(recipeId)
        ? chosen.filter((x) => x !== recipeId)
        : [...chosen, recipeId],
    );
  };
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
