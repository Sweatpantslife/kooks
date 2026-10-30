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

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path.replace(/^#?\/?/, "")}`;
  if (replace) {
    history.replaceState(history.state, "", target);
    route.value = read();
  } else if (location.hash === target) route.value = read();
  else location.hash = target;
}

// Addresses from the previous app keep working: each of its sections maps
// onto the new one that took its place.
const legacy = {
  today: "week",
  plan: "week",
  cook: "week",
  capture: "recipes",
  library: "recipes",
  techniques: "recipes",
  inspiration: "recipes",
  meals: "recipes",
  "new-recipe": "recipes",
  shop: "groceries",
  pantry: "groceries",
  leftovers: "groceries",
  settings: "household",
  account: "household",
};

export function startRouter() {
  const sync = () => {
    const parts = read();
    if (legacy[parts[0]]) navigate(legacy[parts[0]], { replace: true });
    else if (parts[0] === "signin" && !parts[1])
      navigate("week", { replace: true });
    else route.value = parts;
  };
  addEventListener("hashchange", sync);
  sync();
}
