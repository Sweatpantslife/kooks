# Kooks information architecture and experience design

Adopted October 9, 2026. This document is the design authority for both interfaces: the browser household app in `web/` and the Capacitor mobile app in `app/`. It replaces the navigation and page structure described in the archived product brief. Where an older document describes a different layout, this one wins.

## Principles

1. **One mental model.** The browser app and the mobile app share the same destinations, labels, verbs, components and visual tokens. A person who learns one can use the other.
2. **Titles are labels, voice lives below them.** Every page title is the same word as its navigation item. Warmth belongs in subtitles, empty states and confirmations, never in wayfinding.
3. **Five destinations, then depth.** Daily jobs get a tab. Everything else sits one level down behind a section tab or the Settings gear. Nothing is more than two taps from a tab.
4. **Show, then edit.** Lists open as lists. Creating a record with four or more fields gets its own page; quick one-to-three field actions are inline disclosures. No page keeps a blank form permanently open beside its content.
5. **One verb per job.** Cook, Shop and Plan mean the same thing on every screen and carry the same icon.
6. **Kitchen first.** Cooking is a focused mode with large text and the timers in view, reachable in one tap from anywhere.
7. **Progressive, reversible, honest.** Destructive or shared changes confirm or offer undo. Unknown values stay visibly unknown. Nothing claims a capability the code does not have.

## What the audit found

- The browser app exposed nine flat destinations (Today, Recipes, Meals & plan, Pantry, Leftovers, Household, Spending, Shopping, Cooking). Supporting records sat beside daily jobs, and on phones the sidebar collapsed into a nine-item horizontal strip without a tab bar.
- Cooking is a mode entered from a recipe, meal or plan entry, yet it occupied a destination. The mobile app already handled this better with a resume banner.
- The mobile app gave one of its five tabs to an Assistant that is explicitly not connected.
- Pantry, Household, Meals and Spending each rendered a permanent form beside the list they manage.
- Page titles were taglines (“Pick up something good.” for Shopping, “Something good for later.” for Leftovers), so the title never confirmed where you were.
- The same action had different names: “Review groceries” on a recipe, “Shop” on a plan entry and on a meal. Rare actions (variation, cooked batch) had the same weight as Cook.
- Each app had its own navigation, class vocabulary, icon set and colour values.

## Navigation model

| Destination  | Icon            | Contents                                                                                | Section tabs (browser)                    | Section tabs (mobile)                     |
| ------------ | --------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| **Today**    | house           | What is on the stove, today’s and tomorrow’s plan, use-soon pantry, drafts, find dinner | —                                         | —                                         |
| **Recipes**  | book-open       | Library with search and filters, add recipe, recipe detail, editor, draft review        | —                                         | —                                         |
| **Plan**     | calendar-days   | The week, reusable meals, cooked batches and leftovers                                  | Week · Meals · Leftovers                  | Week · Meals                              |
| **Shop**     | shopping-basket | Shopping list(s), the review step that adds a recipe, meal or plan entry, the pantry    | List · Pantry                             | —                                         |
| **Cook**     | flame           | Active cooking sessions, the focused cooking view, finished sessions                    | —                                         | —                                         |
| **Settings** | settings (gear) | Household people and tastes, prices and budget, backup, preferences, sharing, assistant | Household · Prices · Backup · Preferences | Backup · Preferences · Timers · Assistant |

- The five destinations appear as a left sidebar at 840 px and wider and as a bottom tab bar below that, on both apps. The sidebar also carries the brand, an **Add recipe** button and the Settings link. Narrow layouts put the brand, Add recipe and Settings in a compact top bar.
- The Cook tab shows a badge with the number of active sessions. Today repeats the active sessions as its first section so a returning cook never hunts for them.
- Section tabs are a segmented control directly under the page title. The first tab is the destination’s default.
- Household and Spending are supporting records. They move under Settings, and the places that need them link there: Today’s “Who’s eating?” links to Settings › Household; a recipe’s cost line and the week’s cost line link to Settings › Prices.
- The mobile Assistant demonstration moves to Settings › Assistant, labelled as a preview with no connected provider.

### Browser routes

Hash routes, lower-case, noun first. Legacy routes redirect so bookmarks keep working.

| Route                                          | Page                                  | Legacy route                                        |
| ---------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| `#/today`                                      | Today                                 | `#/today`                                           |
| `#/recipes`                                    | Recipes library                       | `#/recipes`                                         |
| `#/recipes/add`                                | Add a recipe (paste, photo, write)    | `#/capture`                                         |
| `#/recipes/new`                                | New recipe editor                     | `#/new-recipe`                                      |
| `#/recipes/:id`                                | Recipe                                | `#/recipes/:id`                                     |
| `#/recipes/:id/edit` · `/variant` · `/memory`  | Edit, make a variation, cooking note  | `#/edit/:id` · `#/variant/:id` · `#/memory/:id`     |
| `#/imports/:id`                                | Review a draft                        | `#/imports/:id`                                     |
| `#/plan`                                       | Plan › Week                           | `#/plan`                                            |
| `#/plan/meals` · `/new` · `/:id`               | Plan › Meals, meal form               | `#/meals` · `#/meals/:id`                           |
| `#/plan/leftovers` · `/new/…` · `/:id`         | Plan › Leftovers, batch form, batch   | `#/leftovers` · `#/new-batch/…` · `#/leftovers/:id` |
| `#/shop` · `#/shop/list/:id`                   | Shop › List                           | `#/shop` · `#/shop/:id`                             |
| `#/shop/pantry` · `/new` · `/:id`              | Shop › Pantry, pantry form            | `#/pantry` · `#/pantry/:id`                         |
| `#/shop/review/:kind/:id`                      | Shop for a recipe, meal or plan entry | `#/review/:kind/:id`                                |
| `#/cook` · `#/cook/:id`                        | Cook, cooking session                 | `#/cooking` · `#/cooking/:id`                       |
| `#/settings/household` · `/new` · `/:id`       | Settings › Household, person form     | `#/household` · `#/household/:id`                   |
| `#/settings/prices` · `/new` · `/:id`          | Settings › Prices, price form         | `#/spending` · `#/spending/:id`                     |
| `#/settings/backup` · `#/settings/preferences` | Settings › Backup, Preferences        | —                                                   |

### Mobile views

The mobile app keeps its persisted `state.view`. Views map to tabs as follows: `today` → Today; `library`, `detail`, `capture`, `editor`, `finished` → Recipes; `plan`, `meals`, `meal`, `meal-editor` → Plan; `shop` → Shop; `cook` → Cook; `review` → the tab it was opened from; `settings`, `byk` → Settings. `today` is new; older backups without it still restore because every other view remains valid.

## Pages

Each page has one title (the navigation label), an optional warm subtitle, at most one primary action in its header, and secondary actions in a quieter row. The “Primary” column is what the page exists to let you do.

| Page                   | Primary action                                      | Secondary actions                                                                   | Notes                                                                                                                                                          |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today                  | Find dinner                                         | Continue cooking, Cook/Shop a planned entry, Add recipe                             | Filters beyond ingredients and eaters sit in a “More filters” disclosure. Shows up to 12 suggestions until a filter is applied.                                |
| Recipes                | Add recipe                                          | Search, All / Favorites / Under 30 min / Needs review chips                         | The card title is the link. Favorite is a toggle on the card.                                                                                                  |
| Add a recipe           | Review pasted recipe / Read photo / Write it myself | —                                                                                   | One method visible at a time via a segmented choice. The original text or photo stays with the recipe.                                                         |
| Review a draft         | Save reviewed recipe                                | Cancel                                                                              | Editor beside the original text or photo; the review confirmation stays required.                                                                              |
| Recipe                 | Cook                                                | Shop, Plan, Edit, Make a variation, Record cooked batch, Favorite, Add cooking note | Plan opens an inline date and meal disclosure. Ingredients and method sit side by side on wide screens.                                                        |
| Edit recipe            | Save recipe                                         | Cancel                                                                              | Fields grouped: Basics, Ingredients, Method, Equipment, Effort and spice (disclosure), Notes, source and links (disclosure).                                   |
| Plan › Week            | Add to a day (per day)                              | Cook, Shop, Remove per entry; previous/next/this week                               | Today is highlighted. Leftover allocations appear as “Already cooked”. A cost line appears when prices or a budget exist.                                      |
| Plan › Meals           | New meal                                            | Cook, Shop, Edit per meal                                                           | The meal form has its own page.                                                                                                                                |
| Plan › Leftovers       | Record a batch                                      | Open batch                                                                          | The batch page shows allocations beside the allocation form.                                                                                                   |
| Shop › List            | Add an item                                         | Bought checkbox, Remove recipe contribution                                         | Unchecked items first; checked items collapse under “In the basket”.                                                                                           |
| Shop › Pantry          | Add ingredient                                      | Have checkbox, Use soon toggle, Edit                                                | Use-soon items sort first.                                                                                                                                     |
| Shop for …             | Add to shopping list                                | Update preview                                                                      | Untick what you already have; the preview shows the diff before anything changes.                                                                              |
| Cook                   | Continue (per active session)                       | Pick a recipe, Open this week                                                       | Recently finished sessions keep their notes-and-leftovers entry point.                                                                                         |
| Cooking session        | Done, next step                                     | Previous step, add task, start timer, Finish cooking                                | Large current step per dish, progress, ingredients and full method behind a disclosure, tasks and timers in view. Requests a screen wake lock where supported. |
| Cooking finished       | Record leftovers (per dish)                         | Remember what worked                                                                | —                                                                                                                                                              |
| Settings › Household   | Add person                                          | Edit                                                                                | Explains that profiles are tastes and task owners, not accounts.                                                                                               |
| Settings › Prices      | Add price                                           | Set or change this week’s budget, change currency/week                              | Weekly estimate and “On the menu” summary live here; the Plan week shows a one-line summary.                                                                   |
| Settings › Backup      | Export cookbook                                     | —                                                                                   | States the sharing mode (this computer only, or shared on the household server).                                                                               |
| Settings › Preferences | —                                                   | Theme (System, Light, Dark), currency                                               | Version and licence.                                                                                                                                           |

Mobile pages follow the same table for the features the mobile app has: Today (resume, today’s plan, favorites, add recipe), Recipes, Plan › Week and Meals, Shop, Cook, and Settings › Backup, Preferences (theme, measurement display, palette, layout, spacing), Timers and Assistant (preview).

## Key flows

- **Add a recipe:** Recipes → Add recipe → choose Paste, Photo or Write → review the draft beside its source → Save → the recipe page. Two taps to the capture screen from any tab.
- **Cook tonight:** Today → “Find dinner” → recipe → Cook. Or Plan › Week → Cook on today’s entry. The session appears under Cook with a badge until it is finished.
- **Shop:** Recipe, meal or plan entry → Shop → untick what you have → Add to shopping list → Shop › List. Repeating the same source replaces its contribution instead of duplicating it.
- **Plan:** Recipe → Plan → pick a day and meal → Plan › Week. Or Plan › Week → Add on a day.
- **Leftovers:** Cook → Finish cooking → Record leftovers → allocate portions to dated meals → they appear in Plan › Week as already cooked.

## Components

Both apps load `shared/tokens.css` and `shared/ui.css` and use the same class vocabulary; each app keeps a small stylesheet for its own quirks (`web/public/style.css`, `app/styles.css`). Icons come from `shared/icons.js`, generated from Lucide by `scripts/icons.mjs`.

| Component        | Class                                                                       | Use                                                                  |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| App shell        | `.app`, `.sidebar`, `.topbar`, `.tabbar`, `.main`                           | Sidebar at ≥ 840 px, top bar and bottom tabs below. Safe-area aware. |
| Page header      | `.page-header`, `.page-title`, `.page-subtitle`, `.page-actions`            | Title equals nav label; one primary button.                          |
| Section tabs     | `.segmented`                                                                | Links with `aria-current="page"`.                                    |
| Buttons          | `.btn`, `.btn-primary`, `.btn-quiet`, `.btn-danger`, `.btn-sm`, `.btn-icon` | 44 px minimum height; icons 18 px.                                   |
| Fields           | `.field`, `.input`, `.select`, `.textarea`, `.check`, `.help`, `.error`     | Explicit labels; errors `role="alert"`.                              |
| Chips            | `.chip`, `.chip-input`                                                      | Filters and multi-select eaters.                                     |
| Cards and panels | `.card`, `.panel`                                                           | Cards for collections, panels for grouped content and forms.         |
| Lists            | `.list`, `.list-item`, `.list-body`, `.list-actions`                        | Rows with a leading control, body and trailing actions.              |
| Tags and badges  | `.tag`, `.tag-warm`, `.tag-neutral`, `.badge`                               | Short status labels; the badge counts sessions.                      |
| Callouts         | `.callout`, `.callout-warning`, `.callout-success`                          | Inline notices; never for form errors.                               |
| Empty state      | `.empty`                                                                    | Icon, one-line title, one sentence, one action.                      |
| Toast            | `.toast`                                                                    | `role="status"`, polite; Undo when available.                        |
| Cooking          | `.step-current`, `.progress`, `.timer`, `.task`                             | Large current step, deterministic countdown text.                    |
| Embeds           | `.embed`, `.embed-load`                                                     | Video players load only when play is pressed.                        |
| Disclosure       | `details.disclosure`                                                        | Inline secondary forms and long content.                             |

## Visual system

- **Tokens** live in `shared/tokens.css`: paper, surface, ink, muted, line, brand, brand-strong, on-brand, soft, warm, warm-ink, danger, danger-soft, focus; a type scale from 13 to 36 px; a 4 px spacing scale; radii 6, 10, 14 and 20 px; two shadows.
- **Type.** Georgia for titles (h1, h2, card titles), the system sans for everything else. Body 15 px / 1.55. Minimum 13 px for secondary text.
- **Dark mode** follows the system by default and can be forced in Settings › Preferences; every colour comes from a token so both themes stay in step. Contrast stays at or above 4.5:1 for body text in both themes.
- **Motion** is limited to short transitions and honours `prefers-reduced-motion`.

## Copy

- Page title = navigation label. Subtitle carries the voice: “Thursday, 9 October. What sounds good today?”
- Buttons start with a verb: Cook, Shop, Plan, Add recipe, Save recipe, Finish cooking.
- Confirmations are short and past tense: “Recipe saved.” “Added to your week.”
- Empty states name the next step: “Nothing on the stove. Pick a recipe or open this week’s plan.”
- Unknowns are explicit: “Yield not set”, “Time not set”, “availability unknown”.

## Accessibility

- Landmarks: one `header`, one `nav` per navigation (labelled), one `main` that receives focus on every route change, the page title as the only `h1`.
- A skip link to the main content.
- `aria-current="page"` on the active destination and section tab; `aria-pressed` on toggles.
- Every control has a visible or programmatic label; icon-only buttons carry `aria-label`.
- Focus rings use the focus token and are never removed.
- Touch targets are at least 44 × 44 px. Text inputs are 16 px on narrow screens to stop iOS zooming.
- Live regions: the toast is `role="status"`; storage errors are `role="alert"`.
- Colour is never the only carrier of meaning; tags carry words.

## Responsive behaviour

| Width        | Navigation            | Columns                                                                     |
| ------------ | --------------------- | --------------------------------------------------------------------------- |
| < 600 px     | Top bar + bottom tabs | One column everywhere; recipe ingredients above the method.                 |
| 600 – 839 px | Top bar + bottom tabs | Two-column grids; forms two fields per row.                                 |
| ≥ 840 px     | Sidebar               | Recipe ingredients beside the method; three-column card grids at ≥ 1100 px. |

No page scrolls horizontally at 320 px. Both Playwright suites assert this.

## Out of scope

This redesign changes structure, navigation, labels, layout and the visual system. It does not change storage, validation, the MCP tools, the data contracts between the two apps, or the unfinished items in the handoff (native verification, shared cookbook, accounts, live assistance).
