import { Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CircleAlert, Leaf } from "lucide";
import { route } from "./lib/router.js";
import { dateLabel, monday, weekdayLabel } from "./lib/format.js";
import {
  appLink,
  invitation,
  loadError,
  record,
  refresh,
  status,
} from "./lib/store.js";
import { Shell } from "./ui/shell.jsx";
import { Toasts } from "./ui/toast.jsx";
import { Empty, PageHeader } from "./ui/page.jsx";
import { SignIn } from "./pages/signin.jsx";
import { ApproveApp, JoinInvite, Welcome } from "./pages/welcome.jsx";
import {
  Account,
  Backup,
  Household,
  Look,
  Members,
} from "./pages/household.jsx";
import { People, PersonForm } from "./pages/people.jsx";
import { RecentChanges } from "./pages/history.jsx";
import { PriceForm, Prices } from "./pages/prices.jsx";
import { AtHome, Groceries, PutAway, ShopFor } from "./pages/groceries.jsx";
import { AddToDay, ChooseDay, Week } from "./pages/week.jsx";
import { Recipes } from "./pages/recipes.jsx";
import { Recipe } from "./pages/recipe.jsx";
import { Meal, MealForm } from "./pages/meal.jsx";
import { NoteForm } from "./pages/note.jsx";
import { Add, FromLink, Idea, Paste, Photo } from "./pages/add.jsx";
import { Editor } from "./pages/editor.jsx";
import {
  BookForm,
  BookPage,
  IdeaForm,
  IdeaPage,
  TechniqueForm,
  TechniquePage,
} from "./pages/library.jsx";
import { Cook, Finish } from "./pages/cook.jsx";
import { Ask } from "./pages/ask.jsx";
import { WaitingList } from "./pages/waiting.jsx";
import { watchTimers } from "./lib/cooking.js";

const named = (kind, id, fallback) => record(kind, id)?.data.title ?? fallback;

const ADD = {
  "": ["Add to your cookbook", Add],
  link: ["Add from a link", FromLink],
  paste: ["Paste a recipe", Paste],
  photo: ["Photograph a recipe", Photo],
  idea: ["Save an idea", Idea],
};
const EDIT = {
  edit: "Edit recipe",
  variation: "Your own version",
};

// Ideas, techniques and books: the page, and the form that adds or edits.
// An idea is added from the Add page.
const LIBRARY = {
  idea: ["inspiration", IdeaPage, IdeaForm],
  technique: ["technique", TechniquePage, TechniqueForm],
  book: ["book", BookPage, BookForm],
};

const HOUSEHOLD = {
  members: ["Members", Members],
  people: ["People at the table", People],
  history: ["Recent changes", RecentChanges],
  prices: ["Prices and budget", Prices],
  look: ["Look and units", Look],
  signin: ["Sign-in", Account],
  backup: ["Backup", Backup],
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
  if (first === "recipes" && second === "meal" && third === "new" && !fourth)
    return { title: "New meal", page: <MealForm key="new" id="new" /> };
  if (first === "recipes" && second === "meal" && third && !fourth)
    return { title: named("meal", third, "Meal"), page: <Meal id={third} /> };
  if (first === "recipes" && second === "meal" && third && fourth === "edit")
    return {
      title: `Edit · ${named("meal", third, "Meal")}`,
      page: <MealForm key={third} id={third} />,
    };
  if (first === "recipes" && Object.hasOwn(LIBRARY, second) && third) {
    const [kind, Page, Form] = LIBRARY[second];
    const name = named(kind, third, "Not found");
    if (third === "new" && second !== "idea" && !fourth)
      return { title: `New ${second}`, page: <Form key="new" id="new" /> };
    if (!fourth) return { title: name, page: <Page id={third} /> };
    if (fourth === "edit")
      return { title: `Edit · ${name}`, page: <Form key={third} id={third} /> };
    if (second === "idea" && fourth === "write")
      return {
        title: `Write up · ${name}`,
        page: <Editor mode="idea" id={third} />,
      };
  }
  if (first === "recipes" && second && EDIT[third] && !fourth)
    return {
      title: `${EDIT[third]} · ${named("recipe", second, "Recipe")}`,
      page: <Editor mode={third} id={second} />,
    };
  if (first === "recipes" && second && third === "note" && !fourth)
    return {
      title: `Add a note · ${named("recipe", second, "Recipe")}`,
      page: <NoteForm key={second} id={second} />,
    };
  if (first === "recipes" && second && !third)
    return {
      title: named("recipe", second, "Recipe"),
      page: <Recipe id={second} />,
    };
  if (first === "recipes" && !second)
    return { title: "Recipes", page: <Recipes /> };
  if (first === "groceries" && !second)
    return { title: "To buy", page: <Groceries /> };
  if (first === "groceries" && second === "home" && !third)
    return { title: "At home", page: <AtHome /> };
  if (first === "groceries" && second === "put-away" && !third)
    return { title: "Put it all away", page: <PutAway /> };
  if (first === "groceries" && second === "week" && !third)
    return { title: "Shop for this week", page: <ShopFor week={monday()} /> };
  if (first === "groceries" && second === "week" && DAY.test(third) && !fourth)
    return {
      title: `Shop for the week of ${dateLabel(monday(third))}`,
      page: <ShopFor week={monday(third)} />,
    };
  if (
    first === "groceries" &&
    second === "add" &&
    (third === "recipe" || third === "meal") &&
    fourth
  )
    return {
      title: `Add to groceries · ${named(third, fourth, "Recipe")}`,
      page: <ShopFor kind={third} id={fourth} />,
    };
  if (first === "ask" && !second) return { title: "Ask Kooks", page: <Ask /> };
  if (first === "waiting" && !second)
    return { title: "Waiting to send", page: <WaitingList /> };
  if (first === "household" && !second)
    return { title: "Household", page: <Household /> };
  if (first === "household" && !third && Object.hasOwn(HOUSEHOLD, second)) {
    const [title, Page] = HOUSEHOLD[second];
    return { title, page: <Page /> };
  }
  if (first === "household" && second === "people" && third && !fourth)
    return {
      title:
        third === "new"
          ? "Add a person"
          : `Edit · ${record("member", third)?.data.name ?? "Person"}`,
      page: <PersonForm key={third} id={third} />,
    };
  if (first === "household" && second === "prices" && third && !fourth)
    return {
      title: third === "new" ? "Add a price" : "Edit a price",
      page: <PriceForm key={third} id={third} />,
    };
  if (first === "cook" && second && third === "done" && !fourth)
    return {
      title: `Finish cooking · ${named("session", second, "Cooking")}`,
      page: <Finish id={second} />,
    };
  if (first === "cook" && second && !third)
    return {
      title: `Cooking · ${named("session", second, "Cooking")}`,
      page: <Cook id={second} />,
      full: true,
    };
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
  const { title, page, full } = pageFor(route.value);
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
  useEffect(watchTimers, []);

  // Keyed by address, so one recipe's servings never carry over to the next.
  // Cooking fills the screen, without the navigation.
  return full ? (
    <Fragment key={key}>{page}</Fragment>
  ) : (
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
      {appLink.value ? (
        <ApproveApp />
      ) : invitation.value && status.value !== "loading" ? (
        <JoinInvite />
      ) : status.value === "ready" ? (
        <Kitchen />
      ) : status.value === "welcome" ? (
        <Welcome />
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
