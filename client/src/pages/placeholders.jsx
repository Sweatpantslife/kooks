import { CalendarDays, BookOpen, ShoppingBasket } from "lucide";
import { records } from "../lib/store.js";
import { monday, weekLabel, plural } from "../lib/format.js";
import { PageHeader, Empty } from "../ui/page.jsx";

// The three tabs as they stand while each is rebuilt. Each says plainly what
// is coming and where to do the work until then.
const current = (path, label) => (
  <a class="btn btn-primary" href={`../#/${path}`}>
    {label}
  </a>
);

export function Week() {
  return (
    <>
      <PageHeader eyebrow={weekLabel(monday())} title="This week" />
      <Empty
        icon={CalendarDays}
        title="Your week will live here"
        action={current("plan", "Plan in the current app")}
      >
        What’s for dinner tonight, the meals planned for the week, and what is
        cooking right now, on one page.
      </Empty>
    </>
  );
}

export function Recipes() {
  const n = records("recipe").length;
  return (
    <>
      <PageHeader eyebrow={plural(n, "recipe")} title="Recipes" />
      <Empty
        icon={BookOpen}
        title="Your cookbook is moving in"
        action={current("recipes", "Open recipes in the current app")}
      >
        Recipes, meals, ideas to try, techniques and books, searchable from one
        place.
      </Empty>
    </>
  );
}

export function Groceries() {
  return (
    <>
      <PageHeader eyebrow="To buy and at home" title="Groceries" />
      <Empty
        icon={ShoppingBasket}
        title="One list for the shop and the fridge"
        action={current("shop", "Open the list in the current app")}
      >
        What to buy, sorted by aisle, and what is already at home, so nothing is
        bought twice.
      </Empty>
    </>
  );
}
