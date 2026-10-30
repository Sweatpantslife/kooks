import { Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CircleAlert, Leaf } from "lucide";
import { route } from "./lib/router.js";
import { dateLabel, monday, weekdayLabel } from "./lib/format.js";
import { status, loadError, refresh, record } from "./lib/store.js";
import { Shell } from "./ui/shell.jsx";
import { Toasts } from "./ui/toast.jsx";
import { Empty, PageHeader } from "./ui/page.jsx";
import { SignIn } from "./pages/signin.jsx";
import { Household } from "./pages/household.jsx";
import { Groceries } from "./pages/placeholders.jsx";
import { AddToDay, ChooseDay, Week } from "./pages/week.jsx";
import { Recipes } from "./pages/recipes.jsx";
import { Recipe } from "./pages/recipe.jsx";
import { Meal } from "./pages/meal.jsx";
import { Add, Idea, Paste, Photo } from "./pages/add.jsx";
import { Editor } from "./pages/editor.jsx";

const named = (kind, id, fallback) => record(kind, id)?.data.title ?? fallback;

const ADD = {
  "": ["Add to your cookbook", Add],
  paste: ["Paste a recipe", Paste],
  photo: ["Photograph a recipe", Photo],
  idea: ["Save an idea", Idea],
};
const EDIT = {
  edit: "Edit recipe",
  variation: "Your own version",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const planned = (id) => record("plan", id)?.data.title ?? "Plan";

// The page for an address, and the title the browser tab shows for it.
function pageFor([first = "week", second, third, fourth]) {
  if (first === "week" && !second)
    return { title: "This week", page: <Week /> };
  if (first === "week" && DAY.test(second) && !third)
    return {
      title: `Week of ${dateLabel(monday(second))}`,
      page: <Week start={monday(second)} />,
    };
  if (first === "week" && second === "add" && DAY.test(third) && !fourth)
    return {
      title: `Add to ${weekdayLabel(third)}`,
      page: <AddToDay day={third} />,
    };
  if (
    first === "week" &&
    second === "when" &&
    (third === "recipe" || third === "meal") &&
    fourth
  )
    return {
      title: `Which day · ${named(third, fourth, "Plan")}`,
      page: <ChooseDay kind={third} id={fourth} />,
    };
  if (first === "week" && second === "move" && third && !fourth)
    return {
      title: `Move · ${planned(third)}`,
      page: <ChooseDay planId={third} />,
    };
  if (first === "recipes" && second === "add" && !fourth && ADD[third ?? ""]) {
    const [title, Page] = ADD[third ?? ""];
    return { title, page: <Page /> };
  }
  if (first === "recipes" && second === "new" && !third)
    return { title: "New recipe", page: <Editor mode="new" /> };
  if (first === "recipes" && second === "draft" && third && !fourth)
    return {
      title: "Check the draft",
      page: <Editor mode="draft" id={third} />,
    };
  if (first === "recipes" && second === "meal" && third && !fourth)
    return { title: named("meal", third, "Meal"), page: <Meal id={third} /> };
  if (first === "recipes" && second && EDIT[third] && !fourth)
    return {
      title: `${EDIT[third]} · ${named("recipe", second, "Recipe")}`,
      page: <Editor mode={third} id={second} />,
    };
  if (first === "recipes" && second && !third)
    return {
      title: named("recipe", second, "Recipe"),
      page: <Recipe id={second} />,
    };
  if (first === "recipes" && !second)
    return { title: "Recipes", page: <Recipes /> };
  if (first === "groceries") return { title: "Groceries", page: <Groceries /> };
  if (first === "household") return { title: "Household", page: <Household /> };
  return { title: "Not found", page: <NotFound /> };
}

function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <Empty
        icon={Leaf}
        title="That page isn’t in the kitchen."
        action={
          <a class="btn btn-primary" href="#/week">
            Go to this week
          </a>
        }
      />
    </>
  );
}

function Kitchen() {
  const { title, page } = pageFor(route.value);
  const key = route.value.join("/");
  const shown = useRef(null);

  // A new page scrolls to the top and puts focus on its title, so keyboard
  // and screen-reader users start there instead of on a link that is gone.
  useEffect(() => {
    if (shown.current !== null) {
      scrollTo(0, 0);
      (
        document.querySelector("[data-page-title]") ??
        document.getElementById("main")
      )?.focus({ preventScroll: true });
    }
    shown.current = key;
  }, [key]);
  useEffect(() => {
    document.title = `${title} · Kooks`;
  }, [title]);

  // Keyed by address, so one recipe's servings never carry over to the next.
  return (
    <Shell>
      <Fragment key={key}>{page}</Fragment>
    </Shell>
  );
}

function Unavailable() {
  useEffect(() => {
    document.title = "Kooks";
  }, []);
  return (
    <main id="main" class="signin" tabIndex={-1}>
      <div class="signin-card">
        <Empty
          icon={CircleAlert}
          heading="h1"
          title="The kitchen didn’t open"
          action={
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => {
                status.value = "loading";
                void refresh();
              }}
            >
              Try again
            </button>
          }
        >
          {loadError.value}
        </Empty>
      </div>
    </main>
  );
}

export function App() {
  return (
    <>
      {status.value === "ready" ? (
        <Kitchen />
      ) : status.value === "signin" ? (
        <SignIn />
      ) : status.value === "error" ? (
        <Unavailable />
      ) : (
        <main id="main" class="loading" tabIndex={-1}>
          Opening your kitchen…
        </main>
      )}
      <Toasts />
    </>
  );
}
