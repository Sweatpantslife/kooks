import { signal } from "@preact/signals";

// Routes live in the hash, so the app works from any address and the server
// never sees them: #/week, #/recipes, #/recipes/<id>, #/signin/<token>.
const read = () =>
  location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

export const route = signal(read());

// The tab a route belongs to, for the navigation's current item.
export const section = (parts) =>
  ({ recipes: "recipes", groceries: "groceries", household: "household" })[
    parts[0]
  ] ?? "week";

export const href = (...parts) =>
  `#/${parts.map((part) => encodeURIComponent(part)).join("/")}`;

// Where the tab is in its history: each entry this visit made has a position
// in history.state, and the address it showed. Pages that close themselves
// and pages that hold the person there both need to know the way back.
const visited = new Map();
let at = 0,
  here = "";
function mark() {
  // A link or a typed address makes a new entry without a position.
  if (typeof history.state?.kooks !== "number")
    history.replaceState({ ...history.state, kooks: at + 1 }, "");
  at = history.state.kooks;
  here = location.hash;
  visited.set(at, here);
}

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path.replace(/^#?\/?/, "")}`;
  if (replace) {
    history.replaceState(history.state, "", target);
    here = location.hash;
    visited.set(at, here);
    route.value = read();
  } else if (location.hash === target) route.value = read();
  else location.hash = target;
}

// Close a page that is done, such as an editor after saving: back to where
// the person came from when that is the place, so Back does not reopen it.
export function leave(path) {
  if (visited.get(at - 1) === `#/${path}`) history.back();
  else navigate(path, { replace: true });
}

// A page with unsaved work can hold the person there: before the address
// changes, it is asked whether leaving is fine.
let guard = null;
export function guardLeaving(ask) {
  guard = ask;
  return () => {
    if (guard === ask) guard = null;
  };
}

// Addresses from the previous app keep working: each of its sections maps
// onto the new one that took its place.
const legacy = {
  today: "week",
  plan: "week",
  capture: "recipes/add",
  imports: "recipes/add",
  library: "recipes",
  techniques: "recipes",
  inspiration: "recipes",
  meals: "recipes",
  "new-recipe": "recipes/new",
  shop: "groceries",
  pantry: "groceries",
  leftovers: "groceries",
  settings: "household",
  account: "household/signin",
};
// Its settings tabs each have a page of their own in Household, and so do
// the people and prices they opened.
const settings = {
  household: "people",
  prices: "prices",
  backup: "backup",
  preferences: "look",
  account: "signin",
};
// Ideas, techniques and books had sections of their own.
const library = {
  inspiration: "idea",
  techniques: "technique",
  library: "book",
};
const path = (parts) => parts.map(encodeURIComponent).join("/");
function moved([first, second, ...rest]) {
  if (first === "settings" && Object.hasOwn(settings, second))
    return path(["household", settings[second], ...rest]);
  if (Object.hasOwn(library, first) && second)
    return first === "inspiration" && second === "new"
      ? "recipes/add/idea"
      : path(["recipes", library[first], second, ...rest]);
  // Pages about one record keep it.
  const [third, fourth] = rest;
  if (first === "imports" && second) return path(["recipes", "draft", second]);
  if (first === "meals" && second) return path(["recipes", "meal", second]);
  if (first === "plan" && second === "meals" && third)
    return path(["recipes", "meal", third]);
  if (
    first === "shop" &&
    second === "review" &&
    (third === "recipe" || third === "meal") &&
    fourth
  )
    return path(["groceries", "add", third, fourth]);
  if (first === "recipes" && second === "new" && third === "inspiration")
    return fourth ? path(["recipes", "idea", fourth, "write"]) : "recipes";
  if (first === "recipes" && second && third === "variant")
    return path(["recipes", second, "variation"]);
  // Cooking notes are written when the cooking finishes.
  if (first === "recipes" && second && third === "memory")
    return path(["recipes", second]);
  return Object.hasOwn(legacy, first) ? legacy[first] : null;
}

export function startRouter() {
  const sync = () => {
    // Staying returns to the entry the page is on, whichever way the person
    // went; the page itself never changed.
    if (location.hash !== here && guard && !guard()) {
      const went = history.state?.kooks;
      const steps = typeof went === "number" ? at - went : -1;
      if (steps) history.go(steps);
      else history.replaceState(history.state, "", here);
      return;
    }
    mark();
    const parts = read();
    const to = moved(parts);
    if (to) navigate(to, { replace: true });
    else if ((parts[0] === "signin" || parts[0] === "cook") && !parts[1])
      navigate("week", { replace: true });
    else route.value = parts;
  };
  addEventListener("hashchange", sync);
  sync();
}
