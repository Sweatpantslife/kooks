import { recipes, days, initial } from "./sample-data.js";
import {
  amount as amountOf,
  clockText,
  originalText,
  scaledText as scaledTextOf,
  timeLeft,
} from "./units.js";
import {
  parseIngredient as parseIngredientLine,
  pasteDraft,
  editDraft,
} from "./parsing.js";
import {
  listItems as listItemsOf,
  buildReview,
  applyShoppingReview as applyReview,
} from "./shopping.js";
import { equipmentSummary } from "./equipment.js";
import { MAX_LINKS, describeLink, parseLinkLines } from "../shared/links.js";
import {
  courseLabel,
  courses,
  dietLabel,
  diets,
  facetText,
  hasFacetFilters,
  labelKey,
  matchesFacets,
  parseLabels,
  suggestedCuisines,
  taxonomy,
} from "../shared/taxonomy.js";
import { clone as structuredClone, randomId } from "./compat.js";
import {
  createIcons,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  Clock3,
  CookingPot,
  Heart,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  Share2,
  ShoppingBasket,
  Sparkles,
  Timer,
  Users,
  Utensils,
  X,
} from "lucide";
import { defaultDesign, snapshot, parseBackup } from "./model.js";
import { createCookbookStorage } from "./storage.js";
import { notificationId } from "./timers.js";
import {
  isNative,
  platform,
  initializeNative,
  enableTimerAlerts,
  syncTimerAlerts,
  tap,
  shareRecipe,
  exportCookbook,
} from "./native.js";

async function boot() {
  const root = document.getElementById("kooks-concept");
  const main = root.querySelector("main");
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const button = (label, action, extra = "", kind = "") =>
    `<button type="button" class="k-button cursor-interaction ${kind}" data-action="${action}" ${extra}>${label}</button>`;
  let state = structuredClone(initial);
  let pendingRestore = null;
  let isRestoring = false;
  let storageStatus = "saved";
  let draft = null;
  // Library facet filters: one course or cuisine, every chosen diet and tag.
  const noFacets = () => ({ course: "", cuisine: "", diets: [], tags: [] });
  let facets = noFacets();
  let review = null;
  let noteMessage = "";
  let timerHandle = null;
  let renderedView = null;
  let mealDraft = null;
  let bykPreview = null;
  let bykResult = null;
  const design = { ...defaultDesign };
  const statusElement = document.getElementById("storage-status");
  const storage = createCookbookStorage((status) => {
    storageStatus = status;
    statusElement.hidden = status !== "error";
    statusElement.textContent =
      status === "error"
        ? "Changes could not be saved. Keep Kooks open and export a backup from Settings."
        : "";
    const label = root.querySelector("[data-storage-label]");
    if (label)
      label.textContent =
        status === "saving"
          ? "Saving…"
          : status === "error"
            ? "Not saved — please retry"
            : "Saved on this device";
  });
  const loaded = await storage.load();
  if (loaded.data) {
    state = loaded.data.state;
    Object.assign(design, loaded.data.design);
  }
  if (loaded.recovered)
    noteMessage =
      "Recovered your previous saved cookbook. Please export a backup.";
  function allRecipes() {
    return recipes
      .map((r) => state.custom.find((x) => x.id === r.id) || r)
      .concat(state.custom.filter((r) => !recipes.some((x) => x.id === r.id)));
  }
  function recipe(id = state.selected) {
    return allRecipes().find((r) => r.id === id) || recipes[0];
  }
  function servings(r) {
    return state.servings[r.id] || r.servings || 1;
  }
  const amount = (i, multiplier = 1, units = state.units) =>
    amountOf(i, multiplier, units);
  const scaledText = (text, units = state.units) => scaledTextOf(text, units);
  function save() {
    if (isRestoring) return Promise.resolve(false);
    let data;
    try {
      data = snapshot(state, design);
    } catch (error) {
      statusElement.hidden = false;
      statusElement.textContent =
        "Changes could not be saved. Please export your cookbook before closing.";
      console.error(error);
      return Promise.resolve(false);
    }
    void syncTimerAlerts(state.session?.timers || []).catch(() =>
      notify(
        "The timer is running, but its device alert could not be scheduled.",
      ),
    );
    return storage.save(data).then(
      () => true,
      () => {
        notify(
          "Storage is unavailable. Keep the app open and export a backup.",
        );
        return false;
      },
    );
  }
  const listItems = () => listItemsOf(state);
  function icons() {
    createIcons({
      icons: {
        ArrowLeft,
        ArrowRight,
        BookOpen,
        CalendarDays,
        CalendarPlus,
        Check,
        Clock3,
        CookingPot,
        Heart,
        Minus,
        Pause,
        Pencil,
        Play,
        Plus,
        Search,
        Settings,
        Share2,
        ShoppingBasket,
        Sparkles,
        Timer,
        Users,
        Utensils,
        X,
      },
      attrs: { width: 17, height: 17 },
    });
  }
  function notify(message) {
    noteMessage = message;
    root.querySelector(".k-toast").textContent = message;
  }
  function navigate(view, id) {
    state.view = view;
    if (id) state.selected = id;
    noteMessage = "";
    render();
    save();
  }
  function navigation() {
    let active = [
      "capture",
      "editor",
      "detail",
      "cook",
      "review",
      "finished",
    ].includes(state.view)
      ? "library"
      : state.view;
    if (
      ["meal", "meal-editor"].includes(state.view) ||
      (state.view === "cook" && state.session?.mealId) ||
      (state.view === "review" && review?.returnView === "meal")
    )
      active = "meals";
    const items = [
      ["library", "book-open", "Recipes"],
      ["meals", "utensils", "Meals"],
      ["shop", "shopping-basket", "Shop"],
      ["plan", "calendar-days", "Plan"],
      ["byk", "sparkles", "Assistant"],
    ];
    const html = items
      .map(
        ([view, ico, label]) =>
          `<button type="button" class="k-nav cursor-interaction" data-action="nav" data-view="${view}" ${active === view ? 'aria-current="page"' : ""}>${icon(ico)}${label}${view === "shop" && listItems().length ? `<span class="k-count">${listItems().filter((i) => !state.bought[i.key]).length}</span>` : ""}</button>`,
      )
      .join("");
    root.querySelector(".k-sidebar").innerHTML =
      html +
      '<div class="k-sidebar-foot">Good food.<br>All in one place.</div>';
    root.querySelector(".k-mobile-nav").innerHTML = html;
  }
  function resumeBanner() {
    return state.session && state.view !== "cook"
      ? `<div class="k-resume"><div><div class="k-kicker">On the stove</div><div class="k-small">${esc(state.session.mealTitle || state.session.snapshot.title)} · Step ${state.session.step + 1}</div></div>${button("Resume", "resume", "", "k-quiet")}</div>`
      : "";
  }
  function uid(prefix) {
    return prefix + "-" + randomId();
  }
  function meal(id = state.selectedMeal) {
    return state.meals.find((m) => m.id === id) || state.meals[0];
  }
  function mealPortionsLabel(m) {
    if (m.components.some((c) => !recipe(c.recipeId).servings))
      return "Original quantities included";
    const n = m.components[0]?.servings;
    return m.components.every((c) => c.servings === n)
      ? n + " portion" + (n === 1 ? "" : "s") + " per dish"
      : "Portions set per dish";
  }
  function mealEntries(m, prefix = "meal:" + m.id) {
    return m.components.map((c) => ({
      source: prefix + ":" + c.id,
      recipeId: c.recipeId,
      servings: c.servings,
      context: m.title,
    }));
  }
  function equipmentView(components, heading = "Required tools") {
    const { rows, unknown, ovens, conflict } = equipmentSummary(
      components,
      recipe,
    );
    return `<section class="k-equipment"><h3>${esc(heading)}</h3>${rows.map((t) => `<div class="k-tool-row"><span>${esc(t.name)}${components.length > 1 ? `<div class="k-tool-uses">${esc(t.uses.join(" · "))}</div>` : ""}</span>${icon("utensils")}</div>`).join("")}${unknown.length ? `<p class="k-note">Tools not specified: ${esc(unknown.join(", "))}.</p>` : ""}${components.length > 1 && rows.length ? '<p class="k-note">Shared tools may need to be reused between dishes. Check sizes and availability before starting.</p>' : ""}${conflict ? `<div class="k-notice" style="margin-top:15px"><strong>Check the oven plan.</strong><br>${ovens.map((r) => esc(r.title) + ": " + r.temps.map((t) => esc(scaledText(t + "°C"))).join(", ")).join("<br>")}<br>With one oven, these dishes need a reviewed cooking order.</div>` : ""}</section>`;
  }
  function mealsView() {
    return `${resumeBanner()}<div class="k-heading"><div><div class="k-kicker">Meals & prep</div><h1>A whole meal, together.</h1><p class="k-muted k-small">Bring your favorite dishes to the same table.</p></div>${button(icon("plus") + "Create a meal", "new-meal", "", "k-primary")}</div><div class="k-meal-list">${state.meals.map((m) => `<article class="k-meal-card"><div class="k-kicker">${m.components.length} dish${m.components.length === 1 ? "" : "es"}</div><h2>${esc(m.title)}</h2><p class="k-small k-muted">${esc(m.components.map((c) => recipe(c.recipeId).title).join(" + "))}</p><div class="k-row" style="margin-top:17px">${button("Open meal" + icon("arrow-right"), "open-meal", `data-id="${esc(m.id)}"`)}<span class="k-small k-muted">${esc(mealPortionsLabel(m))}</span></div></article>`).join("")}</div><div class="k-actions">${button(icon("sparkles") + "Explore AI meal planning", "byk-compose", "", "k-quiet")}</div>`;
  }
  function mealView() {
    const m = meal();
    if (!m) {
      state.view = "meals";
      return mealsView();
    }
    return `${resumeBanner()}${button(icon("arrow-left") + "Meals", "nav", 'data-view="meals"', "k-quiet k-back")}<div class="k-row k-between"><span class="k-tag">${m.components.length} dish${m.components.length === 1 ? "" : "es"} · One meal</span>${button(icon("pencil") + "Edit meal", "edit-meal", "", "k-quiet")}</div><h1 class="k-detail-title">${esc(m.title)}</h1><p class="k-muted">${esc(m.note)}</p><div class="k-actions">${button(icon("play") + "Cook meal", "start-meal", "", "k-primary")}${button(icon("shopping-basket") + "Shop meal", "review-meal")}${button(icon("sparkles") + "Ask assistant", "byk-meal", "", "k-quiet")}</div><section><h2>On the menu</h2>${m.components
      .map((c) => {
        const r = recipe(c.recipeId);
        return `<div class="k-dish"><div class="k-dish-main"><div class="k-kicker">${esc(c.role)}</div><h3>${esc(r.title)}</h3>${button("View recipe", "open", `data-id="${esc(r.id)}"`, "k-quiet")}</div><div><div class="k-small k-muted">${r.servings ? "Dish portions" : "Original quantities"}</div>${r.servings ? `<div class="k-stepper">${button(icon("minus"), "meal-portions", `data-id="${esc(c.id)}" data-delta="-1" aria-label="Fewer portions of ${esc(r.title)}" ${c.servings <= 1 ? "disabled" : ""}`, "k-quiet k-icon")}<strong>${c.servings}</strong>${button(icon("plus"), "meal-portions", `data-id="${esc(c.id)}" data-delta="1" aria-label="More portions of ${esc(r.title)}" ${c.servings >= 24 ? "disabled" : ""}`, "k-quiet k-icon")}</div>` : '<p class="k-note">Set the recipe yield to scale.</p>'}</div></div>`;
      })
      .join(
        "",
      )}<p class="k-note">Set portions for each dish. Shop meal reviews the combined ingredients.</p></section>${equipmentView(m.components)}<div class="k-actions">${button(icon("calendar-plus") + "Put in weekly plan", "schedule-meal", "", "k-quiet")}</div>`;
  }
  function mealEditorView() {
    const d = mealDraft || { title: "", note: "", components: [] };
    return `${button(icon("arrow-left") + "Meals", "cancel-meal", "", "k-quiet k-back")}<div class="k-heading"><div><div class="k-kicker">Made to go together</div><h1>${d.id ? "Edit your meal." : "Compose a meal."}</h1><p class="k-muted k-small">Choose the dishes and the portions you want to make.</p></div></div><form id="k-meal-form" class="k-stack"><label class="k-field"><span>Meal name</span><input class="k-input" name="title" value="${esc(d.title)}" required maxlength="100" placeholder="Friday dinner"></label><label class="k-field"><span>A note for this meal</span><input class="k-input" name="note" value="${esc(d.note)}" maxlength="200" placeholder="Something warm, something fresh"></label><div>${allRecipes()
      .map((r) => {
        const c = d.components.find((c) => c.recipeId === r.id);
        return `<div class="k-meal-option"><label class="k-check-row"><input type="checkbox" name="recipes" value="${esc(r.id)}" ${c ? "checked" : ""}><span class="k-item-main">${esc(r.title)}</span></label><label class="k-field"><span>Dish role</span><select class="k-select" name="role-${esc(r.id)}" aria-label="Role of ${esc(r.title)}">${["Main", "Side", "Starter", "Dessert"].map((role) => `<option ${role === (c?.role || "Side") ? "selected" : ""}>${role}</option>`).join("")}</select></label><label class="k-field"><span>Portions</span><input class="k-input" name="portions-${esc(r.id)}" aria-label="Portions of ${esc(r.title)}" type="number" min="1" max="24" step="1" value="${c?.servings || r.servings || 1}" ${r.servings ? "" : "disabled"}></label></div>`;
      })
      .join(
        "",
      )}</div><p id="k-meal-error" class="k-form-error" role="alert"></p><div class="k-row"><button type="button" data-local-submit class="k-button k-primary cursor-interaction">${icon("check")} Save meal</button>${button("Cancel", "cancel-meal", "", "k-quiet")}</div></form>`;
  }
  function bykView() {
    const m = meal();
    let proposal = "";
    if (bykPreview === "compose")
      proposal = `<div class="k-byk-proposal"><div class="k-kicker">Sample proposal · Review before applying</div><h2>Weeknight dinner</h2><p class="k-small k-muted">Use two saved recipes for a main and a fresh side.</p><ul class="k-proposal-lines"><li>Main: ${esc(recipe("orzo").title)} · 4 portions</li><li>Side: ${esc(recipe("salad").title)} · 4 portions</li></ul><p class="k-small">Create one meal. Then review its shopping and required tools.</p><div class="k-actions">${button("Create this meal", "byk-apply", "", "k-primary")}${button("Dismiss", "byk-dismiss", "", "k-quiet")}</div></div>`;
    if (bykPreview === "shop" && m)
      proposal = `<div class="k-byk-proposal"><div class="k-kicker">Sample shopping request</div><h2>Shop ${esc(m.title)}</h2><ul class="k-proposal-lines">${m.components.map((c) => `<li>${esc(recipe(c.recipeId).title)} · ${recipe(c.recipeId).servings ? c.servings + " portions" : "original quantities"}</li>`).join("")}</ul><p class="k-small">Check what you already have, then add the combined ingredients.</p><div class="k-actions">${button("Review ingredients", "review-meal", "", "k-primary")}</div></div>`;
    if (bykPreview === "tools" && m)
      proposal = `<div class="k-byk-proposal"><div class="k-kicker">Sample preparation request</div><h2>${esc(m.title)}</h2>${equipmentView(m.components)}<div class="k-actions">${button("Open cooking view", "start-meal", "", "k-primary")}</div></div>`;
    const result =
      bykResult && state.meals.some((m) => m.id === bykResult.mealId)
        ? `<div class="k-resume"><div><div class="k-kicker">Meal created</div><span class="k-small">Created ${esc(meal(bykResult.mealId).title)}</span></div><div class="k-row">${button("Open meal", "open-meal", `data-id="${esc(bykResult.mealId)}"`, "k-quiet")}${button("Undo", "byk-undo", "", "k-quiet")}</div></div>`
        : "";
    return `<div class="k-heading"><div><div class="k-kicker">Your cooking assistant</div><h1>Your AI, your kitchen.</h1><p class="k-muted k-small">From saved recipes to a meal on the table.</p></div></div><div class="k-notice">Assistant not connected · Explore the sample actions below.</div><details class="k-source"><summary class="cursor-interaction">Your AI connections</summary><div class="k-tool-row"><span>OpenAI / ChatGPT</span><span class="k-small k-muted">Not connected</span></div><div class="k-tool-row"><span>Claude</span><span class="k-small k-muted">Not connected</span></div><p class="k-note">Account sign-in is being evaluated for each provider. Account connections are not available in this version.</p></details><div class="k-byk-intents">${button(icon("utensils") + "Build dinner for four", "byk-compose", "", "k-byk-choice")}${button(icon("shopping-basket") + "Shop a saved meal", "byk-shop", m ? "" : "disabled", "k-byk-choice")}${button(icon("cooking-pot") + "Prepare to cook a meal", "byk-tools", m ? "" : "disabled", "k-byk-choice")}${button(icon("plus") + "Add a recipe manually", "capture", "", "k-byk-choice")}</div>${m ? `<p class="k-small k-muted">Meal context: ${esc(m.title)}</p>` : ""}${result}${proposal}`;
  }
  function switchDish(id) {
    const s = state.session;
    if (!s?.dishes) return;
    const current = s.dishes.find((d) => d.id === s.activeDish);
    if (current) current.step = s.step;
    const next = s.dishes.find((d) => d.id === id);
    if (!next) return;
    s.activeDish = next.id;
    s.recipeId = next.recipeId;
    s.snapshot = next.snapshot;
    s.servings = next.servings;
    s.step = next.step;
  }
  function startMeal() {
    const m = meal();
    if (!m?.components.length) return false;
    if (state.session) {
      if (state.session.mealId === m.id) {
        state.view = "cook";
        return true;
      }
      notify(
        "Resume and finish the current cooking session before starting this meal.",
      );
      return false;
    }
    const dishes = m.components.map((c) => ({
      ...c,
      snapshot: structuredClone(recipe(c.recipeId)),
      step: 0,
      finished: false,
    }));
    if (dishes.some((d) => !d.snapshot.steps.length)) {
      notify("Add a method to each dish before starting.");
      return false;
    }
    const d = dishes[0];
    state.session = {
      mealId: m.id,
      mealTitle: m.title,
      dishes,
      activeDish: d.id,
      recipeId: d.recipeId,
      snapshot: d.snapshot,
      servings: d.servings,
      units: state.units,
      step: 0,
      timers: [],
    };
    state.view = "cook";
    return true;
  }
  function dishTabs(s) {
    return s.dishes
      ? `<div class="k-meal-context">${icon("utensils")}${esc(s.mealTitle)}</div><div class="k-dish-tabs" role="group" aria-label="Dishes in this meal">${s.dishes.map((d) => button((d.finished ? icon("check") : "") + esc(d.snapshot.title), "switch-dish", `data-id="${esc(d.id)}" aria-label="Switch to ${esc(d.snapshot.title)}" aria-pressed="${s.activeDish === d.id}"`)).join("")}</div>`
      : "";
  }
  function libraryCards() {
    const term = state.query.trim().toLowerCase();
    const found = allRecipes().filter(
      (r) =>
        (state.filter !== "favorites" || state.favorites.includes(r.id)) &&
        (state.filter !== "quick" || (r.time && r.time <= 30)) &&
        matchesFacets(r, facets) &&
        (!term ||
          [
            r.title,
            r.description,
            r.note,
            state.notes[r.id],
            ...r.ingredients.map((i) => i.n),
            facetText(r),
          ]
            .join(" ")
            .toLowerCase()
            .includes(term)),
    );
    return found.length
      ? `<div class="k-grid">${found.map((r) => `<article class="k-recipe-card"><button type="button" class="k-card-open cursor-interaction" data-action="open" data-id="${esc(r.id)}"><span class="k-tag">${esc(courseLabel(r.course) ?? "Your collection")}</span><span class="k-card-title">${esc(r.title)}</span><span class="k-card-description">${esc(r.description)}</span></button>${facetBadges(r)}<div class="k-card-footer"><span class="k-card-meta">${icon("clock-3")}${r.time ? `${r.time} min` : "Time not set"} <span>·</span> ${r.servings ? r.servings + " servings" : "Yield not set"}</span><button type="button" class="k-button k-quiet k-icon k-favorite cursor-interaction" aria-label="${state.favorites.includes(r.id) ? "Unfavorite" : "Favorite"} ${esc(r.title)}" aria-pressed="${state.favorites.includes(r.id)}" data-action="favorite" data-id="${esc(r.id)}">${icon("heart")}</button></div></article>`).join("")}</div><p class="k-library-footer">${found.length} recipe${found.length !== 1 ? "s" : ""} in your collection</p>`
      : `<div class="k-empty">${icon("search")}<h2>No recipes found</h2><p>Try an ingredient, a different name, or another filter.</p>${button("Clear filters", "clear-search")}</div>`;
  }
  // Cuisine, diet labels and tags of a recipe, as small badges.
  function facetBadges(r, cls = "k-card-facets") {
    const labels = [
      ...(r.cuisine ? [r.cuisine] : []),
      ...(r.diets || []).map(dietLabel),
      ...(r.tags || []),
    ];
    return labels.length
      ? `<div class="${cls}">${labels.map((label) => `<span class="k-chip">${esc(label)}</span>`).join("")}</div>`
      : "";
  }
  // Facet filter rows for the library, from what the cookbook contains.
  function facetFilters() {
    const vocabulary = taxonomy(allRecipes());
    const chip = (label, attrs, pressed) =>
      `<button type="button" class="k-filter cursor-interaction" data-action="facet" ${attrs} aria-pressed="${pressed}">${esc(label)}</button>`;
    const row = (label, chips) =>
      chips.length
        ? `<div class="k-facet-row"><span class="k-facet-label">${label}</span><div class="k-filters" aria-label="${label} filters">${chips.join("")}</div></div>`
        : "";
    const chosen = (facet, value) =>
      Array.isArray(facets[facet])
        ? facets[facet].some((v) => labelKey(v) === labelKey(value))
        : labelKey(facets[facet]) === labelKey(value);
    const options = (facet, entries, nameOf, labelOf) =>
      entries.map((entry) =>
        chip(
          labelOf(entry),
          `data-facet="${facet}" data-value="${esc(nameOf(entry))}"`,
          chosen(facet, nameOf(entry)),
        ),
      );
    const single = (facet, entries, nameOf, labelOf) =>
      entries.length
        ? [
            chip("All", `data-facet="${facet}" data-value=""`, !facets[facet]),
            ...options(facet, entries, nameOf, labelOf),
          ]
        : [];
    return (
      row(
        "Course",
        single(
          "course",
          vocabulary.courses,
          (c) => c.key,
          (c) => c.label,
        ),
      ) +
      row(
        "Cuisine",
        single(
          "cuisine",
          vocabulary.cuisines,
          (c) => c.name,
          (c) => c.name,
        ),
      ) +
      row(
        "Diet",
        options(
          "diets",
          vocabulary.diets,
          (d) => d.key,
          (d) => d.label,
        ),
      ) +
      row(
        "Tags",
        options(
          "tags",
          vocabulary.tags,
          (t) => t.name,
          (t) => t.name,
        ),
      ) +
      (hasFacetFilters(facets)
        ? `<div class="k-facet-row">${button("Clear filters", "clear-search", "", "k-quiet")}</div>`
        : "")
    );
  }
  function cuisineOptions() {
    const inUse = taxonomy(allRecipes()).cuisines;
    const seen = new Set(inUse.map((c) => labelKey(c.name)));
    return [
      ...inUse.map((c) => c.name),
      ...suggestedCuisines.filter((name) => !seen.has(labelKey(name))),
    ];
  }
  function libraryView() {
    return `${resumeBanner()}<div class="k-heading"><div><div class="k-kicker">Your everyday cookbook</div><h1>Your kitchen, collected.</h1><p class="k-muted k-small">The recipes you love. Ready when you are.</p></div>${button(icon("plus") + "Add recipe", "capture", "", "k-primary")}</div><label class="k-search">${icon("search")}<span class="k-sr">Search recipes and ingredients</span><input id="k-search" type="search" placeholder="Find a recipe or ingredient…" value="${esc(state.query)}" autocomplete="off"></label><div class="k-filters" aria-label="Recipe filters">${[
      ["all", "All recipes"],
      ["favorites", "Favorites"],
      ["quick", "30 minutes or less"],
    ]
      .map(
        ([v, l]) =>
          `<button type="button" class="k-filter cursor-interaction" data-action="filter" data-value="${v}" aria-pressed="${state.filter === v}">${l}</button>`,
      )
      .join(
        "",
      )}</div>${facetFilters()}<div id="k-results">${libraryCards()}</div><p class="k-note">Six example recipes are included to help you get started. Everything you add is saved on this device.</p>`;
  }
  function unitSelect() {
    return `<label class="k-field"><span class="k-sr">Measurement display</span><select class="k-select" id="k-units" aria-label="Measurement display">${[
      ["metric", "Metric"],
      ["us", "US kitchen"],
      ["original", "Original units"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${state.units === v ? "selected" : ""}>${l}</option>`,
      )
      .join("")}</select></label>`;
  }
  function ingredientRows(
    r,
    selectedServings = servings(r),
    ids = null,
    units = state.units,
  ) {
    return r.ingredients
      .filter((i) => !ids || ids.includes(i.k))
      .map(
        (i) =>
          `<div class="k-ingredient"><span class="k-amount">${esc(amount(i, r.servings ? selectedServings / r.servings : 1, units))}</span><span>${esc(i.n)}${i.q !== null && i.note ? `<br><span class="k-muted k-small">${esc(i.note)}</span>` : ""}</span></div>`,
      )
      .join("");
  }
  // Links and videos of a recipe. A recognised video shows a play button that
  // loads the provider's player only when pressed; everything else is a link.
  function linksView(links, heading = "Links and videos") {
    if (!links?.length) return "";
    return `<section class="k-links"><h3>${esc(heading)}</h3>${links
      .map((item) => {
        const info = describeLink(item.url);
        if (!info) return "";
        const title =
          item.title || (info.embed ? `${info.label} video` : item.url);
        const line = `<p class="k-small"><a href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(title)}</a> <span class="k-muted">· ${esc(info.site)}</span></p>`;
        if (!info.embed) return line;
        return `<div class="k-link-item"><div class="k-embed" data-shape="${info.embed.shape}" data-src="${esc(info.embed.autoplay_src)}" data-title="${esc(title)}">${button(icon("play") + `<span>Play on ${esc(info.label)}</span>`, "embed-load", `aria-label="${esc(item.title ? `Play ${item.title} on ${info.label}` : `Play on ${info.label}`)}"`, "k-embed-load")}<small>Loads the video from ${esc(info.label)} when you press play.</small></div>${line}</div>`;
      })
      .join("")}</section>`;
  }
  function linkLine(links) {
    if (!links?.length) return "";
    return `<p class="k-note">Links and videos: ${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.title || describeLink(l.url)?.site || l.url)}</a>`).join(" · ")}</p>`;
  }
  function loadEmbed(target) {
    const box = target.closest(".k-embed");
    if (!box) return;
    box.dataset.loaded = "true";
    box.innerHTML = `<iframe src="${esc(box.dataset.src)}" title="${esc(box.dataset.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }
  function shareText(r) {
    const links = (r.links || []).map((l) =>
      l.title ? `${l.title}: ${l.url}` : l.url,
    );
    return (
      originalText(r) + (links.length ? "\n\nLinks\n" + links.join("\n") : "")
    );
  }
  function detailView() {
    const r = recipe();
    return `${button(icon("arrow-left") + "Recipes", "nav", 'data-view="library"', "k-quiet k-back")}<div class="k-row k-between"><span class="k-tag">${esc(courseLabel(r.course) ?? "Your collection")}</span>${button(icon("pencil") + "Edit recipe", "edit", 'data-id="' + esc(r.id) + '"', "k-quiet")}</div><h1 class="k-detail-title">${esc(r.title)}</h1><p class="k-muted">${esc(r.description)}</p>${facetBadges(r, "k-detail-facets")}<div class="k-detail-meta"><span>${r.time ? r.time + " minutes" : "Time not set"}</span><span>·</span><span>${esc(r.source)}</span></div><div class="k-actions">${button(icon("play") + "Start cooking", "start-cook", "", "k-primary")}${button(icon("shopping-basket") + "Add to list", "review")}${button(icon("calendar-plus") + "Plan a meal", "schedule")}${button(icon("share-2") + "Share", "share-recipe")}</div><div class="k-recipe-columns"><section class="k-ingredients"><div class="k-row k-between"><h3>Ingredients</h3>${unitSelect()}</div><div class="k-serving-control"><span class="k-small">${r.servings ? "Servings" : "Original quantities"}</span>${r.servings ? `<div class="k-stepper">${button(icon("minus"), "servings", 'data-delta="-1" aria-label="Fewer servings" ' + (servings(r) <= 1 ? "disabled" : ""), "k-quiet k-icon")}<strong>${servings(r)}</strong>${button(icon("plus"), "servings", 'data-delta="1" aria-label="More servings" ' + (servings(r) >= 24 ? "disabled" : ""), "k-quiet k-icon")}</div>` : `${button("Set yield", "edit", "", "k-quiet")}`}</div>${ingredientRows(r)}${state.units === "us" ? '<p class="k-note">Cups use 240 mL. Weight stays in ounces; cup-to-gram estimates need an ingredient reference.</p>' : ""}${r.servings && servings(r) !== r.servings ? '<p class="k-note">Ingredient amounts adjusted. Cooking times stay the same.</p>' : ""}</section><section><h2>The method</h2><ol class="k-method">${r.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(scaledText(s.text))}</p></li>`).join("")}</ol>${r.note ? `<div class="k-notice">${esc(r.note)}</div>` : ""}${linksView(r.links)}<details class="k-source"><summary class="cursor-interaction">Original recipe</summary><pre>${esc(originalText(r))}</pre></details><label class="k-field" style="margin-top:20px"><span>Your cooking notes</span><textarea class="k-input" id="k-recipe-note" placeholder="What worked? What would you change?">${esc(state.notes[r.id] || "")}</textarea></label>${button("Save note", "save-note", 'style="margin-top:9px"', "k-quiet")}</section></div>`;
  }
  function makeReview(entries, options = {}) {
    review = {
      returnView: options.returnView || state.view,
      replaceGroup: options.replaceGroup || null,
      entries: buildReview(entries, recipe),
      excluded: new Set(),
    };
    state.view = "review";
    render();
  }
  function applyShoppingReview() {
    Object.assign(state, applyReview(state, review));
    state.view = "shop";
    noteMessage =
      "Your list is ready. Matching ingredients have been combined.";
    review = null;
  }
  function reviewView() {
    if (!review) {
      state.view = "detail";
      return detailView();
    }
    let count = 0;
    const rows = review.entries
      .map(
        (e, ei) =>
          `<h3 class="k-group-label">${esc(e.title)} · ${e.yieldKnown ? e.servings + " servings" : "original quantities"}</h3>${e.items
            .map((i, ii) => {
              const key = ei + "-" + ii;
              const checked = !review.excluded.has(key);
              if (checked) count++;
              return `<label class="k-check-row"><input type="checkbox" data-review="${key}" ${checked ? "checked" : ""}><span class="k-item-main">${esc(i.n)}${i.note && i.q !== null ? `<br><span class="k-small k-muted">${esc(i.note)}</span>` : ""}</span><span class="k-item-amount">${esc(amount(i, 1, state.units === "original" ? "metric" : state.units))}</span></label>`;
            })
            .join("")}`,
      )
      .join("");
    return `${button(icon("arrow-left") + "Back", "review-back", "", "k-quiet k-back")}<div class="k-heading"><div><div class="k-kicker">A quick kitchen check</div><h1>What do you need?</h1><p class="k-muted k-small">Uncheck anything you already have.</p></div></div>${rows}<div class="k-actions">${button(icon("shopping-basket") + `Add ${count} items to list`, "confirm-list", count ? "" : "disabled", "k-primary")}${button("Select all", "select-all", "", "k-quiet")}</div><p class="k-note">Matching ingredients will combine. Adding this selection again updates its quantities.</p>`;
  }
  function shopView() {
    const items = listItems();
    const remaining = items.filter((i) => !state.bought[i.key]).length;
    const header = `${resumeBanner()}<div class="k-heading"><div><div class="k-kicker">For the next good meal</div><h1>Your shopping list</h1><p class="k-muted k-small">${items.length ? remaining + " of " + items.length + " items left" : "Make room for something delicious."}</p></div>${items.length ? button(icon("plus") + "Add a recipe", "nav", 'data-view="library"') : ""}</div>`;
    if (!items.length)
      return `${header}<div class="k-empty">${icon("shopping-basket")}<h2>Start with a recipe</h2><p>Add the ingredients you need, or jot down an everyday essential.</p>${button("Browse recipes", "nav", 'data-view="library"', "k-primary")}</div>${manualForm()}`;
    const groups = ["Produce", "Dairy & eggs", "Pantry", "Other"];
    const rows = groups
      .map((group) => {
        const selected = items.filter((i) => (i.group || "Other") === group);
        return selected.length
          ? `<h3 class="k-group-label">${group}</h3>${selected.map((i) => `<label class="k-check-row ${state.bought[i.key] ? "k-bought" : ""}"><input type="checkbox" data-buy="${esc(i.key)}" ${state.bought[i.key] ? "checked" : ""}><span class="k-item-main">${esc(i.n)}<br><span class="k-small k-muted">${esc(i.note && i.q !== null ? i.note + " · " : "")}${esc(i.sources.join(" + "))}</span></span><span class="k-item-amount">${i.manual ? "" : esc(amount(i, 1, state.units === "original" ? "metric" : state.units))}</span></label>`).join("")}`
          : "";
      })
      .join("");
    return `${header}${rows}${manualForm()}<details class="k-source"><summary class="cursor-interaction">Recipes on this list (${Object.keys(state.contributions).length})</summary><div class="k-stack" style="margin-top:12px">${Object.entries(
      state.contributions,
    )
      .map(
        ([key, c]) =>
          `<div class="k-row k-between"><span class="k-small">${esc(c.title)}</span>${button(icon("x"), "remove-contribution", `data-key="${esc(key)}" aria-label="Remove ${esc(c.title)} from list"`, "k-quiet k-icon")}</div>`,
      )
      .join("")}</div></details>`;
  }
  function manualForm() {
    return (
      '<form id="k-manual-form" class="k-inline-add"><label class="k-sr" for="k-manual-input">Add an everyday item</label><input class="k-input" id="k-manual-input" name="item" required maxlength="100" placeholder="Add milk, coffee, anything…"><button type="button" data-local-submit class="k-button cursor-interaction" aria-label="Add item">' +
      icon("plus") +
      "</button></form>"
    );
  }
  function planView() {
    const picked = state.planPickMeal
      ? meal(state.planPickMeal)?.title
      : state.planPickRecipe
        ? recipe(state.planPickRecipe).title
        : null;
    return `${resumeBanner()}<div class="k-heading"><div><div class="k-kicker">A little planning goes a long way</div><h1>Good things this week.</h1><p class="k-muted k-small">Save a place for a recipe or a complete meal.</p></div>${state.plan.length ? button(icon("shopping-basket") + "Shop the plan", "shop-plan", "", "k-primary") : ""}</div>${picked ? `<div class="k-notice">Choose a day for ${esc(picked)}.</div>` : ""}<div class="k-plan-grid">${days
      .map(
        (day, index) =>
          `<section class="k-day"><div class="k-day-name">${day.slice(0, 3)}</div><div>${state.plan
            .filter((e) => e.day === index)
            .map((e) => {
              const title = e.mealId ? e.title : recipe(e.recipeId).title;
              return `<div class="k-day-recipe">${button(esc(title), e.mealId ? "open-meal" : "open", `data-id="${esc(e.mealId || e.recipeId)}"`, "k-quiet")}${button(icon("x"), "remove-plan", `data-id="${esc(e.id)}" aria-label="Remove ${esc(title)} from ${day}"`, "k-quiet k-icon")}</div>${e.mealId ? `<p class="k-note">${e.components.length} dishes · Portions saved for this day</p>` : ""}`;
            })
            .join(
              "",
            )}<form class="k-plan-choice" data-day="${index}"><label class="k-sr" for="k-day-${index}">Recipe or meal for ${day}</label><select class="k-select" id="k-day-${index}" name="recipe"><option value="">Choose a recipe or meal</option><optgroup label="Meals">${state.meals.map((m) => `<option value="meal:${esc(m.id)}" ${state.planPickMeal === m.id ? "selected" : ""}>${esc(m.title)}</option>`).join("")}</optgroup><optgroup label="Recipes">${allRecipes()
            .map(
              (r) =>
                `<option value="${esc(r.id)}" ${state.planPickRecipe === r.id ? "selected" : ""}>${esc(r.title)}</option>`,
            )
            .join(
              "",
            )}</optgroup></select><button type="button" data-local-submit class="k-button k-quiet k-icon cursor-interaction" aria-label="Add to ${day}">${icon("plus")}</button></form></div></section>`,
      )
      .join("")}</div>`;
  }
  function timerView(t) {
    return `<div class="k-timer"><div><div class="k-small">${esc(t.label)}</div><span class="k-timer-time" data-timer="${esc(t.id)}">${timeLeft(t) === 0 ? "Ready" : clockText(timeLeft(t))}</span></div>${button(icon(t.pausedMs === null ? "pause" : "play"), "toggle-timer", `data-id="${esc(t.id)}" aria-label="${t.pausedMs === null ? "Pause" : "Resume"} ${esc(t.label)} timer"`, "k-quiet k-icon")}${button(icon("x"), "remove-timer", `data-id="${esc(t.id)}" aria-label="Remove ${esc(t.label)} timer"`, "k-quiet k-icon")}</div>`;
  }
  function cookView() {
    const s = state.session;
    if (!s) {
      state.view = "detail";
      return detailView();
    }
    const r = s.snapshot,
      step = r.steps[s.step],
      ids = step.ids?.length ? step.ids : null;
    const dishTimers = s.timers.filter(
      (t) => !s.dishes || t.dishId === s.activeDish,
    );
    const finishLabel = s.dishes
      ? dishTimers.length
        ? "Finish dish & stop its timers"
        : "Finish dish"
      : s.timers.length
        ? "Finish & stop timers"
        : "Finish cooking";
    return `<div class="k-row k-between">${button(icon("arrow-left") + (s.mealId ? "Meal" : "Recipe"), "leave-cook", "", "k-quiet k-back")}<span class="k-kicker">Cooking mode</span></div>${dishTabs(s)}<h2>${esc(r.title)}</h2><p class="k-muted k-small" style="margin-top:7px">${r.servings ? s.servings + " servings" : "Original quantities"} · ${s.units === "us" ? "US kitchen" : s.units === "original" ? "Original units" : "Metric"}</p><div class="k-progress" role="progressbar" aria-label="Recipe progress" aria-valuemin="0" aria-valuemax="${r.steps.length}" aria-valuenow="${s.step + 1}"><div class="k-progress-fill" style="width:${((s.step + 1) / r.steps.length) * 100}%"></div></div><div class="k-cook-layout"><section><div class="k-kicker">Step ${s.step + 1} of ${r.steps.length}</div><div class="k-cook-step">${esc(step.title)}</div><p class="k-cook-copy">${esc(scaledText(step.text, s.units))}</p>${linkLine(r.links)}${step.mins && !dishTimers.some((t) => t.step === s.step) ? button(icon("timer") + `Start ${step.mins}-minute timer`, "start-timer", 'style="margin-top:22px"', "k-primary") : ""}<div>${s.timers.map(timerView).join("")}</div>${button(icon("timer") + "Add a 5-minute timer", "custom-timer", 'style="margin-top:12px"', "k-quiet")}<details class="k-source"><summary class="cursor-interaction">See the whole method</summary><ol class="k-method">${r.steps.map((st, i) => `<li>${button(esc(st.title), "jump-step", `data-step="${i}"`, "k-quiet")}<p>${esc(scaledText(st.text, s.units))}</p></li>`).join("")}</ol></details></section><aside class="k-cook-ingredients"><h3>${ids ? "For this step" : "Ingredients"}</h3>${ingredientRows(r, s.servings, ids, s.units)}${equipmentView([{ snapshot: r }])}</aside></div><p class="k-note">${isNative ? "Device notifications depend on permissions and system settings. Android alerts may be delayed." : "Keep this page open for browser timer alerts."}</p><div class="k-cook-footer">${button(icon("arrow-left") + "Previous", "cook-back", s.step === 0 ? "disabled" : "")}${s.step === r.steps.length - 1 ? button(icon("check") + finishLabel, "finish-cook", "", "k-primary") : button("Next step" + icon("arrow-right"), "cook-next", "", "k-primary")}</div>`;
  }
  function finishedView() {
    const r = recipe();
    return `<div class="k-empty" style="padding-top:30px">${icon("check")}<div class="k-kicker">Made with care</div><h1>That’s a keeper.</h1><p>${esc(r.title)}</p></div><label class="k-field"><span>A note for next time</span><textarea id="k-finish-note" class="k-input" placeholder="A little more lemon? Five extra minutes?">${esc(state.notes[r.id] || "")}</textarea></label><div class="k-actions">${button("Save & return to recipes", "finish-note", "", "k-primary")}${button("Skip for now", "nav", 'data-view="library"', "k-quiet")}</div>`;
  }
  function captureView() {
    return `${button(icon("arrow-left") + "Recipes", "nav", 'data-view="library"', "k-quiet k-back")}<div class="k-heading"><div><div class="k-kicker">Keep a good thing</div><h1>A new recipe.</h1><p class="k-muted k-small">Copy it from a message. Make it yours.</p></div></div><form id="k-paste-form" class="k-stack"><label class="k-field"><span>Paste a recipe</span><textarea class="k-input" id="k-paste" name="text" style="min-height:260px" required maxlength="6000" placeholder="Recipe name&#10;Serves 4&#10;&#10;Ingredients&#10;250 g orzo&#10;2 tbsp olive oil&#10;&#10;Method&#10;1. Warm the olive oil…"></textarea></label><div class="k-row"><button type="button" data-local-submit class="k-button k-primary cursor-interaction">Review recipe ${icon("arrow-right")}</button>${button("Write it myself", "manual-recipe", "", "k-quiet")}</div><p class="k-note">You’ll be able to edit the ingredients and method before saving. The original message stays with your recipe.</p></form>`;
  }
  function editorView() {
    if (!draft) {
      draft = {
        id: null,
        title: "",
        servings: 4,
        ingredientsText: "",
        stepsText: "",
        linksText: "",
        originalText: "",
      };
    }
    return `${button(icon("arrow-left") + "Back", "editor-back", "", "k-quiet k-back")}<div class="k-heading"><div><div class="k-kicker">Your recipe, your way</div><h1>${draft.id ? "Make it your own." : "A quick read-through."}</h1><p class="k-muted k-small">Check the ingredients, servings, and method.</p></div></div><form id="k-editor-form" class="k-stack"><div class="k-editor-meta"><label class="k-field"><span>Recipe name</span><input class="k-input" name="title" value="${esc(draft.title)}" required maxlength="120"></label><label class="k-field"><span>Servings</span><input class="k-input" name="servings" type="number" min="1" max="24" step="1" value="${draft.servings || ""}" placeholder="Unknown"></label></div><div class="k-editor-facets"><label class="k-field"><span>Course</span><select class="k-select" name="course">${[["", "Not recorded"], ...courses.map((c) => [c.key, c.label])].map(([value, label]) => `<option value="${value}" ${(draft.course ?? "") === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="k-field"><span>Cuisine</span><input class="k-input" name="cuisine" list="k-cuisines" maxlength="100" value="${esc(draft.cuisine || "")}" placeholder="Italian, Israeli…"><datalist id="k-cuisines">${cuisineOptions()
      .map((name) => `<option value="${esc(name)}"></option>`)
      .join(
        "",
      )}</datalist></label></div><label class="k-field"><span>Tags · separated by commas</span><input class="k-input" name="tags" maxlength="4000" value="${esc(draft.tagsText || "")}" placeholder="Weeknight, Shabbat, kid-friendly"></label><fieldset class="k-field k-diets"><legend>Diet labels</legend><div class="k-filters">${diets.map((d) => `<label class="k-filter k-check-chip"><input type="checkbox" name="diets" value="${d.key}" ${(draft.diets || []).includes(d.key) ? "checked" : ""}>${d.label}</label>`).join("")}</div><span class="k-note">What you know about this recipe, not an allergen check.</span></fieldset><div class="k-editor-grid"><label class="k-field"><span>Ingredients · one per line</span><textarea class="k-input" name="ingredients" style="min-height:240px" placeholder="250 g orzo&#10;2 tbsp olive oil" required maxlength="4000">${esc(draft.ingredientsText)}</textarea></label><label class="k-field"><span>Method · one step per paragraph</span><textarea class="k-input" name="steps" style="min-height:240px" placeholder="Warm the olive oil.&#10;&#10;Add the orzo and stir." required maxlength="5000">${esc(draft.stepsText)}</textarea></label></div><label class="k-field"><span>Links and videos · one per line</span><textarea class="k-input" name="links" maxlength="4000" placeholder="https://youtu.be/… Folding the dough&#10;example.com/the-original The written version">${esc(draft.linksText || "")}</textarea><span class="k-note">A web address, then an optional title. YouTube, Vimeo, Facebook, Instagram and TikTok videos play on the recipe page; other links open in your browser.</span></label><p class="k-note">For pasted recipes, cups use 240 mL, tablespoons 15 mL, and teaspoons 5 mL. Check these against your source. Unclear ingredient amounts stay as written. Add a serving count when you know it to enable scaling.</p><div class="k-row"><button type="button" data-local-submit class="k-button k-primary cursor-interaction">${icon("check")} Save recipe</button>${button("Cancel", "editor-back", "", "k-quiet")}</div><p class="k-form-error" id="k-editor-error" role="alert"></p></form>`;
  }
  const knownIngredients = recipes.flatMap((r) => r.ingredients);
  const parseIngredient = (line) => parseIngredientLine(line, knownIngredients);
  function render() {
    root.classList.toggle("k-phone", design.preview === "Phone");
    root.classList.toggle("k-compact", design.density === "Compact");
    root.classList.toggle("k-rows", design.layout === "Rows");
    const clay = design.palette === "Clay";
    root.style.setProperty("--k-brand", clay ? "#7a4934" : "#385740");
    root.style.setProperty("--k-on-brand", clay ? "#fffaf4" : "#fffef7");
    root.style.setProperty("--k-soft", clay ? "#efe0d6" : "#e7edda");
    navigation();
    const views = {
      library: libraryView,
      detail: detailView,
      shop: shopView,
      plan: planView,
      review: reviewView,
      cook: cookView,
      finished: finishedView,
      capture: captureView,
      editor: editorView,
      meals: mealsView,
      meal: mealView,
      "meal-editor": mealEditorView,
      byk: bykView,
      settings: settingsView,
    };
    main.innerHTML = (views[state.view] || libraryView)();
    if (state.view === "detail")
      main
        .querySelector(".k-ingredients")
        .insertAdjacentHTML(
          "beforeend",
          equipmentView([{ recipeId: state.selected }]),
        );
    if (state.view === "editor")
      main
        .querySelector("#k-editor-form .k-editor-grid")
        .insertAdjacentHTML(
          "afterend",
          `<label class="k-field"><span>Required tools · one per line</span><textarea class="k-input" name="equipment" maxlength="1500" placeholder="Wide pan&#10;Measuring jug">${esc(draft?.equipmentText || "")}</textarea><span class="k-note">Leave blank if the recipe does not specify its equipment.</span></label>`,
        );
    root.querySelector(".k-toast").textContent = noteMessage;
    icons();
    updateTimers();
    if (renderedView && renderedView !== state.view)
      root.scrollIntoView({ block: "start", behavior: "auto" });
    renderedView = state.view;
  }
  function updateTimers() {
    if (!state.session) return;
    let changed = false;
    state.session.timers.forEach((t) => {
      const el = root.querySelector(`[data-timer="${t.id}"]`);
      if (el)
        el.textContent = timeLeft(t) === 0 ? "Ready" : clockText(timeLeft(t));
      if (timeLeft(t) === 0 && !t.announced) {
        t.announced = true;
        changed = true;
        notify(t.label + " timer is ready.");
      }
    });
    if (changed) save();
  }
  function newTimer(label, minutes, step) {
    const s = state.session;
    return {
      id: uid("timer"),
      notificationId: notificationId(s.timers),
      label: (s?.mealId ? s.snapshot.title + " · " : "") + label,
      step,
      dishId: s?.activeDish || null,
      endAt: Date.now() + minutes * 60000,
      pausedMs: null,
      announced: false,
    };
  }
  root.addEventListener("click", async (event) => {
    if (isRestoring) {
      event.preventDefault();
      return;
    }
    const localSubmit = event.target.closest("[data-local-submit]");
    if (localSubmit) {
      event.preventDefault();
      submitForm(localSubmit.closest("form"));
      return;
    }
    const target = event.target.closest("button[data-action]");
    if (!target || target.disabled) return;
    const a = target.dataset.action;
    if (a === "embed-load") {
      loadEmbed(target);
      return;
    }
    noteMessage = "";
    if (["start-timer", "custom-timer"].includes(a)) {
      if (state.session.timers.length >= 60) {
        notify("Finish or remove a timer before adding another.");
        return;
      }
      target.disabled = true;
      try {
        if (!(await enableTimerAlerts()))
          noteMessage = isNative
            ? "Timer started. Device alerts are off; keep Kooks open or use a device timer."
            : "Timer started. Browser timers alert while this page is open.";
      } catch {
        noteMessage = "Timer started. Device alerts are unavailable.";
      }
      target.disabled = false;
    }
    if (["favorite", "confirm-list", "cook-next", "finish-cook"].includes(a))
      tap();
    if (a === "settings") {
      navigate("settings");
      return;
    }
    if (a === "retry-save") {
      await save();
      render();
      return;
    }
    if (a === "share-recipe") {
      try {
        await shareRecipe(recipe().title, shareText(recipe()));
      } catch (error) {
        if (error.name !== "AbortError")
          notify("Sharing was cancelled or unavailable.");
      }
      return;
    }
    if (a === "export-backup") {
      try {
        await storage.flush().catch(() => {});
        await exportCookbook(
          snapshot({ ...state, custom: allRecipes() }, design),
        );
      } catch {
        notify("Could not export the cookbook. Please try again.");
      }
      return;
    }
    if (a === "restore-backup") {
      root.querySelector("#k-restore-file").click();
      return;
    }
    if (a === "cancel-restore") {
      pendingRestore = null;
      render();
      return;
    }
    if (a === "confirm-restore" && pendingRestore) {
      target.disabled = true;
      isRestoring = true;
      try {
        const next = structuredClone(pendingRestore);
        next.state.view = "library";
        await storage.save(next);
        state = next.state;
        Object.assign(design, next.design);
        pendingRestore = null;
        draft = null;
        review = null;
        mealDraft = null;
        bykResult = null;
        bykPreview = null;
        noteMessage = "Your cookbook has been restored.";
        render();
        void syncTimerAlerts(state.session?.timers || []).catch(() =>
          notify("Cookbook restored. Check your device timer alerts."),
        );
      } catch {
        notify("Restore failed. Your current cookbook has been kept.");
        target.disabled = false;
      } finally {
        isRestoring = false;
      }
      return;
    }
    if (a === "enable-alerts") {
      try {
        notify(
          (await enableTimerAlerts())
            ? "Timer alerts are enabled."
            : "Timer alerts are off. You can allow them in your device settings.",
        );
        await syncTimerAlerts(state.session?.timers || []);
      } catch {
        notify("Timer alerts are unavailable on this device.");
      }
      return;
    }
    if (a === "nav") {
      navigate(target.dataset.view);
      return;
    }
    if (a === "open") {
      navigate("detail", target.dataset.id);
      return;
    }
    if (a === "open-meal") {
      state.selectedMeal = target.dataset.id;
      navigate("meal");
      return;
    }
    if (a === "favorite") {
      const id = target.dataset.id;
      state.favorites = state.favorites.includes(id)
        ? state.favorites.filter((x) => x !== id)
        : [...state.favorites, id];
    } else if (a === "filter") state.filter = target.dataset.value;
    else if (a === "facet") {
      const { facet, value } = target.dataset,
        same = (v) => labelKey(v) === labelKey(value);
      if (Array.isArray(facets[facet]))
        facets[facet] = facets[facet].some(same)
          ? facets[facet].filter((v) => !same(v))
          : [...facets[facet], value];
      else facets[facet] = same(facets[facet]) ? "" : value;
    } else if (a === "clear-search") {
      state.query = "";
      state.filter = "all";
      facets = noFacets();
    } else if (a === "servings") {
      const r = recipe();
      state.servings[r.id] = Math.min(
        24,
        Math.max(1, servings(r) + Number(target.dataset.delta)),
      );
    } else if (a === "review") {
      const r = recipe();
      makeReview([
        { source: "recipe:" + r.id, recipeId: r.id, servings: servings(r) },
      ]);
      return;
    } else if (a === "review-back") {
      navigate(review?.returnView || "detail");
      return;
    } else if (a === "select-all") review.excluded.clear();
    else if (a === "confirm-list") applyShoppingReview();
    else if (a === "remove-contribution") {
      delete state.contributions[target.dataset.key];
      noteMessage =
        "Recipe ingredients removed. Other contributions are still on your list.";
    } else if (a === "schedule") {
      state.planPickRecipe = recipe().id;
      state.planPickMeal = null;
      state.view = "plan";
    } else if (a === "remove-plan") {
      const id = target.dataset.id;
      state.plan = state.plan.filter((e) => e.id !== id);
      Object.keys(state.contributions)
        .filter(
          (key) => key === "plan:" + id || key.startsWith("plan:" + id + ":"),
        )
        .forEach((key) => delete state.contributions[key]);
    } else if (a === "shop-plan") {
      makeReview(
        state.plan.flatMap((e) =>
          e.mealId
            ? mealEntries(
                { ...e, title: e.title + " · " + days[e.day] },
                "plan:" + e.id,
              )
            : [
                {
                  source: "plan:" + e.id,
                  recipeId: e.recipeId,
                  servings: e.servings,
                },
              ],
        ),
        { returnView: "plan" },
      );
      return;
    } else if (a === "start-cook") {
      const r = recipe();
      if (!r.steps.length) {
        notify("Add a method before starting cooking.");
        return;
      }
      if (state.session && state.session.recipeId !== r.id) {
        notify(
          "Finish your current cooking session before starting another recipe.",
        );
        return;
      }
      if (!state.session)
        state.session = {
          recipeId: r.id,
          snapshot: structuredClone(r),
          servings: servings(r),
          units: state.units,
          step: 0,
          timers: [],
        };
      state.view = "cook";
    } else if (a === "resume") {
      if (state.session) {
        state.selected = state.session.recipeId;
        state.view = "cook";
      }
    } else if (a === "leave-cook") {
      state.selected = state.session.recipeId;
      if (state.session.mealId) {
        state.selectedMeal = state.session.mealId;
        state.view = "meal";
      } else state.view = "detail";
    } else if (a === "cook-next")
      state.session.step = Math.min(
        state.session.step + 1,
        state.session.snapshot.steps.length - 1,
      );
    else if (a === "cook-back")
      state.session.step = Math.max(0, state.session.step - 1);
    else if (a === "jump-step")
      state.session.step = Number(target.dataset.step);
    else if (a === "start-timer") {
      const s = state.session,
        step = s.snapshot.steps[s.step];
      s.timers.push(newTimer(step.title, step.mins, s.step));
    } else if (a === "custom-timer")
      state.session.timers.push(newTimer("Kitchen timer", 5, null));
    else if (a === "toggle-timer") {
      const t = state.session.timers.find((t) => t.id === target.dataset.id);
      if (t.pausedMs === null) t.pausedMs = timeLeft(t);
      else {
        t.endAt = Date.now() + t.pausedMs;
        t.pausedMs = null;
      }
    } else if (a === "remove-timer")
      state.session.timers = state.session.timers.filter(
        (t) => t.id !== target.dataset.id,
      );
    else if (a === "finish-cook") {
      const s = state.session;
      if (s.dishes) {
        const d = s.dishes.find((d) => d.id === s.activeDish);
        d.finished = true;
        s.timers = s.timers.filter((t) => t.dishId !== s.activeDish);
        const next = s.dishes.find((d) => !d.finished);
        if (next) {
          switchDish(next.id);
          noteMessage =
            "Dish finished. Continue with " + next.snapshot.title + ".";
        } else {
          state.selectedMeal = s.mealId;
          state.session = null;
          state.view = "meal";
          noteMessage = "Meal finished. All dishes are complete.";
        }
      } else {
        state.selected = s.recipeId;
        state.session = null;
        state.view = "finished";
      }
    } else if (a === "save-note") {
      state.notes[state.selected] = root.querySelector("#k-recipe-note").value;
      noteMessage = "Note saved for next time.";
    } else if (a === "finish-note") {
      state.notes[state.selected] = root.querySelector("#k-finish-note").value;
      state.view = "library";
      noteMessage = "Your cooking note is saved.";
    } else if (a === "capture") {
      draft = null;
      state.view = "capture";
    } else if (a === "manual-recipe") {
      draft = {
        id: null,
        title: "",
        servings: 4,
        ingredientsText: "",
        stepsText: "",
        linksText: "",
        originalText: "",
      };
      state.view = "editor";
    } else if (a === "edit") {
      if (target.dataset.id) state.selected = target.dataset.id;
      draft = editDraft(recipe());
      state.view = "editor";
    } else if (a === "editor-back") {
      state.view = draft?.id ? "detail" : "library";
      draft = null;
    } else if (a === "new-meal") {
      mealDraft = { title: "", note: "", components: [] };
      state.view = "meal-editor";
    } else if (a === "edit-meal") {
      mealDraft = structuredClone(meal());
      state.view = "meal-editor";
    } else if (a === "cancel-meal") {
      state.view = mealDraft?.id ? "meal" : "meals";
      mealDraft = null;
    } else if (a === "meal-portions") {
      const c = meal().components.find((c) => c.id === target.dataset.id);
      c.servings = Math.min(
        24,
        Math.max(1, c.servings + Number(target.dataset.delta)),
      );
      noteMessage =
        "Dish portions updated. Review Shop meal to update its shopping quantities.";
    } else if (a === "review-meal") {
      const m = meal();
      makeReview(mealEntries(m), {
        returnView: state.view,
        replaceGroup: "meal:" + m.id,
      });
      return;
    } else if (a === "schedule-meal") {
      state.planPickMeal = meal().id;
      state.planPickRecipe = null;
      state.view = "plan";
    } else if (a === "start-meal") {
      if (!startMeal()) return;
    } else if (a === "switch-dish") switchDish(target.dataset.id);
    else if (a === "byk-compose") {
      bykPreview = "compose";
      state.view = "byk";
    } else if (a === "byk-shop") {
      bykPreview = "shop";
      state.view = "byk";
    } else if (a === "byk-meal" || a === "byk-tools") {
      bykPreview = "tools";
      state.view = "byk";
    } else if (a === "byk-dismiss") bykPreview = null;
    else if (a === "byk-apply") {
      if (bykPreview !== "compose") return;
      const m = {
        id: uid("meal"),
        title: "Weeknight dinner",
        note: "A main and a fresh side, saved together.",
        components: [
          { id: uid("dish"), recipeId: "orzo", role: "Main", servings: 4 },
          { id: uid("dish"), recipeId: "salad", role: "Side", servings: 4 },
        ],
      };
      state.meals.push(m);
      state.selectedMeal = m.id;
      bykResult = { mealId: m.id, snapshot: JSON.stringify(m) };
      bykPreview = null;
      noteMessage = "Sample proposal applied: one meal created.";
    } else if (a === "byk-undo") {
      const m = state.meals.find((m) => m.id === bykResult?.mealId);
      if (!m) return;
      const used =
        state.plan.some((e) => e.mealId === m.id) ||
        state.session?.mealId === m.id ||
        Object.keys(state.contributions).some((key) =>
          key.startsWith("meal:" + m.id + ":"),
        );
      if (used || JSON.stringify(m) !== bykResult.snapshot) {
        notify(
          "This meal has changed or is in use. Keep those changes; undo is no longer available.",
        );
        return;
      }
      state.meals = state.meals.filter((x) => x.id !== m.id);
      state.selectedMeal = state.meals[0]?.id;
      bykResult = null;
      noteMessage = "Meal creation undone.";
    }
    render();
    save();
  });
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (input.id === "k-search") {
      state.query = input.value;
      root.querySelector("#k-results").innerHTML = libraryCards();
      icons();
    }
    if (input.id === "k-recipe-note") state.notes[state.selected] = input.value;
    if (input.closest("#k-editor-form") && draft) {
      const form = new FormData(input.closest("form"));
      draft.title = String(form.get("title"));
      draft.servings = Number(form.get("servings")) || null;
      draft.ingredientsText = String(form.get("ingredients"));
      draft.stepsText = String(form.get("steps"));
      draft.equipmentText = String(form.get("equipment") || "");
      draft.linksText = String(form.get("links") || "");
      draft.course = String(form.get("course") || "") || null;
      draft.cuisine = String(form.get("cuisine") || "");
      draft.diets = form.getAll("diets").map(String);
      draft.tagsText = String(form.get("tags") || "");
    }
  });
  root.addEventListener("change", async (event) => {
    const t = event.target;
    if (t.id === "k-restore-file") {
      const file = t.files?.[0];
      if (!file) return;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error();
        pendingRestore = parseBackup(await file.text());
        render();
      } catch {
        notify(
          "This is not a valid Kooks mobile backup. Your cookbook has not changed.",
        );
      }
      return;
    }
    if (t.dataset.setting) {
      design[t.dataset.setting] = t.value;
      render();
      save();
      return;
    }
    if (t.id === "k-units") {
      state.units = t.value;
      render();
      save();
    } else if (t.dataset.buy) {
      state.bought[t.dataset.buy] = t.checked;
      render();
      save();
    } else if (t.dataset.review) {
      t.checked
        ? review.excluded.delete(t.dataset.review)
        : review.excluded.add(t.dataset.review);
      render();
    }
  });
  function submitForm(form) {
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    if (form.id === "k-manual-form") {
      const name = String(values.get("item") || "").trim();
      if (!name) return;
      state.manual.push({
        key: uid("manual"),
        n: name,
        q: null,
        u: "",
        group: "Other",
        manual: true,
      });
      render();
      save();
    } else if (form.matches(".k-plan-choice")) {
      const choice = String(values.get("recipe") || "");
      if (!choice) {
        notify("Choose a recipe or meal for this day.");
        return;
      }
      const entry = { id: uid("plan"), day: Number(form.dataset.day) };
      if (choice.startsWith("meal:")) {
        const m = meal(choice.slice(5));
        Object.assign(entry, {
          mealId: m.id,
          title: m.title,
          components: structuredClone(m.components),
        });
      } else {
        const r = recipe(choice);
        Object.assign(entry, { recipeId: r.id, servings: servings(r) });
      }
      state.plan.push(entry);
      state.planPickRecipe = null;
      state.planPickMeal = null;
      render();
      save();
    } else if (form.id === "k-meal-form") {
      const selected = values.getAll("recipes").map(String),
        title = String(values.get("title") || "").trim();
      if (!selected.length || !title) {
        root.querySelector("#k-meal-error").textContent =
          "Give your meal a name and choose at least one recipe.";
        return;
      }
      const id = mealDraft?.id || uid("meal");
      const m = {
        id,
        title,
        note: String(values.get("note") || "").trim(),
        components: selected.map((recipeId) => ({
          id:
            mealDraft?.components.find((c) => c.recipeId === recipeId)?.id ||
            uid("dish"),
          recipeId,
          role: String(values.get("role-" + recipeId) || "Side"),
          servings: Number(values.get("portions-" + recipeId)) || 1,
        })),
      };
      state.meals = state.meals.filter((m) => m.id !== id).concat(m);
      state.selectedMeal = id;
      state.view = "meal";
      mealDraft = null;
      noteMessage =
        "Meal saved. Existing shopping selections and planned portions stay as they were until reviewed.";
      render();
      save();
    } else if (form.id === "k-paste-form") {
      const text = String(values.get("text") || "").trim();
      if (!text) return;
      draft = pasteDraft(text);
      state.view = "editor";
      render();
    } else if (form.id === "k-editor-form") {
      const title = String(values.get("title") || "").trim(),
        ingredientsText = String(values.get("ingredients") || "").trim(),
        stepsText = String(values.get("steps") || "").trim();
      if (!title || !ingredientsText || !stepsText) {
        root.querySelector("#k-editor-error").textContent =
          "Add a name, ingredients, and at least one step.";
        return;
      }
      const links = parseLinkLines(values.get("links"));
      if (links.invalid.length || links.links.length > MAX_LINKS) {
        root.querySelector("#k-editor-error").textContent = links.invalid.length
          ? "Each link needs a web address such as https://example.com: " +
            links.invalid.join("; ")
          : `Keep it to ${MAX_LINKS} links.`;
        return;
      }
      const old = draft.id ? recipe(draft.id) : null;
      const id = draft.id || uid("recipe");
      const selectedYield = Number(values.get("servings")) || null;
      const r = {
        id,
        title,
        description:
          old?.description || "A good recipe, saved for another day.",
        course: String(values.get("course") || "") || null,
        cuisine: String(values.get("cuisine") || "").trim(),
        diets: values.getAll("diets").map(String),
        tags: parseLabels(values.get("tags")),
        time: old?.time || null,
        servings: selectedYield,
        source: draft.originalText ? "Copied recipe" : "Your recipe",
        ingredients: ingredientsText
          .split(/\n/)
          .filter((l) => l.trim())
          .map(parseIngredient),
        steps: stepsText
          .split(/\n\s*\n|\n(?=\s*\d+[.)]\s)/)
          .filter((s) => s.trim())
          .map((text, index) => {
            const cleaned = text.trim().replace(/^\d+[.)]\s*/, "");
            const same = old?.steps.find((s) => s.text === cleaned);
            return (
              same || { title: "Step " + (index + 1), text: cleaned, ids: [] }
            );
          }),
        note: old?.note || "",
        originalText: draft.originalText,
        links: links.links,
      };
      r.equipment = String(values.get("equipment") || "")
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      state.custom = state.custom.filter((x) => x.id !== id).concat(r);
      delete state.servings[id];
      state.selected = id;
      state.view = "detail";
      state.query = "";
      state.filter = "all";
      draft = null;
      noteMessage = "Recipe saved. Your original text is kept with it.";
      render();
      save();
    }
  }
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(event.target);
  });
  root.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      event.target.matches("input") &&
      event.target.closest("form")
    ) {
      event.preventDefault();
      submitForm(event.target.closest("form"));
    }
  });

  function settingsView() {
    return `${button(icon("arrow-left") + "Recipes", "nav", 'data-view="library"', "k-quiet k-back")}
   <div class="k-heading"><div><div class="k-kicker">Make yourself at home</div><h1>Your kitchen settings.</h1><p class="k-muted">Kooks for ${platform === "ios" ? "iOS" : platform === "android" ? "Android" : "the web"} · ${__KOOKS_VERSION__}</p></div></div>
   <div class="k-settings-grid"><section class="k-ingredients"><h2>Your cookbook</h2><p class="k-note" data-storage-label>${storageStatus === "error" ? "Not saved — please retry" : storageStatus === "saving" ? "Saving…" : "Saved on this device"}</p><p class="k-small" style="margin-top:15px">Recipes, meals, shopping, and cooking progress stay on this device. Export a backup to keep a copy or move to another device. Household sync and the desktop MCP cookbook are separate.</p>
   <div class="k-actions">${button("Export backup", "export-backup", "", "k-primary")}${button("Restore backup", "restore-backup")}${storageStatus === "error" ? button("Retry saving", "retry-save") : ""}</div>
   <input type="file" id="k-restore-file" accept=".json,application/json" hidden>
   ${pendingRestore ? `<div class="k-notice"><strong>Replace this device’s cookbook?</strong><p>This backup has ${pendingRestore.state.custom.length} saved recipe entries, ${pendingRestore.state.meals.length} meals, and ${pendingRestore.state.plan.length} planned entries. Export your current cookbook first if you want to keep both.</p><div class="k-actions">${button("Replace cookbook", "confirm-restore", "", "k-primary")}${button("Cancel", "cancel-restore")}</div></div>` : ""}
   <p class="k-note">Uninstalling the app removes its local data. Restores accept Kooks mobile backups.</p></section>
   <section class="k-ingredients"><h2>Make it yours</h2><div class="k-stack" style="margin-top:20px">
   ${[
     ["palette", "Color", ["Olive", "Clay"]],
     ["layout", "Recipe library", ["Cards", "Rows"]],
     ["density", "Spacing", ["Comfortable", "Compact"]],
   ]
     .map(
       ([key, label, options]) =>
         `<label class="k-field"><span>${label}</span><select class="k-select" data-setting="${key}">${options.map((option) => `<option ${design[key] === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>`,
     )
     .join("")}
   </div></section><section class="k-ingredients"><h2>Cooking timers</h2><p class="k-small" style="margin-top:15px">${isNative ? "Allow notifications to receive cooking reminders while Kooks is in the background. Alerts can be delayed or silenced by your device settings." : "In the browser, timers update while the page is open. The iOS and Android apps can also send device notifications."}</p><div class="k-actions">${isNative ? button("Enable timer alerts", "enable-alerts") : ""}</div></section></div>`;
  }
  function back() {
    if (isRestoring) return true;
    const destinations = {
      detail: "library",
      capture: "library",
      editor: draft?.id ? "detail" : "library",
      review: review?.returnView || "detail",
      cook: state.session?.mealId ? "meal" : "detail",
      finished: "library",
      meal: "meals",
      "meal-editor": mealDraft?.id ? "meal" : "meals",
      settings: "library",
    };
    if (state.view === "library") return false;
    navigate(destinations[state.view] || "library");
    return true;
  }
  render();
  if (!loaded.data) await save();
  await initializeNative({
    back,
    resume: () => {
      updateTimers();
      void syncTimerAlerts(state.session?.timers || []).catch(() =>
        notify("Check device timer alerts."),
      );
    },
    openTimers: () => {
      if (state.session) navigate("cook");
    },
  }).catch(() =>
    notify(
      "Some device features could not start. Your cookbook is still available.",
    ),
  );
  void syncTimerAlerts(state.session?.timers || []).catch(() =>
    notify("Check device timer alerts."),
  );
  timerHandle = setInterval(updateTimers, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") updateTimers();
    else void save();
  });
  window.addEventListener("pagehide", () => {
    clearInterval(timerHandle);
    void save();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clearInterval(timerHandle);
      timerHandle = setInterval(updateTimers, 1000);
      updateTimers();
    }
  });
}
boot().catch((error) => {
  const main = document.querySelector("main");
  main.innerHTML =
    '<div class="k-empty"><h1>Your cookbook is safe.</h1><p id="load-error"></p><button class="k-button k-primary" id="retry-load">Try again</button></div>';
  document.getElementById("load-error").textContent =
    "Kooks could not open its storage. No saved files have been replaced. " +
    (error.message || "Please try again.");
  document
    .getElementById("retry-load")
    .addEventListener("click", () => location.reload());
  console.error(error);
});
