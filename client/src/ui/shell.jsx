import {
  CalendarDays,
  BookOpen,
  ShoppingBasket,
  CookingPot,
  House,
  Sparkles,
} from "lucide";
import { route, section, href } from "../lib/router.js";
import { account, assistant } from "../lib/store.js";
import { Icon } from "./icon.jsx";
import { NowCooking } from "./now-cooking.jsx";
import { Offline } from "./offline.jsx";

const TABS = [
  { id: "week", label: "Week", icon: CalendarDays },
  { id: "recipes", label: "Recipes", icon: BookOpen },
  { id: "groceries", label: "Groceries", icon: ShoppingBasket },
];

// "anna.berg@…" reads as AB, "cook@…" as CO.
export function initials(email) {
  const local = email.split("@")[0];
  const parts = local.split(/[._+-]/).filter(Boolean);
  return (
    parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)
  ).toUpperCase();
}

function Badge() {
  const email = account.value?.email;
  return email ? (
    <span class="avatar" aria-hidden="true">
      {initials(email)}
    </span>
  ) : (
    <Icon icon={House} />
  );
}

const Brand = () => (
  <a class="brand" href={href("week")}>
    <Icon icon={CookingPot} />
    kooks
  </a>
);

export function Shell({ children }) {
  const current = section(route.value);
  const here = (id) => (current === id ? "page" : undefined);
  const skip = (event) => {
    event.preventDefault();
    document.getElementById("main")?.focus();
  };
  return (
    <div class="app">
      <a class="skip" href="#main" onClick={skip}>
        Skip to content
      </a>
      <header class="topbar">
        <Brand />
        <div class="topbar-end">
          {assistant.value && (
            <a
              class="btn btn-quiet btn-icon"
              href={href("ask")}
              aria-label="Ask Kooks"
              aria-current={here("ask")}
            >
              <Icon icon={Sparkles} />
            </a>
          )}
          <a
            class="btn btn-quiet btn-icon"
            href={href("household")}
            aria-label="Household"
            aria-current={here("household")}
          >
            <Badge />
          </a>
        </div>
      </header>
      <header class="rail">
        <Brand />
        <nav class="rail-nav" aria-label="Main">
          {TABS.map((tab) => (
            <a
              key={tab.id}
              class="rail-link"
              href={href(tab.id)}
              aria-current={here(tab.id)}
            >
              <Icon icon={tab.icon} />
              {tab.label}
            </a>
          ))}
        </nav>
        <div class="rail-foot">
          {assistant.value && (
            <a class="rail-link" href={href("ask")} aria-current={here("ask")}>
              <Icon icon={Sparkles} />
              Ask Kooks
            </a>
          )}
          <a
            class="rail-link"
            href={href("household")}
            aria-current={here("household")}
          >
            <Badge />
            Household
          </a>
        </div>
      </header>
      <main id="main" class="main" tabIndex={-1}>
        <div class="page">
          <Offline />
          <NowCooking />
          {children}
        </div>
      </main>
      <nav class="tabbar" aria-label="Main">
        {TABS.map((tab) => (
          <a
            key={tab.id}
            class="tab"
            href={href(tab.id)}
            aria-current={here(tab.id)}
          >
            <span class="tab-icon">
              <Icon icon={tab.icon} />
            </span>
            {tab.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
