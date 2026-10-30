import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import {
  ArrowLeft,
  CalendarDays,
  PackageCheck,
  Plus,
  Refrigerator,
  ShoppingBasket,
  X,
} from "lucide";
import { parseIngredient } from "../../../shared/ingredients.js";
import { change, record, records, undoAction } from "../lib/store.js";
import { leave } from "../lib/router.js";
import { toast } from "../lib/toast.js";
import {
  addDays,
  dateLabel,
  localDay,
  monday,
  plural,
  weekdayLabel,
} from "../lib/format.js";
import { amount, atHome, metaOf } from "../lib/kitchen.js";
import { AISLES, aisleOf, nameKey } from "../lib/aisles.js";
import {
  addItem,
  check,
  chosen,
  dishesOf,
  forWhat,
  ingredientKeys,
  keysOn,
  onList,
  pantryEntry,
  putSource,
  shopAmount,
  takeOut,
  theList,
} from "../lib/groceries.js";
import { FormError, useWork } from "../ui/form.jsx";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";
import { slotOrder, weekTitle } from "./week.jsx";

// What the last tap did, said out loud: a row that moves to another part of
// the page is otherwise gone without a word.
const said = signal("");
function Said() {
  useEffect(() => () => (said.value = ""), []);
  return (
    <p class="sr-only" role="status">
      {said.value}
    </p>
  );
}

// A row about to move away hands keyboard focus to the same control on the
// row after it, or before it, so a list can be worked through without
// starting again from the top.
function passFocus(from, fallback) {
  if (from !== document.activeElement) return;
  const group = from.closest("[data-rows]");
  const controls = group
    ? [...group.querySelectorAll(`[data-row="${from.dataset.row}"]`)]
    : [];
  const at = controls.indexOf(from);
  (
    controls[at + 1] ??
    controls[at - 1] ??
    document.querySelector(fallback)
  )?.focus();
}

// Rows ticked or taken off show so at once; the list catches up when the
// server answers.
const pending = signal({});
function settle(id, value) {
  const { [id]: _, ...rest } = pending.value;
  pending.value = value === undefined ? rest : { ...rest, [id]: value };
}

const done = (result, text) =>
  toast(text, {
    undo: result?.action_id ? () => undoAction(result.action_id) : null,
  });
const failed = (error) => toast(error.message, { error: true });

function Sections({ here }) {
  return (
    <nav class="subnav" aria-label="Groceries">
      <a href="#/groceries" aria-current={here === "buy" ? "page" : undefined}>
        To buy
      </a>
      <a
        href="#/groceries/home"
        aria-current={here === "home" ? "page" : undefined}
      >
        At home
      </a>
    </nav>
  );
}

// One line for anything to buy: "2 lemons", "500 g flour, sifted".
function QuickAdd() {
  const [text, setText] = useState("");
  const { busy, error, run } = useWork();
  const submit = (event) => {
    event.preventDefault();
    const line = text.trim();
    if (!line) return;
    run(async () => {
      const { name, quantity, unit, preparation, original_text } =
        parseIngredient(line);
      await addItem({
        name,
        quantity,
        unit,
        preparation,
        original_text,
        category: aisleOf({ name }),
      });
      setText("");
      said.value = `${line} is on the list.`;
    });
  };
  return (
    <form class="stack-sm" onSubmit={submit}>
      <div class="quick-add">
        <label for="grocery-add" class="sr-only">
          Add to the list
        </label>
        <input
          id="grocery-add"
          class="input"
          autocomplete="off"
          enterkeyhint="done"
          placeholder="Add something, like 2 lemons"
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <button type="submit" class="btn btn-primary" disabled={busy}>
          <Icon icon={Plus} />
          Add
        </button>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}

function Row({ row }) {
  const id = `grocery-${row.id}`;
  const note = forWhat(row);
  const size = shopAmount(row);
  const tick = async (event) => {
    const checked = event.currentTarget.checked;
    settle(row.id, checked);
    passFocus(event.currentTarget, "#grocery-add");
    said.value = checked
      ? `${row.name} is in the basket.`
      : `${row.name} is back on the list.`;
    try {
      await check([row.id], checked);
    } catch (error) {
      failed(error);
    } finally {
      settle(row.id);
    }
  };
  const remove = async (event) => {
    settle(row.id, "gone");
    passFocus(event.currentTarget, "#grocery-add");
    try {
      const results = await takeOut([row]);
      done(results.length === 1 && results[0], `${row.name} is off the list.`);
    } catch (error) {
      failed(error);
    } finally {
      settle(row.id);
    }
  };
  return (
    <li class={`grocery${row.checked ? " grocery-done" : ""}`}>
      <input
        type="checkbox"
        id={id}
        data-row="check"
        checked={row.checked}
        aria-describedby={note ? `${id}-for` : undefined}
        onChange={tick}
      />
      <span class="grocery-text">
        <label for={id} class="grocery-name">
          <span>
            {row.name}
            {row.preparation && <span class="muted">, {row.preparation}</span>}
          </span>{" "}
          {size && <span class="grocery-amount">{size}</span>}
        </label>
        {note && (
          <span id={`${id}-for`} class="muted small">
            {note}
          </span>
        )}
      </span>
      <button
        type="button"
        class="btn btn-quiet btn-icon"
        data-row="remove"
        aria-label={`Remove ${row.name} from the list`}
        onClick={remove}
      >
        <Icon icon={X} />
      </button>
    </li>
  );
}

const aisleId = (aisle) => `aisle-${aisle.toLowerCase().replace(/\W+/g, "-")}`;
const byName = (a, b) => a.name.localeCompare(b.name);

// Where a source on the list came from: the day it is planned for, or
// what kind of thing it is.
function describe(group) {
  const { kind, id } = group.reference;
  const plan = kind === "plan" && record("plan", id);
  if (plan) return `${weekdayLabel(plan.data.date)} · ${plan.data.slot}`;
  if (kind === "plan") return "No longer planned";
  return kind === "meal" ? "Meal" : "Recipe";
}

function Sources({ list }) {
  const groups = list.data.sources;
  if (!groups.length) return null;
  const takeOff = async (group) => {
    try {
      const result = await onList((fresh) =>
        change("shopping_remove_source", {
          id: fresh.id,
          expected_version: fresh.version,
          source_key: group.source_key,
        }),
      );
      done(result, `${group.title} is off the list.`);
    } catch (error) {
      failed(error);
    }
  };
  return (
    <details class="card disclosure">
      <summary>
        <h2>What it’s for</h2>
        <span class="muted small">{plural(groups.length, "meal")}</span>
      </summary>
      <ul class="plan-items" role="list">
        {groups.map((group) => (
          <li key={group.source_key} class="plan-item">
            <span class="plan-text">
              <span class="plan-title">{group.title}</span>
              <span class="muted small">
                {describe(group)} ·{" "}
                {plural(group.contributions.length, "grocery", "groceries")}
              </span>
            </span>
            <button
              type="button"
              class="btn btn-quiet btn-small"
              onClick={() => takeOff(group)}
              aria-label={`Take off, ${group.title}`}
            >
              Take off
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

// The shopping list, by aisle, with what is already in the basket below.
export function Groceries() {
  const lists = records("shopping");
  const list = theList();
  const rows = (list?.items ?? []).flatMap((row) => {
    const now = pending.value[row.id];
    if (now === "gone") return [];
    return [now === undefined ? row : { ...row, checked: now }];
  });
  const toBuy = rows.filter((row) => !row.checked);
  const basket = rows.filter((row) => row.checked).sort(byName);
  const aisles = AISLES.map((aisle) => [
    aisle,
    toBuy.filter((row) => aisleOf(row) === aisle).sort(byName),
  ]).filter(([, items]) => items.length);
  return (
    <>
      <PageHeader
        eyebrow={
          toBuy.length ? plural(toBuy.length, "thing") + " to buy" : "Groceries"
        }
        title="To buy"
      >
        <a class="btn" href="#/groceries/week">
          <Icon icon={CalendarDays} />
          Shop for the week
        </a>
      </PageHeader>
      <Sections here="buy" />
      {lists.length > 1 && (
        <div class="chips" role="group" aria-label="Lists">
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              class="chip"
              aria-pressed={l.id === list.id ? "true" : "false"}
              onClick={() => (chosen.value = l.id)}
            >
              {l.data.title}
            </button>
          ))}
        </div>
      )}
      <QuickAdd />
      <Said />
      {rows.length === 0 ? (
        <Empty
          icon={ShoppingBasket}
          title="Nothing to buy yet"
          action={
            <a class="btn btn-primary" href="#/groceries/week">
              Shop for the week
            </a>
          }
        >
          Add what you need above, or pick the groceries for the meals planned
          this week.
        </Empty>
      ) : (
        <div class="stack-lg" data-rows="buy">
          {aisles.length === 0 && (
            <p class="lede">Everything is in the basket.</p>
          )}
          {aisles.map(([aisle, items]) => (
            <section key={aisle} class="aisle" aria-labelledby={aisleId(aisle)}>
              <h2 id={aisleId(aisle)}>{aisle}</h2>
              <ul class="groceries" role="list">
                {items.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {basket.length > 0 && (
        <section class="card basket" aria-labelledby="basket">
          <div class="section-head">
            <h2 id="basket">In the basket</h2>
            <span class="muted small">{plural(basket.length, "thing")}</span>
          </div>
          <ul class="groceries" role="list" data-rows="basket">
            {basket.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
          <a class="btn btn-primary basket-done" href="#/groceries/put-away">
            <Icon icon={PackageCheck} />
            Put it all away
          </a>
        </section>
      )}
      {list && <Sources list={list} />}
    </>
  );
}

// Breakfast before eleven, lunch before four, then dinner.
function slotNow() {
  const hour = new Date().getHours();
  return hour < 11 ? "Breakfast" : hour < 16 ? "Lunch" : "Dinner";
}

function Leftovers() {
  const batches = records("batch")
    .filter((b) => b.remaining_portions > 0)
    .sort((a, b) => b.data.cooked_on.localeCompare(a.data.cooked_on));
  if (!batches.length) return null;
  const eat = async (b, portions, text) => {
    try {
      const result = await change("batch_allocate", {
        id: b.id,
        expected_version: b.version,
        allocation: {
          portions,
          date: localDay(),
          slot: slotNow(),
          storage: b.data.storage,
          status: "eaten",
        },
      });
      done(result, text);
    } catch (error) {
      failed(error);
    }
  };
  return (
    <section class="card" aria-labelledby="leftovers">
      <h2 id="leftovers">Leftovers</h2>
      <ul class="plan-items" role="list">
        {batches.map((b) => {
          const title = b.data.title;
          const free = b.available_portions;
          return (
            <li key={b.id} class="plan-item">
              <span class="plan-text">
                <span class="plan-title">{title}</span>
                <span class="muted small">
                  {[
                    `${plural(b.remaining_portions, "portion")} left`,
                    b.reserved_portions > 0 &&
                      `${b.reserved_portions} set aside`,
                    b.data.storage === "freezer" ? "Freezer" : "Fridge",
                    `cooked ${dateLabel(b.data.cooked_on)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {free > 0 && (
                <span class="plan-actions">
                  <button
                    type="button"
                    class="btn btn-quiet btn-small"
                    onClick={() =>
                      eat(b, Math.min(1, free), `A portion of ${title} eaten.`)
                    }
                    aria-label={`Ate one, ${title}`}
                  >
                    Ate one
                  </button>
                  <button
                    type="button"
                    class="btn btn-quiet btn-small"
                    onClick={() => eat(b, free, `${title} is all gone.`)}
                    aria-label={`All gone, ${title}`}
                  >
                    All gone
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const savePantry = (p, changes) =>
  change("pantry_save", {
    id: p.id,
    expected_version: p.version,
    pantry: { ...p.data, ...changes },
  });

function PantryRow({ p }) {
  const d = p.data;
  const name = (
    <span class="plan-title">
      {d.name}
      {d.preparation && <span class="muted">, {d.preparation}</span>}
    </span>
  );
  // Every button but "Add to the list" moves the row to another section.
  const run = async (event, work) => {
    if (event.currentTarget.dataset.row)
      passFocus(event.currentTarget, "#pantry-add");
    try {
      await work();
    } catch (error) {
      failed(error);
    }
  };
  if (!d.available)
    return (
      <li class="plan-item">
        <span class="plan-text">{name}</span>
        <span class="plan-actions">
          <button
            type="button"
            class="btn btn-quiet btn-small"
            onClick={(event) =>
              run(event, async () =>
                done(
                  await addItem({
                    name: d.name,
                    preparation: d.preparation,
                    category: aisleOf(d),
                  }),
                  `${d.name} is on the list.`,
                ),
              )
            }
            aria-label={`Add to the list, ${d.name}`}
          >
            Add to the list
          </button>
          <button
            type="button"
            class="btn btn-quiet btn-small"
            data-row="back"
            onClick={(event) =>
              run(event, async () => {
                await savePantry(p, { available: true });
                said.value = `${d.name} is back at home.`;
              })
            }
            aria-label={`Have it, ${d.name}`}
          >
            Have it
          </button>
        </span>
      </li>
    );
  return (
    <li class="plan-item">
      <span class="plan-text">
        {name}
        {d.quantity != null && <span class="muted small">{shopAmount(d)}</span>}
      </span>
      <span class="plan-actions">
        <button
          type="button"
          class="btn btn-quiet btn-small"
          data-row="soon"
          aria-pressed={d.use_soon ? "true" : "false"}
          onClick={(event) =>
            run(event, async () => {
              await savePantry(p, { use_soon: !d.use_soon });
              said.value = d.use_soon
                ? `${d.name} is no longer marked to use soon.`
                : `${d.name} is marked to use soon.`;
            })
          }
          aria-label={`Use soon, ${d.name}`}
        >
          Use soon
        </button>
        <button
          type="button"
          class="btn btn-quiet btn-small"
          data-row="out"
          onClick={(event) =>
            run(event, async () =>
              done(
                await savePantry(p, { available: false, use_soon: false }),
                `${d.name} is used up.`,
              ),
            )
          }
          aria-label={`Used up, ${d.name}`}
        >
          Used up
        </button>
      </span>
    </li>
  );
}

function AddToPantry() {
  const [text, setText] = useState("");
  const { busy, error, run } = useWork();
  const submit = (event) => {
    event.preventDefault();
    const name = text.trim();
    if (!name) return;
    run(async () => {
      const known = pantryEntry(name);
      if (known && !known.data.available)
        await savePantry(known, { available: true });
      else if (!known)
        await change("pantry_save", {
          pantry: { name, category: aisleOf({ name }) },
        });
      setText("");
      said.value = `${name} is at home.`;
    });
  };
  return (
    <form class="stack-sm" onSubmit={submit}>
      <div class="quick-add">
        <label for="pantry-add" class="sr-only">
          Add something you have
        </label>
        <input
          id="pantry-add"
          class="input"
          autocomplete="off"
          enterkeyhint="done"
          placeholder="Add something you have, like rice"
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <button type="submit" class="btn btn-primary" disabled={busy}>
          <Icon icon={Plus} />
          Add
        </button>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}

// What is in the kitchen already: what to use soon, leftovers, the rest, and
// what ran out.
export function AtHome() {
  const pantry = [...records("pantry")].sort((a, b) =>
    a.data.name.localeCompare(b.data.name),
  );
  const have = pantry.filter((p) => p.data.available);
  const soon = have.filter((p) => p.data.use_soon);
  const rest = have.filter((p) => !p.data.use_soon);
  const out = pantry.filter((p) => !p.data.available);
  const section = (id, title, list) =>
    list.length > 0 && (
      <section class="card" aria-labelledby={id}>
        <h2 id={id}>{title}</h2>
        <ul class="plan-items" role="list">
          {list.map((p) => (
            <PantryRow key={p.id} p={p} />
          ))}
        </ul>
      </section>
    );
  return (
    <>
      <PageHeader
        eyebrow={
          have.length ? plural(have.length, "thing") + " at home" : "Groceries"
        }
        title="At home"
      />
      <Sections here="home" />
      <AddToPantry />
      <Said />
      <Leftovers />
      {have.length === 0 && out.length === 0 ? (
        <Empty icon={Refrigerator} title="Nothing noted yet">
          Note what you have, and recipes show it as at home. Putting the
          shopping away adds what you bought.
        </Empty>
      ) : (
        <div class="stack-lg" data-rows="home">
          {section("use-soon", "Use soon", soon)}
          {section("in-the-kitchen", "In the kitchen", rest)}
        </div>
      )}
      {out.length > 0 && (
        <details class="card disclosure" data-rows="out">
          <summary>
            <h2>Ran out</h2>
            <span class="muted small">{plural(out.length, "thing")}</span>
          </summary>
          <ul class="plan-items" role="list">
            {out.map((p) => (
              <PantryRow key={p.id} p={p} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

const back = (href, label) => (
  <a class="back" href={href}>
    <Icon icon={ArrowLeft} />
    {label}
  </a>
);

// The planned days of a week from today on, or one recipe or meal, each with
// its ingredients to pick from.
function sourcesFor({ week, kind, id }) {
  const make = (source, key, title, detail) => {
    const dishes = dishesOf(source);
    return dishes && { source, key, title, detail, dishes };
  };
  if (!week) {
    const r = record(kind, id);
    return r
      ? [make({ kind, id }, `${kind}:${id}`, r.data.title, metaOf(kind, r))]
      : [];
  }
  const today = localDay();
  const from = week > today ? week : today;
  const to = addDays(week, 6);
  return records("plan")
    .filter((p) => p.data.date >= from && p.data.date <= to)
    .sort(
      (a, b) =>
        a.data.date.localeCompare(b.data.date) ||
        slotOrder(a.data.slot) - slotOrder(b.data.slot),
    )
    .map((p) =>
      make(
        { kind: "plan", id: p.id },
        `plan:${p.id}`,
        p.data.title,
        `${weekdayLabel(p.data.date)} · ${p.data.slot}`,
      ),
    )
    .filter(Boolean);
}

// Pick what to buy for the week's plans, or for one recipe or meal: what is
// already on the list stays as it is, and what is at home starts unticked.
export function ShopFor({ week, kind, id }) {
  const list = theList();
  const home = atHome();
  const entries = sourcesFor({ week, kind, id });
  const [picked, setPicked] = useState({});
  const { busy, error, run } = useWork();
  const ticked = (entry, key, ingredient) => {
    const choice = picked[`${entry.key}|${key}`];
    if (choice !== undefined) return choice;
    const on = keysOn(list, entry.key);
    return on.size ? on.has(key) : !home.has(nameKey(ingredient.name));
  };
  const plan = entries.map((entry) => {
    const all = ingredientKeys(entry.dishes);
    const byKey = new Map(
      entry.dishes.flatMap((dish) =>
        dish.ingredients.map((i, index) => [`${dish.dish_id}:${index}`, i]),
      ),
    );
    const keep = all.filter((key) => ticked(entry, key, byKey.get(key)));
    const on = keysOn(list, entry.key);
    const same = keep.length === on.size && keep.every((key) => on.has(key));
    return { entry, all, keep, changed: !same };
  });
  const count = plan.reduce((n, p) => n + p.keep.length, 0);
  const title = !week
    ? "Add to groceries"
    : week === monday()
      ? "Shop for this week"
      : week === addDays(monday(), 7)
        ? "Shop for next week"
        : `Shop for the week of ${dateLabel(week)}`;
  const from = week
    ? `#/${week === monday() ? "week" : `week/${week}`}`
    : kind === "meal"
      ? `#/recipes/meal/${encodeURIComponent(id)}`
      : `#/recipes/${encodeURIComponent(id)}`;
  const apply = () =>
    run(async () => {
      for (const { entry, all, keep, changed } of plan)
        if (changed)
          await putSource({
            source: entry.source,
            source_key: entry.key,
            exclude: all.filter((key) => !keep.includes(key)),
            all,
          });
      toast(
        week
          ? "The week’s groceries are on the list."
          : `${entries[0].title}’s groceries are on the list.`,
      );
      leave(week ? "groceries" : from.slice(2));
    });
  const backTo = back(
    from,
    week ? weekTitle(week) : (entries[0]?.title ?? "Recipes"),
  );
  if (!entries.length)
    return (
      <>
        {backTo}
        <PageHeader title={title} />
        <Empty
          icon={CalendarDays}
          title={
            week ? "Nothing planned from today on" : "That isn’t in the kitchen"
          }
          action={
            <a class="btn btn-primary" href={week ? from : "#/recipes"}>
              {week ? "Plan the week" : "Go to recipes"}
            </a>
          }
        >
          {week
            ? "Plan a few meals, then pick their groceries here."
            : "It may have been removed or archived."}
        </Empty>
      </>
    );
  return (
    <>
      {backTo}
      <PageHeader
        eyebrow={week ? plural(entries.length, "meal") : entries[0].title}
        title={title}
      />
      <p class="lede">
        Untick what you already have. What is at home starts unticked.
      </p>
      <div class="stack-lg">
        {entries.map((entry, n) => (
          <section key={entry.key} class="card" aria-labelledby={`source-${n}`}>
            <div class="section-head">
              <h2 id={`source-${n}`}>{entry.title}</h2>
              <span class="muted small">
                {entry.detail}
                {keysOn(list, entry.key).size > 0 && " · On the list"}
              </span>
            </div>
            {entry.dishes.map((dish) => (
              <fieldset key={dish.dish_id} class="shop-dish">
                <legend
                  class={
                    entry.dishes.length > 1 ? "shop-dish-title" : "sr-only"
                  }
                >
                  {entry.dishes.length > 1
                    ? dish.title
                    : `Groceries for ${entry.title}`}
                </legend>
                {dish.ingredients.length ? (
                  <ul class="shop-picks" role="list">
                    {dish.ingredients.map((i, index) => {
                      const key = `${dish.dish_id}:${index}`;
                      const box = `pick-${n}-${key.replace(":", "-")}`;
                      return (
                        <li key={key}>
                          <input
                            type="checkbox"
                            id={box}
                            checked={ticked(entry, key, i)}
                            onChange={(event) =>
                              setPicked({
                                ...picked,
                                [`${entry.key}|${key}`]:
                                  event.currentTarget.checked,
                              })
                            }
                          />
                          <label for={box}>
                            <span>
                              {i.name}
                              {i.preparation && (
                                <span class="muted">, {i.preparation}</span>
                              )}
                            </span>{" "}
                            <span class="muted">{amount(i, dish.factor)}</span>
                          </label>
                          {home.has(nameKey(i.name)) && (
                            <span class="badge badge-herb">At home</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p class="muted small">No ingredients written down.</p>
                )}
              </fieldset>
            ))}
          </section>
        ))}
      </div>
      <div class="shop-footer">
        <p class="muted" role="status">
          {plural(count, "grocery", "groceries")} picked
        </p>
        {error && <FormError>{error}</FormError>}
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          onClick={apply}
        >
          <Icon icon={ShoppingBasket} />
          Put them on the list
        </button>
      </div>
    </>
  );
}

// After the shop: what was bought joins At home, and the basket empties.
export function PutAway() {
  const list = theList();
  const basket = (list?.items ?? []).filter((row) => row.checked).sort(byName);
  const [skipped, setSkipped] = useState({});
  const { busy, error, run } = useWork();
  // Paper towels and the like are not worth noting as at home.
  const skips = (row) => skipped[row.id] ?? aisleOf(row) === "Household";
  const kept = basket.filter((row) => !skips(row));
  const apply = () =>
    run(async () => {
      for (const row of kept) {
        const known = pantryEntry(row.name);
        if (known?.data.available) continue;
        if (known) await savePantry(known, { available: true });
        else
          await change("pantry_save", {
            pantry: {
              name: row.name,
              preparation: row.preparation,
              category: aisleOf(row),
            },
          });
      }
      await takeOut(basket);
      toast(`${plural(basket.length, "grocery", "groceries")} put away.`);
      leave("groceries");
    });
  return (
    <>
      {back("#/groceries", "To buy")}
      <PageHeader eyebrow="Groceries" title="Put it all away" />
      {basket.length === 0 ? (
        <Empty
          icon={PackageCheck}
          title="The basket is empty"
          action={
            <a class="btn btn-primary" href="#/groceries">
              Back to the list
            </a>
          }
        >
          Tick groceries as they go in the basket, then put them away here.
        </Empty>
      ) : (
        <>
          <p class="lede">
            Ticked groceries join At home, so recipes show what you have.
            Everything here leaves the list.
          </p>
          <fieldset class="card">
            <legend class="sr-only">Note as at home</legend>
            <ul class="shop-picks" role="list">
              {basket.map((row) => {
                const box = `away-${row.id}`;
                const there = pantryEntry(row.name)?.data.available;
                return (
                  <li key={row.id}>
                    <input
                      type="checkbox"
                      id={box}
                      checked={!skips(row)}
                      onChange={(event) =>
                        setSkipped({
                          ...skipped,
                          [row.id]: !event.currentTarget.checked,
                        })
                      }
                    />
                    <label for={box}>
                      <span>{row.name}</span>{" "}
                      <span class="muted">{shopAmount(row)}</span>
                    </label>
                    {there && <span class="badge badge-herb">At home</span>}
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div class="shop-footer">
            <p class="muted" role="status">
              {plural(kept.length, "grocery", "groceries")} to note as at home
            </p>
            {error && <FormError>{error}</FormError>}
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              onClick={apply}
            >
              <Icon icon={PackageCheck} />
              Put away
            </button>
          </div>
        </>
      )}
    </>
  );
}
