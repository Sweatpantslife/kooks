import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CookingPot,
  Timer,
  X,
} from "lucide";
import { change, record } from "../lib/store.js";
import { leave, navigate } from "../lib/router.js";
import { toast } from "../lib/toast.js";
import { localDay } from "../lib/format.js";
import { amount, memories } from "../lib/kitchen.js";
import {
  clock,
  edit,
  liveTimers,
  minutesLabel,
  onSession,
  originOf,
  readySound,
  secondsLeft,
  slotNow,
  useNow,
} from "../lib/cooking.js";
import { Field, FormError, numberOrNull, useWork } from "../ui/form.jsx";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";
import { LastTime } from "./recipe.jsx";

const failed = (error) => toast(error.message, { error: true });

// Steps moved on show at once; the session catches up when the server
// answers. Keyed by session and dish.
const moving = signal({});

function progressOf(session, dishId) {
  const key = `${session.id}|${dishId}`;
  return (
    moving.value[key] ??
    session.data.progress.find((p) => p.dish_id === dishId) ?? {
      current_step: 0,
      completed_steps: [],
    }
  );
}

async function goTo(session, dish, current_step, completed_steps) {
  const key = `${session.id}|${dish.dish_id}`;
  moving.value = { ...moving.value, [key]: { current_step, completed_steps } };
  try {
    await onSession(session.id, (s) =>
      change("cooking_progress", {
        ...edit(s),
        dish_id: dish.dish_id,
        current_step,
        completed_steps,
      }),
    );
  } catch (error) {
    failed(error);
  } finally {
    const { [key]: _, ...rest } = moving.value;
    moving.value = rest;
  }
}

async function startTimer(session, label, seconds, dish, step) {
  readySound();
  try {
    await onSession(session.id, (s) =>
      change("cooking_timer", {
        ...edit(s),
        label,
        duration_seconds: seconds,
        ...(dish ? { dish_id: dish.dish_id, step_index: step } : {}),
      }),
    );
  } catch (error) {
    failed(error);
  }
}

async function stopTimer(session, timer) {
  try {
    await onSession(session.id, (s) =>
      change("cooking_timer", { ...edit(s), cancel_timer_id: timer.id }),
    );
  } catch (error) {
    failed(error);
  }
}

// The timers on the stove, counting down, and a way to start one of any
// length.
function Timers({ session }) {
  const timers = liveTimers(session);
  const now = useNow(timers.length > 0);
  const [minutes, setMinutes] = useState("");
  const start = (event) => {
    event.preventDefault();
    const m = Number(minutes);
    if (!(m > 0)) return;
    void startTimer(
      session,
      `${minutesLabel(m * 60)} timer`,
      Math.round(m * 60),
    );
    setMinutes("");
  };
  return (
    <section class="cook-card" aria-labelledby="timers">
      <h2 id="timers">Timers</h2>
      {timers.length > 0 && (
        <ul class="timers" role="list">
          {timers.map((t) => {
            const left = secondsLeft(t, now);
            return (
              <li key={t.id} class={`timer${left ? "" : " timer-done"}`}>
                <Icon icon={Timer} />
                <span class="timer-label">{t.label}</span>
                <span class="timer-clock" aria-hidden="true">
                  {left ? clock(left) : "Time’s up"}
                </span>
                <span class="sr-only">
                  {left ? `${minutesLabel(left)} left` : "Time’s up"}
                </span>
                <button
                  type="button"
                  class="btn btn-quiet btn-icon"
                  aria-label={`${left ? "Stop" : "Dismiss"} ${t.label}`}
                  onClick={() => stopTimer(session, t)}
                >
                  <Icon icon={X} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form class="quick-add" onSubmit={start}>
        <label for="timer-minutes" class="sr-only">
          Minutes
        </label>
        <input
          id="timer-minutes"
          class="input"
          type="number"
          inputMode="decimal"
          min="0.5"
          step="0.5"
          placeholder="Minutes"
          value={minutes}
          onInput={(event) => setMinutes(event.currentTarget.value)}
        />
        <button type="submit" class="btn">
          <Icon icon={Timer} />
          Start a timer
        </button>
      </form>
    </section>
  );
}

// The screen stays on while cooking, where the browser allows it.
function useWakeLock() {
  useEffect(() => {
    let lock = null;
    let gone = false;
    const take = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        lock = await navigator.wakeLock?.request("screen");
        if (gone) void lock?.release();
      } catch {
        lock = null;
      }
    };
    void take();
    document.addEventListener("visibilitychange", take);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
    };
  }, []);
}

function Step({ session, dish, onDone }) {
  const { current_step: at, completed_steps: done } = progressOf(
    session,
    dish.dish_id,
  );
  const steps = dish.steps;
  // Past the last step; a step picked from the list after that shows again.
  const finished =
    steps.length > 0 &&
    at === steps.length - 1 &&
    done.includes(steps.length - 1);
  const step = steps[at];
  const recipe = record("recipe", dish.recipe_id);
  const before = recipe ? memories(recipe) : [];
  const next = () =>
    goTo(
      session,
      dish,
      Math.min(at + 1, steps.length - 1),
      [...new Set([...done, at])].sort((a, b) => a - b),
    );
  const back = () =>
    finished
      ? goTo(
          session,
          dish,
          at,
          done.filter((i) => i !== at),
        )
      : goTo(session, dish, Math.max(0, at - 1), done);
  if (!steps.length)
    return (
      <section class="cook-step">
        <h1 tabIndex={-1} data-page-title>
          {dish.title}
        </h1>
        <p class="cook-text">No steps written down for this dish.</p>
        {onDone}
      </section>
    );
  return (
    <section class="cook-step" aria-labelledby="step-title">
      {session.data.dishes.length > 1 && <p class="eyebrow">{dish.title}</p>}
      <h1 id="step-title" tabIndex={-1} data-page-title>
        {finished ? "Every step done" : `Step ${at + 1} of ${steps.length}`}
      </h1>
      {at === 0 && !done.length && <LastTime notes={before} />}
      <div class="cook-text" aria-live="polite">
        {finished ? <p>That’s all of {dish.title}.</p> : <p>{step.text}</p>}
      </div>
      {!finished && step.duration_seconds && (
        <button
          type="button"
          class="btn"
          onClick={() =>
            startTimer(
              session,
              session.data.dishes.length > 1
                ? `${dish.title}, step ${at + 1}`
                : `Step ${at + 1}`,
              step.duration_seconds,
              dish,
              at,
            )
          }
        >
          <Icon icon={Timer} />
          Start a {minutesLabel(step.duration_seconds)} timer
        </button>
      )}
      <div class="cook-nav">
        <button
          type="button"
          class="btn btn-large"
          disabled={at === 0 && !finished}
          onClick={back}
        >
          <Icon icon={ChevronLeft} />
          Back
        </button>
        {finished ? (
          onDone
        ) : (
          <button
            type="button"
            class="btn btn-primary btn-large"
            onClick={next}
          >
            {at === steps.length - 1 ? "Done" : "Next"}
            <Icon icon={at === steps.length - 1 ? CircleCheck : ChevronRight} />
          </button>
        )}
      </div>
    </section>
  );
}

function AllSteps({ session, dish }) {
  const { current_step: at, completed_steps: done } = progressOf(
    session,
    dish.dish_id,
  );
  if (!dish.steps.length) return null;
  return (
    <details class="cook-card disclosure">
      <summary>
        <h2>All steps</h2>
        <span class="muted small">
          {done.length} of {dish.steps.length} done
        </span>
      </summary>
      <ol class="cook-steps">
        {dish.steps.map((s, index) => (
          <li
            key={index}
            class={done.includes(index) ? "cook-steps-done" : undefined}
          >
            <button
              type="button"
              class="cook-steps-jump"
              aria-current={index === at ? "step" : undefined}
              onClick={() => goTo(session, dish, index, done)}
            >
              <span class="cook-steps-number">
                {done.includes(index) ? (
                  <Icon icon={CircleCheck} class="icon-sm" />
                ) : (
                  index + 1
                )}
              </span>
              <span>{s.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Ingredients({ dish }) {
  if (!dish.ingredients.length) return null;
  return (
    <details class="cook-card disclosure" open>
      <summary>
        <h2>Ingredients</h2>
        <span class="muted small">
          {dish.servings ? `Serves ${dish.servings}` : ""}
        </span>
      </summary>
      <ul class="ingredients" role="list">
        {dish.ingredients.map((i, index) => (
          <li key={index}>
            <span class="ingredient-amount">{amount(i)}</span>
            <span>
              {i.name}
              {i.preparation && <span class="muted">, {i.preparation}</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Cooking, full screen: one step at a time in large type, a dish at a time
// for a meal, with its timers and ingredients beside it.
export function Cook({ id }) {
  const session = record("session", id);
  useWakeLock();
  const [dishId, setDishId] = useState(
    () => session?.data.dishes[0]?.dish_id ?? "",
  );
  if (!session || session.data.status !== "active")
    return (
      <main id="main" class="cook" tabIndex={-1}>
        <div class="cook-page">
          <Empty
            icon={CookingPot}
            heading="h1"
            title={
              session ? `${session.data.title} is done` : "Nothing on the stove"
            }
            action={
              <a class="btn btn-primary" href="#/week">
                Go to this week
              </a>
            }
          >
            {session
              ? "This cooking was finished. What you noted is with the recipe."
              : "It may have been finished on another device."}
          </Empty>
        </div>
      </main>
    );
  const dishes = session.data.dishes;
  const dish = dishes.find((d) => d.dish_id === dishId) ?? dishes[0];
  const doneWith = (d) => {
    const p = progressOf(session, d.dish_id);
    return !d.steps.length || p.completed_steps.includes(d.steps.length - 1);
  };
  const waiting = dishes.find((d) => d !== dish && !doneWith(d));
  const onDone = waiting ? (
    <button
      type="button"
      class="btn btn-primary btn-large"
      onClick={() => setDishId(waiting.dish_id)}
    >
      On to {waiting.title}
      <Icon icon={ChevronRight} />
    </button>
  ) : (
    <a
      class="btn btn-primary btn-large"
      href={`#/cook/${encodeURIComponent(id)}/done`}
    >
      <Icon icon={CircleCheck} />
      Finish cooking
    </a>
  );
  return (
    <main id="main" class="cook" tabIndex={-1}>
      <header class="cook-bar">
        <button
          type="button"
          class="btn btn-quiet btn-icon"
          aria-label="Leave the stove"
          onClick={() => leave(originOf(session))}
        >
          <Icon icon={X} />
        </button>
        <span class="cook-title">{session.data.title}</span>
        <a class="btn btn-small" href={`#/cook/${encodeURIComponent(id)}/done`}>
          Finish
        </a>
      </header>
      <div class="cook-page">
        {dishes.length > 1 && (
          <div class="chips" role="group" aria-label="Dishes">
            {dishes.map((d) => {
              const p = progressOf(session, d.dish_id);
              return (
                <button
                  key={d.dish_id}
                  type="button"
                  class="chip"
                  aria-pressed={d === dish ? "true" : "false"}
                  onClick={() => setDishId(d.dish_id)}
                >
                  {d.title}
                  <span class="chip-count">
                    {doneWith(d)
                      ? "done"
                      : `${p.current_step + 1}/${d.steps.length}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <Step
          key={dish.dish_id}
          session={session}
          dish={dish}
          onDone={onDone}
        />
        <div class="cook-side">
          <Timers session={session} />
          <Ingredients dish={dish} />
          <AllSteps session={session} dish={dish} />
        </div>
      </div>
    </main>
  );
}

// A batch is everything a dish made, and what was eaten tonight is recorded
// against it, so what is left shows on At home. Leftovers beyond what the
// recipe makes are kept on their own.
async function keepLeftovers(sessionId, dish, left, storage) {
  const day = localDay();
  if (!dish.servings || left > dish.servings) {
    await change("batch_create", {
      recipe_id: dish.recipe_id,
      portions: left,
      cooked_on: day,
      storage,
    });
    return;
  }
  const { record: batch } = await change("batch_create", {
    recipe_id: dish.recipe_id,
    portions: dish.servings,
    cooked_on: day,
    storage,
    session_id: sessionId,
    dish_id: dish.dish_id,
  });
  if (dish.servings > left)
    await change("batch_allocate", {
      id: batch.id,
      expected_version: batch.version,
      allocation: {
        portions: dish.servings - left,
        date: day,
        slot: slotNow(),
        storage,
        status: "eaten",
      },
    });
}

// After cooking: how it went and what to change, per dish, kept with the
// recipe; leftovers become a batch for At home; the stove is then cleared.
export function Finish({ id }) {
  const session = record("session", id);
  const dishes = session?.data.dishes ?? [];
  const [notes, setNotes] = useState(() =>
    Object.fromEntries(
      dishes.map((d) => [
        d.dish_id,
        { rating: null, next_time: "", text: "", left: "", storage: "fridge" },
      ]),
    ),
  );
  const { busy, error, run } = useWork();
  if (!session || session.data.status !== "active")
    return (
      <>
        <PageHeader title="Finish cooking" />
        <Empty
          icon={CookingPot}
          title="Nothing on the stove"
          action={
            <a class="btn btn-primary" href="#/week">
              Go to this week
            </a>
          }
        >
          This cooking was already finished.
        </Empty>
      </>
    );
  const set = (dishId, field, value) =>
    setNotes({ ...notes, [dishId]: { ...notes[dishId], [field]: value } });
  const today = localDay();
  const finish = (event) => {
    event.preventDefault();
    run(async () => {
      const cooked = dishes.filter((d) => record("recipe", d.recipe_id));
      for (const d of cooked) {
        const n = notes[d.dish_id];
        await change("note_save", {
          recipe_id: d.recipe_id,
          session_id: id,
          cooked_on: today,
          text: n.text.trim() || "Cooked.",
          ...(n.rating ? { rating: n.rating } : {}),
          ...(n.next_time.trim() ? { next_time: n.next_time.trim() } : {}),
        });
      }
      await onSession(id, (s) => change("cooking_finish", { ...edit(s) }));
      // Leftovers are kept only from finished cooking. A failure here leaves
      // the notes and the finished stove as they are.
      try {
        for (const d of cooked) {
          const left = numberOrNull(notes[d.dish_id].left);
          if (left) await keepLeftovers(id, d, left, notes[d.dish_id].storage);
        }
        toast(`${session.data.title} is done. Enjoy!`);
      } catch (error) {
        failed(error);
      }
      navigate(originOf(session), { replace: true });
    });
  };
  return (
    <>
      <a class="back" href={`#/cook/${encodeURIComponent(id)}`}>
        <Icon icon={ChevronLeft} />
        Back to the stove
      </a>
      <PageHeader eyebrow={session.data.title} title="How did it go?" />
      <p class="lede">
        What you note shows up on the recipe next time, and leftovers go to At
        home.
      </p>
      <form class="stack-lg" onSubmit={finish}>
        {dishes.map((d) => {
          const n = notes[d.dish_id];
          const f = (name) => `${d.dish_id}-${name}`;
          return (
            <fieldset key={d.dish_id} class="card stack">
              <legend class="card-legend">{d.title}</legend>
              <fieldset class="field">
                <legend>How was it?</legend>
                <div class="segmented rating">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <label key={r}>
                      <input
                        type="radio"
                        name={f("rating")}
                        checked={n.rating === r}
                        onChange={() => set(d.dish_id, "rating", r)}
                      />
                      {r}
                      <span class="sr-only"> of 5</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field
                id={f("next")}
                label="Next time"
                help="A change to try, or something to remember."
              >
                <textarea
                  id={f("next")}
                  class="input"
                  rows={2}
                  aria-describedby={`${f("next")}-hint`}
                  value={n.next_time}
                  onInput={(event) =>
                    set(d.dish_id, "next_time", event.currentTarget.value)
                  }
                />
              </Field>
              <Field id={f("text")} label="Notes">
                <textarea
                  id={f("text")}
                  class="input"
                  rows={2}
                  value={n.text}
                  onInput={(event) =>
                    set(d.dish_id, "text", event.currentTarget.value)
                  }
                />
              </Field>
              <div class="row">
                <Field id={f("left")} label="Portions left over">
                  <input
                    id={f("left")}
                    class="input input-short"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    value={n.left}
                    onInput={(event) =>
                      set(d.dish_id, "left", event.currentTarget.value)
                    }
                  />
                </Field>
                <fieldset class="field">
                  <legend>Kept in the</legend>
                  <div class="segmented">
                    {[
                      ["fridge", "Fridge"],
                      ["freezer", "Freezer"],
                    ].map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name={f("storage")}
                          checked={n.storage === value}
                          onChange={() => set(d.dish_id, "storage", value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </fieldset>
          );
        })}
        {error && <FormError>{error}</FormError>}
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={busy}>
            <Icon icon={CircleCheck} />
            Done cooking
          </button>
        </div>
      </form>
    </>
  );
}
