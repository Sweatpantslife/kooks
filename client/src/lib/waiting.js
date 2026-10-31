import { canonicalQuantity, round } from "../../../shared/quantities.js";
import { plural } from "./format.js";

// The kinds of change a device keeps while the kitchen is out of reach, and
// what each does when the kitchen answers. Each is kept only where meeting
// changes made meanwhile cannot overwrite anyone: a tick sets one grocery's
// state, a grocery or a note is added beside what is there, and eating a
// leftover takes portions that are still free or is refused.
//
// For each kind:
// - next(entry, read) is the call to make now, against the kitchen as this
//   device last heard it: { tool, input }; null when nothing is left to do;
//   or { problem } when the kitchen as it is now cannot take the change.
//   read(kind, id) is that record, or undefined.
// - after(entry, call, result) is the entry once that call went in: null
//   when it is done, or the entry with what is left.
// - preview(view, entry) shows the change on the records meanwhile, each
//   row or record it adds or changes marked `waiting` with the entry's id.
// - describe(entry, read) names it for the list of what waits, with the page
//   it shows on.

const waitingId = (entry) => `waiting-${entry.id}`;

// The view with one record of a kind replaced by what `change` makes of it.
function withRecord(view, kind, id, change) {
  const list = view[kind];
  const index = list?.findIndex((r) => r.id === id) ?? -1;
  if (index < 0) return view;
  const next = list.slice();
  next[index] = change(list[index]);
  return { ...view, [kind]: next };
}

const listOf = (read, entry) => read("shopping", entry.input.list);
const versionOf = (record) => ({
  id: record.id,
  expected_version: record.version,
});

// The same sums the kitchen makes of a batch's portions.
function portionsOf(batch, allocations) {
  const total = (list) => round(list.reduce((n, a) => n + a.portions, 0));
  const allocated = total(allocations);
  const eaten = total(allocations.filter((a) => a.status === "eaten"));
  return {
    ...batch,
    data: { ...batch.data, allocations },
    available_portions: round(batch.data.portions - allocated),
    remaining_portions: round(batch.data.portions - eaten),
    reserved_portions: round(allocated - eaten),
    eaten_portions: eaten,
  };
}

export const kinds = {
  // Ticks on one list: { list, ticks: { [grocery id]: checked } }. A tick
  // only says "in the basket" or not, so the latest for each grocery is all
  // there is to keep, and it goes against whatever version the list has. A
  // grocery that changed meanwhile, such as one whose amount grew, is a new
  // grocery, and the tick on the old one is let go.
  ticks: {
    next(entry, read) {
      const list = listOf(read, entry);
      const on = new Set(list?.items.map((row) => row.id) ?? []);
      const { ticks } = entry.input;
      for (const checked of [true, false]) {
        const ids = Object.keys(ticks).filter(
          (id) => on.has(id) && ticks[id] === checked,
        );
        if (ids.length)
          return {
            tool: "shopping_check",
            input: { ...versionOf(list), item_ids: ids, checked },
          };
      }
      return null;
    },
    // A tick made since the call left stays.
    after(entry, call) {
      const ticks = { ...entry.input.ticks };
      for (const id of call.input.item_ids)
        if (ticks[id] === call.input.checked) delete ticks[id];
      return Object.keys(ticks).length
        ? { ...entry, input: { ...entry.input, ticks } }
        : null;
    },
    preview(view, entry) {
      const { ticks } = entry.input;
      return withRecord(view, "shopping", entry.input.list, (list) => ({
        ...list,
        items: list.items.map((row) =>
          Object.hasOwn(ticks, row.id)
            ? { ...row, checked: ticks[row.id] }
            : row,
        ),
      }));
    },
    describe(entry) {
      return {
        text: `${plural(Object.keys(entry.input.ticks).length, "tick")} on the grocery list`,
        href: "#/groceries",
      };
    },
  },

  // A grocery added by hand: { list, item, checked?, row? }. It joins the
  // list as it is when it arrives. Ticked while it waits, it is ticked once
  // it is on the list, in whichever row the kitchen put it.
  grocery: {
    next(entry, read) {
      const list = listOf(read, entry);
      if (!list)
        return {
          problem: "The grocery list it was for is no longer in the kitchen.",
        };
      const { item, checked, row } = entry.input;
      if (!row)
        return {
          tool: "shopping_manual_item",
          input: { ...versionOf(list), item },
        };
      if (!checked || !list.items.some((r) => r.id === row)) return null;
      return {
        tool: "shopping_check",
        input: { ...versionOf(list), item_ids: [row], checked: true },
      };
    },
    after(entry, call, result) {
      if (call.tool !== "shopping_manual_item" || !entry.input.checked)
        return null;
      const row = result?.items?.find((r) =>
        r.contributions.some((c) => c.contribution_id === result.item_id),
      );
      return row ? { ...entry, input: { ...entry.input, row: row.id } } : null;
    },
    preview(view, entry) {
      const { item, checked, row: added } = entry.input;
      return withRecord(view, "shopping", entry.input.list, (list) => {
        if (added)
          return {
            ...list,
            items: list.items.map((r) =>
              r.id === added ? { ...r, checked: Boolean(checked) } : r,
            ),
          };
        const id = waitingId(entry);
        const { quantity, unit } = canonicalQuantity(
          item.quantity ?? null,
          item.unit ?? "",
        );
        const row = {
          id,
          name: item.name,
          preparation: item.preparation ?? null,
          category: item.category,
          quantity,
          unit: unit || null,
          checked: Boolean(checked),
          contributions: [
            {
              ...item,
              contribution_id: id,
              source_key: "manual",
              recipe_id: null,
              recipe_title: null,
            },
          ],
          waiting: entry.id,
        };
        return { ...list, items: [...list.items, row] };
      });
    },
    describe(entry) {
      const { item } = entry.input;
      return {
        text: `Add ${item.original_text || item.name} to the grocery list`,
        href: "#/groceries",
      };
    },
  },

  // Leftovers eaten: { batch, title, portions, all, date, slot, storage }.
  // "All gone" eats whatever is free when it arrives; a number of portions
  // is refused if fewer are free by then.
  eaten: {
    next(entry, read) {
      const { batch: id, title, all, date, slot, storage } = entry.input;
      const batch = read("batch", id);
      if (!batch)
        return { problem: `${title} is no longer among the leftovers.` };
      const free = batch.available_portions;
      if (all && free <= 0) return null;
      const portions = all ? free : entry.input.portions;
      if (portions > free)
        return {
          problem:
            free > 0
              ? `Only ${plural(free, "portion")} of ${title} ${free === 1 ? "was" : "were"} left when this arrived.`
              : `No portion of ${title} was left when this arrived.`,
        };
      return {
        tool: "batch_allocate",
        input: {
          ...versionOf(batch),
          allocation: { portions, date, slot, storage, status: "eaten" },
        },
      };
    },
    after: () => null,
    preview(view, entry) {
      const { batch: id, all, date, slot, storage } = entry.input;
      return withRecord(view, "batch", id, (batch) => {
        const portions = all ? batch.available_portions : entry.input.portions;
        if (portions <= 0) return batch;
        return {
          ...portionsOf(batch, [
            ...batch.data.allocations,
            {
              id: waitingId(entry),
              portions,
              date,
              slot,
              storage,
              status: "eaten",
            },
          ]),
          waiting: entry.id,
        };
      });
    },
    describe(entry) {
      const { title, all, portions } = entry.input;
      return {
        text: all
          ? `${title} is all gone`
          : `Ate ${portions === 1 ? "a portion" : plural(portions, "portion")} of ${title}`,
        href: "#/groceries/home",
      };
    },
  },

  // A note about cooking a recipe: note_save's input. A note is a record of
  // its own, so there is nothing for it to meet.
  note: {
    next: (entry) => ({ tool: "note_save", input: entry.input }),
    after: () => null,
    preview(view, entry) {
      const { request_id: _, ...data } = entry.input;
      const at = new Date(entry.made_at).toISOString();
      const note = {
        id: waitingId(entry),
        version: 0,
        archived: false,
        created_at: at,
        updated_at: at,
        data: { session_id: null, cooked_on: null, ...data },
        waiting: entry.id,
      };
      return { ...view, note: [...(view.note ?? []), note] };
    },
    describe(entry, read) {
      const { recipe_id } = entry.input;
      const title = read("recipe", recipe_id)?.data.title;
      return {
        text: title ? `A note on ${title}` : "A cooking note",
        href: `#/recipes/${encodeURIComponent(recipe_id)}`,
      };
    },
  },
};

// How many changes an entry holds: a list's ticks count one by one.
export const sizeOf = (entry) =>
  entry.kind === "ticks" ? Object.keys(entry.input.ticks).length : 1;

// The records as they will be once what waits has gone in. Changes the
// kitchen would not take are left out until the member decides.
export function withWaiting(records, entries) {
  let view = records;
  for (const entry of entries)
    if (!entry.problem) view = kinds[entry.kind]?.preview(view, entry) ?? view;
  return view;
}
