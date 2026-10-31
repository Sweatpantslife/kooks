import { useState } from "preact/hooks";
import {
  ArrowLeft,
  CalendarPlus,
  Clock,
  CopyPlus,
  Flame,
  Heart,
  Minus,
  NotebookPen,
  Pencil,
  Plus,
  ShoppingBasket,
  Timer,
  UtensilsCrossed,
} from "lucide";
import { courseLabel, dietLabel } from "../../../shared/taxonomy.js";
import { record, records, waitingHere } from "../lib/store.js";
import { needsChoice } from "../lib/waiting.js";
import { pastDayLabel, plural } from "../lib/format.js";
import { nameKey } from "../lib/aisles.js";
import { tastes } from "../lib/people.js";
import {
  measure,
  atHome,
  family,
  hrefOf,
  memories,
  minutes,
  toggleFavorite,
} from "../lib/kitchen.js";
import { Art } from "../ui/tile.jsx";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";
import { Waiting } from "../ui/waiting.jsx";
import { CookButton } from "../ui/cook-button.jsx";
import { MoreList, linkItems } from "../ui/more.jsx";

const back = (
  <a class="back" href="#/recipes">
    <Icon icon={ArrowLeft} />
    Recipes
  </a>
);

export function Missing({ what }) {
  return (
    <>
      {back}
      <PageHeader title="Not found" />
      <Empty
        icon={UtensilsCrossed}
        title={`That ${what} isn’t in the kitchen`}
        action={
          <a class="btn btn-primary" href="#/recipes">
            Back to recipes
          </a>
        }
      >
        It may have been archived, or the link is from another kitchen.
      </Empty>
    </>
  );
}

function Facts({ d }) {
  const facts = [
    d.total_minutes != null && {
      icon: Clock,
      text:
        d.active_minutes != null && d.active_minutes !== d.total_minutes
          ? `${minutes(d.total_minutes)}, ${minutes(d.active_minutes)} hands-on`
          : minutes(d.total_minutes),
    },
    d.total_minutes == null &&
      d.active_minutes != null && {
        icon: Clock,
        text: `${minutes(d.active_minutes)} hands-on`,
      },
    d.pan_count != null && {
      icon: UtensilsCrossed,
      text: plural(d.pan_count, "pan"),
    },
    d.spice_level != null &&
      d.spice_level > 0 && {
        icon: Flame,
        text: ["", "Mild", "Medium", "Hot"][d.spice_level],
      },
  ].filter(Boolean);
  const labels = [
    courseLabel(d.course),
    d.cuisine,
    ...d.diets.map(dietLabel),
    ...d.tags,
  ].filter(Boolean);
  return (
    <div class="stack-sm">
      {facts.length > 0 && (
        <ul class="facts" role="list">
          {facts.map((f) => (
            <li key={f.text}>
              <Icon icon={f.icon} class="icon-sm" />
              {f.text}
            </li>
          ))}
        </ul>
      )}
      {labels.length > 0 && (
        <ul class="labels" role="list">
          {labels.map((label) => (
            <li key={label} class="label">
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Who at the table will like it, or won't.
function Tastes({ d }) {
  const found = tastes(d);
  if (!found.length) return null;
  return (
    <ul class="tastes" role="list" aria-label="At the table">
      {found.map((t) => (
        <li key={t.text} class={`badge badge-${t.liked ? "herb" : "saffron"}`}>
          {t.text}
        </li>
      ))}
    </ul>
  );
}

export function LastTime({ notes }) {
  const last = notes[0];
  if (!last) return null;
  const n = last.data;
  const day = n.cooked_on ?? last.created_at?.slice(0, 10);
  return (
    <aside class="last-time" aria-label="Last time">
      <p class="eyebrow">
        Last time{day && `, ${pastDayLabel(day)}`}
        {n.rating ? ` · ${n.rating} of 5` : ""}
        {notes.length > 1 && ` · cooked ${notes.length} times`}
      </p>
      <p>{n.next_time || n.changes || n.text}</p>
    </aside>
  );
}

// Every time this recipe, or another version of it, was cooked, newest
// first, with what was noted then. The note a quiet finish leaves says only
// that it was cooked.
function CookedBefore({ r, notes }) {
  const item = (note) => {
    const n = note.data;
    const day = n.cooked_on ?? note.created_at?.slice(0, 10);
    const version = n.recipe_id !== r.id && record("recipe", n.recipe_id);
    const about = [
      day && pastDayLabel(day),
      version && `As ${version.data.title}`,
      n.rating && `${n.rating} of 5`,
      n.cook_again === true && "Cook again",
      n.cook_again === false && "Try something else",
    ].filter(Boolean);
    return (
      <li key={note.id} class="cooked">
        <p class="eyebrow">{about.join(" · ")}</p>
        {note.waiting && <Waiting />}
        {n.text !== "Cooked." && <p class="preline">{n.text}</p>}
        {n.changes && (
          <p class="preline">
            <strong>Changed:</strong> {n.changes}
          </p>
        )}
        {n.next_time && (
          <p class="preline">
            <strong>Next time:</strong> {n.next_time}
          </p>
        )}
      </li>
    );
  };
  const recent = notes.slice(0, 3);
  const earlier = notes.slice(3);
  return (
    <section class="stack" aria-labelledby="cooked-before">
      <div class="section-head">
        <h2 id="cooked-before">Cooked before</h2>
        <a
          class="btn btn-small"
          href={`#/recipes/${encodeURIComponent(r.id)}/note`}
        >
          <Icon icon={NotebookPen} />
          Add a note
        </a>
      </div>
      {notes.length ? (
        <ol class="cooked-list" role="list">
          {recent.map(item)}
        </ol>
      ) : (
        <p class="muted">
          No notes yet. What you note when you finish cooking shows up here.
        </p>
      )}
      {earlier.length > 0 && (
        <details class="disclosure">
          <summary>{plural(earlier.length, "earlier time")}</summary>
          <ol class="cooked-list" role="list">
            {earlier.map(item)}
          </ol>
        </details>
      )}
    </section>
  );
}

function Ingredients({ d }) {
  const [servings, setServings] = useState(d.servings);
  const factor = d.servings ? servings / d.servings : 1;
  const home = atHome();
  const step = d.servings && d.servings < 2 ? 0.5 : 1;
  return (
    <section class="card recipe-ingredients" aria-labelledby="ingredients">
      <div class="section-head">
        <h2 id="ingredients">Ingredients</h2>
        {d.servings ? (
          <div class="stepper" role="group" aria-label="Servings">
            <button
              type="button"
              class="btn btn-icon"
              aria-label="Fewer servings"
              disabled={servings <= step}
              onClick={() => setServings(Math.max(step, servings - step))}
            >
              <Icon icon={Minus} />
            </button>
            <output aria-live="polite">Serves {servings}</output>
            <button
              type="button"
              class="btn btn-icon"
              aria-label="More servings"
              onClick={() => setServings(servings + step)}
            >
              <Icon icon={Plus} />
            </button>
          </div>
        ) : (
          <p class="muted small">
            Yield not set, so amounts can’t change with servings.
          </p>
        )}
      </div>
      {d.ingredients.length ? (
        <ul class="ingredients" role="list">
          {d.ingredients.map((i, index) => (
            <li key={index}>
              <span class="ingredient-amount">{measure(i, factor)}</span>
              <span>
                {i.name}
                {i.preparation && <span class="muted">, {i.preparation}</span>}
                {home.has(nameKey(i.name)) && (
                  <span class="badge badge-herb">At home</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No ingredients written down yet.</p>
      )}
      {d.equipment.length > 0 && (
        <p class="muted small">
          Equipment: {d.equipment.map((e) => e.name).join(", ")}
        </p>
      )}
    </section>
  );
}

function Method({ d }) {
  return (
    <section class="card" aria-labelledby="method">
      <h2 id="method">Method</h2>
      {d.steps.length ? (
        <ol class="steps">
          {d.steps.map((s, index) => (
            <li key={index}>
              <p>{s.text}</p>
              {s.duration_seconds && (
                <span class="badge badge-sky">
                  <Icon icon={Timer} class="icon-sm" />
                  {minutes(Math.max(1, Math.round(s.duration_seconds / 60)))}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p class="muted">No steps written down yet.</p>
      )}
      {d.notes && (
        <div class="note">
          <p class="eyebrow">Notes</p>
          <p class="preline">{d.notes}</p>
        </div>
      )}
    </section>
  );
}

function More({ r }) {
  const d = r.data;
  const relatives = family(r).filter((x) => x.id !== r.id);
  const meals = records("meal").filter((m) =>
    m.data.dishes.some((dish) => dish.recipe_id === r.id),
  );
  const items = [
    ...relatives.map((x) => ({
      href: `#/recipes/${encodeURIComponent(x.id)}`,
      title: x.data.title,
      note:
        x.id === d.original_recipe_id
          ? "The original"
          : x.data.preferred
            ? "Your usual way of making it"
            : "A variation",
    })),
    ...meals.map((m) => ({
      href: `#/recipes/meal/${encodeURIComponent(m.id)}`,
      title: m.data.title,
      note: "A meal it’s part of",
    })),
    ...records("technique")
      .filter((t) => t.data.recipe_ids?.includes(r.id))
      .map((t) => ({
        href: hrefOf("technique", t.id),
        title: t.data.title,
        note: "Technique",
      })),
    ...records("book")
      .filter((b) => b.data.recipe_ids?.includes(r.id))
      .map((b) => ({
        href: hrefOf("book", b.id),
        title: b.data.title,
        note: "The book it’s from",
      })),
    ...records("inspiration")
      .filter((i) => i.data.recipe_id === r.id)
      .map((i) => ({
        href: hrefOf("inspiration", i.id),
        title: i.data.title,
        note: "The idea it grew from",
      })),
    ...linkItems(d),
  ];
  return <MoreList id="more" title="More about this recipe" items={items} />;
}

// An edit of this recipe made on this phone that the kitchen has not taken
// yet: waiting to send, or waiting for the member to choose.
function EditWaiting({ r }) {
  const entry = waitingHere.value.find(
    (e) => e.kind === "edit" && e.input.id === r.id,
  );
  if (!entry) return null;
  if (entry.problem && !needsChoice(entry))
    return (
      <p class="notice" role="status">
        <span>
          The kitchen didn’t take your edit: {entry.problem.message}{" "}
          <a href="#/waiting">See what waits</a>
        </span>
      </p>
    );
  if (entry.problem)
    return (
      <p class="notice" role="status">
        <span>
          Your edit met a change made in the kitchen.{" "}
          <a href={`#/waiting/${encodeURIComponent(entry.id)}`}>
            Choose what to keep
          </a>
        </span>
      </p>
    );
  return (
    <p class="notice">
      <Waiting />
      <span>
        Your changes are on this phone. They go to the kitchen when it answers.
      </span>
    </p>
  );
}

export function Recipe({ id }) {
  const r = record("recipe", id);
  if (!r) return <Missing what="recipe" />;
  const d = r.data;
  const notes = memories(r);
  return (
    <article class="recipe">
      {back}
      <Art kind="recipe" data={d} class="art-hero" />
      <PageHeader title={d.title}>
        <button
          type="button"
          class="btn btn-icon favorite"
          aria-pressed={d.favorite ? "true" : "false"}
          aria-label="Favorite"
          onClick={() => toggleFavorite(r)}
        >
          <Icon icon={Heart} />
        </button>
        <a class="btn" href={`#/recipes/${encodeURIComponent(id)}/edit`}>
          <Icon icon={Pencil} />
          Edit
        </a>
        <a
          class="btn"
          href={`#/groceries/add/recipe/${encodeURIComponent(id)}`}
        >
          <Icon icon={ShoppingBasket} />
          Add to groceries
        </a>
        <a class="btn" href={`#/week/when/recipe/${encodeURIComponent(id)}`}>
          <Icon icon={CalendarPlus} />
          Add to the week
        </a>
        <CookButton source={{ kind: "recipe", id }} primary />
      </PageHeader>
      <EditWaiting r={r} />
      <Facts d={d} />
      <Tastes d={d} />
      <LastTime notes={notes} />
      <div class="recipe-columns">
        <Ingredients key={`${r.id}-${d.servings}`} d={d} />
        <Method d={d} />
      </div>
      <CookedBefore r={r} notes={notes} />
      <More r={r} />
      <div class="row">
        <a
          class="btn btn-quiet"
          href={`#/recipes/${encodeURIComponent(id)}/variation`}
        >
          <Icon icon={CopyPlus} />
          Make your own version
        </a>
      </div>
    </article>
  );
}
