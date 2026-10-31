import { CloudCheck } from "lucide";
import { offline, record, sendNow, waitingHere } from "../lib/store.js";
import { discard, retry } from "../lib/outbox.js";
import { kinds, needsChoice } from "../lib/waiting.js";
import { localDay, pastDayLabel } from "../lib/format.js";
import { toast } from "../lib/toast.js";
import { phone } from "../lib/device.js";
import { passFocus } from "../ui/focus.js";
import { Empty, PageHeader } from "../ui/page.jsx";

// When a change was made: the time today, the day before that.
function madeAt(ms) {
  const when = new Date(ms);
  const time = when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = localDay(when);
  return day === localDay() ? time : `${pastDayLabel(day)}, ${time}`;
}

// Everything made on this device that the kitchen has not taken yet, in the
// order it will go, with why the kitchen would not take any it refused. Any
// of them can be discarded, so it is never sent.
export function WaitingList() {
  const entries = waitingHere.value;
  const away = offline.value !== null;
  const read = (kind, id) => record(kind, id);
  const forget = (event, entry, text) => {
    passFocus(event.currentTarget, "main h1");
    const back = discard(entry.id);
    toast(`Discarded: ${text}.`, { undo: back });
  };
  const again = (entry) => {
    retry(entry.id);
    void sendNow();
  };
  return (
    <div class="stack-lg page-narrow">
      <PageHeader
        eyebrow={
          away
            ? "Can’t reach the kitchen"
            : `Made on this ${phone ? "phone" : "browser"}`
        }
        title="Waiting to send"
      />
      {entries.length === 0 ? (
        <Empty icon={CloudCheck} title="Nothing waiting">
          Everything made here is in the kitchen.
        </Empty>
      ) : (
        <>
          <p class="lede">
            {away
              ? "These go to the kitchen, in this order, as soon as it answers."
              : "These go to the kitchen, in this order."}
          </p>
          <ul class="plan-items card" role="list" data-rows="waiting">
            {entries.map((entry) => {
              const { text, href } = kinds[entry.kind].describe(entry, read);
              const problem = entry.problem?.message;
              return (
                <li key={entry.id} class="plan-item">
                  <span class="plan-text">
                    <a class="plan-title" href={href}>
                      {text}
                    </a>
                    <span class="muted small">
                      {`Made ${madeAt(entry.made_at)} · `}
                      {needsChoice(entry)
                        ? "Needs your choice"
                        : problem
                          ? "The kitchen didn’t take it"
                          : "Waiting to send"}
                    </span>
                    {problem && <span class="waiting-problem">{problem}</span>}
                  </span>
                  <span class="plan-actions">
                    {needsChoice(entry) && (
                      <a
                        class="btn btn-small btn-primary"
                        href={`#/waiting/${encodeURIComponent(entry.id)}`}
                        aria-label={`Choose what to keep, ${text}`}
                      >
                        Choose what to keep
                      </a>
                    )}
                    {problem && !away && !needsChoice(entry) && (
                      <button
                        type="button"
                        class="btn btn-quiet btn-small"
                        onClick={() => again(entry)}
                        aria-label={`Try again, ${text}`}
                      >
                        Try again
                      </button>
                    )}
                    <button
                      type="button"
                      class="btn btn-quiet btn-small"
                      data-row="discard"
                      onClick={(event) => forget(event, entry, text)}
                      aria-label={`Discard, ${text}`}
                    >
                      Discard
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {entries.length > 0 && (
        <p class="muted small">Signing out lets everything here go.</p>
      )}
    </div>
  );
}
