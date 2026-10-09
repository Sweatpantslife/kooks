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
import { icon } from "../shared/icons.js";
import { clone as structuredClone, randomId } from "./compat.js";
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
  const root = document.getElementById("app");
  const main = root.querySelector("main");
  const toastElement = document.getElementById("toast");
  const html = document.documentElement;

  // ---------- Markup ----------
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
  const button = (label, action, extra = "", kind = "", ico = "") =>
    `<button type="button" class="btn ${kind}" data-action="${action}" ${extra}>${ico ? icon(ico) : ""}${label ? esc(label) : ""}</button>`;
  const tag = (label, kind = "") =>
    `<span class="tag ${kind}">${esc(label)}</span>`;
  const callout = (body, { kind = "", ico = "info", action = "" } = {}) =>
    `<div class="callout ${kind}">${icon(ico)}<div class="grow">${body}</div>${action}</div>`;
  const emptyState = (title, text = "", action = "", ico = "leaf") =>
    `<div class="empty">${icon(ico)}<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}${action ? `<div class="actions">${action}</div>` : ""}</div>`;
  const pageHeader = ({
    title,
    subtitle = "",
    eyebrow = "",
    actions = "",
    back = null,
  }) =>
    `<header class="page-header"><div>${back ? `<button type="button" class="back" data-action="${back.action}" ${back.extra ?? ""}>${icon("chevron-left")}${esc(back.label)}</button>` : ""}${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h1 class="page-title">${esc(title)}</h1>${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
  const segmented = (items, active, action, label) =>
    `<div class="segmented" role="group" aria-label="${esc(label)}">${items.map(([key, text]) => `<button type="button" data-action="${action}" data-tab="${key}" aria-pressed="${active === key}">${esc(text)}</button>`).join("")}</div>`;
  const disclosure = (summary, body, { open = false, quiet = false } = {}) =>
    `<details class="disclosure ${quiet ? "quiet" : ""}" ${open ? "open" : ""}><summary>${summary}</summary><div class="disclosure-body stack">${body}</div></details>`;
  const field = (label, name, value = "", extra = "", type = "text") =>
    `<label class="field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
  const area = (label, name, value = "", extra = "", hint = "") =>
    `<label class="field"><span>${esc(label)}</span><textarea name="${name}" ${extra}>${esc(value)}</textarea>${hint ? `<span class="help">${esc(hint)}</span>` : ""}</label>`;
  const errorSlot = (id = "") =>
    `<div class="error" role="alert" data-error ${id ? `id="${id}"` : ""}></div>`;

  // ---------- State ----------
  let state = structuredClone(initial);
  let pendingRestore = null;
  let isRestoring = false;
  let storageStatus = "saved";
  let draft = null;
  let review = null;
  let noteMessage = "";
  let timerHandle = null;
  let renderedView = null;
  let mealDraft = null;
  let bykPreview = null;
  let bykResult = null;
  let settingsTab = "backup";
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
    if (label) label.textContent = storageLabel();
  });
  const storageLabel = () =>
    storageStatus === "saving"
      ? "Saving…"
      : storageStatus === "error"
        ? "Not saved — please retry"
        : "Saved on this device";
  const loaded = await storage.load();
  if (loaded.data) {
    state = loaded.data.state;
    Object.assign(design, loaded.data.design);
  }
  if (loaded.recovered)
    noteMessage =
      "Recovered your previous saved cookbook. Please export a backup.";

  // ---------- Data helpers ----------
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
  const listItems = () => listItemsOf(state);
  const todayIndex = () => (new Date().getDay() + 6) % 7;
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
  function notify(message) {
    noteMessage = message;
    toastElement.textContent = message;
  }
  function navigate(view, id) {
    state.view = view;
    if (id) state.selected = id;
    noteMessage = "";
    render();
    save();
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
  function planEntryReview(e) {
    return e.mealId
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
        ];
  }

  // ---------- Shell ----------
  const NAV = [
    ["today", "house", "Today"],
    ["library", "book-open", "Recipes"],
    ["plan", "calendar-days", "Plan"],
    ["shop", "shopping-basket", "Shop"],
    ["cook", "flame", "Cook"],
  ];
  const TAB_OF = {
    today: "today",
    library: "library",
    detail: "library",
    capture: "library",
    editor: "library",
    finished: "library",
    plan: "plan",
    meals: "plan",
    meal: "plan",
    "meal-editor": "plan",
    shop: "shop",
    cook: "cook",
    settings: "settings",
    byk: "settings",
  };
  const TITLES = {
    today: "Today",
    library: "Recipes",
    capture: "Add a recipe",
    editor: "Edit recipe",
    finished: "Finished cooking",
    plan: "Plan",
    meals: "Meals",
    "meal-editor": "Edit meal",
    shop: "Shop",
    review: "Add to shopping list",
    cook: "Cook",
    settings: "Settings",
    byk: "Settings",
  };
  function activeTab() {
    if (state.view === "review") return TAB_OF[review?.returnView] ?? "shop";
    return TAB_OF[state.view] ?? "today";
  }
  function navigation() {
    const active = activeTab();
    const items = NAV.map(
      ([view, ico, label]) =>
        `<button type="button" class="nav-item" data-action="nav" data-view="${view}" ${active === view ? 'aria-current="page"' : ""}>${icon(ico)}<span>${label}</span>${view === "cook" && state.session ? '<span class="badge">1<span class="sr-only"> active</span></span>' : ""}</button>`,
    ).join("");
    root.querySelector(".sidebar").innerHTML =
      `<button type="button" class="brand" data-action="nav" data-view="today">${icon("cooking-pot")}kooks</button>${button("Add recipe", "capture", "", "btn-primary", "plus")}${items}<div class="sidebar-foot"><button type="button" class="nav-item" data-action="settings" ${active === "settings" ? 'aria-current="page"' : ""}>${icon("settings")}<span>Settings</span></button><div class="small">${allRecipes().length} recipes · Saved on this device</div></div>`;
    root.querySelector(".tabbar").innerHTML = items;
    root
      .querySelector('.topbar [data-action="settings"]')
      ?.setAttribute("aria-current", active === "settings" ? "page" : "false");
  }
  function resumeBanner() {
    return state.session && state.view !== "cook"
      ? callout(
          `<strong>On the stove:</strong> ${esc(state.session.mealTitle || state.session.snapshot.title)} · Step ${state.session.step + 1}`,
          {
            ico: "flame",
            action: button("Resume", "resume", "", "btn-primary btn-sm"),
          },
        )
      : "";
  }

  // ---------- Recipe pieces ----------
  function recipeCard(r) {
    const fav = state.favorites.includes(r.id);
    return `<article class="card recipe-card"><div class="row between">${tag(r.tag)}${button("", "favorite", `data-id="${esc(r.id)}" aria-label="${fav ? "Remove from favorites" : "Add to favorites"}: ${esc(r.title)}" aria-pressed="${fav}"`, `btn-quiet btn-icon btn-sm favorite ${fav ? "is-favorite" : ""}`, "heart")}</div><h2 class="card-title"><button type="button" class="card-open" data-action="open" data-id="${esc(r.id)}">${esc(r.title)}</button></h2><p>${esc(r.description)}</p><div class="card-end"><div class="meta"><span>${icon("clock")}${r.time ? `${r.time} min` : "Time not set"}</span><span>${r.servings ? r.servings + " servings" : "Yield not set"}</span></div>${button("Open", "open", `data-id="${esc(r.id)}" aria-label="Open ${esc(r.title)}"`, "btn-sm btn-quiet", "chevron-right")}</div></article>`;
  }
  function equipmentView(components, heading = "Required tools") {
    const { rows, unknown, ovens, conflict } = equipmentSummary(
      components,
      recipe,
    );
    return `<section class="stack-sm"><h3>${esc(heading)}</h3><div>${rows.map((t) => `<div class="tool-row"><span>${esc(t.name)}${components.length > 1 ? `<div class="tool-uses">${esc(t.uses.join(" · "))}</div>` : ""}</span>${icon("utensils", { className: "icon-sm" })}</div>`).join("") || '<p class="small muted">No tools recorded.</p>'}</div>${unknown.length ? `<p class="small muted">Tools not specified: ${esc(unknown.join(", "))}.</p>` : ""}${components.length > 1 && rows.length ? '<p class="small muted">Shared tools may need to be reused between dishes. Check sizes and availability before starting.</p>' : ""}${conflict ? callout(`<strong>Check the oven plan.</strong><br>${ovens.map((r) => esc(r.title) + ": " + r.temps.map((t) => esc(scaledText(t + "°C"))).join(", ")).join("<br>")}<br>With one oven, these dishes need a reviewed cooking order.`, { kind: "callout-warning", ico: "triangle-alert" }) : ""}</section>`;
  }
  function unitSelect(id = "units") {
    return `<label class="field"><span class="sr-only">Measurement display</span><select class="select" id="${id}" aria-label="Measurement display">${[
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
          `<div class="ingredient"><span>${esc(i.n)}${i.q !== null && i.note ? `<small>${esc(i.note)}</small>` : ""}</span><span class="amount">${esc(amount(i, r.servings ? selectedServings / r.servings : 1, units))}</span></div>`,
      )
      .join("");
  }
  // Links and videos of a recipe. A recognised video shows a play button that
  // loads the provider's player only when pressed; everything else is a link.
  function linksView(links, heading = "Links and videos") {
    if (!links?.length) return "";
    return `<section class="links"><h3>${esc(heading)}</h3>${links
      .map((item) => {
        const info = describeLink(item.url);
        if (!info) return "";
        const title =
          item.title || (info.embed ? `${info.label} video` : item.url);
        const line = `<p class="small"><a href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(title)}</a> <span class="muted">· ${esc(info.site)}</span></p>`;
        if (!info.embed) return line;
        return `<div class="link-item"><div class="embed" data-shape="${info.embed.shape}" data-src="${esc(info.embed.autoplay_src)}" data-title="${esc(title)}">${button(`Play on ${info.label}`, "embed-load", `aria-label="${esc(item.title ? `Play ${item.title} on ${info.label}` : `Play on ${info.label}`)}"`, "embed-load", "play")}<small>Loads the video from ${esc(info.label)} when you press play.</small></div>${line}</div>`;
      })
      .join("")}</section>`;
  }
  function linkLine(links) {
    if (!links?.length) return "";
    return `<p class="small">Links and videos: ${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.title || describeLink(l.url)?.site || l.url)}</a>`).join(" · ")}</p>`;
  }
  function loadEmbed(target) {
    const box = target.closest(".embed");
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
  function planRow(e) {
    const isMeal = Boolean(e.mealId);
    const title = isMeal ? e.title : recipe(e.recipeId).title;
    const detail = isMeal
      ? `${e.components.length} dishes · portions saved for this day`
      : `${e.servings} portions`;
    return `<div class="list-item"><div class="list-body"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div><div class="list-actions">${button("Cook", "plan-cook", `data-id="${esc(e.id)}"`, "btn-sm", "flame")}${button("Shop", "plan-shop", `data-id="${esc(e.id)}"`, "btn-sm", "shopping-basket")}${button("Open", isMeal ? "open-meal" : "open", `data-id="${esc(e.mealId || e.recipeId)}" aria-label="Open ${esc(title)}"`, "btn-sm btn-quiet")}${button("", "remove-plan", `data-id="${esc(e.id)}" aria-label="Remove ${esc(title)} from ${days[e.day]}"`, "btn-sm btn-quiet btn-icon", "x")}</div></div>`;
  }

  // ---------- Today ----------
  function todayView() {
    const now = new Date();
    const index = todayIndex();
    const entries = state.plan.filter((e) => e.day === index);
    const favorites = allRecipes()
      .filter((r) => state.favorites.includes(r.id))
      .slice(0, 6);
    const items = listItems();
    const remaining = items.filter((i) => !state.bought[i.key]).length;
    return `${pageHeader({ title: "Today", subtitle: `${now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}. What sounds good today?` })}${resumeBanner()}<section class="panel stack-sm"><div class="section-header tight"><h2>${days[index]}</h2>${button("Plan the week", "nav", 'data-view="plan"', "btn-sm btn-quiet", "calendar-days")}</div>${entries.length ? `<div class="list">${entries.map(planRow).join("")}</div>` : '<p class="small muted">Nothing planned for today. Pick something from your recipes, or plan the week.</p>'}</section>${items.length ? `<div class="spacer">${callout(`<strong>${remaining} of ${items.length} items</strong> left on your shopping list.`, { ico: "shopping-basket", action: button("Open list", "nav", 'data-view="shop"', "btn-sm") })}</div>` : ""}<section class="section"><div class="section-header"><h2>Cook again</h2><span class="small">Your favorites</span></div>${favorites.length ? `<div class="grid grid-3">${favorites.map(recipeCard).join("")}</div>` : emptyState("No favorites yet.", "Tap the heart on a recipe to keep it close.", button("Browse recipes", "nav", 'data-view="library"', "btn-primary"), "heart")}</section>`;
  }

  // ---------- Recipes ----------
  function libraryCards() {
    const term = state.query.trim().toLowerCase();
    const found = allRecipes().filter(
      (r) =>
        (state.filter !== "favorites" || state.favorites.includes(r.id)) &&
        (state.filter !== "quick" || (r.time && r.time <= 30)) &&
        (!term ||
          [
            r.title,
            r.description,
            r.note,
            state.notes[r.id],
            ...r.ingredients.map((i) => i.n),
          ]
            .join(" ")
            .toLowerCase()
            .includes(term)),
    );
    return found.length
      ? `<div class="grid grid-3">${found.map(recipeCard).join("")}</div><p class="small muted spacer">${found.length} recipe${found.length !== 1 ? "s" : ""} in your collection</p>`
      : emptyState(
          "No recipes found",
          "Try an ingredient, a different name, or another filter.",
          button("Clear filters", "clear-search"),
          "search",
        );
  }
  function libraryView() {
    const total = allRecipes().length;
    return `${pageHeader({ title: "Recipes", subtitle: `${total} recipe${total === 1 ? "" : "s"} in your cookbook. The ones you love, ready when you are.`, actions: button("Add recipe", "capture", "", "btn-primary", "plus") })}${resumeBanner()}<div class="toolbar" role="search"><label class="search grow"><span class="sr-only">Search recipes and ingredients</span>${icon("search")}<input id="search" type="search" placeholder="Find a recipe or ingredient…" value="${esc(state.query)}" autocomplete="off"></label><div class="chips" aria-label="Recipe filters">${[
      ["all", "All"],
      ["favorites", "Favorites"],
      ["quick", "Under 30 min"],
    ]
      .map(
        ([v, l]) =>
          `<button type="button" class="chip" data-action="filter" data-value="${v}" aria-pressed="${state.filter === v}">${l}</button>`,
      )
      .join(
        "",
      )}</div></div><div id="results">${libraryCards()}</div><p class="small muted spacer">Six example recipes are included to help you get started. Everything you add is saved on this device.</p>`;
  }
  function detailView() {
    const r = recipe();
    const fav = state.favorites.includes(r.id);
    return `${pageHeader({ title: r.title, eyebrow: r.tag, subtitle: r.description, back: { label: "Recipes", action: "nav", extra: 'data-view="library"' }, actions: `${button("", "favorite", `data-id="${esc(r.id)}" aria-label="${fav ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${fav}"`, `btn-quiet btn-icon favorite ${fav ? "is-favorite" : ""}`, "heart")}${button("Edit recipe", "edit", `data-id="${esc(r.id)}"`, "", "pencil")}` })}<div class="meta"><span>${icon("clock")}${r.time ? r.time + " minutes" : "Time not set"}</span><span>${esc(r.source)}</span></div><div class="actions spacer">${button("Cook", "start-cook", "", "btn-primary", "flame")}${button("Shop", "review", "", "", "shopping-basket")}${button("Plan", "schedule", "", "", "calendar-days")}${button("Share", "share-recipe", "", "btn-quiet", "share-2")}</div><div class="recipe-columns spacer"><section class="panel stack-sm"><div class="row between"><h2>Ingredients</h2>${unitSelect()}</div><div class="serving-control"><span class="label">${r.servings ? "Servings" : "Original quantities"}</span>${r.servings ? `<div class="stepper">${button("", "servings", 'data-delta="-1" aria-label="Fewer servings" ' + (servings(r) <= 1 ? "disabled" : ""), "btn-quiet btn-icon btn-sm", "minus")}<strong>${servings(r)}</strong>${button("", "servings", 'data-delta="1" aria-label="More servings" ' + (servings(r) >= 24 ? "disabled" : ""), "btn-quiet btn-icon btn-sm", "plus")}</div>` : button("Set yield", "edit", "", "btn-sm")}</div><div>${ingredientRows(r)}</div>${state.units === "us" ? '<p class="small muted">Cups use 240 mL. Weight stays in ounces; cup-to-gram estimates need an ingredient reference.</p>' : ""}${r.servings && servings(r) !== r.servings ? '<p class="small muted">Ingredient amounts adjusted. Cooking times stay the same.</p>' : ""}${equipmentView([{ recipeId: r.id }])}</section><section class="stack"><h2>Method</h2><ol class="method">${r.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(scaledText(s.text))}</p></li>`).join("")}</ol>${r.note ? callout(esc(r.note), { ico: "notebook-pen" }) : ""}${linksView(r.links)}${disclosure("Original recipe", `<pre class="source-text">${esc(originalText(r))}</pre>`, { quiet: true })}<div class="stack-sm">${area("Your cooking notes", "note", state.notes[r.id] || "", 'id="recipe-note" rows="3" placeholder="What worked? What would you change?"')}<div>${button("Save note", "save-note", "", "btn-sm", "check")}</div></div></section></div>`;
  }
  function captureView() {
    return `${pageHeader({ title: "Add a recipe", subtitle: "Copy it from a message, or write it yourself. The original text stays with the recipe.", back: { label: "Recipes", action: "nav", extra: 'data-view="library"' } })}<div class="segmented" role="group" aria-label="How to add it"><button type="button" aria-pressed="true">${icon("clipboard-paste")}Paste text</button><button type="button" data-action="manual-recipe" aria-pressed="false">${icon("pen-line")}Write it myself</button></div><form id="paste-form" class="panel stack"><h2>Paste a recipe</h2>${area("Paste a recipe", "text", "", 'id="paste" rows="10" required maxlength="6000" placeholder="Recipe name&#10;Serves 4&#10;&#10;Ingredients&#10;250 g orzo&#10;2 tbsp olive oil&#10;&#10;Method&#10;1. Warm the olive oil…"', "You’ll be able to edit the ingredients and method before saving.")}<div class="form-footer"><button type="button" data-local-submit class="btn btn-primary">${icon("arrow-right")}Review recipe</button></div></form>`;
  }
  function editorView() {
    if (!draft)
      draft = {
        id: null,
        title: "",
        servings: 4,
        ingredientsText: "",
        stepsText: "",
        linksText: "",
        originalText: "",
      };
    const title = draft.id
      ? "Edit recipe"
      : draft.originalText
        ? "Review draft"
        : "New recipe";
    return `${pageHeader({ title, subtitle: draft.id ? "Unknown amounts and timings can stay blank." : "Check the ingredients, servings and method before saving.", back: { label: draft.id ? recipe(draft.id).title : "Recipes", action: "editor-back" } })}<form id="editor-form" class="stack"><section class="panel stack"><h2>Basics</h2><div class="editor-meta">${field("Recipe name", "title", draft.title, 'required maxlength="120"')}${field("Servings", "servings", draft.servings || "", 'min="1" max="24" step="1" placeholder="Unknown"', "number")}</div></section><section class="panel stack"><h2>Ingredients</h2>${area("Ingredients · one per line", "ingredients", draft.ingredientsText, 'rows="8" required maxlength="4000" placeholder="250 g orzo&#10;2 tbsp olive oil"', "Cups use 240 mL, tablespoons 15 mL and teaspoons 5 mL. Unclear amounts stay as written.")}</section><section class="panel stack"><h2>Method</h2>${area("Method · one step per paragraph", "steps", draft.stepsText, 'rows="8" required maxlength="5000" placeholder="Warm the olive oil.&#10;&#10;Add the orzo and stir."')}</section><section class="panel stack"><h2>Equipment</h2>${area("Required tools · one per line", "equipment", draft.equipmentText || "", 'rows="3" maxlength="1500" placeholder="Wide pan&#10;Measuring jug"', "Leave blank if the recipe does not specify its equipment.")}</section>${disclosure("Links and videos", area("Links and videos · one per line", "links", draft.linksText || "", 'rows="3" maxlength="4000" placeholder="https://youtu.be/… Folding the dough&#10;example.com/the-original The written version"', "A web address, then an optional title. YouTube, Vimeo, Facebook, Instagram and TikTok videos play on the recipe page; other links open in your browser."), { open: Boolean(draft.linksText) })}${errorSlot("editor-error")}<div class="form-footer"><button type="button" data-local-submit class="btn btn-primary">${icon("check")}Save recipe</button>${button("Cancel", "editor-back", "", "btn-quiet")}</div></form>`;
  }

  // ---------- Plan ----------
  const PLAN_TABS = [
    ["plan", "Week"],
    ["meals", "Meals"],
  ];
  function planView() {
    const picked = state.planPickMeal
      ? meal(state.planPickMeal)?.title
      : state.planPickRecipe
        ? recipe(state.planPickRecipe).title
        : null;
    const index = todayIndex();
    return `${pageHeader({ title: "Plan", subtitle: "Save a place for a recipe or a complete meal.", actions: state.plan.length ? button("Shop the plan", "shop-plan", "", "btn-primary", "shopping-basket") : "" })}${segmented(PLAN_TABS, "plan", "plan-tab", "Plan sections")}${picked ? callout(`Choose a day for <strong>${esc(picked)}</strong>.`, { ico: "calendar-days" }) : ""}<div class="week-grid spacer">${days
      .map(
        (day, i) =>
          `<section class="day ${i === index ? "today" : ""}"><div class="day-head"><h2 class="day-name">${day}</h2>${i === index ? tag("Today") : ""}</div>${
            state.plan.filter((e) => e.day === i).length
              ? `<div class="list">${state.plan
                  .filter((e) => e.day === i)
                  .map(planRow)
                  .join("")}</div>`
              : '<p class="small muted">Nothing planned.</p>'
          }<form class="plan-choice" data-day="${i}"><label class="sr-only" for="day-${i}">Recipe or meal for ${day}</label><select class="select" id="day-${i}" name="recipe"><option value="">Choose a recipe or meal</option><optgroup label="Meals">${state.meals.map((m) => `<option value="meal:${esc(m.id)}" ${state.planPickMeal === m.id ? "selected" : ""}>${esc(m.title)}</option>`).join("")}</optgroup><optgroup label="Recipes">${allRecipes()
            .map(
              (r) =>
                `<option value="${esc(r.id)}" ${state.planPickRecipe === r.id ? "selected" : ""}>${esc(r.title)}</option>`,
            )
            .join(
              "",
            )}</optgroup></select><button type="button" data-local-submit class="btn btn-icon" aria-label="Add to ${day}">${icon("plus")}</button></form></section>`,
      )
      .join("")}</div>`;
  }
  function mealsView() {
    return `${pageHeader({ title: "Plan", subtitle: "Combinations you’ll want to cook again, with portions for each dish." })}${segmented(PLAN_TABS, "meals", "plan-tab", "Plan sections")}${state.meals.length ? `<div class="toolbar">${button("New meal", "new-meal", "", "btn-primary", "plus")}</div><div class="grid grid-3">${state.meals.map((m) => `<article class="card"><span class="eyebrow">${m.components.length} dish${m.components.length === 1 ? "" : "es"} · One meal</span><h2 class="card-title">${esc(m.title)}</h2><p>${esc(m.components.map((c) => recipe(c.recipeId).title).join(" + "))}</p><div class="card-end"><span class="small muted">${esc(mealPortionsLabel(m))}</span>${button("Open meal", "open-meal", `data-id="${esc(m.id)}"`, "btn-sm", "chevron-right")}</div></article>`).join("")}</div>` : emptyState("No meals yet.", "Save a main and a side together, with portions for each dish, and cook or shop them as one.", button("New meal", "new-meal", "", "btn-primary"), "utensils")}`;
  }
  function mealView() {
    const m = meal();
    if (!m) {
      state.view = "meals";
      return mealsView();
    }
    return `${pageHeader({ title: m.title, eyebrow: `${m.components.length} dish${m.components.length === 1 ? "" : "es"} · One meal`, subtitle: m.note, back: { label: "Meals", action: "nav", extra: 'data-view="meals"' }, actions: button("Edit meal", "edit-meal", "", "", "pencil") })}${resumeBanner()}<div class="actions">${button("Cook meal", "start-meal", "", "btn-primary", "flame")}${button("Shop meal", "review-meal", "", "", "shopping-basket")}${button("Plan", "schedule-meal", "", "", "calendar-days")}</div><section class="panel spacer"><h2>On the menu</h2><div>${m.components
      .map((c) => {
        const r = recipe(c.recipeId);
        return `<div class="dish"><div><div class="eyebrow">${esc(c.role)}</div><h3>${esc(r.title)}</h3>${button("View recipe", "open", `data-id="${esc(r.id)}"`, "btn-sm btn-quiet")}</div><div class="stack-sm"><span class="small muted">${r.servings ? "Dish portions" : "Original quantities"}</span>${r.servings ? `<div class="stepper">${button("", "meal-portions", `data-id="${esc(c.id)}" data-delta="-1" aria-label="Fewer portions of ${esc(r.title)}" ${c.servings <= 1 ? "disabled" : ""}`, "btn-quiet btn-icon btn-sm", "minus")}<strong>${c.servings}</strong>${button("", "meal-portions", `data-id="${esc(c.id)}" data-delta="1" aria-label="More portions of ${esc(r.title)}" ${c.servings >= 24 ? "disabled" : ""}`, "btn-quiet btn-icon btn-sm", "plus")}</div>` : '<p class="small muted">Set the recipe yield to scale.</p>'}</div></div>`;
      })
      .join(
        "",
      )}</div><p class="small muted">Set portions for each dish. Shop meal reviews the combined ingredients.</p></section><section class="panel spacer">${equipmentView(m.components)}</section>`;
  }
  function mealEditorView() {
    const d = mealDraft || { title: "", note: "", components: [] };
    return `${pageHeader({ title: d.id ? "Edit meal" : "New meal", subtitle: "Choose the dishes and the portions you want to make.", back: { label: "Meals", action: "cancel-meal" } })}<form id="meal-form" class="panel stack">${field("Meal name", "title", d.title, 'required maxlength="100" placeholder="Friday dinner"')}${field("A note for this meal", "note", d.note, 'maxlength="200" placeholder="Something warm, something fresh"')}<div><h3>Dishes</h3><div>${allRecipes()
      .map((r) => {
        const c = d.components.find((c) => c.recipeId === r.id);
        return `<div class="meal-option"><label class="check check-lg"><input type="checkbox" name="recipes" value="${esc(r.id)}" ${c ? "checked" : ""}><span>${esc(r.title)}</span></label><label class="field"><span>Dish role</span><select class="select" name="role-${esc(r.id)}" aria-label="Role of ${esc(r.title)}">${["Main", "Side", "Starter", "Dessert"].map((role) => `<option ${role === (c?.role || "Side") ? "selected" : ""}>${role}</option>`).join("")}</select></label><label class="field"><span>Portions</span><input name="portions-${esc(r.id)}" aria-label="Portions of ${esc(r.title)}" type="number" min="1" max="24" step="1" value="${c?.servings || r.servings || 1}" ${r.servings ? "" : "disabled"}></label></div>`;
      })
      .join(
        "",
      )}</div></div>${errorSlot("meal-error")}<div class="form-footer"><button type="button" data-local-submit class="btn btn-primary">${icon("check")}Save meal</button>${button("Cancel", "cancel-meal", "", "btn-quiet")}</div></form>`;
  }

  // ---------- Shop ----------
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
    const groups = review.entries
      .map(
        (e, ei) =>
          `<section class="stack-sm"><h3>${esc(e.title)} · ${e.yieldKnown ? e.servings + " servings" : "original quantities"}</h3><div class="list">${e.items
            .map((i, ii) => {
              const key = ei + "-" + ii;
              const checked = !review.excluded.has(key);
              if (checked) count++;
              return `<label class="list-item"><input type="checkbox" class="check-input" data-review="${key}" ${checked ? "checked" : ""}><span class="list-body"><strong>${esc(i.n)}</strong>${i.note && i.q !== null ? `<p>${esc(i.note)}</p>` : ""}</span><span class="quantity">${esc(amount(i, 1, state.units === "original" ? "metric" : state.units))}</span></label>`;
            })
            .join("")}</div></section>`,
      )
      .join("");
    return `${pageHeader({ title: "Add to shopping list", subtitle: "Untick anything you already have. Matching ingredients combine; adding the same recipe again updates its quantities.", back: { label: "Back", action: "review-back" } })}<div class="panel stack">${groups}</div><div class="actions spacer">${button(`Add ${count} items to list`, "confirm-list", count ? "" : "disabled", "btn-primary", "shopping-basket")}${button("Select all", "select-all", "", "btn-quiet")}</div>`;
  }
  function manualForm() {
    return `<form id="manual-form" class="inline-add"><label class="field grow"><span class="sr-only">Add an everyday item</span><input id="manual-input" name="item" required maxlength="100" placeholder="Add milk, coffee, anything…"></label><button type="button" data-local-submit class="btn btn-icon" aria-label="Add item">${icon("plus")}</button></form>`;
  }
  function shopView() {
    const items = listItems();
    const remaining = items.filter((i) => !state.bought[i.key]).length;
    const header = pageHeader({
      title: "Shop",
      subtitle: items.length
        ? `${remaining} of ${items.length} items left to pick up.`
        : "Nothing on the list yet. Shop a recipe, or add the everyday things you need.",
    });
    if (!items.length)
      return `${header}${resumeBanner()}<section class="panel stack">${manualForm()}${emptyState("Start with a recipe", "Open a recipe or meal and press Shop to add its ingredients.", button("Browse recipes", "nav", 'data-view="library"', "btn-primary"), "shopping-basket")}</section>`;
    const groups = ["Produce", "Dairy & eggs", "Pantry", "Other"];
    const rows = groups
      .map((group) => {
        const selected = items.filter((i) => (i.group || "Other") === group);
        return selected.length
          ? `<section class="stack-sm"><h3>${group}</h3><div class="list">${selected.map((i) => `<label class="list-item ${state.bought[i.key] ? "done" : ""}"><input type="checkbox" class="check-input" data-buy="${esc(i.key)}" ${state.bought[i.key] ? "checked" : ""}><span class="list-body"><strong>${esc(i.n)}</strong><p>${esc(i.note && i.q !== null ? i.note + " · " : "")}${esc(i.sources.join(" + "))}</p></span><span class="quantity">${i.manual ? "" : esc(amount(i, 1, state.units === "original" ? "metric" : state.units))}</span></label>`).join("")}</div></section>`
          : "";
      })
      .join("");
    return `${header}${resumeBanner()}<section class="panel stack">${manualForm()}${rows}${disclosure(
      `Recipes on this list · ${Object.keys(state.contributions).length}`,
      `<div class="list">${
        Object.entries(state.contributions)
          .map(
            ([key, c]) =>
              `<div class="list-item"><span class="list-body small">${esc(c.title)}</span>${button("Remove", "remove-contribution", `data-key="${esc(key)}" aria-label="Remove ${esc(c.title)} from list"`, "btn-quiet btn-sm")}</div>`,
          )
          .join("") || '<p class="small muted">Only everyday items so far.</p>'
      }</div>`,
      { quiet: true },
    )}</section>`;
  }

  // ---------- Cook ----------
  function startCook() {
    const r = recipe();
    if (!r.steps.length) {
      notify("Add a method before starting cooking.");
      return false;
    }
    if (state.session && state.session.recipeId !== r.id) {
      notify(
        "Finish your current cooking session before starting another recipe.",
      );
      return false;
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
    return true;
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
      ? `<div class="dish-tabs" role="group" aria-label="Dishes in this meal">${s.dishes.map((d) => button(d.snapshot.title, "switch-dish", `data-id="${esc(d.id)}" aria-label="Switch to ${esc(d.snapshot.title)}" aria-pressed="${s.activeDish === d.id}"`, "btn-sm", d.finished ? "check" : "")).join("")}</div>`
      : "";
  }
  function timerView(t) {
    return `<div class="timer"><div><strong>${esc(t.label)}</strong></div><span class="timer-time" data-timer="${esc(t.id)}">${timeLeft(t) === 0 ? "Ready" : clockText(timeLeft(t))}</span>${button("", "toggle-timer", `data-id="${esc(t.id)}" aria-label="${t.pausedMs === null ? "Pause" : "Resume"} ${esc(t.label)} timer"`, "btn-quiet btn-icon btn-sm", t.pausedMs === null ? "pause" : "play")}${button("", "remove-timer", `data-id="${esc(t.id)}" aria-label="Remove ${esc(t.label)} timer"`, "btn-quiet btn-icon btn-sm", "x")}</div>`;
  }
  function cookEmptyView() {
    return `${pageHeader({ title: "Cook", subtitle: "Follow a recipe step by step, with the timers in view." })}${emptyState("Nothing on the stove.", "Open a recipe or a meal and press Cook to start.", `${button("Pick a recipe", "nav", 'data-view="library"', "btn-primary")}${button("Open this week", "nav", 'data-view="plan"')}`, "flame")}`;
  }
  function cookView() {
    const s = state.session;
    if (!s) return cookEmptyView();
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
    return `${pageHeader({ title: s.mealTitle || r.title, eyebrow: "Cooking", subtitle: `${r.servings ? s.servings + " servings" : "Original quantities"} · ${s.units === "us" ? "US kitchen" : s.units === "original" ? "Original units" : "Metric"}`, back: { label: s.mealId ? "Meal" : "Recipe", action: "leave-cook" } })}${s.dishes ? `<div class="stack-sm"><h2>${esc(r.title)}</h2>${dishTabs(s)}</div>` : ""}<div class="stack-sm spacer"><div class="eyebrow">Step ${s.step + 1} of ${r.steps.length}</div><progress class="progress" max="${r.steps.length}" value="${s.step + 1}" aria-label="Recipe progress"></progress></div><div class="cook-layout spacer"><section class="stack"><div><h2>${esc(step.title)}</h2><p class="step-current preline">${esc(scaledText(step.text, s.units))}</p></div>${linkLine(r.links)}${step.mins && !dishTimers.some((t) => t.step === s.step) ? `<div>${button(`Start ${step.mins}-minute timer`, "start-timer", "", "btn-primary", "timer")}</div>` : ""}<div class="stack-sm">${s.timers.map(timerView).join("")}</div><div>${button("Add a 5-minute timer", "custom-timer", "", "btn-quiet btn-sm", "timer")}</div>${disclosure("See the whole method", `<ol class="method method-compact">${r.steps.map((st, i) => `<li>${button(st.title, "jump-step", `data-step="${i}"`, "btn-quiet btn-sm")}<p>${esc(scaledText(st.text, s.units))}</p></li>`).join("")}</ol>`, { quiet: true })}</section><aside class="panel stack-sm"><h3>${ids ? "For this step" : "Ingredients"}</h3><div>${ingredientRows(r, s.servings, ids, s.units)}</div>${equipmentView([{ snapshot: r }])}</aside></div><p class="small muted spacer">${isNative ? "Device notifications depend on permissions and system settings. Android alerts may be delayed." : "Keep this page open for browser timer alerts."}</p><div class="cook-footer">${button("Previous", "cook-back", s.step === 0 ? "disabled" : "", "", "chevron-left")}${s.step === r.steps.length - 1 ? button(finishLabel, "finish-cook", "", "btn-primary", "check") : button("Next step", "cook-next", "", "btn-primary", "chevron-right")}</div>`;
  }
  function finishedView() {
    const r = recipe();
    return `${pageHeader({ title: r.title, eyebrow: "Finished", subtitle: "That’s a keeper. Leave a note for next time." })}<form class="panel stack">${area("A note for next time", "note", state.notes[r.id] || "", 'id="finish-note" rows="3" placeholder="A little more lemon? Five extra minutes?"')}<div class="form-footer">${button("Save & return to recipes", "finish-note", "", "btn-primary", "check")}${button("Skip for now", "nav", 'data-view="library"', "btn-quiet")}</div></form>`;
  }

  // ---------- Settings ----------
  const SETTINGS_TABS = [
    ["backup", "Backup"],
    ["preferences", "Preferences"],
    ["timers", "Timers"],
    ["assistant", "Assistant"],
  ];
  function bykContent() {
    const m = meal();
    let proposal = "";
    if (bykPreview === "compose")
      proposal = `<section class="panel stack-sm"><div class="eyebrow">Sample proposal · Review before applying</div><h2>Weeknight dinner</h2><p class="small muted">Use two saved recipes for a main and a fresh side.</p><ul class="proposal-lines"><li>Main: ${esc(recipe("orzo").title)} · 4 portions</li><li>Side: ${esc(recipe("salad").title)} · 4 portions</li></ul><p class="small">Create one meal. Then review its shopping and required tools.</p><div class="actions">${button("Create this meal", "byk-apply", "", "btn-primary")}${button("Dismiss", "byk-dismiss", "", "btn-quiet")}</div></section>`;
    if (bykPreview === "shop" && m)
      proposal = `<section class="panel stack-sm"><div class="eyebrow">Sample shopping request</div><h2>Shop ${esc(m.title)}</h2><ul class="proposal-lines">${m.components.map((c) => `<li>${esc(recipe(c.recipeId).title)} · ${recipe(c.recipeId).servings ? c.servings + " portions" : "original quantities"}</li>`).join("")}</ul><p class="small">Check what you already have, then add the combined ingredients.</p><div class="actions">${button("Review ingredients", "review-meal", "", "btn-primary")}</div></section>`;
    if (bykPreview === "tools" && m)
      proposal = `<section class="panel stack-sm"><div class="eyebrow">Sample preparation request</div><h2>${esc(m.title)}</h2>${equipmentView(m.components)}<div class="actions">${button("Open cooking view", "start-meal", "", "btn-primary")}</div></section>`;
    const result =
      bykResult && state.meals.some((m) => m.id === bykResult.mealId)
        ? callout(
            `<strong>Meal created:</strong> ${esc(meal(bykResult.mealId).title)}`,
            {
              ico: "check",
              action: `${button("Open meal", "open-meal", `data-id="${esc(bykResult.mealId)}"`, "btn-sm")}${button("Undo", "byk-undo", "", "btn-sm btn-quiet")}`,
            },
          )
        : "";
    return `${callout("<strong>Preview.</strong> No assistant is connected. The actions below are labelled samples that use your saved recipes; no model is called.", { kind: "callout-warning", ico: "sparkles" })}<section class="panel stack-sm"><h2>AI connections</h2><div class="tool-row"><span>OpenAI / ChatGPT</span><span class="small muted">Not connected</span></div><div class="tool-row"><span>Claude</span><span class="small muted">Not connected</span></div><p class="small muted">Account sign-in is being evaluated for each provider. Connections are not available in this version.</p></section><section class="stack-sm"><h2 class="h-plain">Sample actions</h2><div class="intents">${button("Build dinner for four", "byk-compose", "", "", "utensils")}${button("Shop a saved meal", "byk-shop", m ? "" : "disabled", "", "shopping-basket")}${button("Prepare to cook a meal", "byk-tools", m ? "" : "disabled", "", "cooking-pot")}${button("Add a recipe manually", "capture", "", "", "plus")}</div>${m ? `<p class="small muted">Meal context: ${esc(m.title)}</p>` : ""}</section>${result}${proposal}`;
  }
  function settingsView() {
    const tab = state.view === "byk" ? "assistant" : settingsTab;
    let body = "";
    if (tab === "backup")
      body = `<section class="panel stack"><h2>Your cookbook</h2><p class="small" data-storage-label>${storageLabel()}</p><p class="small muted">Recipes, meals, shopping and cooking progress stay on this device. Export a backup to keep a copy or move to another device. Household sync and the desktop cookbook are separate.</p><div class="actions">${button("Export backup", "export-backup", "", "btn-primary", "download")}${button("Restore backup", "restore-backup", "", "", "upload")}${storageStatus === "error" ? button("Retry saving", "retry-save") : ""}</div><input type="file" id="restore-file" accept=".json,application/json" hidden>${pendingRestore ? `<div class="callout callout-warning"><div class="grow stack-sm"><strong>Replace this device’s cookbook?</strong><p>This backup has ${pendingRestore.state.custom.length} saved recipe entries, ${pendingRestore.state.meals.length} meals, and ${pendingRestore.state.plan.length} planned entries. Export your current cookbook first if you want to keep both.</p><div class="actions">${button("Replace cookbook", "confirm-restore", "", "btn-primary")}${button("Cancel", "cancel-restore")}</div></div></div>` : ""}<p class="small muted">Uninstalling the app removes its local data. Restores accept Kooks mobile backups.</p></section>`;
    else if (tab === "preferences")
      body = `<div class="grid-2"><section class="panel stack"><h2>Appearance</h2><fieldset class="radio-cards fieldset-plain"><legend class="label">Theme</legend>${[
        ["system", "Match the system", "monitor"],
        ["light", "Light", "sun"],
        ["dark", "Dark", "moon"],
      ]
        .map(
          ([value, label, ico]) =>
            `<label><input type="radio" name="theme" data-setting="theme" value="${value}" ${design.theme === value ? "checked" : ""}>${icon(ico)}${label}</label>`,
        )
        .join("")}</fieldset>${[
        ["palette", "Color", ["Olive", "Clay"]],
        ["layout", "Recipe library", ["Cards", "Rows"]],
        ["density", "Spacing", ["Comfortable", "Compact"]],
      ]
        .map(
          ([key, label, options]) =>
            `<label class="field"><span>${label}</span><select class="select" data-setting="${key}">${options.map((option) => `<option ${design[key] === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>`,
        )
        .join(
          "",
        )}</section><section class="panel stack"><h2>Measurements</h2><label class="field"><span>Measurement display</span><select class="select" id="units">${[
        ["metric", "Metric"],
        ["us", "US kitchen"],
        ["original", "Original units"],
      ]
        .map(
          ([v, l]) =>
            `<option value="${v}" ${state.units === v ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select><span class="help">Cups use 240 mL, tablespoons 15 mL, teaspoons 5 mL. Weight stays in grams or ounces.</span></label><h2>About</h2><dl class="kv"><dt>Version</dt><dd>${__KOOKS_VERSION__}</dd><dt>Platform</dt><dd>${platform === "ios" ? "iOS" : platform === "android" ? "Android" : "Web preview"}</dd><dt>Licence</dt><dd>GNU AGPL-3.0 · <a href="https://github.com/Sweatpantslife/kooks" target="_blank" rel="noreferrer">Source code</a></dd></dl></section></div>`;
    else if (tab === "timers")
      body = `<section class="panel stack"><h2>Cooking timers</h2><p class="small muted">${isNative ? "Allow notifications to receive cooking reminders while Kooks is in the background. Alerts can be delayed or silenced by your device settings." : "In the browser, timers update while the page is open. The iOS and Android apps can also send device notifications."}</p>${isNative ? `<div>${button("Enable timer alerts", "enable-alerts", "", "btn-primary", "bell-ring")}</div>` : ""}</section>`;
    else body = bykContent();
    return `${pageHeader({ title: "Settings", subtitle: "Backups, appearance, timers and the assistant preview." })}${segmented(SETTINGS_TABS, tab, "settings-tab", "Settings sections")}${body}`;
  }

  // ---------- Rendering ----------
  const knownIngredients = recipes.flatMap((r) => r.ingredients);
  const parseIngredient = (line) => parseIngredientLine(line, knownIngredients);
  function applyDesign() {
    if (design.theme === "system") delete html.dataset.theme;
    else html.dataset.theme = design.theme;
    html.dataset.palette = design.palette === "Clay" ? "clay" : "olive";
    html.dataset.density =
      design.density === "Compact" ? "compact" : "comfortable";
    html.dataset.layout = design.layout === "Rows" ? "rows" : "cards";
  }
  // Keeps the screen on while a cooking session is open, where the WebView
  // supports the Screen Wake Lock API; elsewhere this quietly does nothing.
  let wakeLock = null;
  async function manageWakeLock(wanted) {
    try {
      if (wanted && !wakeLock && navigator.wakeLock && !document.hidden) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } else if (!wanted && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }
  function render() {
    applyDesign();
    navigation();
    const views = {
      today: todayView,
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
      byk: settingsView,
      settings: settingsView,
    };
    main.innerHTML = `<div class="page">${(views[state.view] || todayView)()}</div>`;
    toastElement.textContent = noteMessage;
    const title =
      state.view === "detail"
        ? recipe().title
        : state.view === "meal"
          ? (meal()?.title ?? "Meal")
          : TITLES[state.view] || "Kooks";
    document.title = `${title} · Kooks`;
    updateTimers();
    void manageWakeLock(state.view === "cook" && Boolean(state.session));
    if (renderedView && renderedView !== state.view) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    }
    renderedView = state.view;
  }
  function updateTimers() {
    if (!state.session) return;
    let changed = false;
    state.session.timers.forEach((t) => {
      const el = root.querySelector(`[data-timer="${t.id}"]`);
      if (el)
        el.textContent = timeLeft(t) === 0 ? "Ready" : clockText(timeLeft(t));
      el?.closest(".timer")?.classList.toggle("ready", timeLeft(t) === 0);
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

  // ---------- Events ----------
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
      settingsTab = "backup";
      navigate("settings");
      return;
    }
    if (a === "settings-tab") {
      settingsTab = target.dataset.tab;
      navigate(settingsTab === "assistant" ? "byk" : "settings");
      return;
    }
    if (a === "plan-tab") {
      navigate(target.dataset.tab === "meals" ? "meals" : "plan");
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
      root.querySelector("#restore-file").click();
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
        next.state.view = "today";
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
    else if (a === "clear-search") {
      state.query = "";
      state.filter = "all";
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
    } else if (a === "plan-cook") {
      const e = state.plan.find((e) => e.id === target.dataset.id);
      if (!e) return;
      if (e.mealId) {
        state.selectedMeal = e.mealId;
        if (!startMeal()) {
          render();
          return;
        }
      } else {
        state.selected = e.recipeId;
        state.servings[e.recipeId] = e.servings;
        if (!startCook()) {
          render();
          return;
        }
      }
    } else if (a === "plan-shop") {
      const e = state.plan.find((e) => e.id === target.dataset.id);
      if (!e) return;
      makeReview(planEntryReview(e), { returnView: state.view });
      return;
    } else if (a === "shop-plan") {
      makeReview(state.plan.flatMap(planEntryReview), { returnView: "plan" });
      return;
    } else if (a === "start-cook") {
      if (!startCook()) {
        render();
        return;
      }
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
      state.notes[state.selected] = root.querySelector("#recipe-note").value;
      noteMessage = "Note saved for next time.";
    } else if (a === "finish-note") {
      state.notes[state.selected] = root.querySelector("#finish-note").value;
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
        returnView: state.view === "byk" ? "meal" : state.view,
        replaceGroup: "meal:" + m.id,
      });
      return;
    } else if (a === "schedule-meal") {
      state.planPickMeal = meal().id;
      state.planPickRecipe = null;
      state.view = "plan";
    } else if (a === "start-meal") {
      if (!startMeal()) {
        render();
        return;
      }
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
    if (input.id === "search") {
      state.query = input.value;
      root.querySelector("#results").innerHTML = libraryCards();
    }
    if (input.id === "recipe-note") state.notes[state.selected] = input.value;
    if (input.closest("#editor-form") && draft) {
      const form = new FormData(input.closest("form"));
      draft.title = String(form.get("title"));
      draft.servings = Number(form.get("servings")) || null;
      draft.ingredientsText = String(form.get("ingredients"));
      draft.stepsText = String(form.get("steps"));
      draft.equipmentText = String(form.get("equipment") || "");
      draft.linksText = String(form.get("links") || "");
    }
  });
  root.addEventListener("change", async (event) => {
    const t = event.target;
    if (t.id === "restore-file") {
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
    if (t.id === "units") {
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
    if (form.id === "manual-form") {
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
    } else if (form.matches(".plan-choice")) {
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
      noteMessage = "Added to your week.";
      render();
      save();
    } else if (form.id === "meal-form") {
      const selected = values.getAll("recipes").map(String),
        title = String(values.get("title") || "").trim();
      if (!selected.length || !title) {
        root.querySelector("#meal-error").textContent =
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
    } else if (form.id === "paste-form") {
      const text = String(values.get("text") || "").trim();
      if (!text) return;
      draft = pasteDraft(text);
      state.view = "editor";
      render();
    } else if (form.id === "editor-form") {
      const title = String(values.get("title") || "").trim(),
        ingredientsText = String(values.get("ingredients") || "").trim(),
        stepsText = String(values.get("steps") || "").trim();
      if (!title || !ingredientsText || !stepsText) {
        root.querySelector("#editor-error").textContent =
          "Add a name, ingredients, and at least one step.";
        return;
      }
      const links = parseLinkLines(values.get("links"));
      if (links.invalid.length || links.links.length > MAX_LINKS) {
        root.querySelector("#editor-error").textContent = links.invalid.length
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
        tag: old?.tag || "Your collection",
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
  function back() {
    if (isRestoring) return true;
    const destinations = {
      library: "today",
      plan: "today",
      meals: "plan",
      shop: "today",
      cook: "today",
      settings: "today",
      byk: "today",
      detail: "library",
      capture: "library",
      editor: draft?.id ? "detail" : "library",
      review: review?.returnView || "detail",
      finished: "library",
      meal: "meals",
      "meal-editor": mealDraft?.id ? "meal" : "meals",
    };
    if (state.view === "today") return false;
    navigate(destinations[state.view] || "today");
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
    if (document.visibilityState === "visible") {
      updateTimers();
      void manageWakeLock(state.view === "cook" && Boolean(state.session));
    } else void save();
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
    '<div class="page"><div class="empty"><h1>Your cookbook is safe.</h1><p id="load-error"></p><button type="button" class="btn btn-primary" id="retry-load">Try again</button></div></div>';
  document.getElementById("load-error").textContent =
    "Kooks could not open its storage. No saved files have been replaced. " +
    (error.message || "Please try again.");
  document
    .getElementById("retry-load")
    .addEventListener("click", () => location.reload());
  console.error(error);
});
