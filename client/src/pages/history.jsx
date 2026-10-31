import { useEffect, useState } from "preact/hooks";
import { History, Undo2 } from "lucide";
import { tool } from "../lib/api.js";
import { db, undoAction } from "../lib/store.js";
import { describe, undoQuestion } from "../lib/history.js";
import { dateLabel, localDay } from "../lib/format.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { FormError } from "../ui/form.jsx";
import { Icon } from "../ui/icon.jsx";
import { toHousehold } from "./household.jsx";

const PAGE = 30;
// "Today, 14:05", "Yesterday, 09:30" or "Oct 28, 18:00".
function when(moment) {
  const day = localDay(moment);
  const time = new Date(moment).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const yesterday = localDay(Date.now() - 24 * 60 * 60 * 1000);
  const date =
    day === localDay()
      ? "Today"
      : day === yesterday
        ? "Yesterday"
        : dateLabel(day);
  return `${date}, ${time}`;
}

// What changed in the kitchen, newest first, who changed it, and Undo for
// anything from the last 90 days. Taking back someone else's change asks
// first.
export function RecentChanges() {
  const [shown, setShown] = useState(PAGE);
  const [actions, setActions] = useState(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Read again whenever the kitchen changes, so others' changes arrive.
  useEffect(() => {
    let current = true;
    tool("history_list", { limit: Math.min(shown, 100) })
      .then(async (first) => {
        // More than one page is read a page at a time.
        let list = first.actions;
        while (list.length < shown && list.length % 100 === 0 && list.length)
          list = list.concat(
            (await tool("history_list", { limit: 100, offset: list.length }))
              .actions,
          );
        if (!current) return;
        setActions(list.slice(0, shown));
        setMore(list.length >= shown);
        setError("");
      })
      .catch((failure) => current && setError(failure.message));
    return () => {
      current = false;
    };
  }, [db.value, shown]);

  const undo = async (action) => {
    const question = undoQuestion(action.actor);
    if (question && !confirm(question)) return;
    setBusy(true);
    try {
      await undoAction(action.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="stack-lg page-narrow">
      {toHousehold}
      <PageHeader title="Recent changes" />
      <p class="lede">
        Everything changed in this kitchen, and who changed it. Changes from the
        last 90 days can be undone, unless something changed since.
      </p>
      <FormError>{error}</FormError>
      {actions === null ? (
        !error && <p class="muted">Loading changes…</p>
      ) : actions.length ? (
        <section class="card" aria-labelledby="changes">
          <h2 id="changes" class="sr-only">
            Changes, newest first
          </h2>
          <ul class="entries" role="list">
            {actions.map((action) => {
              const line = describe(action);
              return (
                <li key={action.id}>
                  <Icon icon={History} />
                  <div>
                    <strong>{line}</strong>
                    <p class="muted small">
                      <time dateTime={action.created_at}>
                        {when(action.created_at)}
                      </time>
                    </p>
                  </div>
                  {!action.trimmed && (
                    <button
                      type="button"
                      class="btn btn-quiet"
                      disabled={busy}
                      aria-label={`Undo: ${line}`}
                      onClick={() => void undo(action)}
                    >
                      <Icon icon={Undo2} />
                      Undo
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {more && (
            <div class="row">
              <button
                type="button"
                class="btn"
                onClick={() => setShown(shown + PAGE)}
              >
                Show older changes
              </button>
            </div>
          )}
        </section>
      ) : (
        <Empty icon={History} title="Nothing yet">
          Changes to recipes, the week and groceries show here, with who made
          them.
        </Empty>
      )}
    </div>
  );
}
