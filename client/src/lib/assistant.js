import { signal } from "@preact/signals";
import * as api from "./api.js";
import { change, record } from "./store.js";
import { onList } from "./groceries.js";
import { amount } from "./kitchen.js";
import { dateLabel, localDay, monday, weekdayLabel } from "./format.js";
import { navigate } from "./router.js";
import { toast } from "./toast.js";
import { fitting } from "../../../shared/conversation.js";

// The conversation with the assistant lives in this tab only: it goes when
// the tab closes or the member starts over. Each answer may carry
// proposals, which the member makes or leaves; nothing else changes the
// kitchen.
export const turns = signal([]);
// What the assistant is doing while it answers, or null.
export const working = signal(null);
let asking = null;

// An earlier answer as the assistant hears it again: its words, and what
// became of what it proposed.
const outcome = {
  open: "not done",
  done: "the member made it",
  opened: "the member opened it",
  skipped: "the member said no",
};
function heard(turn) {
  if (turn.role === "user") return { role: "user", text: turn.text };
  const said = turn.proposals.map(
    (p) => `${describe(p).title} (${outcome[p.state] ?? "not done"})`,
  );
  const text = said.length
    ? `${turn.text}\n\n[Proposed: ${said.join("; ")}]`
    : turn.text;
  return { role: "assistant", text: text.slice(0, 20000) };
}

export async function askAbout(text) {
  const before = turns.value;
  turns.value = [...before, { role: "user", text }];
  working.value = "Thinking";
  asking = new AbortController();
  try {
    const answer = await api.ask(
      { today: localDay(), messages: fitting(turns.value.map(heard)) },
      { signal: asking.signal, onStep: (step) => (working.value = step) },
    );
    turns.value = [
      ...turns.value,
      {
        role: "assistant",
        text: answer.reply,
        proposals: answer.proposals.map((p) => ({ ...p, state: "open" })),
      },
    ];
  } catch (error) {
    // An unanswered question leaves the conversation, back to the box.
    turns.value = before;
    throw error;
  } finally {
    working.value = null;
    asking = null;
  }
}

export const stopAsking = () => asking?.abort();

export function startOver() {
  stopAsking();
  turns.value = [];
}

const titleOf = (kind, id) => record(kind, id)?.data.title ?? null;
const groceryLine = (item) =>
  [amount(item), item.name].filter(Boolean).join(" ");

// What a proposal does, in the app's words, from its own fields and the
// kitchen's records: never from what the assistant wrote about it.
// { title, detail, items, gone } where gone means it can no longer be made.
export function describe({ type, input }) {
  if (type === "plan") {
    const title = titleOf(input.kind, input.id);
    return {
      title: `${title ?? "A recipe that’s gone"} on ${weekdayLabel(input.date)}, ${dateLabel(input.date)}`,
      detail: [input.slot, input.servings != null && `for ${input.servings}`]
        .filter(Boolean)
        .join(" · "),
      gone: !title,
    };
  }
  if (type === "groceries")
    return {
      title: `Add ${input.items.length === 1 ? "1 thing" : `${input.items.length} things`} to the groceries`,
      items: input.items.map(groceryLine),
    };
  if (type === "shop") {
    if (input.week)
      return {
        title: `Shop for the week of ${dateLabel(monday(input.week))}`,
        detail: "See what the planned days need and leave out what you have.",
      };
    const title = titleOf(input.kind, input.id);
    return {
      title: `Shop for ${title ?? "a recipe that’s gone"}`,
      detail: "See what it needs and leave out what you have.",
      gone: !title,
    };
  }
  return {
    title: `Save “${input.title}” as a draft`,
    detail: "You check and edit it before it joins your recipes.",
  };
}

export const verbs = {
  plan: "Plan it",
  groceries: "Add them",
  shop: "Choose what to buy",
  draft: "Save the draft",
};

function settle(turn, proposal, state) {
  turns.value = turns.value.map((t) =>
    t !== turn
      ? t
      : {
          ...t,
          proposals: t.proposals.map((p) =>
            p.id === proposal.id ? { ...p, state } : p,
          ),
        },
  );
}

export const skip = (turn, proposal) => settle(turn, proposal, "skipped");

// Make a proposal with the app's own actions. Each carries a request id of
// its own, so a repeated tap is made once and a new proposal is new.
export async function make(turn, proposal) {
  const { type, input } = proposal;
  const key = `ask-${proposal.id}`;
  if (type === "plan") {
    const title = titleOf(input.kind, input.id);
    await change(
      "plan_save",
      {
        request_id: key,
        source: {
          kind: input.kind,
          id: input.id,
          ...(input.servings != null ? { servings: input.servings } : {}),
        },
        date: input.date,
        slot: input.slot,
      },
      { done: `${title} is on ${weekdayLabel(input.date)}.` },
    );
    return settle(turn, proposal, "done");
  }
  if (type === "groceries") {
    for (const [index, item] of input.items.entries())
      await onList((list) =>
        change("shopping_manual_item", {
          request_id: `${key}-${index}`,
          id: list.id,
          expected_version: list.version,
          item,
        }),
      );
    toast(
      input.items.length === 1
        ? `${input.items[0].name} is on the grocery list.`
        : "They’re on the grocery list.",
    );
    return settle(turn, proposal, "done");
  }
  if (type === "shop") {
    settle(turn, proposal, "opened");
    return navigate(
      input.week
        ? `groceries/week/${monday(input.week)}`
        : `groceries/add/${input.kind}/${encodeURIComponent(input.id)}`,
    );
  }
  const { record: draft } = await change("recipe_import_text", {
    request_id: key,
    text: input.text,
  });
  settle(turn, proposal, "done");
  navigate(`recipes/draft/${encodeURIComponent(draft.id)}`);
}
