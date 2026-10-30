# Kooks information architecture and experience design

Adopted October 30, 2026, when the redesigned app replaced the previous browser app. This document is the design authority for the app in `client/` (Preact, built by Vite and served by `web/server.js` at `/`). The Capacitor mobile app in `app/` still has the previous structure (Today, Recipes, Plan, Shop, Cook and a Settings gear) until it moves onto this client; where the two differ, this document describes where the mobile app is going.

## Principles

1. **Three places for the week's work.** Week is what the household eats, Recipes what it knows how to make, Groceries what it needs and has. Household holds the people, money and settings behind them. Nothing else is a destination.
2. **The title says where you are.** Every page has one `h1`, and the browser tab reads "Title · Kooks". A small eyebrow above it carries context, such as a count or the dish's course.
3. **Cooking is a mode, not a place.** It fills the screen, one step at a time, and a Now cooking bar on every other page leads back to it.
4. **Show, then edit.** Pages show records; every form is a page of its own with its own address, and a form with unsaved changes asks before it is left.
5. **Reversible and honest.** Removing something offers Undo. Unknown amounts, prices and times stay visibly unknown, and totals that miss something say "at least".
6. **Reach, not hunt.** Everything is at most two taps from a tab, and pages link to the next thing a cook needs (a recipe to its book, a missing price to its form).

## Navigation

| Destination   | Icon                            | Holds                                                                                     |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| **Week**      | calendar-days                   | This week's days with their plans, leftovers set aside and the week's cost; other weeks   |
| **Recipes**   | book-open                       | The cookbook: recipes, meals, ideas to try, techniques and books, with search and filters |
| **Groceries** | shopping-basket                 | To buy (by aisle, with the basket), shopping for the week, At home (pantry and leftovers) |
| **Household** | house, or the member's initials | People at the table, prices and budget, look and units, sign-in, backup                   |

- At 840 px and wider a rail on the inline-start side carries the brand, the three tabs and Household at its foot. Below 840 px a top bar carries the brand and Household, and the three tabs sit at the bottom. Never both.
- The current tab and the Household link carry `aria-current="page"`.
- Cooking (`#/cook/<session>`) hides all navigation. Leaving it keeps the session, and the Now cooking bar at the top of every page shows its step or next timer and goes back.

### Routes

Hash routes, noun first. The address after `#` is the whole state of the page, so every page can be bookmarked, shared and reloaded.

| Route                                                                   | Page                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `#/week` · `#/week/<date>`                                              | This week, or the week holding that date                     |
| `#/week/add/<date>`                                                     | Add a dish to a day                                          |
| `#/week/when/recipe/<id>` · `/meal/<id>` · `#/week/move/<plan>`         | Choose a day for a recipe or meal, or move a plan            |
| `#/recipes`                                                             | The cookbook                                                 |
| `#/recipes/add` · `/paste` · `/photo` · `/idea`                         | Add to the cookbook, and each way of adding                  |
| `#/recipes/new` · `#/recipes/draft/<id>`                                | Write a recipe; check a pasted or photographed draft         |
| `#/recipes/<id>` · `/edit` · `/variation`                               | A recipe, its editor, and your own version of it             |
| `#/recipes/meal/<id>`                                                   | A meal and its dishes                                        |
| `#/recipes/idea/<id>` · `/edit` · `/write`                              | An idea to try, its form, writing it up as a recipe          |
| `#/recipes/technique/new` · `/<id>` · `/<id>/edit`                      | A technique and its forms                                    |
| `#/recipes/book/new` · `/<id>` · `/<id>/edit`                           | A book on the shelf and its forms                            |
| `#/groceries` · `#/groceries/put-away`                                  | To buy; putting the basket away                              |
| `#/groceries/week` · `/week/<date>` · `/add/recipe/<id>` · `/meal/<id>` | Pick through a week's plans, a recipe or a meal for the list |
| `#/groceries/home`                                                      | At home                                                      |
| `#/cook/<session>` · `/done`                                            | Cooking, and finishing it                                    |
| `#/household` · `/people` · `/prices` · `/look` · `/signin` · `/backup` | Household and its pages                                      |
| `#/household/people/new` · `/<id>` · `#/household/prices/new` · `/<id>` | Person and price forms                                       |
| `#/signin/<token>`                                                      | An emailed sign-in link                                      |

An unknown address shows a Not found page with a way to this week.

### Addresses from the previous app

The previous browser app's addresses open the page that replaced them, so bookmarks keep working: `#/today` and `#/plan` open Week; `#/capture`, `#/imports/<id>` and `#/new-recipe` open adding, the draft or the editor; `#/techniques/<id>`, `#/inspiration/<id>` and `#/library/<id>` (with `/edit`) open the technique, idea or book; `#/recipes/<id>/variant` opens your own version and `/memory` the recipe; `#/meals/<id>` and `#/plan/meals/<id>` open the meal; `#/shop`, `#/pantry` and `#/leftovers` open Groceries, and `#/shop/review/<kind>/<id>` picks through that recipe or meal; `#/settings/…` and `#/account` open the Household page that took each tab's place. The server sends `/next/…`, where the app was tried out before the swap, to `/`.

## Pages

| Page                  | For                                                                                                                                    | Primary action          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Week                  | Seven days with their plans and leftovers; today first on phones. One line with the week's food cost against the budget.               | Add to a day            |
| Recipes               | Search by name or ingredient; chips for kind (recipes, meals, ideas, techniques, books) and for favorites and facets; What can I make? | Add                     |
| Add                   | Paste, photograph, write, save an idea, keep a technique, add a book                                                                   | One link per way        |
| Recipe                | Ingredients (scaled, converted, marked when at home), method, who at the table likes it, its family and sources                        | Cook                    |
| Editor                | Basics, ingredients read back line by line, method, facets, links; a draft sits beside its original                                    | Save recipe             |
| Meal                  | Its dishes                                                                                                                             | Cook                    |
| Idea, technique, book | Notes, steps and tips, files and bookmarks, links and the recipes they touch                                                           | Edit, or open the book  |
| To buy                | The list by aisle, the basket, and putting it away                                                                                     | Add, Shop for the week  |
| At home               | What is in, what to use soon, leftovers                                                                                                | Add                     |
| Cooking               | One step at a time in large type, the dish's ingredients, every step, timers                                                           | Next                    |
| Finishing             | How it went per dish: rating, next time, notes, portions left over                                                                     | Done                    |
| Household pages       | People and tastes; prices, budget and currency; colors and units; passkeys; backup                                                     | Add a person or a price |

## Key flows

- **Add a recipe:** Recipes → Add → Paste or Photo → check the draft beside its original → Save → the recipe.
- **Plan the week:** Week → Add on a day → pick a recipe or meal. Or a recipe → Add to the week → pick a day.
- **Shop:** Groceries → Shop for the week → untick what you have → the list by aisle → tick into the basket → Put it all away, which fills At home.
- **Cook:** a recipe, meal or today's plan → Cook → steps and timers → Finish → leftovers go to At home and the note shows as "Last time" on the recipe.
- **Write up an idea:** the idea → Write it up as a recipe → the editor starts from it → Save → the idea points at the recipe.

## Components

Components live in `client/src/ui/`, styles in `client/src/styles/` (`tokens.css` for every color, size and font; `base.css` for elements; `components.css` for the rest). Icons are imported one by one from `lucide`.

| Component     | Where                                                          | Use                                                                |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Shell         | `ui/shell.jsx`: `.app`, `.rail`, `.topbar`, `.tabbar`, `.main` | Navigation, skip link, Now cooking bar                             |
| Page header   | `ui/page.jsx`: `.page-header`, `.eyebrow`                      | The `h1`, which takes focus on every page change                   |
| Empty state   | `ui/page.jsx`: `.empty`                                        | Icon, one line, one sentence, one action                           |
| Tiles         | `ui/tile.jsx`: `.tile`                                         | Cookbook grid; the favorite toggle sits beside the link            |
| Forms         | `ui/form.jsx`: `.field`, `.input`, `.hint`, `.segmented`       | Visible labels, hints below, errors as `role="alert"`              |
| Chips         | `.chips`, `.chip`, `.check-chip`                               | Filters (`aria-pressed`) and multi-select                          |
| Related links | `ui/more.jsx`: `.more`                                         | Places to go from a page; external links say they open a new tab   |
| Recipe picker | `ui/recipe-picker.jsx`                                         | Search and tick recipes in a form                                  |
| Messages      | `ui/toast.jsx`, `lib/toast.js`: `.toast-region`, `.toast`      | One message at a time, with Undo when the change can be taken back |
| Cooking       | `pages/cook.jsx`, `ui/now-cooking.jsx`                         | Full-screen steps and timers; the bar that leads back              |

## Visual system

- **Tokens** in `client/src/styles/tokens.css`: ground, surface, raised, sunken, lines, ink and muted; tomato for actions (`--accent`), herb for what is at home and done, saffron, plum, sky and stone for kinds of things; danger and focus. A type scale from 13 to 40 px, radii of 10, 16 and 22 px and pills, a 44 px target.
- **Type.** Bricolage Grotesque for titles, the system sans for everything else.
- **Dark mode** follows the device, and Household › Look and units can fix it to light or dark for this browser. Text keeps at least 4.5:1 contrast and focus rings and field borders 3:1, in both themes.
- **Windows contrast themes** (`forced-colors`) frame the selected tab, chip and choice.
- **Direction.** Layout uses logical properties, so `dir="rtl"` mirrors it.
- **Motion** is short and honours `prefers-reduced-motion`.

## Copy

- Titles name the page: "This week", "To buy", "People at the table".
- Buttons start with a verb: Cook, Add to the week, Save recipe, Put it all away.
- Messages say what happened, in the household's words: "Chickpea stew is a favorite." "Ada is at the table." "Undone."
- Empty states say what to do next. Unknowns say so: "No price yet", "at least $42".

## Accessibility

- **Checked automatically.** The `web` Playwright project runs axe against WCAG 2.2 A and AA and axe's best practices, in light and dark, on every tab and Household at phone and desktop widths and on each page its tests visit, including sign-in; a violation fails CI. Keyboard paths, focus and announcements have their own tests.
- **Landmarks.** A skip link, one labelled main navigation, one `main`; the page title is the only `h1` and takes focus when the page changes, so a screen reader starts at the new page's title.
- **Your place is kept.** Other cooks' changes arrive every 3 seconds while the tab is in view (at once when it comes back), and redraw the page without moving the focus or the caret: typing in a search carries on. A button that removes its own row passes the focus to the next row first.
- **Messages** are a polite live region. Plain messages stay 7 seconds, errors and messages with Undo 20, counted from when they appear; the pointer or the focus on a message holds it. Escape or the close button dismisses it, and focus that was on it goes back where it was before the message (the button Undo reversed, for example), or else to `main`.
- **Names.** Every control has a visible or programmatic name that starts with its visible words; icon-only buttons are labelled; toggles use `aria-pressed`; result counts and the cooking step are announced.
- **Targets** are at least 44 × 44 px, and text fields are 16 px on phones so iOS does not zoom.
- **No sideways scrolling.** Every page fits 320, 390, 768 and 1280 px without scrolling sideways; a test checks each one.

## Out of scope

The redesign changes the browser app's structure, pages and look. It does not change the MCP tools, storage or the data contracts; the mobile app's move onto this client and the unfinished items in the [handoff](handoff.md) (native verification, a shared cookbook on phones, live assistance) come next.
