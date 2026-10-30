import { useState } from "preact/hooks";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  ShoppingBasket,
  Wallet,
  X,
} from "lucide";
import { normalize } from "../../../shared/quantities.js";
import { change, record, records } from "../lib/store.js";
import { leave } from "../lib/router.js";
import {
  addDays,
  dateLabel,
  localDay,
  monday,
  plural,
  weekLabel,
  weekdayLabel,
} from "../lib/format.js";
import { metaOf, searchText } from "../lib/kitchen.js";
import {
  budgetFor,
  currency,
  money,
  planned as costOf,
  useWeekCost,
} from "../lib/money.js";
import { toast } from "../lib/toast.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Art } from "../ui/tile.jsx";
import { Icon } from "../ui/icon.jsx";
import { CookButton } from "../ui/cook-button.jsx";

// Meals in the order a day is eaten; anything else the household calls a
// meal comes after, in its own order.
const SLOTS = ["Breakfast", "Lunch", "Dinner"];
export const slotOrder = (slot) => {
  const at = SLOTS.indexOf(slot);
  return at < 0 ? SLOTS.length : at;
};

// The week's address: #/week for this one, #/week/<monday> for any other.
export const weekPath = (day) =>
  monday(day) === monday() ? "week" : `week/${monday(day)}`;

// "Today", "Tomorrow", or the weekday.
function dayName(day) {
  const today = localDay();
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return weekdayLabel(day);
}

export function weekTitle(start) {
  const now = monday();
  if (start === now) return "This week";
  if (start === addDays(now, 7)) return "Next week";
  if (start === addDays(now, -7)) return "Last week";
  return `Week of ${dateLabel(start)}`;
}

const sourceOf = (plan) => {
  const { kind, id, servings } = plan.data.reference ?? {};
  return servings == null ? { kind, id } : { kind, id, servings };
};

function planned(day) {
  return records("plan")
    .filter((p) => p.data.date === day)
    .sort((a, b) => slotOrder(a.data.slot) - slotOrder(b.data.slot));
}

// Leftovers set aside for a day. Portions already eaten, tonight's own
// share of a dish among them, are not plans.
function leftovers(day) {
  return records("batch").flatMap((b) =>
    (b.data.allocations ?? [])
      .filter((a) => a.date === day && a.status !== "eaten")
      .map((a) => ({ ...a, batch: b })),
  );
}

function PlanItem({ plan, day }) {
  const { kind, id } = plan.data.reference ?? {};
  const live = record(kind, id);
  const d = plan.data;
  const dishes = d.dishes ?? [];
  const details = [
    d.slot,
    kind === "meal"
      ? dishes.map((dish) => dish.title).join(" + ")
      : dishes[0]?.servings != null && `Serves ${dishes[0].servings}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const href = live
    ? kind === "meal"
      ? `#/recipes/meal/${encodeURIComponent(id)}`
      : `#/recipes/${encodeURIComponent(id)}`
    : null;
  const remove = async () => {
    try {
      await change(
        "record_archive",
        {
          kind: "plan",
          id: plan.id,
          expected_version: plan.version,
          archived: true,
        },
        { done: `${d.title} is off ${weekdayLabel(day)}.` },
      );
    } catch (error) {
      toast(error.message, { error: true });
    }
  };
  return (
    <li class="plan-item">
      <Art
        kind={kind === "meal" ? "meal" : "recipe"}
        data={live?.data ?? { title: d.title }}
        class="art-thumb"
      />
      <span class="plan-text">
        {href ? (
          <a class="plan-title" href={href}>
            {d.title}
          </a>
        ) : (
          <span class="plan-title">{d.title}</span>
        )}
        {details && <span class="muted small">{details}</span>}
      </span>
      <span class="plan-actions">
        {day === localDay() && (
          <CookButton
            source={{ kind: "plan", id: plan.id }}
            name={`Cook ${d.title}`}
            compact
          />
        )}
        <a
          class="btn btn-quiet btn-small"
          href={`#/week/move/${encodeURIComponent(plan.id)}`}
          aria-label={`Move ${d.title} to another day`}
        >
          Move
        </a>
        <button
          type="button"
          class="btn btn-quiet btn-icon"
          aria-label={`Remove ${d.title} from ${weekdayLabel(day)}`}
          onClick={remove}
        >
          <Icon icon={X} />
        </button>
      </span>
    </li>
  );
}

function Day({ day, heading: H = "h2" }) {
  const plans = planned(day);
  const rest = leftovers(day);
  const today = localDay();
  const id = `day-${day}`;
  return (
    <li
      class={`day${day === today ? " day-today" : ""}${day < today ? " day-past" : ""}`}
    >
      <section aria-labelledby={id} class="day-inner">
        <div class="day-head">
          <H id={id}>
            {weekdayLabel(day)} <span class="day-date">{dateLabel(day)}</span>
          </H>
          {day === today && <span class="badge badge-tomato">Today</span>}
        </div>
        {plans.length || rest.length ? (
          <ul class="plan-items" role="list">
            {plans.map((plan) => (
              <PlanItem key={plan.id} plan={plan} day={day} />
            ))}
            {rest.map((a) => (
              <li key={`${a.batch.id}-${a.id}`} class="plan-item">
                <span class="badge badge-herb">Leftovers</span>
                <span class="plan-text">
                  <span class="plan-title">{a.batch.data.title}</span>
                  <span class="muted small">
                    {[a.slot, plural(a.portions, "portion")]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">Nothing planned.</p>
        )}
        <a
          class="btn btn-quiet btn-small day-add"
          href={`#/week/add/${day}`}
          aria-label={`Add to ${weekdayLabel(day)}`}
        >
          <Icon icon={Plus} class="icon-sm" />
          Add
        </a>
      </section>
    </li>
  );
}

// One line on what the week's food comes to, once the household keeps
// prices or a budget.
function WeekMoney({ start }) {
  const budget = budgetFor(start);
  const priced = records("price").some(
    (p) => p.data.currency === currency.value,
  );
  const cost = useWeekCost(start, Boolean(budget || priced));
  if (!cost?.plans.length) return null;
  const left =
    budget && cost.complete ? budget.data.amount - cost.known_cost : null;
  return (
    <p class="week-money-line">
      <Icon icon={Wallet} class="icon-sm" />
      <span>
        Food planned: {costOf(cost)}
        {budget && ` of your ${money(budget.data.amount)} budget`}
        {left !== null && left < 0 && `, ${money(-left)} over`}
        {cost.unpriced.length > 0 &&
          ` · ${plural(cost.unpriced.length, "thing")} without a price`}
      </span>{" "}
      <a href="#/household/prices">Prices and budget</a>
    </p>
  );
}

export function Week({ start = monday() }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const now = monday();
  const any = days.some((day) => planned(day).length || leftovers(day).length);
  // Days gone by fold away, so this week opens on today.
  const today = localDay();
  const past = days.filter((day) => day < today);
  const coming = days.filter((day) => day >= today);
  const earlier = past.reduce(
    (n, day) => n + planned(day).length + leftovers(day).length,
    0,
  );
  return (
    <>
      <PageHeader eyebrow={weekLabel(start)} title={weekTitle(start)}>
        {addDays(start, 6) >= today && (
          <a
            class="btn"
            href={
              start === now ? "#/groceries/week" : `#/groceries/week/${start}`
            }
          >
            <Icon icon={ShoppingBasket} />
            Shop for the week
          </a>
        )}
        <a
          class="btn btn-icon"
          href={`#/${weekPath(addDays(start, -7))}`}
          aria-label="Previous week"
        >
          <Icon icon={ChevronLeft} />
        </a>
        {start !== now && (
          <a class="btn" href="#/week">
            This week
          </a>
        )}
        <a
          class="btn btn-icon"
          href={`#/${weekPath(addDays(start, 7))}`}
          aria-label="Next week"
        >
          <Icon icon={ChevronRight} />
        </a>
      </PageHeader>
      <WeekMoney start={start} />
      {!any && (
        <p class="lede">
          Nothing planned yet. Add a dish to a day, or open a recipe and choose
          Add to the week.
        </p>
      )}
      {past.length > 0 && (
        <details class="card disclosure earlier">
          <summary>
            <h2>Earlier this week</h2>
            <span class="muted small">
              {earlier ? plural(earlier, "dish", "dishes") : "Nothing planned"}
            </span>
          </summary>
          <ol class="days" role="list">
            {past.map((day) => (
              <Day key={day} day={day} heading="h3" />
            ))}
          </ol>
        </details>
      )}
      <ol class="days" role="list">
        {coming.map((day) => (
          <Day key={day} day={day} />
        ))}
      </ol>
    </>
  );
}

// Breakfast, lunch or dinner, as a row of choices.
function SlotChoice({ value, onChange }) {
  const options = SLOTS.includes(value) ? SLOTS : [...SLOTS, value];
  return (
    <fieldset class="segmented">
      <legend class="sr-only">Meal</legend>
      {options.map((slot) => (
        <label key={slot}>
          <input
            type="radio"
            name="slot"
            value={slot}
            checked={value === slot}
            onChange={() => onChange(slot)}
          />
          {slot}
        </label>
      ))}
    </fieldset>
  );
}

const back = (href, label) => (
  <a class="back" href={href}>
    <Icon icon={ArrowLeft} />
    {label}
  </a>
);

// Choose what to cook on a day: recipes and meals, favorites first.
export function AddToDay({ day }) {
  const [slot, setSlot] = useState("Dinner");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const words = normalize(query).split(" ").filter(Boolean);
  const choices = ["meal", "recipe"]
    .flatMap((kind) => records(kind).map((r) => ({ kind, r })))
    .filter(({ kind, r }) => {
      const text = searchText(kind, r);
      return words.every((w) => text.includes(w));
    })
    .sort(
      (a, b) =>
        Number(Boolean(b.r.data.favorite)) -
          Number(Boolean(a.r.data.favorite)) ||
        a.r.data.title.localeCompare(b.r.data.title),
    );
  const where = weekPath(day);
  const add = async (kind, r) => {
    setBusy(true);
    try {
      await change(
        "plan_save",
        { source: { kind, id: r.id }, date: day, slot },
        { done: `${r.data.title} is on ${weekdayLabel(day)}.` },
      );
      leave(where);
    } catch (error) {
      toast(error.message, { error: true });
      setBusy(false);
    }
  };
  if (!records("recipe").length)
    return (
      <>
        {back(`#/${where}`, weekTitle(monday(day)))}
        <PageHeader title={`Add to ${weekdayLabel(day)}`} />
        <Empty
          icon={CalendarDays}
          title="Nothing to plan yet"
          action={
            <a class="btn btn-primary" href="#/recipes/add">
              Add a recipe
            </a>
          }
        >
          Add a recipe you love to cook, then plan it for a day.
        </Empty>
      </>
    );
  return (
    <>
      {back(`#/${where}`, weekTitle(monday(day)))}
      <PageHeader
        eyebrow={`${dayName(day)}, ${dateLabel(day)}`}
        title={`Add to ${weekdayLabel(day)}`}
      />
      <div class="stack">
        <SlotChoice value={slot} onChange={setSlot} />
        <label class="search">
          <Icon icon={Search} />
          <span class="sr-only">Search recipes and meals</span>
          <input
            type="search"
            class="search-input"
            placeholder="Recipes and meals"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>
      <p class="results-note muted" role="status">
        {plural(choices.length, "choice")}
      </p>
      {choices.length ? (
        <ul class="picks" role="list">
          {choices.map(({ kind, r }) => (
            <li key={r.id}>
              <button
                type="button"
                class="pick"
                disabled={busy}
                onClick={() => add(kind, r)}
              >
                <Art kind={kind} data={r.data} class="art-thumb" />
                <span class="pick-text">
                  <span class="pick-title">{r.data.title}</span>
                  <span class="muted small">{metaOf(kind, r)}</span>
                </span>
                <Icon icon={Plus} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={Search} title="Nothing matches">
          Try fewer words.
        </Empty>
      )}
    </>
  );
}

// Choose the day for a recipe or meal, or a new day for something planned:
// the rest of this week and all of the next.
export function ChooseDay({ kind, id, planId }) {
  const plan = planId ? record("plan", planId) : null;
  const source = plan ? sourceOf(plan) : { kind, id };
  const item = plan ? null : record(kind, id);
  const [slot, setSlot] = useState(plan?.data.slot ?? "Dinner");
  const [busy, setBusy] = useState(false);
  if (!plan && !item)
    return (
      <>
        {back("#/week", "This week")}
        <PageHeader title="Not found" />
        <Empty
          icon={CalendarDays}
          title={
            planId ? "That’s no longer planned" : "That isn’t in the kitchen"
          }
          action={
            <a class="btn btn-primary" href="#/week">
              Go to this week
            </a>
          }
        >
          It may have been removed or archived.
        </Empty>
      </>
    );
  const title = plan?.data.title ?? item.data.title;
  const today = localDay();
  const days = Array.from({ length: 14 }, (_, i) =>
    addDays(monday(), i),
  ).filter((day) => day >= today);
  const from = plan
    ? `#/${weekPath(plan.data.date)}`
    : kind === "meal"
      ? `#/recipes/meal/${encodeURIComponent(id)}`
      : `#/recipes/${encodeURIComponent(id)}`;
  const choose = async (day) => {
    setBusy(true);
    try {
      await change(
        "plan_save",
        {
          ...(plan ? { id: plan.id, expected_version: plan.version } : {}),
          source,
          date: day,
          slot,
          ...(plan ? { notes: plan.data.notes ?? "" } : {}),
        },
        { done: `${title} is on ${weekdayLabel(day)}.` },
      );
      leave(plan ? weekPath(day) : from.slice(2));
    } catch (error) {
      toast(error.message, { error: true });
      setBusy(false);
    }
  };
  const weeks = [
    days.filter((day) => day < addDays(monday(), 7)),
    days.filter((day) => day >= addDays(monday(), 7)),
  ];
  return (
    <>
      {back(from, plan ? weekTitle(monday(plan.data.date)) : title)}
      <PageHeader
        eyebrow={title}
        title={plan ? "Move to which day?" : "Which day?"}
      />
      <SlotChoice value={slot} onChange={setSlot} />
      {weeks.map(
        (list, index) =>
          list.length > 0 && (
            <section
              key={index}
              class="stack"
              aria-labelledby={`when-${index}`}
            >
              <h2 id={`when-${index}`}>{index ? "Next week" : "This week"}</h2>
              <ul class="day-picks" role="list">
                {list.map((day) => {
                  const n = planned(day).filter((p) => p.id !== planId).length;
                  const current = plan?.data.date === day;
                  return (
                    <li key={day}>
                      <button
                        type="button"
                        class="day-pick"
                        disabled={busy}
                        aria-current={current ? "date" : undefined}
                        onClick={() => choose(day)}
                      >
                        <span class="day-pick-name">{dayName(day)}</span>
                        <span class="muted small">
                          {dateLabel(day)}
                          {n ? ` · ${n} planned` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}
    </>
  );
}
