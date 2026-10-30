import { useEffect, useRef, useState } from "preact/hooks";
import {
  CalendarPlus,
  Check,
  NotebookPen,
  RotateCcw,
  ShoppingBasket,
  Sparkles,
  Square,
} from "lucide";
import { Icon } from "../ui/icon.jsx";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Field, FormError, hint } from "../ui/form.jsx";
import { toast } from "../lib/toast.js";
import { assistant } from "../lib/store.js";
import {
  askAbout,
  describe,
  make,
  skip,
  startOver,
  stopAsking,
  turns,
  verbs,
  working,
} from "../lib/assistant.js";

const STARTERS = [
  "What can we make tonight?",
  "Plan dinners for the week",
  "What do we need to buy?",
  "Something new to try",
];

// The assistant's words, as text: paragraphs, with lines that start "- " or
// "1. " as lists. Nothing it writes becomes a link or markup.
const bullet = /^[-•*]\s+/;
const numbered = /^\d+[.)]\s+/;
function Reply({ text }) {
  const groups = [];
  for (const line of text.replace(/\*\*(.+?)\*\*/g, "$1").split("\n")) {
    const trimmed = line.trim();
    const kind = !trimmed
      ? "gap"
      : bullet.test(trimmed)
        ? "ul"
        : numbered.test(trimmed)
          ? "ol"
          : "p";
    const last = groups.at(-1);
    if (kind === "gap") groups.push({ kind, lines: [] });
    else if (last?.kind === kind) last.lines.push(trimmed);
    else groups.push({ kind, lines: [trimmed] });
  }
  return groups.map(({ kind, lines }, i) => {
    if (kind === "gap") return null;
    if (kind === "p")
      return (
        <p key={i} class="preline">
          {lines.join("\n")}
        </p>
      );
    const List = kind;
    const mark = kind === "ul" ? bullet : numbered;
    return (
      <List key={i}>
        {lines.map((line, j) => (
          <li key={j}>{line.replace(mark, "")}</li>
        ))}
      </List>
    );
  });
}

const ICONS = {
  plan: CalendarPlus,
  groceries: ShoppingBasket,
  shop: ShoppingBasket,
  draft: NotebookPen,
};
const SETTLED = {
  done: "Done",
  opened: "Opened",
  skipped: "Not this time",
};

// A change the assistant suggests: what it does, from the kitchen's own
// records, and the member's choice.
function Proposal({ turn, proposal }) {
  const [busy, setBusy] = useState(false);
  const { title, detail, items, gone } = describe(proposal);
  const named = `proposal-${proposal.id}`;
  const act = async () => {
    setBusy(true);
    try {
      await make(turn, proposal);
    } catch (error) {
      toast(error.message, { error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li class="proposal">
      <span class="proposal-icon">
        <Icon icon={ICONS[proposal.type]} />
      </span>
      <div class="proposal-body">
        <p class="proposal-title" id={named}>
          {title}
        </p>
        {detail && <p class="muted small">{detail}</p>}
        {items && (
          <ul class="proposal-items">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
        {proposal.state === "open" ? (
          <div class="row">
            <button
              type="button"
              class="btn btn-primary btn-small"
              disabled={busy || gone}
              aria-describedby={named}
              onClick={act}
            >
              {verbs[proposal.type]}
            </button>
            <button
              type="button"
              class="btn btn-quiet btn-small"
              disabled={busy}
              aria-describedby={named}
              onClick={() => skip(turn, proposal)}
            >
              No thanks
            </button>
          </div>
        ) : (
          <p
            class={`proposal-state ${proposal.state === "skipped" ? "muted" : "proposal-done"}`}
          >
            {proposal.state !== "skipped" && <Icon icon={Check} />}
            {SETTLED[proposal.state]}
          </p>
        )}
      </div>
    </li>
  );
}

function Turn({ turn }) {
  if (turn.role === "user")
    return (
      <li class="turn turn-you">
        <p class="turn-who">You</p>
        <p class="preline">{turn.text}</p>
      </li>
    );
  return (
    <li class="turn turn-kooks">
      <p class="turn-who">
        <Icon icon={Sparkles} />
        Kooks assistant
      </p>
      <Reply text={turn.text} />
      {turn.proposals.length > 0 && (
        <ul class="proposals" aria-label="Suggested changes">
          {turn.proposals.map((proposal) => (
            <Proposal key={proposal.id} turn={turn} proposal={proposal} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Ask() {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const box = useRef(null);
  const latest = useRef(null);
  const count = turns.value.length;
  // A new answer comes into view from its start.
  useEffect(() => {
    if (turns.value.at(-1)?.role === "assistant")
      latest.current?.lastElementChild?.scrollIntoView({ block: "start" });
  }, [count]);
  const submit = async (event, asked = text) => {
    event?.preventDefault();
    const question = asked.trim();
    if (!question || working.value) return;
    setText("");
    setError("");
    try {
      await askAbout(question);
    } catch (failure) {
      setText(question);
      if (failure.code !== "STOPPED") setError(failure.message);
    }
  };
  const keys = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing)
      void submit(event);
  };
  if (!assistant.value)
    return (
      <div class="stack-lg page-narrow">
        <PageHeader title="Ask Kooks" />
        <Empty icon={Sparkles} title="The assistant isn’t set up here">
          Whoever runs this kitchen can turn it on with a Claude API key. The
          hosting guide says how.
        </Empty>
      </div>
    );
  return (
    <div class="stack-lg page-narrow ask">
      <PageHeader title="Ask Kooks">
        {count > 0 && (
          <button
            type="button"
            class="btn btn-quiet"
            onClick={() => {
              startOver();
              setError("");
              box.current?.focus();
            }}
          >
            <Icon icon={RotateCcw} />
            Start over
          </button>
        )}
      </PageHeader>
      {count === 0 ? (
        <section class="stack" aria-label="Ideas to ask">
          <p class="lede">
            Ask about your recipes, the week or the groceries. Kooks can suggest
            changes, and nothing changes until you say so.
          </p>
          <div class="chips">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                class="chip"
                onClick={() => submit(null, starter)}
              >
                {starter}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <ol class="turns" ref={latest}>
          {turns.value.map((turn, i) => (
            <Turn key={i} turn={turn} />
          ))}
        </ol>
      )}
      <p role="status" class="ask-status">
        {working.value && (
          <>
            <Icon icon={Sparkles} class="ask-pulse" />
            {working.value}…
          </>
        )}
      </p>
      {error && <FormError>{error}</FormError>}
      <form class="ask-form" onSubmit={submit}>
        <Field
          id="ask-text"
          label="Your question"
          help="Your question, and the recipes and household details Kooks reads to answer it, go to Anthropic’s Claude."
        >
          <textarea
            id="ask-text"
            ref={box}
            class="input"
            rows={2}
            maxLength={4000}
            value={text}
            aria-describedby={hint("ask-text")}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={keys}
          />
        </Field>
        <div class="row">
          {working.value ? (
            <button type="button" class="btn" onClick={stopAsking}>
              <Icon icon={Square} />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              class="btn btn-primary"
              disabled={!text.trim()}
            >
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
