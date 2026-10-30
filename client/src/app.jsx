import { useEffect, useRef } from "preact/hooks";
import { CircleAlert, Leaf } from "lucide";
import { route } from "./lib/router.js";
import { status, loadError, refresh } from "./lib/store.js";
import { Shell } from "./ui/shell.jsx";
import { Toasts } from "./ui/toast.jsx";
import { Empty, PageHeader } from "./ui/page.jsx";
import { SignIn } from "./pages/signin.jsx";
import { Household } from "./pages/household.jsx";
import { Week, Recipes, Groceries } from "./pages/placeholders.jsx";

const PAGES = {
  week: { title: "This week", Page: Week },
  recipes: { title: "Recipes", Page: Recipes },
  groceries: { title: "Groceries", Page: Groceries },
  household: { title: "Household", Page: Household },
};

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
  const [first = "week"] = route.value;
  const { title, Page } = PAGES[first] ?? {
    title: "Not found",
    Page: NotFound,
  };
  const key = route.value.join("/");
  const shown = useRef(null);

  // A new page scrolls to the top and puts focus on its title, so keyboard
  // and screen-reader users start there instead of on a link that is gone.
  useEffect(() => {
    document.title = `${title} · Kooks`;
    if (shown.current !== null) {
      scrollTo(0, 0);
      (
        document.querySelector("[data-page-title]") ??
        document.getElementById("main")
      )?.focus({ preventScroll: true });
    }
    shown.current = key;
  }, [key]);

  return (
    <Shell>
      <Page />
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
