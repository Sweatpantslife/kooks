import { useState } from "preact/hooks";
import {
  ArrowLeft,
  CalendarPlus,
  Clock,
  CopyPlus,
  ExternalLink,
  Flame,
  Heart,
  Minus,
  Pencil,
  Plus,
  ShoppingBasket,
  Timer,
  UtensilsCrossed,
} from "lucide";
import { courseLabel, dietLabel } from "../../../shared/taxonomy.js";
import { displayLinks, describeLink } from "../../../shared/links.js";
import { record, records } from "../lib/store.js";
import { dateLabel, plural } from "../lib/format.js";
import { nameKey } from "../lib/aisles.js";
import {
  amount,
  atHome,
  family,
  memories,
  minutes,
  toggleFavorite,
} from "../lib/kitchen.js";
import { Art } from "../ui/tile.jsx";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";

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

function LastTime({ notes }) {
  const last = notes[0];
  if (!last) return null;
  const n = last.data;
  const day = n.cooked_on ?? last.created_at?.slice(0, 10);
  return (
    <aside class="last-time" aria-label="Last time">
      <p class="eyebrow">
        Last time{day && `, ${dateLabel(day)}`}
        {n.rating ? ` · ${n.rating} of 5` : ""}
        {notes.length > 1 && ` · cooked ${notes.length} times`}
      </p>
      <p>{n.next_time || n.changes || n.text}</p>
    </aside>
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
          <p class="muted small">Yield not set, so amounts are as written.</p>
        )}
      </div>
      {d.ingredients.length ? (
        <ul class="ingredients" role="list">
          {d.ingredients.map((i, index) => (
            <li key={index}>
              <span class="ingredient-amount">{amount(i, factor)}</span>
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
  const techniques = records("technique").filter((t) =>
    t.data.recipe_ids?.includes(r.id),
  );
  const links = displayLinks(d);
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
    ...techniques.map((t) => ({
      href: `../#/techniques/${encodeURIComponent(t.id)}`,
      title: t.data.title,
      note: "Technique",
    })),
    ...links.map((link) => {
      const info = describeLink(link.url);
      return {
        href: link.url,
        external: true,
        title: link.title || info?.label || link.url,
        note: info?.provider
          ? `Video on ${info.label}`
          : (info?.site ?? "Link"),
      };
    }),
    ...(d.source_url && !links.some((link) => link.url === d.source_url)
      ? [
          {
            href: d.source_url,
            external: true,
            title: `From ${describeLink(d.source_url)?.site ?? d.source_url}`,
            note: "Where this recipe came from",
          },
        ]
      : []),
  ];
  if (!items.length) return null;
  return (
    <section aria-labelledby="more" class="stack">
      <h2 id="more">More about this recipe</h2>
      <ul class="more" role="list">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              {...(item.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              <span class="more-title">
                {item.title}
                {item.external && (
                  <Icon
                    icon={ExternalLink}
                    class="icon-sm"
                    label="opens in a new tab"
                  />
                )}
              </span>
              <span class="muted small">{item.note}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Recipe({ id }) {
  const r = record("recipe", id);
  if (!r) return <Missing what="recipe" />;
  const d = r.data;
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
        <a
          class="btn btn-primary"
          href={`#/week/when/recipe/${encodeURIComponent(id)}`}
        >
          <Icon icon={CalendarPlus} />
          Add to the week
        </a>
      </PageHeader>
      <Facts d={d} />
      <LastTime notes={memories(r)} />
      <div class="recipe-columns">
        <Ingredients key={`${r.id}-${d.servings}`} d={d} />
        <Method d={d} />
      </div>
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
