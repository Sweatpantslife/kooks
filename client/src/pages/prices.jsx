import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Check, Pencil, Plus, Trash2, Wallet } from "lucide";
import { normalize } from "../../../shared/quantities.js";
import { change, record, records } from "../lib/store.js";
import { guardLeaving, leave, navigate } from "../lib/router.js";
import {
  budgetFor,
  chooseCurrency,
  currency,
  money,
  planned,
  saveBudget,
  useWeekCost,
} from "../lib/money.js";
import { amount } from "../lib/kitchen.js";
import { dateLabel, localDay, monday } from "../lib/format.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Field, FormError, hint, useWork } from "../ui/form.jsx";
import { Icon } from "../ui/icon.jsx";
import { passFocus } from "../ui/focus.js";
import { toHousehold } from "./household.jsx";

// An ingredient the week still needs a price for, carried to the form.
const draft = signal(null);

const withPreparation = (d) =>
  d.preparation ? `${d.name}, ${d.preparation}` : d.name;

function ThisWeek({ cost }) {
  const budget = budgetFor(monday());
  const [value, setValue] = useState(budget ? String(budget.data.amount) : "");
  const work = useWork();
  const left =
    budget && cost?.complete ? budget.data.amount - cost.known_cost : null;
  const submit = (event) => {
    event.preventDefault();
    void work.run(() => saveBudget(Number(value)));
  };
  return (
    <section class="card" aria-labelledby="this-week">
      <h2 id="this-week">This week</h2>
      {cost && (
        <p class="week-money">
          {cost.plans.length > 0 && (
            <span class="week-money-total">{planned(cost)}</span>
          )}
          <span class="muted">
            {cost.plans.length ? "for the food planned" : "Nothing planned yet"}
            {budget && ` · budget ${money(budget.data.amount)}`}
            {left !== null &&
              (left >= 0
                ? ` · ${money(left)} left`
                : ` · ${money(-left)} over`)}
          </span>
        </p>
      )}
      <form class="inline-form" onSubmit={submit}>
        <Field id="budget" label={`Weekly budget (${currency.value})`}>
          <input
            id="budget"
            class="input input-short"
            type="number"
            inputMode="decimal"
            min="0"
            max="1000000000"
            step="0.01"
            required
            aria-describedby={hint("budget")}
            value={value}
            onInput={(event) => setValue(event.currentTarget.value)}
          />
        </Field>
        <button type="submit" class="btn" disabled={work.busy}>
          <Icon icon={Check} />
          Save budget
        </button>
        <p class="hint" id={hint("budget")}>
          Holds every week from this one on, until you change it.
        </p>
      </form>
      <FormError>{work.error}</FormError>
    </section>
  );
}

function Unpriced({ list }) {
  const add = (ingredient) => {
    draft.value = ingredient;
    navigate("household/prices/new");
  };
  return (
    <section class="card" aria-labelledby="unpriced">
      <h2 id="unpriced">Still without a price</h2>
      <p class="muted small">
        In this week’s plans. Add what you paid, and the week adds up.
      </p>
      <ul class="price-list" role="list">
        {list.map((i) => (
          <li key={withPreparation(i)}>
            <span class="price-text">
              <strong>{withPreparation(i)}</strong>
              <span class="muted small">For {i.recipe}</span>
            </span>
            <button
              type="button"
              class="btn btn-quiet"
              aria-label={`Add a price for ${withPreparation(i)}`}
              onClick={() => add(i)}
            >
              <Icon icon={Plus} />
              Add a price
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The newest price of each thing; older ones stay in the kitchen's history.
function latestPrices() {
  const latest = new Map();
  for (const p of records("price")) {
    if (p.data.currency !== currency.value) continue;
    const key = `${normalize(p.data.name)}|${normalize(p.data.preparation)}`;
    const seen = latest.get(key);
    if (!seen || p.data.purchased_on > seen.data.purchased_on)
      latest.set(key, p);
  }
  return [...latest.values()].sort((a, b) =>
    a.data.name.localeCompare(b.data.name),
  );
}

function Known() {
  const prices = latestPrices();
  const work = useWork();
  const remove = (event, p) => {
    passFocus(event.currentTarget, "#add-price");
    void work.run(() =>
      change(
        "record_archive",
        {
          kind: "price",
          id: p.id,
          expected_version: p.version,
          archived: true,
        },
        { done: `The price of ${p.data.name} is gone.` },
      ),
    );
  };
  return (
    <section class="stack" aria-labelledby="known">
      <div class="section-head">
        <h2 id="known">What things cost</h2>
        <a
          id="add-price"
          class="btn"
          href="#/household/prices/new"
          onClick={() => (draft.value = null)}
        >
          <Icon icon={Plus} />
          Add a price
        </a>
      </div>
      {prices.length ? (
        <ul class="card price-list price-card" role="list" data-rows>
          {prices.map((p) => (
            <li key={p.id}>
              <span class="price-text">
                <strong>{withPreparation(p.data)}</strong>
                <span class="muted small">
                  {amount({
                    quantity: p.data.package_quantity,
                    unit: p.data.unit,
                  })}{" "}
                  for {money(p.data.price)}, {dateLabel(p.data.purchased_on)}
                </span>
              </span>
              <span class="row">
                <a
                  class="btn btn-quiet btn-icon"
                  href={`#/household/prices/${encodeURIComponent(p.id)}`}
                  aria-label={`Edit the price of ${p.data.name}`}
                >
                  <Icon icon={Pencil} />
                </a>
                <button
                  type="button"
                  class="btn btn-quiet btn-icon btn-danger"
                  data-row="remove"
                  aria-label={`Remove the price of ${p.data.name}`}
                  disabled={work.busy}
                  onClick={(event) => remove(event, p)}
                >
                  <Icon icon={Trash2} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={Wallet} title="No prices yet" heading="h3">
          Add what you paid for the things you buy most, and planned meals add
          up to a cost.
        </Empty>
      )}
      <FormError>{work.error}</FormError>
    </section>
  );
}

function Currency() {
  const [code, setCode] = useState(currency.value);
  const submit = (event) => {
    event.preventDefault();
    chooseCurrency(code);
  };
  return (
    <form class="card inline-form" onSubmit={submit}>
      <Field id="currency" label="Currency">
        <input
          id="currency"
          class="input input-short"
          required
          pattern="[A-Za-z]{3}"
          maxLength={3}
          autoComplete="off"
          aria-describedby={hint("currency")}
          value={code}
          onInput={(event) => setCode(event.currentTarget.value)}
        />
      </Field>
      <button type="submit" class="btn">
        <Icon icon={Check} />
        Use this currency
      </button>
      <p class="hint" id={hint("currency")}>
        Three letters, such as USD, EUR or ILS. Prices in another currency stay,
        and come back when you switch.
      </p>
    </form>
  );
}

export function Prices() {
  const cost = useWeekCost(monday());
  return (
    <div class="stack-lg">
      {toHousehold}
      <PageHeader title="Prices and budget" />
      <p class="lede">
        Kooks adds up what planned meals use at the prices you paid. It’s the
        food on the plate, not the till receipt.
      </p>
      <ThisWeek key={currency.value} cost={cost} />
      {cost?.unpriced.length > 0 && <Unpriced list={cost.unpriced} />}
      <Known />
      <Currency key={currency.value} />
    </div>
  );
}

export function PriceForm({ id }) {
  const editing = id === "new" ? null : record("price", id);
  const [f, setF] = useState(() => {
    const d = editing?.data ?? draft.value ?? {};
    return {
      name: d.name ?? "",
      preparation: d.preparation ?? "",
      package_quantity:
        d.package_quantity != null ? String(d.package_quantity) : "",
      unit: d.unit ?? "",
      price: d.price != null ? String(d.price) : "",
      purchased_on: d.purchased_on ?? localDay(),
    };
  });
  const dirty = useRef(false);
  const work = useWork();
  useEffect(
    () =>
      guardLeaving(
        () =>
          !dirty.current ||
          confirm("Leave without saving? This price will be lost."),
      ),
    [],
  );
  if (id !== "new" && !editing)
    return (
      <>
        {toHousehold}
        <PageHeader title="Not found" />
        <Empty icon={Wallet} title="That price isn’t in the kitchen">
          It may have been removed.
        </Empty>
      </>
    );

  const code = editing?.data.currency ?? currency.value;
  const text = (key) => (event) => {
    dirty.current = true;
    setF({ ...f, [key]: event.currentTarget.value });
  };
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      const name = f.name.trim();
      await change(
        "price_save",
        {
          ...(editing && { id: editing.id, expected_version: editing.version }),
          price: {
            source: "manual",
            notes: "",
            ...editing?.data,
            name,
            preparation: f.preparation.trim(),
            package_quantity: Number(f.package_quantity),
            unit: f.unit.trim(),
            price: Number(f.price),
            currency: code,
            purchased_on: f.purchased_on,
          },
        },
        { done: `Saved the price of ${name}.` },
      );
      dirty.current = false;
      draft.value = null;
      leave("household/prices");
    });
  };
  return (
    <div class="stack-lg page-narrow">
      {toHousehold}
      <PageHeader title={editing ? "Edit a price" : "Add a price"} />
      <form class="card" onSubmit={submit}>
        <Field id="price-name" label="What">
          <input
            id="price-name"
            class="input"
            required
            maxLength={500}
            autoComplete="off"
            value={f.name}
            onInput={text("name")}
          />
        </Field>
        <Field
          id="price-preparation"
          label="Preparation"
          help="Only when your recipes name one, such as grated: a price counts for the recipes that say the same."
        >
          <input
            id="price-preparation"
            class="input"
            maxLength={500}
            autoComplete="off"
            aria-describedby={hint("price-preparation")}
            value={f.preparation}
            onInput={text("preparation")}
          />
        </Field>
        <div class="fields-2">
          <Field id="price-size" label="Pack size">
            <input
              id="price-size"
              class="input"
              type="number"
              inputMode="decimal"
              min="0.01"
              max="10000"
              step="any"
              required
              value={f.package_quantity}
              onInput={text("package_quantity")}
            />
          </Field>
          <Field
            id="price-unit"
            label="Unit"
            help="g, kg, ml, l; blank for things you count."
          >
            <input
              id="price-unit"
              class="input"
              maxLength={80}
              autoComplete="off"
              list="price-units"
              aria-describedby={hint("price-unit")}
              value={f.unit}
              onInput={text("unit")}
            />
          </Field>
          <datalist id="price-units">
            {["g", "kg", "ml", "l", "oz", "lb"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <div class="fields-2">
          <Field id="price-price" label={`Price (${code})`}>
            <input
              id="price-price"
              class="input"
              type="number"
              inputMode="decimal"
              min="0"
              max="1000000000"
              step="0.01"
              required
              value={f.price}
              onInput={text("price")}
            />
          </Field>
          <Field id="price-date" label="Bought on">
            <input
              id="price-date"
              class="input"
              type="date"
              required
              value={f.purchased_on}
              onInput={text("purchased_on")}
            />
          </Field>
        </div>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={Check} />
            {work.busy ? "Saving…" : "Save price"}
          </button>
        </div>
      </form>
    </div>
  );
}
