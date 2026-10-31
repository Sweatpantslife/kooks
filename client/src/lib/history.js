// The kitchen's history as the app tells it: who made each change, in the
// household's words, and what it did. The server names members by their
// person at the table, never by address, and says which changes were yours.

// Who made a change, as the start of a sentence, or "" for a change from
// before Kooks kept it.
export function whoDid(actor) {
  if (!actor) return "";
  if (actor.you) return "You";
  if (actor.type === "agent") return "An agent";
  if (actor.type === "local") return "This computer";
  return actor.name || "A member";
}

// The question Undo asks before taking back someone else's change; null for
// a change of your own, which Undo takes back at once.
export function undoQuestion(actor) {
  if (actor?.you) return null;
  if (actor?.type === "member" && actor.name)
    return `Undo ${actor.name}’s change?`;
  if (actor?.type === "member") return "Undo this member’s change?";
  if (actor?.type === "agent") return "Undo the agent’s change?";
  return "Undo this change?";
}

const created = (change) => change?.before_version == null;
// What each tool did, for something new and for a change: "{}" is where the
// record's name goes, and a line without one ends with it.
const VERBS = {
  recipe_save: ["added", "edited"],
  meal_save: ["added the meal", "edited the meal"],
  plan_save: ["planned", "changed the plan for"],
  equipment_save: ["added", "changed"],
  member_save: ["added {} to the table", "changed {}’s tastes"],
  pantry_save: ["noted {} at home", "changed {} at home"],
  price_save: ["noted the price of", "changed the price of"],
  technique_save: ["added the technique", "edited the technique"],
  inspiration_save: ["saved the idea", "changed the idea"],
  book_save: ["added the book", "edited the book"],
};
const FIXED = {
  note_save: "wrote a cooking note",
  shopping_create: "started a grocery list",
  shopping_sync: "added to the groceries",
  shopping_remove_source: "took a dish off the groceries",
  shopping_manual_item: "changed the groceries",
  shopping_check: "ticked groceries",
  cooking_start: "started cooking",
  cooking_progress: "moved on with",
  cooking_timer: "changed a timer for",
  cooking_finish: "finished cooking",
  cooking_task_save: "changed the jobs for",
  recipe_variant_save: "made their own version of",
  batch_create: "put away leftovers of",
  batch_allocate: "set aside leftovers of",
  budget_save: "set the weekly budget",
  recipe_import_text: "made a draft from pasted text:",
  recipe_import_image: "made a draft from a photo:",
  recipe_import_link: "made a draft from a link:",
  recipe_import_commit: "added {} from a draft",
  asset_save: "added a photo or file",
  backup_restore: "restored a backup",
  history_undo: "undid a change to",
};
// The record a line is about, by kind, when a tool changes several; null
// for a line that names none.
const SUBJECT = {
  recipe_import_commit: "recipe",
  recipe_variant_save: "recipe",
  cooking_finish: "session",
  batch_create: "batch",
  note_save: null,
  shopping_create: null,
  shopping_sync: null,
  shopping_remove_source: null,
  shopping_manual_item: null,
  shopping_check: null,
  budget_save: null,
  asset_save: null,
  backup_restore: null,
};

// What a change did, after who made it: "edited Chickpea stew".
export function whatDone(action) {
  const changes = action.changes ?? [];
  const kind = SUBJECT[action.action];
  const subject =
    kind === null
      ? null
      : (changes.find((change) => change.kind === kind) ?? changes[0]);
  let verb;
  if (action.action === "record_archive")
    verb = subject?.archived ? "removed" : "brought back";
  else if (VERBS[action.action])
    verb = VERBS[action.action][created(subject) ? 0 : 1];
  else verb = FIXED[action.action] ?? "changed";
  const title = subject?.title;
  if (verb.includes("{}"))
    return verb.replace(
      "{}",
      title ?? (action.action === "member_save" ? "someone" : "something"),
    );
  return title
    ? `${verb} ${title}`
    : verb.replace(/ (of|for|to|with):?$|:$/, "");
}

// The whole line: "Sam edited Chickpea stew", or "Edited Chickpea stew" for
// a change from before Kooks kept who made it.
export function describe(action) {
  const who = whoDid(action.actor);
  const what = whatDone(action);
  return who ? `${who} ${what}` : what[0].toUpperCase() + what.slice(1);
}
