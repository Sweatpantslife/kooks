import {
  describeLink,
  displayLinks,
  formatLinkLines,
  parseLinkLines,
} from "/shared/links.js";
import { icon } from "/shared/icons.js";

// ---------- Values ----------
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (date, days) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monday = (date) =>
  addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const num = (value) =>
  value == null ? "—" : Number(value.toFixed(3)).toLocaleString();
const plural = (n, word, words = `${word}s`) =>
  `${num(n)} ${n === 1 ? word : words}`;
const amount = (ingredient) =>
  ingredient.quantity === null
    ? "As written"
    : `${num(ingredient.quantity)} ${ingredient.unit ?? ""}`.trim();
const inputNumber = (value) =>
  value === "" || value === null ? null : Number(value);
const comma = (value) =>
  String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const lineList = (value) =>
  String(value ?? "")
    .split(/\n/)
    .map((v) => v.trim())
    .filter(Boolean);
const localDate = (date, options) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options);
const dateLabel = (date) => localDate(date, { month: "short", day: "numeric" });
const weekdayLabel = (date) => localDate(date, { weekday: "long" });
const longDate = (date) =>
  localDate(date, { weekday: "long", day: "numeric", month: "long" });
const money = (value, code = currency) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${code} ${Number(value).toFixed(2)}`;
  }
};

// ---------- Markup ----------
const link = (label, route, { primary = false, cls = "", ico = "" } = {}) =>
  `<a class="btn ${primary ? "btn-primary" : ""} ${cls}" href="#/${route}">${ico ? icon(ico) : ""}${esc(label)}</a>`;
const button = (label, action, attrs = "", cls = "", ico = "") =>
  `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${ico ? icon(ico) : ""}${label ? esc(label) : ""}</button>`;
const chip = (label, action, attrs = "", pressed = false) =>
  `<button type="button" class="chip" data-action="${action}" aria-pressed="${pressed}" ${attrs}>${esc(label)}</button>`;
const hidden = (name, value) =>
  `<input type="hidden" name="${name}" value="${esc(value)}">`;
const help = (text) => (text ? `<span class="help">${esc(text)}</span>` : "");
const field = (label, name, value = "", type = "text", extra = "", hint = "") =>
  `<label class="field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}>${help(hint)}</label>`;
const area = (label, name, value = "", extra = "", hint = "") =>
  `<label class="field"><span>${esc(label)}</span><textarea name="${name}" ${extra}>${esc(value)}</textarea>${help(hint)}</label>`;
const select = (label, name, options, value = "", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><select name="${name}" ${extra}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
const check = (label, name, value = "on", checked = false, extra = "") =>
  `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? "checked" : ""} ${extra}><span>${esc(label)}</span></label>`;
const errorSlot = () => '<div class="error" role="alert" data-error></div>';
const submit = (label, ico = "") =>
  `<button class="btn btn-primary" type="submit">${ico ? icon(ico) : ""}${esc(label)}</button>`;
const emptyState = (title, text = "", action = "", ico = "leaf") =>
  `<div class="empty">${icon(ico)}<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}${action ? `<div class="actions">${action}</div>` : ""}</div>`;
const callout = (body, { kind = "", ico = "info" } = {}) =>
  `<div class="callout ${kind}">${icon(ico)}<div class="grow">${body}</div></div>`;
const tag = (label, kind = "") =>
  `<span class="tag ${kind}">${esc(label)}</span>`;
function pageHeader({
  title,
  subtitle = "",
  eyebrow = "",
  actions = "",
  back = null,
}) {
  return `<header class="page-header"><div>${back ? `<a class="back" href="#/${back.route}">${icon("chevron-left")}${esc(back.label)}</a>` : ""}${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h1 class="page-title">${esc(title)}</h1>${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
}
function segmented(items, active, label) {
  return `<nav class="segmented" aria-label="${esc(label)}">${items.map(([key, text, route]) => `<a href="#/${route}" ${key === active ? 'aria-current="page"' : ""}>${esc(text)}</a>`).join("")}</nav>`;
}
function disclosure(
  summary,
  body,
  { open = false, quiet = false, attrs = "" } = {},
) {
  return `<details class="disclosure ${quiet ? "quiet" : ""}" ${open ? "open" : ""} ${attrs}><summary>${summary}</summary><div class="disclosure-body stack">${body}</div></details>`;
}
const spiceOptions = [
  ["", "Not recorded"],
  [0, "No heat"],
  [1, "Mild"],
  [2, "Medium"],
  [3, "Hot"],
];
const cleanupOptions = [
  ["", "Not recorded"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
];
const NAV = [
  ["today", "house", "Today"],
  ["recipes", "book-open", "Recipes"],
  ["plan", "calendar-days", "Plan"],
  ["shop", "shopping-basket", "Shop"],
  ["cook", "flame", "Cook"],
];
const PLAN_TABS = [
  ["week", "Week", "plan"],
  ["meals", "Meals", "plan/meals"],
  ["leftovers", "Leftovers", "plan/leftovers"],
];
const SHOP_TABS = [
  ["list", "List", "shop"],
  ["pantry", "Pantry", "shop/pantry"],
];
const SETTINGS_TABS = [
  ["household", "Household", "settings/household"],
  ["prices", "Prices & budget", "settings/prices"],
  ["backup", "Backup", "settings/backup"],
  ["preferences", "Preferences", "settings/preferences"],
];

// ---------- State ----------
let db = {},
  revision = "",
  busy = 0,
  draw = 0,
  lastAction = null,
  sharing = false,
  filters = {},
  search = "",
  libraryFilter = "all",
  captureMethod = "paste",
  week = monday(today()),
  toastTimeout,
  wakeLock = null,
  wantsWakeLock = false;
let currency = localStorage.getItem("kooks.currency") ?? "USD";
let theme = localStorage.getItem("kooks.theme") ?? "system";
const pendingWrites = new Map(),
  portions = new Map(),
  exclusions = new Map();
let review = null;
const records = (kind) => db[kind] ?? [];
const record = (kind, id) => records(kind).find((r) => r.id === id);
const person = (id) => record("member", id)?.data.name ?? "Unassigned";
const optionsFor = (kind) =>
  records(kind).map((r) => [r.id, r.data.title ?? r.data.name]);
const sourceOptions = () => [
  ...records("recipe").map((r) => [`recipe:${r.id}`, r.data.title]),
  ...records("meal").map((r) => [`meal:${r.id}`, `${r.data.title} · Meal`]),
];
const sourceFrom = (value) => {
  const [kind, id] = value.split(":");
  return { kind, id };
};
const activeSessions = () =>
  records("session").filter((s) => s.data.status === "active");

// ---------- Server ----------
async function api(name, input = {}) {
  const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.message ?? "Could not complete this action.");
    error.code = value.error;
    throw error;
  }
  return value;
}
async function write(name, input) {
  const key = JSON.stringify([name, input]);
  const request_id = pendingWrites.get(key) ?? uid();
  pendingWrites.set(key, request_id);
  const result = await api(name, { ...input, request_id });
  pendingWrites.delete(key);
  lastAction = result.action_id;
  return result;
}
function toast(message, error = false, undo = false) {
  const el = $("#toast");
  el.className = `toast ${error ? "toast-error" : ""}`;
  el.innerHTML = `<span>${esc(message)}</span>${undo && lastAction ? '<button type="button" data-action="undo">Undo</button>' : ""}<button type="button" data-action="dismiss-toast" aria-label="Dismiss message">${icon("x", { className: "icon-sm" })}</button>`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(
    () => {
      el.textContent = "";
    },
    error ? 20000 : 7000,
  );
}
async function loadState({ polling = false } = {}) {
  const response = await fetch(
    `/api/state${polling ? `?revision=${encodeURIComponent(revision)}` : ""}`,
  );
  if (response.status === 401) {
    revision = "";
    renderLogin();
    return false;
  }
  if (!response.ok)
    throw new Error(
      "Could not open the kitchen. Check that the server is running.",
    );
  const value = await response.json();
  if (value.unchanged) return false;
  // A draft or a playing video survives other cooks' changes until this
  // page is left; redrawing would discard the one and restart the other.
  const dirty = document.querySelector('form[data-dirty="true"]'),
    playing = document.querySelector(".embed iframe");
  if (polling && (dirty || playing)) {
    const notice = $(".sync-note");
    if (notice) {
      notice.hidden = false;
      notice.textContent = dirty
        ? "Someone updated the kitchen. Your draft is kept here; saving checks for conflicting changes."
        : "Someone updated the kitchen. Your video keeps playing; the page refreshes when you move on.";
    }
    return false;
  }
  db = value.records;
  revision = value.revision;
  sharing = value.sharing;
  return true;
}
function navigate(target) {
  if (location.hash === `#/${target}`) void render();
  else location.hash = `/${target}`;
}
async function afterSave(message, target) {
  await loadState();
  if (target) navigate(target);
  else await render();
  toast(message, false, true);
}
function applyTheme() {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
// Keeps the screen on while a cooking session is open, where supported.
async function manageWakeLock(wanted) {
  wantsWakeLock = wanted;
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

// ---------- Shell ----------
function shell({ content, active }) {
  const cooking = activeSessions().length;
  const nav = () =>
    NAV.map(
      ([key, ico, label]) =>
        `<a class="nav-item" href="#/${key}" ${key === active ? 'aria-current="page"' : ""}>${icon(ico)}<span>${label}</span>${key === "cook" && cooking ? `<span class="badge">${cooking}<span class="sr-only"> active</span></span>` : ""}</a>`,
    ).join("");
  const settingsCurrent = active === "settings" ? 'aria-current="page"' : "";
  return `<div class="app"><nav class="sidebar" aria-label="Main"><a class="brand" href="#/today">${icon("cooking-pot")}kooks</a><a class="btn btn-primary" href="#/recipes/add">${icon("plus")}Add recipe</a>${nav()}<div class="sidebar-foot"><a class="nav-item" href="#/settings/household" ${settingsCurrent}>${icon("settings")}<span>Settings</span></a><div class="small">${plural(records("recipe").length, "recipe")} · ${sharing ? "Shared household server" : "This computer only"}</div><a class="source-link" href="https://github.com/Sweatpantslife/kooks">Kooks source code (AGPL-3.0)</a></div></nav><header class="topbar"><a class="brand" href="#/today">${icon("cooking-pot")}kooks</a><div class="topbar-actions"><a class="btn btn-quiet btn-icon" href="#/recipes/add" aria-label="Add recipe">${icon("plus")}</a><a class="btn btn-quiet btn-icon" href="#/settings/household" aria-label="Settings" ${settingsCurrent}>${icon("settings")}</a></div></header><div class="sync-note" role="status" hidden></div><main id="main" class="main" tabindex="-1"><div class="page">${content}</div></main><nav class="tabbar" aria-label="Main">${nav()}</nav></div>`;
}

// ---------- Shared pieces ----------
function effort(r) {
  const d = r.data ?? r;
  return `<div class="meta"><span>${icon("clock")}${d.active_minutes == null ? "Hands-on time not set" : `${d.active_minutes} min hands-on`}</span>${d.total_minutes != null ? `<span>${d.total_minutes} min total</span>` : ""}${d.pan_count != null ? `<span>${icon("cooking-pot")}${plural(d.pan_count, "pan")}</span>` : ""}</div>`;
}
function suggestionDetails(s) {
  const preferences = [
    ...s.preferences.likes,
    ...s.preferences.unknown,
    ...s.preferences.conflicts,
  ];
  return `<div class="stack-sm"><div class="chips">${s.use_soon.map((n) => tag(`Use soon · ${n}`, "tag-warm")).join("")}${s.missing.length ? tag(`${s.missing.length} shopping gap${s.missing.length === 1 ? "" : "s"}`, "tag-neutral") : tag("All ingredients on hand")}</div>${s.missing.length ? `<p>Missing: ${esc(s.missing.map((i) => `${i.name} (${amount(i)})`).join(", "))}</p>` : ""}${s.check_quantities.length ? `<p>Check amounts: ${esc(s.check_quantities.map((i) => i.name).join(", "))}.</p>` : ""}${preferences.length ? `<p>${esc(preferences.join(" · "))}</p>` : ""}</div>`;
}
function recipeCard(r, suggestion = null) {
  const d = r.data;
  return `<article class="card"><div class="row between"><span class="tag">${esc(d.tags[0] ?? "Recipe")}</span>${button("", "favorite", `data-id="${r.id}" aria-label="${d.favorite ? "Remove from favorites" : "Add to favorites"}: ${esc(d.title)}" aria-pressed="${Boolean(d.favorite)}"`, `btn-quiet btn-icon btn-sm favorite ${d.favorite ? "is-favorite" : ""}`, "heart")}</div><h2 class="card-title"><a href="#/recipes/${r.id}">${esc(d.title)}</a></h2>${effort(r)}${d.preferred ? '<span class="small muted">Your preferred version</span>' : ""}${suggestion ? suggestionDetails(suggestion) : ""}<div class="card-end"><span class="small muted">${d.servings == null ? "Yield not set" : `${num(suggestion?.servings ?? d.servings)} portions`}</span><a class="btn btn-sm btn-quiet" href="#/recipes/${r.id}">Open${icon("chevron-right")}</a></div></article>`;
}
function planRow(p) {
  return `<div class="list-item"><div class="list-body"><strong>${esc(p.data.title)}</strong><p>${esc(p.data.slot)} · ${p.data.dishes.map((d) => `${esc(d.title)} · ${d.servings == null ? "original" : num(d.servings)} portions`).join(" + ")}</p></div><div class="list-actions">${button("Cook", "cook", `data-kind="plan" data-id="${p.id}"`, "btn-sm", "flame")}${link("Shop", `shop/review/plan/${p.id}`, { cls: "btn-sm", ico: "shopping-basket" })}${button("Remove", "archive", `data-kind="plan" data-id="${p.id}" aria-label="Remove ${esc(p.data.title)} from the plan"`, "btn-sm btn-quiet")}</div></div>`;
}
function leftoverRow(a) {
  return `<div class="list-item"><div class="list-body"><div class="row row-sm">${tag("Already cooked")}<strong>${esc(a.batch.data.title)}</strong></div><p>${num(a.portions)} portions · ${esc(a.slot)}${a.status === "eaten" ? " · Eaten" : ""}</p></div><div class="list-actions">${link("Open batch", `plan/leftovers/${a.batch.id}`, { cls: "btn-sm" })}</div></div>`;
}
function dayEntries(date) {
  return {
    planned: records("plan").filter((p) => p.data.date === date),
    leftovers: records("batch").flatMap((b) =>
      b.data.allocations
        .filter((a) => a.date === date)
        .map((a) => ({ ...a, batch: b })),
    ),
  };
}
// Links and videos of a recipe. A recognised video shows a play button that
// loads the provider's player only when pressed; everything else is a link.
function linksSection(data, heading = "Links and videos") {
  const items = displayLinks(data);
  if (!items.length) return "";
  return `<section class="links"><h3>${esc(heading)}</h3>${items.map(linkView).join("")}</section>`;
}
function linkView(item) {
  const info = describeLink(item.url);
  if (!info) return "";
  const title = item.title || (info.embed ? `${info.label} video` : item.url);
  const line = `<p class="small"><a href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(title)}</a> <span class="muted">· ${esc(info.site)}</span></p>`;
  if (!info.embed) return line;
  return `<div class="link-item"><div class="embed" data-shape="${info.embed.shape}" data-src="${esc(info.embed.autoplay_src)}" data-title="${esc(title)}">${button(`Play on ${info.label}`, "embed-load", `aria-label="${esc(item.title ? `Play ${item.title} on ${info.label}` : `Play on ${info.label}`)}"`, "embed-load", "play")}<small>Loads the video from ${esc(info.label)} when you press play.</small></div>${line}</div>`;
}
function linkLine(links) {
  if (!links?.length) return "";
  return `<p class="small">Links and videos: ${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.title || describeLink(l.url)?.site || l.url)}</a>`).join(" · ")}</p>`;
}
function loadEmbed(button) {
  const box = button.closest(".embed");
  if (!box) return;
  box.dataset.loaded = "true";
  box.innerHTML = `<iframe src="${esc(box.dataset.src)}" title="${esc(box.dataset.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

// ---------- Today ----------
async function todayPage() {
  const filtering = Object.keys(filters).length > 0;
  const result = await api("recipe_suggest", {
    ...filters,
    limit: filtering ? 30 : 12,
  });
  const date = today();
  const active = activeSessions();
  const useSoon = records("pantry").filter(
    (p) => p.data.use_soon && p.data.available,
  );
  const drafts = records("import").filter((r) => r.data.status === "draft");
  const dayPanel = (label, d) => {
    const { planned, leftovers } = dayEntries(d);
    return `<section class="panel"><div class="section-header tight"><h2>${label}</h2><span class="small">${weekdayLabel(d)}</span></div>${planned.length || leftovers.length ? `<div class="list">${planned.map(planRow).join("")}${leftovers.map(leftoverRow).join("")}</div>` : `<p class="small muted">Nothing planned yet. <a href="#/plan">Open the week</a>.</p>`}</section>`;
  };
  const members = records("member");
  const advancedOpen = [
    "max_active_minutes",
    "max_total_minutes",
    "max_pans",
    "cleanup",
    "servings",
  ].some((key) => filters[key] !== undefined);
  const content = `${pageHeader({ title: "Today", subtitle: `${longDate(date)}. What sounds good today?` })}${active.map((s) => callout(`<strong>On the stove:</strong> ${esc(s.data.title)}`, { ico: "flame" }).replace("</div></div>", `</div>${link("Continue", `cook/${s.id}`, { primary: true, cls: "btn-sm" })}</div>`)).join("")}${drafts.length ? callout(`<strong>${plural(drafts.length, "draft")} waiting for a read-through:</strong> ${drafts.map((r) => `<a href="#/imports/${r.id}">${esc(r.data.title)}</a>`).join(", ")}`, { kind: "callout-warning", ico: "file-text" }) : ""}<div class="grid-2 spacer">${dayPanel("Today", date)}${dayPanel("Tomorrow", addDays(date, 1))}</div>${useSoon.length ? `<div class="spacer">${callout(`<strong>Use soon:</strong> ${esc(useSoon.map((p) => p.data.name).join(", "))}. <a href="#/shop/pantry">Open the pantry</a>`, { kind: "callout-warning", ico: "refrigerator" })}</div>` : ""}<section class="section"><div class="section-header"><h2>Find dinner</h2><span class="small">From your own cookbook</span></div><form data-form="suggest" class="panel stack"><div class="suggest-row">${field("Ingredients on hand, separated by commas", "available", (filters.available_ingredients ?? []).join(", "), "text", 'placeholder="zucchini, chickpeas"')}${submit("Find dinner", "search")}</div>${
    members.length
      ? `<div class="stack-sm"><span class="label">Who’s eating?</span><div class="chips">${members.map((m) => `<label class="chip-input"><input type="checkbox" name="members" value="${m.id}" ${(filters.member_ids ?? []).includes(m.id) ? "checked" : ""}><span>${esc(m.data.name)}</span></label>`).join("")}<a class="chip" href="#/settings/household">${icon("users")}Manage people</a></div></div>`
      : `<p class="small muted"><a href="#/settings/household">Add the people at your table</a> to match dinner to their tastes.</p>`
  }${disclosure(
    "More filters",
    `<div class="form-grid-4 form-grid">${field("Hands-on minutes, at most", "active", filters.max_active_minutes ?? "", "number", 'min="0" max="10080" placeholder="Any"')}${field("Total minutes, at most", "total", filters.max_total_minutes ?? "", "number", 'min="0" max="10080" placeholder="Any"')}${select(
      "Pans, at most",
      "pans",
      [
        ["", "Any number"],
        [0, "No cooking pans"],
        [1, "One pan"],
        [2, "Two pans"],
      ],
      filters.max_pans ?? "",
    )}${select(
      "Cleanup",
      "cleanup",
      [
        ["", "Any effort"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
      ],
      filters.cleanup ?? "",
    )}</div><div class="row">${field("Portions to make", "servings", filters.servings ?? "", "number", 'min="0.01" max="10000" step="any" placeholder="Recipe yield"')}${check("Skip ingredients people dislike", "avoid", "on", filters.avoid_dislikes !== false)}</div>`,
    { open: advancedOpen, quiet: true },
  )}${filtering ? `<div>${button("Clear filters", "clear-filters", "", "btn-quiet btn-sm", "x")}</div>` : ""}</form>${result.skipped.effort_unknown ? `<p class="callout callout-warning spacer">${plural(result.skipped.effort_unknown, "recipe")} need effort details before they can match these filters.</p>` : ""}${result.skipped.missing_yield ? `<p class="callout callout-warning spacer">${plural(result.skipped.missing_yield, "recipe")} need a serving count before they can be scaled.</p>` : ""}${result.skipped.preferences ? `<p class="small muted spacer">${plural(result.skipped.preferences, "recipe")} excluded by the selected tastes.</p>` : ""}<div class="section-header spacer"><h2 class="h-plain">${filtering ? "Matches" : "Suggestions"}</h2><span class="small">${plural(result.total, "recipe")}${!filtering && result.total > result.results.length ? ` · <a href="#/recipes">See all</a>` : ""}</span></div>${
    result.results.length
      ? `<div class="grid grid-3">${result.results.map((r) => recipeCard(r.record, r)).join("")}</div>`
      : records("recipe").length
        ? emptyState(
            "Nothing fits just yet.",
            "Allow a little more time, or choose different eaters.",
            button("Clear filters", "clear-filters"),
          )
        : emptyState(
            "Your first recipe belongs here.",
            "Paste a recipe from your messages, photograph a favorite, or write one yourself.",
            link("Add your first recipe", "recipes/add", { primary: true }),
            "book-open",
          )
  }<p class="small muted spacer">Pantry names must match recipe ingredients. A checklist entry means you have the ingredient; check amounts before cooking.</p></section>`;
  return { title: "Today", active: "today", content };
}

// ---------- Recipes ----------
function libraryPage() {
  const drafts = records("import").filter((r) => r.data.status === "draft");
  const all = [...records("recipe")].sort((a, b) =>
    a.data.title.localeCompare(b.data.title),
  );
  const chips = [
    ["all", "All"],
    ["favorites", "Favorites"],
    ["quick", "Under 30 min"],
    ...(drafts.length ? [["drafts", `Needs review · ${drafts.length}`]] : []),
  ];
  const content = `${pageHeader({ title: "Recipes", subtitle: all.length ? `${plural(all.length, "recipe")} in your cookbook. Old favorites, small discoveries, and your own adjustments.` : "Your cookbook is empty. Start with something you already love to cook.", actions: link("Add recipe", "recipes/add", { primary: true, ico: "plus" }) })}<form data-form="search" class="toolbar" role="search"><label class="search grow"><span class="sr-only">Find a recipe, ingredient or tag</span>${icon("search")}<input id="search" name="query" type="search" placeholder="Find a recipe, ingredient or tag…" value="${esc(search)}" autocomplete="off"></label><div class="chips" aria-label="Filters">${chips.map(([key, label]) => chip(label, "library-filter", `data-filter="${key}"`, libraryFilter === key)).join("")}</div></form><div id="library-results">${libraryResults(all, drafts)}</div>`;
  return { title: "Recipes", active: "recipes", content };
}
function libraryResults(all, drafts) {
  if (libraryFilter === "drafts")
    return drafts.length
      ? `<div class="grid grid-3">${drafts.map((r) => `<article class="card">${tag("Draft", "tag-warm")}<h2 class="card-title"><a href="#/imports/${r.id}">${esc(r.data.title)}</a></h2><p>Check the extracted text against the original, then save it.</p><div class="card-end"><span class="small muted">${dateLabel(r.created_at.slice(0, 10))}</span>${link("Review", `imports/${r.id}`, { cls: "btn-sm" })}</div></article>`).join("")}</div>`
      : emptyState("Nothing is waiting for review.");
  const q = search.trim().toLowerCase();
  const found = all.filter(
    (r) =>
      (libraryFilter !== "favorites" || r.data.favorite) &&
      (libraryFilter !== "quick" ||
        (r.data.total_minutes != null && r.data.total_minutes <= 30)) &&
      (!q ||
        [
          r.data.title,
          r.data.notes,
          ...r.data.ingredients.map((i) => i.name),
          ...r.data.tags,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  if (!found.length)
    return all.length
      ? emptyState(
          "No recipes match.",
          "Try another ingredient, name or tag, or show everything.",
          button("Show all recipes", "library-filter", 'data-filter="all"'),
          "search",
        )
      : emptyState(
          "Your cookbook is empty.",
          "Paste a recipe from your messages, photograph a favorite, or write one yourself.",
          link("Add your first recipe", "recipes/add", { primary: true }),
          "book-open",
        );
  return `<div class="grid grid-3">${found.map((r) => recipeCard(r)).join("")}</div>`;
}

function capturePage() {
  const methods = [
    ["paste", "Paste", "clipboard-paste"],
    ["photo", "Photo", "camera"],
    ["write", "Write", "pen-line"],
  ];
  const show = (key) => (captureMethod === key ? "" : "hidden");
  const content = `${pageHeader({ title: "Add a recipe", subtitle: "From a message, a photo, or the way you’ve always made it. The original stays with the recipe.", back: { label: "Recipes", route: "recipes" } })}<div class="segmented" role="group" aria-label="How to add it">${methods.map(([key, label, ico]) => `<button type="button" data-action="capture-method" data-method="${key}" aria-pressed="${captureMethod === key}">${icon(ico)}${label}</button>`).join("")}</div><form data-form="paste" class="panel stack" data-method="paste" ${show("paste")}><h2>Paste a recipe</h2><p class="small muted">Copy it from a message or a website. You’ll review the draft before it is saved.</p>${area("Recipe text", "text", "", 'required rows="11" placeholder="Lemon orzo\nServes 4\n\nIngredients\n250 g orzo\n\nMethod\nCook the orzo…"')}${errorSlot()}<div class="form-footer">${submit("Review pasted recipe", "arrow-right")}</div></form><form data-form="photo" class="panel stack" data-method="photo" ${show("photo")}><h2>From a photo or screenshot</h2><p class="small muted">The text is read on this household’s own computer and never sent to a model provider. You’ll check it beside the original image.</p><label class="upload">${icon("camera")}<strong>Choose a recipe photo</strong><span class="small muted">PNG, JPEG or WebP, up to 8 MB. Clear, upright photos work best.</span><input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label>${errorSlot()}<div class="form-footer">${submit("Read photo", "arrow-right")}</div></form><section class="panel stack" data-method="write" ${show("write")}><h2>Write it yourself</h2><p class="small muted">You don’t need a source to save something good. Start with a blank recipe.</p><div>${link("Open a blank recipe", "recipes/new", { primary: true, ico: "pen-line" })}</div></section>`;
  return { title: "Add a recipe", active: "recipes", content };
}

function recipeEditor(id, mode = "edit") {
  const draft = mode === "import" ? record("import", id) : null;
  const r = mode === "import" ? null : record("recipe", id);
  const data = draft?.data.recipe ??
    r?.data ?? {
      title: "",
      servings: null,
      ingredients: [],
      steps: [],
      equipment: [],
      tags: [],
      notes: "",
      links: [],
    };
  if ((id && !r && !draft) || draft?.data.status === "saved")
    return {
      title: "Recipes",
      active: "recipes",
      content: emptyState(
        "This editor is no longer available.",
        "Open the saved recipe from your cookbook.",
        link("Recipes", "recipes"),
      ),
    };
  const titles = {
    import: "Review draft",
    variant: "New variation",
    new: "New recipe",
    edit: "Edit recipe",
  };
  const subtitles = {
    import:
      "Check the ingredients, amounts and method against the original before saving.",
    variant:
      "The original stays in your cookbook. This version gets its own ingredients and method.",
    new: "Unknown amounts and timings can stay blank.",
    edit: "Unknown amounts and timings can stay blank.",
  };
  const back =
    r || mode === "variant"
      ? { label: r?.data.title ?? "Recipe", route: `recipes/${id}` }
      : { label: "Recipes", route: "recipes" };
  const ingredientText = data.ingredients
    .map((i) =>
      `${i.quantity == null ? "" : `${i.quantity} ${i.unit ?? ""} `}${i.name}${i.preparation ? `, ${i.preparation}` : ""}`.trim(),
    )
    .join("\n");
  const effortSet = [
    data.active_minutes,
    data.total_minutes,
    data.pan_count,
    data.cleanup,
    data.spice_level,
  ].some((v) => v != null && v !== "");
  const extrasSet = Boolean(
    data.notes || data.source_url || (data.links ?? []).length,
  );
  const content = `${pageHeader({ title: titles[mode] ?? "Edit recipe", subtitle: subtitles[mode], back })}<div class="${draft ? "review-grid" : ""}"><form data-form="recipe" class="stack" data-mode="${mode}" data-id="${esc(id ?? "")}" data-version="${draft?.version ?? r?.version ?? ""}"><section class="panel stack"><h2>Basics</h2><div class="form-grid">${field("Recipe name", "title", mode === "variant" ? `${data.title} · My version` : data.title, "text", 'required maxlength="500"')}${field("Original yield / portions", "servings", data.servings ?? "", "number", 'min="0.01" max="10000" step="any" placeholder="Unknown"')}</div>${field("Tags, separated by commas", "tags", data.tags.join(", "), "text", 'placeholder="Weeknight, vegetarian"')}</section><section class="panel stack"><h2>Ingredients</h2>${area("Ingredients · one per line", "ingredients", ingredientText, 'rows="9" placeholder="250 g orzo\n30 mL olive oil\nSalt to taste"', "Amount, unit, name, then an optional preparation after a comma. Unclear amounts stay as written.")}</section><section class="panel stack"><h2>Method</h2>${area("Method · separate steps with a blank line", "steps", data.steps.map((s) => s.text).join("\n\n"), 'rows="9"')}</section><section class="panel stack"><h2>Equipment</h2>${area("Equipment · one per line", "equipment", data.equipment.map((e) => e.name).join("\n"), 'rows="3" placeholder="Wide pan\nMeasuring jug"', "Leave blank if the recipe does not specify its tools.")}</section>${disclosure(
    "Effort and spice",
    `<div class="form-grid form-grid-4">${field("Hands-on minutes", "active_minutes", data.active_minutes ?? "", "number", 'min="0" max="10080" placeholder="Unknown"')}${field("Total minutes", "total_minutes", data.total_minutes ?? "", "number", 'min="0" max="10080" placeholder="Unknown"')}${field("Cooking pans", "pan_count", data.pan_count ?? "", "number", 'min="0" max="100" placeholder="Unknown"')}${select("Cleanup effort", "cleanup", cleanupOptions, data.cleanup ?? "")}</div>${select("Spice level", "spice_level", spiceOptions, data.spice_level ?? "")}`,
    { open: effortSet },
  )}${disclosure(
    "Notes, source and links",
    `${area("Recipe notes", "notes", data.notes)}${field("Source link (optional)", "source_url", data.source_url ?? "", "url", "", "Where the recipe came from. A video source plays on the recipe page.")}${area("Links and videos · one per line", "links", formatLinkLines(data.links ?? []), 'rows="3" placeholder="https://youtu.be/… Folding the dough\nexample.com/the-original The written version"', "A web address, then an optional title. YouTube, Vimeo, Facebook, Instagram and TikTok videos play on the recipe page; other links open in a new tab.")}`,
    { open: extrasSet },
  )}${mode === "variant" ? `<div class="panel">${check("Use this as my preferred version", "preferred", "on", true)}</div>` : ""}${draft ? `<div class="panel">${check("I checked the ingredients, amounts and method against the original.", "reviewed", "on", false, "required")}</div>` : ""}${errorSlot()}<div class="form-footer">${submit(draft ? "Save reviewed recipe" : mode === "variant" ? "Save variation" : "Save recipe", "check")}${link("Cancel", r ? `recipes/${r.id}` : "recipes", { cls: "btn-quiet" })}</div></form>${draft ? `<aside class="panel source-pane stack-sm"><h2>Your original</h2>${draft.data.warnings.map((w) => `<p class="small muted">${esc(w)}</p>`).join("")}${draft.data.image_id ? `<img class="source-image" src="/api/assets/${encodeURIComponent(draft.data.image_id)}" alt="Original recipe photo for comparison">` : ""}<details open><summary class="small">Extracted source text</summary><pre class="source-text">${esc(draft.data.original_text)}</pre></details></aside>` : ""}</div>`;
  return { title: titles[mode] ?? "Edit recipe", active: "recipes", content };
}

async function recipePage(id) {
  const r = record("recipe", id);
  if (!r)
    return {
      title: "Recipes",
      active: "recipes",
      content: emptyState(
        "Recipe not found.",
        "It may have been archived.",
        link("Your recipes", "recipes"),
      ),
    };
  const source = {
    kind: "recipe",
    id,
    ...(portions.has(id) ? { servings: portions.get(id) } : {}),
  };
  const [scaled, memory, cost] = await Promise.all([
    api("recipe_scale", {
      id,
      ...(source.servings ? { servings: source.servings } : {}),
    }),
    api("recipe_memory", { id }),
    api("cost_estimate", { source, currency, as_of: today() }),
  ]);
  const d = scaled.recipe;
  const content = `${pageHeader({ title: r.data.title, eyebrow: r.data.original_recipe_id ? "Your own variation" : (r.data.tags[0] ?? "Recipe"), back: { label: "Recipes", route: "recipes" }, actions: `${button("", "favorite", `data-id="${id}" aria-label="${r.data.favorite ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${Boolean(r.data.favorite)}"`, `btn-quiet btn-icon favorite ${r.data.favorite ? "is-favorite" : ""}`, "heart")}${link("Edit recipe", `recipes/${id}/edit`, { ico: "pencil" })}` })}${effort(r)}<div class="actions spacer">${button("Cook", "cook", `data-kind="recipe" data-id="${id}"`, "btn-primary", "flame")}${link("Shop", `shop/review/recipe/${id}`, { ico: "shopping-basket" })}${button("Plan", "toggle", 'data-target="#plan-form" aria-expanded="false" aria-controls="plan-form"', "", "calendar-days")}</div><form id="plan-form" data-form="plan" class="panel stack spacer" hidden>${hidden("source", `recipe:${id}`)}<h2>Add to the plan</h2><div class="form-grid">${field("Date", "date", today(), "date", "required")}${field("Meal", "slot", "Dinner", "text", "required")}</div>${errorSlot()}<div class="form-footer">${submit("Add to plan", "calendar-days")}${button("Cancel", "toggle", 'data-target="#plan-form"', "btn-quiet")}</div></form>${memory.preferred_recipe && memory.preferred_recipe.id !== id ? `<div class="spacer">${callout(`Your preferred version: ${esc(memory.preferred_recipe.data.title)} <a href="#/recipes/${memory.preferred_recipe.id}">Open variation</a>`, { ico: "star" })}</div>` : ""}${memory.latest ? `<div class="spacer">${callout(`<div class="eyebrow">Remember for next time</div><p class="preline">${esc(memory.latest.data.next_time || memory.latest.data.changes || memory.latest.data.text)}</p><small class="muted">${esc(memory.latest.data.cooked_on ?? memory.latest.created_at.slice(0, 10))}</small>`, { kind: "callout-warning", ico: "notebook-pen" })}</div>` : ""}<div class="cols spacer"><section class="panel stack"><div class="row between"><h2>Ingredients</h2><form data-form="servings" class="row row-nowrap servings-form">${hidden("id", id)}${field("Portions", "servings", d.servings ?? "", "number", `min="0.01" max="10000" step="any" ${r.data.servings === null ? 'disabled placeholder="Unknown"' : "required"}`)}${r.data.servings !== null ? '<button class="btn btn-sm self-end" type="submit">Update</button>' : ""}</form></div><div>${d.ingredients.map((i) => `<div class="ingredient"><span>${esc(i.name)}${i.preparation ? `<small>${esc(i.preparation)}</small>` : ""}</span><span class="amount">${esc(amount(i))}</span></div>`).join("") || '<p class="small muted">Ingredients have not been recorded.</p>'}</div>${d.equipment.length ? `<div><h3>What you’ll use</h3><div class="chips spacer-sm">${d.equipment.map((e) => tag(`${e.quantity > 1 ? `${e.quantity} × ` : ""}${e.name}${e.capacity ? ` · ${e.capacity}` : ""}`, "tag-neutral")).join("")}</div></div>` : ""}<div><h3>Estimated ingredient cost</h3><p class="small spacer-xs">${cost.complete ? `<strong>${money(cost.total)}</strong> <span class="muted">· ${cost.dishes[0].per_portion == null ? "" : `${money(cost.dishes[0].per_portion)} per portion`}</span>` : `<strong>${money(cost.known_cost)}</strong> <span class="muted">known subtotal · incomplete</span>`}</p>${cost.missing_prices.length ? `<p class="small muted">Missing amounts or prices: ${esc([...new Set(cost.missing_prices.map((l) => l.ingredient.name))].join(", "))}.</p>` : ""}<a class="small" href="#/settings/prices">Prices</a></div></section><section class="stack"><h2>Method</h2><ol class="method">${d.steps.map((s) => `<li>${esc(s.text)}${s.duration_seconds ? `<small class="muted">${num(s.duration_seconds / 60)} minutes</small>` : ""}</li>`).join("") || '<li class="small muted">No method recorded.</li>'}</ol>${d.warnings.length ? callout(d.warnings.map(esc).join("<br>"), { kind: "callout-warning", ico: "triangle-alert" }) : ""}${r.data.notes ? `<div class="panel panel-soft"><p class="preline">${esc(r.data.notes)}</p></div>` : ""}${linksSection(r.data)}<details class="disclosure quiet"><summary>Original recipe and sources</summary><div class="disclosure-body">${r.data.source_url ? `<a href="${esc(r.data.source_url)}" target="_blank" rel="noreferrer">Original source</a>` : ""}${(r.data.source_image_ids ?? []).map((id) => `<img class="source-image" src="/api/assets/${encodeURIComponent(id)}" alt="Original recipe photo">`).join("")}<pre class="source-text">${esc(r.data.original_text || "No original text was provided.")}</pre></div></details></section></div><section class="section"><div class="section-header"><h2>Cooking notes</h2><div class="actions">${link("Add a cooking note", `recipes/${id}/memory`, { cls: "btn-sm", ico: "notebook-pen" })}${link("Make a variation", `recipes/${memory.original_recipe_id}/variant`, { cls: "btn-sm", ico: "copy" })}${link("Record a cooked batch", `plan/leftovers/new/${id}`, { cls: "btn-sm", ico: "package" })}</div></div>${memory.notes.length ? `<div class="grid">${memory.notes.map((n) => `<article class="panel stack-sm"><div class="row between"><span class="eyebrow">${esc(n.data.cooked_on ?? n.created_at.slice(0, 10))}</span><span class="small">${n.data.rating ? "★".repeat(n.data.rating) : ""}${n.data.cook_again === true ? " · Cook again" : n.data.cook_again === false ? " · Try something else" : ""}</span></div><p class="preline">${esc(n.data.text)}</p>${n.data.changes ? `<p class="small preline"><strong>Changed:</strong> ${esc(n.data.changes)}</p>` : ""}${n.data.next_time ? `<p class="small preline"><strong>Next time:</strong> ${esc(n.data.next_time)}</p>` : ""}</article>`).join("")}</div>` : '<p class="small muted">Your notes and successful changes will appear here before the next cook.</p>'}${memory.variants.length ? `<div class="spacer"><h3>Ways you make it</h3><div class="chips spacer-sm">${memory.variants.map((v) => `<a class="chip" href="#/recipes/${v.id}">${esc(v.data.title)}${v.data.preferred ? " · Preferred" : ""}</a>`).join("")}</div></div>` : ""}</section>`;
  return { title: r.data.title, active: "recipes", content };
}

function memoryPage(id) {
  const r = record("recipe", id);
  if (!r)
    return {
      title: "Recipes",
      active: "recipes",
      content: emptyState(
        "Choose a recipe first.",
        "",
        link("Recipes", "recipes"),
      ),
    };
  const content = `${pageHeader({ title: "Add a cooking note", subtitle: `What worked, what you changed, and what to remember next time you make ${r.data.title}.`, back: { label: r.data.title, route: `recipes/${id}` } })}<form data-form="memory" class="panel stack">${hidden("recipe_id", id)}${field("Cooked on", "cooked_on", today(), "date", "required")}${area("How did it turn out?", "text", "", 'required placeholder="A keeper. Everyone went back for seconds."')}${area("What did you change?", "changes", "", 'placeholder="Used half the lemon and added fresh dill."')}${area("What should you remember next time?", "next_time", "", 'placeholder="Use the wide pan, and keep the heat low."')}<div class="form-grid">${select(
    "Your rating",
    "rating",
    [
      ["", "No rating"],
      [5, "5 · Loved it"],
      [4, "4 · Very good"],
      [3, "3 · Good"],
      [2, "2 · Needs work"],
      [1, "1 · Not for us"],
    ],
  )}${select("Make it again?", "cook_again", [
    ["", "Not sure yet"],
    ["yes", "Yes, please"],
    ["no", "Probably not"],
  ])}</div>${errorSlot()}<div class="form-footer">${submit("Save cooking note", "check")}${link("Cancel", `recipes/${id}`, { cls: "btn-quiet" })}</div></form>`;
  return { title: "Add a cooking note", active: "recipes", content };
}

// ---------- Plan ----------
async function planWeekPage() {
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const estimate = await api("cost_week", {
    week_start: week,
    currency,
    as_of: today(),
  }).catch(() => null);
  const showCost =
    estimate && (estimate.budget || estimate.plans.some((p) => p.known_cost));
  const content = `${pageHeader({ title: "Plan", subtitle: "A freshly cooked meal, a favorite combination, or yesterday’s good idea." })}${segmented(PLAN_TABS, "week", "Plan sections")}<div class="toolbar">${button("", "week", 'data-delta="-7" aria-label="Previous week"', "btn-icon", "chevron-left")}<h2 class="grow toolbar-title">${dateLabel(week)} – ${dateLabel(addDays(week, 6))}</h2>${week !== monday(today()) ? button("This week", "week-today", "", "btn-sm") : ""}${button("", "week", 'data-delta="7" aria-label="Next week"', "btn-icon", "chevron-right")}</div>${
    showCost
      ? callout(
          `<strong>${estimate.complete ? "Planned cost" : "Known cost so far"}: ${money(estimate.known_cost)}</strong>${estimate.budget ? ` · Budget ${money(estimate.budget.data.amount)}${estimate.remaining === null ? "" : estimate.remaining >= 0 ? ` · ${money(estimate.remaining)} left` : ` · ${money(-estimate.remaining)} over`}` : ""} <a href="#/settings/prices">Prices &amp; budget</a>`,
          { ico: "coins" },
        )
      : ""
  }<div class="week-grid spacer">${days
    .map((date) => {
      const { planned, leftovers } = dayEntries(date);
      const isToday = date === today();
      return `<section class="day ${isToday ? "today" : ""}"><div class="day-head"><h2 class="day-name">${weekdayLabel(date)}<small>${dateLabel(date)}</small></h2>${isToday ? tag("Today") : ""}</div>${planned.length || leftovers.length ? `<div class="list">${planned.map(planRow).join("")}${leftovers.map(leftoverRow).join("")}</div>` : '<p class="small muted">Nothing planned.</p>'}${disclosure(
        `${icon("plus", { className: "icon-sm" })}Add to ${weekdayLabel(date)}`,
        `<form data-form="plan" class="stack">${hidden("date", date)}<div class="form-grid">${select("Recipe or meal", "source", sourceOptions(), "", "required")}${field("Meal", "slot", "Dinner", "text", "required")}</div>${errorSlot()}<div class="form-footer">${submit("Add to this day")}${link("Plan leftovers instead", "plan/leftovers", { cls: "btn-quiet btn-sm" })}</div></form>`,
        { quiet: true },
      )}</section>`;
    })
    .join("")}</div>`;
  return { title: "Plan", active: "plan", content };
}

function mealsPage(editId) {
  if (editId) return mealForm(editId);
  const meals = records("meal");
  const content = `${pageHeader({ title: "Plan", subtitle: "Combinations you’ll want to cook again, with portions for each dish." })}${segmented(PLAN_TABS, "meals", "Plan sections")}${meals.length ? `<div class="toolbar">${link("New meal", "plan/meals/new", { primary: true, ico: "plus" })}</div>` : ""}${
    meals.length
      ? `<div class="grid grid-3">${meals
          .map(
            (m) =>
              `<article class="card"><span class="eyebrow">${plural(m.data.dishes.length, "dish", "dishes")} · One meal</span><h2 class="card-title">${esc(m.data.title)}</h2><div class="card-body">${m.data.dishes.map((d) => `<p>${esc(record("recipe", d.recipe_id)?.data.title ?? "Archived recipe")} · ${d.servings ?? "Original"} portions</p>`).join("")}</div>${m.data.notes ? `<p class="preline">${esc(m.data.notes)}</p>` : ""}<div class="card-end"><div class="actions">${button("Cook", "cook", `data-kind="meal" data-id="${m.id}"`, "btn-primary btn-sm", "flame")}${link("Shop", `shop/review/meal/${m.id}`, { cls: "btn-sm", ico: "shopping-basket" })}</div>${link("Edit", `plan/meals/${m.id}`, { cls: "btn-sm btn-quiet", ico: "pencil" })}</div></article>`,
          )
          .join("")}</div>`
      : emptyState(
          "No meals yet.",
          "Save a main and a side together, with portions for each dish, and cook or shop them as one.",
          link("New meal", "plan/meals/new", { primary: true }),
          "utensils",
        )
  }`;
  return { title: "Plan", active: "plan", content };
}
function mealForm(editId) {
  const editing = editId === "new" ? null : record("meal", editId);
  if (editId !== "new" && !editing)
    return {
      title: "Plan",
      active: "plan",
      content: emptyState("Meal not found.", "", link("Meals", "plan/meals")),
    };
  const recipes = records("recipe");
  const content = `${pageHeader({ title: editing ? "Edit meal" : "New meal", subtitle: "Choose the dishes and the portions you want to make.", back: { label: "Meals", route: "plan/meals" } })}<form data-form="meal" class="panel stack" data-id="${editing?.id ?? ""}" data-version="${editing?.version ?? ""}">${field("Meal name", "title", editing?.data.title ?? "", "text", 'required placeholder="Friday dinner"')}<div><h3>Dishes</h3><div class="list">${
    recipes
      .map((r) => {
        const dish = editing?.data.dishes.find((d) => d.recipe_id === r.id);
        return `<div class="list-item"><div class="list-body">${check(r.data.title, "recipes", r.id, Boolean(dish), 'class="check-lg"')}</div><label class="field w-portions"><span class="sr-only">Portions of ${esc(r.data.title)}</span><input type="number" name="portions-${r.id}" value="${dish?.servings ?? r.data.servings ?? ""}" min="0.01" max="10000" step="any" placeholder="${r.data.servings === null ? "Original" : "Portions"}" ${r.data.servings === null ? "disabled" : ""} aria-label="Portions of ${esc(r.data.title)}"></label></div>`;
      })
      .join("") ||
    `<p class="small muted">Add a recipe first, then combine recipes into a meal.</p>`
  }</div></div>${area("Meal notes", "notes", editing?.data.notes ?? "", 'rows="2"')}${errorSlot()}<div class="form-footer">${submit("Save meal", "check")}${link("Cancel", "plan/meals", { cls: "btn-quiet" })}</div></form>`;
  return { title: editing ? "Edit meal" : "New meal", active: "plan", content };
}

function leftoversPage() {
  const batches = records("batch");
  const content = `${pageHeader({ title: "Plan", subtitle: "Cooked portions set aside for later. They appear in the week without adding groceries." })}${segmented(PLAN_TABS, "leftovers", "Plan sections")}${batches.length ? `<div class="toolbar">${link("Record a batch", "plan/leftovers/new", { primary: true, ico: "plus" })}</div>` : ""}${
    batches.length
      ? `<div class="grid grid-3">${batches
          .map(
            (b) =>
              `<article class="card"><div class="row between">${tag(b.data.storage)}<small class="muted">Cooked ${dateLabel(b.data.cooked_on)}</small></div><h2 class="card-title"><a href="#/plan/leftovers/${b.id}">${esc(b.data.title)}</a></h2><div class="row"><div class="stat"><span class="number">${num(b.remaining_portions)}</span><small>portions left</small></div><div class="stat"><strong>${num(b.available_portions)}</strong><small>not yet allocated</small></div></div><p>${num(b.reserved_portions)} reserved · ${num(b.eaten_portions)} eaten</p><div class="card-end"><span></span>${link("Allocate portions", `plan/leftovers/${b.id}`, { cls: "btn-sm", ico: "chevron-right" })}</div></article>`,
          )
          .join("")}</div>`
      : emptyState(
          "No cooked batches yet.",
          "Record a batch after cooking, then set portions aside for later meals.",
          link("Record a batch", "plan/leftovers/new", { primary: true }),
          "package",
        )
  }`;
  return { title: "Plan", active: "plan", content };
}
function batchForm(recipeId, sessionId, dishId) {
  if (!records("recipe").length)
    return {
      title: "Plan",
      active: "plan",
      content: emptyState(
        "Save a recipe first.",
        "Then record how much you cooked.",
        link("Add recipe", "recipes/add", { primary: true }),
      ),
    };
  const session = record("session", sessionId),
    dish = session?.data.dishes.find((d) => d.dish_id === dishId);
  const content = `${pageHeader({ title: "Record a batch", subtitle: "Record what you made. Allocate it to meals once it’s saved.", back: { label: "Leftovers", route: "plan/leftovers" } })}<form data-form="batch" class="panel stack">${session ? `${hidden("session_id", sessionId)}${hidden("dish_id", dishId)}` : ""}${select("Recipe", "recipe_id", optionsFor("recipe"), dish?.recipe_id ?? recipeId ?? records("recipe")[0]?.id, session ? "disabled" : "required")}${session ? hidden("recipe_id", dish.recipe_id) : ""}<div class="form-grid">${field("Portions actually cooked", "portions", dish?.servings ?? record("recipe", recipeId)?.data.servings ?? "", "number", `required min="0.01" max="10000" step="any" ${session ? "readonly" : ""}`)}${field("Cooked on", "cooked_on", today(), "date", "required")}${select(
    "Stored in",
    "storage",
    [
      ["fridge", "Fridge"],
      ["freezer", "Freezer"],
    ],
  )}</div>${area("Batch notes", "notes", "", 'rows="2" placeholder="Label on the container, or a reheating note."')}${errorSlot()}<div class="form-footer">${submit("Record cooked batch", "check")}${link("Cancel", "plan/leftovers", { cls: "btn-quiet" })}</div></form>`;
  return { title: "Record a batch", active: "plan", content };
}
function batchPage(id) {
  const b = record("batch", id);
  if (!b)
    return {
      title: "Plan",
      active: "plan",
      content: emptyState(
        "Batch not found.",
        "",
        link("Leftovers", "plan/leftovers"),
      ),
    };
  const content = `${pageHeader({ title: b.data.title, eyebrow: "Cooked batch", subtitle: `Cooked ${dateLabel(b.data.cooked_on)} · ${num(b.data.portions)} portions originally · ${b.data.storage}`, back: { label: "Leftovers", route: "plan/leftovers" } })}${callout(`<strong>${num(b.available_portions)}</strong> portions available to allocate · ${num(b.reserved_portions)} reserved · ${num(b.eaten_portions)} eaten`, { ico: "package" })}<div class="grid-2 spacer"><section class="panel stack"><h2>Where it’s going</h2><div class="list">${b.data.allocations.map((a) => `<div class="list-item"><div class="list-body"><strong>${num(a.portions)} portions · ${esc(a.slot)}</strong><p>${a.date ? dateLabel(a.date) : "No date set"} · ${esc(a.storage)} · ${a.status === "eaten" ? "Eaten" : "Reserved"}</p>${a.notes ? `<p>${esc(a.notes)}</p>` : ""}</div><div class="list-actions">${a.status === "reserved" ? button("Eaten", "allocation-eat", `data-id="${id}" data-allocation="${a.id}"`, "btn-sm", "check") : ""}${button("Release", "allocation-release", `data-id="${id}" data-allocation="${a.id}" aria-label="Release ${esc(a.slot)} allocation"`, "btn-quiet btn-sm")}</div></div>`).join("") || '<p class="small muted">No portions allocated yet.</p>'}</div>${b.data.notes ? `<div class="panel panel-soft"><p class="preline">${esc(b.data.notes)}</p></div>` : ""}</section><form data-form="allocation" class="panel stack" data-id="${id}" data-version="${b.version}"><h2>Allocate portions</h2><div class="form-grid">${field("Portions", "portions", "", "number", `required min="0.01" max="${b.available_portions}" step="any"`)}${field("Meal date (optional)", "date", "", "date", `min="${b.data.cooked_on}"`)}${select(
    "Meal",
    "slot",
    [
      ["Lunch", "Lunch"],
      ["Dinner", "Dinner"],
      ["Breakfast", "Breakfast"],
      ["For later", "For later"],
    ],
  )}${select(
    "Store these portions in",
    "storage",
    [
      ["fridge", "Fridge"],
      ["freezer", "Freezer"],
    ],
    b.data.storage,
  )}</div>${area("A note for this portion", "notes", "", 'rows="2"')}${check("Already eaten", "eaten")}${errorSlot()}<div class="form-footer">${submit("Allocate portions", "check")}</div><p class="small muted">These portions are already cooked. Planning them adds no groceries.</p></form></div>`;
  return { title: b.data.title, active: "plan", content };
}

// ---------- Shop ----------
function shopListPage(id) {
  const lists = records("shopping");
  const list = record("shopping", id) ?? lists[0];
  const open = list ? list.items.filter((i) => !i.checked) : [];
  const done = list ? list.items.filter((i) => i.checked) : [];
  const itemRow = (i) =>
    `<div class="list-item ${i.checked ? "done" : ""}"><label class="check check-lg"><input type="checkbox" data-change="shopping-check" data-id="${list.id}" data-item="${i.id}" ${i.checked ? "checked" : ""} aria-label="Bought ${esc(i.name)}"></label><div class="list-body"><strong>${esc(i.name)}</strong><p>${esc([...new Set(i.contributions.map((c) => c.recipe_title).filter(Boolean))].join(", ") || "Everyday item")}</p></div><span class="quantity">${esc(amount(i))}</span></div>`;
  const content = `${pageHeader({ title: "Shop", subtitle: list ? (list.items.length ? `${plural(open.length, "item")} left to pick up.` : "Nothing on the list yet. Shop a recipe, or add the everyday things you need.") : "Create a list, then shop a recipe, a meal or a planned day." })}${segmented(SHOP_TABS, "list", "Shop sections")}${
    list
      ? `${lists.length > 1 ? `<div class="chips list-switcher">${lists.map((l) => `<a class="chip" href="#/shop/list/${l.id}" ${l.id === list.id ? 'aria-current="page"' : ""}>${esc(l.data.title)}</a>`).join("")}</div>` : ""}<section class="panel stack"><form data-form="shopping-item" class="inline-add" data-id="${list.id}" data-version="${list.version}">${field("Add an everyday item", "name", "", "text", 'required placeholder="Coffee"')}${errorSlot()}${submit("Add item", "plus")}</form><div class="list">${open.map(itemRow).join("") || (done.length ? '<p class="small muted">Everything is in the basket.</p>' : '<p class="small muted">Open a recipe, meal or planned day and press Shop to add its ingredients.</p>')}</div>${done.length ? disclosure(`In the basket · ${done.length}`, `<div class="list">${done.map(itemRow).join("")}</div>`, { quiet: true, open: true }) : ""}${list.data.sources.length ? disclosure(`Recipes on this list · ${list.data.sources.length}`, `<div class="list">${list.data.sources.map((s) => `<div class="list-item"><span class="list-body">${esc(s.title)}</span>${button("Remove", "shopping-remove", `data-id="${list.id}" data-source="${esc(s.source_key)}" aria-label="Remove ${esc(s.title)} from this list"`, "btn-quiet btn-sm")}</div>`).join("")}</div>`, { quiet: true }) : ""}</section>`
      : `<form data-form="shopping-create" class="panel stack"><h2>Create a shopping list</h2>${field("List name", "title", "Groceries", "text", "required")}${errorSlot()}<div class="form-footer">${submit("Create shopping list", "plus")}</div></form>`
  }`;
  return { title: "Shop", active: "shop", content };
}

function pantryPage() {
  const pantry = [...records("pantry")].sort(
    (a, b) =>
      Number(b.data.use_soon) - Number(a.data.use_soon) ||
      a.data.name.localeCompare(b.data.name),
  );
  const content = `${pageHeader({ title: "Shop", subtitle: "What you have at home. Today uses it to suggest dinner and to spot what’s missing." })}${segmented(SHOP_TABS, "pantry", "Shop sections")}${pantry.length ? `<div class="toolbar">${link("Add ingredient", "shop/pantry/new", { primary: true, ico: "plus" })}${link("Find dinner with it", "today", { ico: "search" })}</div>` : ""}${
    pantry.length
      ? `<section class="panel"><div class="list">${pantry.map((p) => `<div class="list-item"><label class="check check-lg"><input type="checkbox" data-change="pantry-available" data-id="${p.id}" ${p.data.available ? "checked" : ""} aria-label="Have ${esc(p.data.name)}"></label><div class="list-body"><strong>${esc(p.data.name)}</strong>${p.data.preparation ? `<small> · ${esc(p.data.preparation)}</small>` : ""}<p>${p.data.quantity == null ? "Amount not recorded" : esc(amount(p.data))}${!p.data.available ? " · Not on hand" : ""}</p></div><div class="list-actions">${button(p.data.use_soon ? "Use soon ✓" : "Use soon", "pantry-soon", `data-id="${p.id}" aria-pressed="${p.data.use_soon}"`, `btn-sm ${p.data.use_soon ? "" : "btn-quiet"}`)}${link("Edit", `shop/pantry/${p.id}`, { cls: "btn-sm btn-quiet" })}</div></div>`).join("")}</div></section>`
      : emptyState(
          "Your pantry is empty.",
          "Start with the ingredients you’d like to use this week. A simple checklist is enough; amounts are optional.",
          link("Add ingredient", "shop/pantry/new", { primary: true }),
          "refrigerator",
        )
  }`;
  return { title: "Shop", active: "shop", content };
}
function pantryForm(id) {
  const editing = id === "new" ? null : record("pantry", id);
  if (id !== "new" && !editing)
    return {
      title: "Shop",
      active: "shop",
      content: emptyState(
        "Ingredient not found.",
        "",
        link("Pantry", "shop/pantry"),
      ),
    };
  const d = editing?.data ?? {};
  const content = `${pageHeader({ title: editing ? "Edit ingredient" : "Add ingredient", subtitle: "Names and preparation should match the way your recipes write them.", back: { label: "Pantry", route: "shop/pantry" } })}<form data-form="pantry" class="panel stack" data-id="${editing?.id ?? ""}" data-version="${editing?.version ?? ""}">${field("Ingredient name", "name", d.name ?? "", "text", 'required placeholder="Zucchini"')}${field("Preparation / form", "preparation", d.preparation ?? "", "text", 'placeholder="Match the recipe, e.g. drained"')}<div class="form-grid">${field("Amount (optional)", "quantity", d.quantity ?? "", "number", 'min="0" max="1000000000" step="any" placeholder="Unknown"')}${field("Unit", "unit", d.unit ?? "", "text", 'placeholder="g, mL, each…"')}</div>${check("I have this ingredient", "available", "on", d.available !== false)}${check("Use this soon", "use_soon", "on", d.use_soon ?? false)}${area("A note", "notes", d.notes ?? "", 'rows="2"')}${errorSlot()}<div class="form-footer">${submit(editing ? "Save ingredient" : "Add to pantry", "check")}${link("Cancel", "shop/pantry", { cls: "btn-quiet" })}</div></form>`;
  return {
    title: editing ? "Edit ingredient" : "Add ingredient",
    active: "shop",
    content,
  };
}

async function reviewPage(kind, id) {
  const source = {
    kind,
    id,
    ...(kind === "recipe" && portions.has(id)
      ? { servings: portions.get(id) }
      : {}),
  };
  const list = records("shopping")[0];
  if (!list)
    return {
      title: "Shop",
      active: "shop",
      content: `${pageHeader({ title: "Start a shopping list", subtitle: "Create a list before shopping this recipe or meal.", back: { label: "Shop", route: "shop" } })}<form data-form="shopping-create" class="panel stack">${field("List name", "title", "Groceries", "text", "required")}${errorSlot()}<div class="form-footer">${submit("Create shopping list", "plus")}</div></form>`,
    };
  const key = `${kind}:${id}`,
    excluded = exclusions.get(key) ?? [];
  const input = {
    id: list.id,
    source,
    source_key: key,
    exclude_ingredients: excluded,
  };
  const preview = await api("shopping_preview", input);
  review = { input, preview };
  const content = `${pageHeader({ title: `Shop for ${preview.source.title}`, subtitle: "Untick what you already have, then add the rest to your list. Repeating this for the same source updates it instead of adding it twice.", back: { label: "Shop", route: "shop" } })}<div class="grid-2"><form data-form="shopping-review" class="panel stack"><h2>Ingredients to buy</h2>${preview.source.dishes.map((d) => `<section class="stack-sm"><h3>${esc(d.title)}</h3><div class="list">${d.ingredients.map((i, index) => `<div class="list-item">${check(`${i.name} · ${amount(i)}`, "ingredients", `${d.dish_id}:${index}`, !excluded.includes(`${d.dish_id}:${index}`))}</div>`).join("")}</div></section>`).join("")}${errorSlot()}<div class="form-footer">${submit("Update preview")}</div></form><section class="panel stack"><h2>Changes to your list</h2><p class="small muted">${preview.diff.added.length} new · ${preview.diff.changed.length} changed · ${preview.diff.removed.length} removed</p><div>${preview.items.map((i) => `<div class="ingredient"><span>${esc(i.name)}</span><span class="amount">${esc(amount(i))}</span></div>`).join("") || '<p class="small muted">No ingredients remain on this list.</p>'}</div>${button("Add to shopping list", "shopping-apply", "", "btn-primary", "shopping-basket")}<p class="small muted" id="review-hint">Repeating this action updates this occurrence without adding it twice.</p>${preview.equipment.requirements.length ? disclosure("Required equipment", preview.equipment.requirements.map((e) => `<p class="small">${esc(e.name)} · ${e.available_quantity === null ? "availability unknown" : `${e.available_quantity} available`}</p>${e.conflicts.map((c) => `<p class="small muted">${esc(c)}</p>`).join("")}`).join(""), { quiet: true }) : ""}</section></div>`;
  return { title: `Shop for ${preview.source.title}`, active: "shop", content };
}

// ---------- Cook ----------
function cookPage() {
  const sessions = [...records("session")].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );
  const active = sessions.filter((s) => s.data.status === "active");
  const finished = sessions
    .filter((s) => s.data.status !== "active")
    .slice(0, 6);
  const content = `${pageHeader({ title: "Cook", subtitle: "Follow each dish, share the preparation, and keep the timers in view." })}${
    active.length
      ? `<div class="grid grid-3">${active.map((s) => `<article class="card">${tag("On the stove", "tag-warm")}<h2 class="card-title"><a href="#/cook/${s.id}">${esc(s.data.title)}</a></h2><p>${plural(s.data.dishes.length, "dish", "dishes")} · ${s.data.progress.reduce((n, p) => n + p.completed_steps.length, 0)} of ${s.data.dishes.reduce((n, d) => n + d.steps.length, 0)} steps done</p><div class="card-end"><span class="small muted">Started ${dateLabel(s.created_at.slice(0, 10))}</span>${link("Continue", `cook/${s.id}`, { primary: true, cls: "btn-sm", ico: "flame" })}</div></article>`).join("")}</div>`
      : emptyState(
          "Nothing on the stove.",
          "Open a recipe, a meal or a planned day and press Cook to start.",
          `${link("Pick a recipe", "recipes", { primary: true })}${link("Open this week", "plan")}`,
          "flame",
        )
  }${finished.length ? `<section class="section"><div class="section-header"><h2>Recently finished</h2></div><div class="panel"><div class="list">${finished.map((s) => `<div class="list-item"><div class="list-body"><strong>${esc(s.data.title)}</strong><p>${plural(s.data.dishes.length, "dish", "dishes")} · ${dateLabel(s.created_at.slice(0, 10))}</p></div>${link("Notes & leftovers", `cook/${s.id}`, { cls: "btn-sm" })}</div>`).join("")}</div></div></section>` : ""}`;
  return { title: "Cook", active: "cook", content };
}
function sessionPage(id) {
  const s = record("session", id);
  if (!s)
    return {
      title: "Cook",
      active: "cook",
      content: emptyState("Session not found.", "", link("Cook", "cook")),
    };
  const d = s.data;
  if (d.status === "finished") {
    const content = `${pageHeader({ title: d.title, eyebrow: "Finished", subtitle: "Nice work. Save what you learned and set leftovers aside.", back: { label: "Cook", route: "cook" } })}<div class="grid grid-3">${d.dishes
      .map((dish) => {
        const batch = records("batch").find(
          (b) =>
            b.data.session_id === id && b.data.dish.dish_id === dish.dish_id,
        );
        return `<article class="card"><h2 class="card-title">${esc(dish.title)}</h2><p>${dish.servings ?? "Original"} portions cooked</p><div class="actions">${link("Remember what worked", `recipes/${dish.recipe_id}/memory`, { cls: "btn-sm", ico: "notebook-pen" })}${batch ? link("Open cooked batch", `plan/leftovers/${batch.id}`, { cls: "btn-sm", ico: "package" }) : dish.servings ? link("Record leftovers", `plan/leftovers/new/${dish.recipe_id}/${id}/${dish.dish_id}`, { cls: "btn-sm", ico: "package" }) : '<p class="small muted">The cooked yield was unknown; record a batch from Leftovers once the recipe yield is set.</p>'}</div></article>`;
      })
      .join(
        "",
      )}</div>${d.notes ? `<div class="panel panel-soft spacer"><p class="preline">${esc(d.notes)}</p></div>` : ""}`;
    return { title: d.title, active: "cook", content };
  }
  const ownerOptions = [["", "Unassigned"], ...optionsFor("member")];
  const dishOptions = [
    ["", "Whole meal"],
    ...d.dishes.map((dish) => [dish.dish_id, dish.title]),
  ];
  const content = `${pageHeader({ title: d.title, eyebrow: "Cooking", subtitle: sharing ? "Progress, tasks and timers are shared with everyone connected to this kitchen." : "Progress, tasks and timers are saved as you go.", back: { label: "Cook", route: "cook" } })}<div class="dishes ${d.dishes.length > 1 ? "many" : ""}">${d.dishes
    .map((dish) => {
      const p = d.progress.find((p) => p.dish_id === dish.dish_id);
      const current = dish.steps[p.current_step];
      const memory = records("note")
        .filter((n) => n.data.recipe_id === dish.recipe_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return `<section class="panel stack"><div class="row between"><h2>${esc(dish.title)}</h2>${tag(`${dish.servings ?? "Original"} portions`)}</div>${memory ? callout(`<p class="preline">${esc(memory.data.next_time || memory.data.changes || memory.data.text)}</p><small class="muted">Your last cooking note</small>`, { kind: "callout-warning", ico: "notebook-pen" }) : ""}<div class="stack-sm"><span class="eyebrow">${p.completed_steps.length} of ${dish.steps.length} steps complete</span><progress class="progress" max="${Math.max(1, dish.steps.length)}" value="${p.completed_steps.length}" aria-label="Progress for ${esc(dish.title)}"></progress></div>${current ? `<div><div class="eyebrow">Step ${p.current_step + 1}</div><p class="step-current preline">${esc(current.text)}</p></div><div class="actions">${button("Previous step", "step-back", `data-id="${id}" data-dish="${dish.dish_id}" ${p.current_step === 0 ? "disabled" : ""}`, "", "chevron-left")}${button(p.current_step === dish.steps.length - 1 ? "Mark step done" : "Done, next step", "step-next", `data-id="${id}" data-dish="${dish.dish_id}"`, "btn-primary", "check")}</div>` : '<p class="small muted">This dish has no recorded instructions.</p>'}${linkLine(dish.links)}${disclosure("Ingredients and all steps", `<div>${dish.ingredients.map((i) => `<div class="ingredient"><span>${esc(i.name)}</span><span class="amount">${esc(amount(i))}</span></div>`).join("")}</div><ol class="method method-compact">${dish.steps.map((step, index) => `<li>${esc(step.text)} ${button(`Go to step ${index + 1}`, "step-jump", `data-id="${id}" data-dish="${dish.dish_id}" data-step="${index}"`, "btn-quiet btn-sm")}</li>`).join("")}</ol>`, { quiet: true })}</section>`;
    })
    .join(
      "",
    )}</div><div class="grid-2 spacer"><section class="panel stack"><div class="section-header tight"><h2>Tasks</h2><span class="small">Many hands, one meal</span></div><div>${(d.tasks ?? []).map((t) => `<div class="task ${t.completed ? "done" : ""}"><input type="checkbox" data-change="task-complete" data-id="${id}" data-task="${t.id}" ${t.completed ? "checked" : ""} aria-label="Complete ${esc(t.text)}"><div class="task-title"><strong>${esc(t.text)}</strong>${t.dish_id ? `<p class="small muted">${esc(d.dishes.find((dish) => dish.dish_id === t.dish_id)?.title)}</p>` : ""}</div><select data-change="task-owner" data-id="${id}" data-task="${t.id}" aria-label="Assign ${esc(t.text)}">${ownerOptions.map(([v, l]) => `<option value="${v}" ${v === (t.member_id ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${button("", "task-remove", `data-id="${id}" data-task="${t.id}" aria-label="Remove task ${esc(t.text)}"`, "btn-quiet btn-icon btn-sm", "x")}</div>`).join("") || '<p class="small muted">Split the prep into small tasks, then choose who handles each one.</p>'}</div><form data-form="task" class="stack-sm" data-id="${id}" data-version="${s.version}">${field("New task", "text", "", "text", 'required maxlength="500" placeholder="Chop the vegetables"')}<div class="form-grid">${select("For which dish?", "dish_id", dishOptions)}${select("Who’s doing it?", "member_id", ownerOptions)}</div>${errorSlot()}<div>${submit("Add cooking task", "plus")}</div></form></section><section class="panel stack"><div class="section-header tight"><h2>Timers</h2><span class="small">Countdowns stay in view here</span></div><div class="stack-sm">${
    d.timers
      .filter((t) => !t.cancelled)
      .map(
        (t) =>
          `<div class="timer" data-timer-row="${t.id}"><div><strong>${esc(t.label)}</strong><br><small class="muted">${t.dish_id ? `${esc(d.dishes.find((d) => d.dish_id === t.dish_id)?.title)} · ` : ""}${esc(person(t.member_id))}</small></div><span class="timer-time" data-deadline="${esc(t.deadline)}">—</span>${button("", "timer-cancel", `data-id="${id}" data-timer="${t.id}" aria-label="Cancel ${esc(t.label)} timer"`, "btn-quiet btn-icon btn-sm", "x")}</div>`,
      )
      .join("") || '<p class="small muted">No timers running.</p>'
  }</div><form data-form="timer" class="stack-sm" data-id="${id}" data-version="${s.version}"><div class="form-grid">${field("Timer name", "label", "", "text", 'required placeholder="Orzo"')}${field("Minutes", "minutes", "", "number", 'required min="0.016667" max="10080" step="any"')}${select("Dish", "dish_id", dishOptions)}${select("Who’s watching it?", "member_id", ownerOptions)}</div>${errorSlot()}<div>${submit("Start timer", "timer")}</div><p class="small muted">Use a device alarm for reliable alerts when the screen is locked.</p></form></section></div><form data-form="finish" class="panel stack spacer" data-id="${id}" data-version="${s.version}"><h2>Ready for the table?</h2>${area("A note about this meal", "notes", "", 'rows="2" placeholder="Crispy top. Next time, a little more lemon."')}${errorSlot()}<div class="form-footer">${submit("Finish cooking", "check")}</div></form>`;
  return { title: d.title, active: "cook", content, wakeLock: true };
}

// ---------- Settings ----------
async function settingsPage(tab, id) {
  const header = (subtitle) =>
    `${pageHeader({ title: "Settings", subtitle })}${segmented(SETTINGS_TABS, tab, "Settings sections")}`;
  if (tab === "household") {
    if (id) return memberForm(id);
    const members = records("member");
    return {
      title: "Settings",
      active: "settings",
      content: `${header("The people at your table: their tastes shape dinner suggestions, and they can own cooking tasks and timers.")}${members.length ? `<div class="toolbar">${link("Add person", "settings/household/new", { primary: true, ico: "plus" })}</div>` : ""}${
        members.length
          ? `<div class="grid grid-3">${members.map((m) => `<article class="card"><div class="row"><span class="avatar" aria-hidden="true">${esc(m.data.name[0])}</span><div class="grow"><h2 class="card-title card-title-sm">${esc(m.data.name)}</h2><p>${m.data.spice_tolerance == null ? "Spice preference not set" : `Spice: ${spiceOptions.find((o) => o[0] === m.data.spice_tolerance)?.[1]}`}</p></div></div><dl class="kv"><dt>Likes</dt><dd>${esc(m.data.likes.join(", ") || "Not set")}</dd><dt>Dislikes</dt><dd>${esc(m.data.dislikes.join(", ") || "Not set")}</dd></dl>${m.data.notes ? `<p>${esc(m.data.notes)}</p>` : ""}<div class="card-end"><span></span>${link("Edit", `settings/household/${m.id}`, { cls: "btn-sm", ico: "pencil" })}</div></article>`).join("")}</div>`
          : emptyState(
              "Who’s coming to dinner?",
              "Add a person to tailor suggestions and share cooking tasks.",
              link("Add person", "settings/household/new", { primary: true }),
              "users",
            )
      }<p class="small muted spacer">${sharing ? "Other browsers connected to this household server see the same recipes and cooking progress. " : ""}Profiles record tastes and task owners; they are not accounts or allergen records.</p>`,
    };
  }
  if (tab === "prices") {
    if (id) return priceForm(id);
    const estimate = await api("cost_week", {
      week_start: week,
      currency,
      as_of: today(),
    });
    const prices = records("price").filter((p) => p.data.currency === currency);
    return {
      title: "Settings",
      active: "settings",
      content: `${header("Estimates use the prices you confirm and the amounts your recipes need. They describe ingredients used, not checkout totals.")}<form data-form="currency" class="toolbar">${field("Currency", "currency", currency, "text", 'required pattern="[A-Za-z]{3}" maxlength="3" class="w-code"')}${field("Week starting Monday", "week", week, "date", "required")}<button type="submit" class="btn self-end">View week</button></form><div class="grid-2"><section class="panel stack"><div><div class="eyebrow">${estimate.complete ? "Planned cooking cost" : "Known ingredient subtotal"}</div><div class="number spacer-sm">${money(estimate.known_cost)}</div><p class="small muted">${estimate.complete ? `${plural(estimate.plans.length, "planned cooking occurrence")}` : "Incomplete · some prices or quantities are missing"}</p></div>${estimate.budget ? `<p>Weekly budget <strong>${money(estimate.budget.data.amount)}</strong><br><small class="muted">${estimate.remaining === null ? "Add missing prices to calculate what remains." : estimate.remaining >= 0 ? `${money(estimate.remaining)} remaining` : `${money(-estimate.remaining)} over budget`}</small></p>` : ""}${disclosure(`${estimate.budget ? "Change" : "Set"} this week’s budget`, `<form data-form="budget" class="stack-sm" data-id="${estimate.budget?.id ?? ""}" data-version="${estimate.budget?.version ?? ""}">${field(`Budget (${currency})`, "amount", estimate.budget?.data.amount ?? "", "number", 'required min="0" max="1000000000" step="0.01"')}${errorSlot()}<div>${submit("Save weekly budget")}</div></form>`, { quiet: true })}</section><section class="panel stack"><h2>On the menu</h2><div class="list">${estimate.plans.map((p) => `<div class="list-item"><div class="list-body"><strong>${esc(p.title)}</strong><p>${dateLabel(p.date)}${!p.complete ? ` · Missing: ${esc([...new Set(p.missing_prices.map((i) => i.ingredient.name))].join(", "))}` : ""}</p></div><span class="quantity">${money(p.known_cost)}${!p.complete ? '<br><small class="muted">partial</small>' : ""}</span></div>`).join("") || '<p class="small muted">Plan a recipe or meal to see its ingredient cost here.</p>'}</div>${estimate.leftovers.length ? `<p class="small muted">${plural(estimate.leftovers.length, "leftover meal")} already cooked and add no new grocery cost.</p>` : ""}<div>${link("Open the week", "plan", { cls: "btn-sm" })}</div></section></div><section class="section"><div class="section-header"><h2>Confirmed prices · ${esc(currency)}</h2>${link("Add price", "settings/prices/new", { primary: true, cls: "btn-sm", ico: "plus" })}</div><div class="panel table-wrap prices"><table><thead><tr><th>Ingredient</th><th>Package</th><th>Price</th><th>Confirmed</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${prices.map((p) => `<tr><td>${esc(p.data.name)}${p.data.preparation ? `<br><small>${esc(p.data.preparation)}</small>` : ""}</td><td>${num(p.data.package_quantity)} ${esc(p.data.unit)}</td><td>${money(p.data.price)}</td><td>${dateLabel(p.data.purchased_on)}<br><small>${p.data.source === "receipt" ? "From a receipt" : "Entered by hand"}</small></td><td>${link("Edit", `settings/prices/${p.id}`, { cls: "btn-sm btn-quiet" })}</td></tr>`).join("") || '<tr><td colspan="5"><span class="small muted">No confirmed prices yet. Add the ones you know.</span></td></tr>'}</tbody></table></div></section>`,
    };
  }
  if (tab === "backup")
    return {
      title: "Settings",
      active: "settings",
      content: `${header("Keep a portable copy of your cookbook, and see how this kitchen is shared.")}<div class="grid-2"><section class="panel stack"><h2>Backup</h2><p class="small muted">Export everything as one portable Kooks file, including photos, leftovers and prices. Keep it somewhere safe outside this computer.</p><div>${button("Export cookbook", "export", "", "btn-primary", "download")}</div><p class="small muted">Restoring replaces an empty cookbook through the MCP tools; see the household guide.</p></section><section class="panel stack"><h2>Sharing</h2>${callout(sharing ? "<strong>Shared household server.</strong> Everyone with the household key sees the same cookbook, plan and cooking progress." : "<strong>This computer only.</strong> The server accepts connections from this computer. A trusted-network key can share it with the household.", { ico: sharing ? "wifi" : "lock" })}<p class="small muted">One shared household, one key. Person profiles are tastes and task owners, not accounts.</p></section></div>`,
    };
  const status = await api("kooks_status").catch(() => null);
  return {
    title: "Settings",
    active: "settings",
    content: `${header("Make Kooks feel like home.")}<div class="grid-2"><form data-form="preferences" class="panel stack"><h2>Appearance</h2><fieldset class="radio-cards fieldset-plain"><legend class="label">Theme</legend>${[
      ["system", "Match the system", "monitor"],
      ["light", "Light", "sun"],
      ["dark", "Dark", "moon"],
    ]
      .map(
        ([value, label, ico]) =>
          `<label><input type="radio" name="theme" value="${value}" ${theme === value ? "checked" : ""}>${icon(ico)}${label}</label>`,
      )
      .join(
        "",
      )}</fieldset>${field("Currency for estimates", "currency", currency, "text", 'required pattern="[A-Za-z]{3}" maxlength="3"', "Three-letter code, for example USD or EUR.")}${errorSlot()}<div class="form-footer">${submit("Save preferences", "check")}</div></form><section class="panel stack"><h2>About</h2><dl class="kv"><dt>Version</dt><dd>${esc(status?.version ?? "—")}</dd><dt>Storage</dt><dd>${esc(status?.storage ?? "local SQLite")}</dd><dt>Licence</dt><dd>GNU AGPL-3.0 · <a href="https://github.com/Sweatpantslife/kooks">Source code</a></dd></dl><p class="small muted">Kooks stores your cookbook on this household’s own computer. Nothing is sent to a model provider unless you connect one yourself.</p></section></div>`,
  };
}
function memberForm(id) {
  const editing = id === "new" ? null : record("member", id);
  if (id !== "new" && !editing)
    return {
      title: "Settings",
      active: "settings",
      content: emptyState(
        "Person not found.",
        "",
        link("Household", "settings/household"),
      ),
    };
  const d = editing?.data ?? {};
  const content = `${pageHeader({ title: editing ? "Edit person" : "Add person", subtitle: "Tastes match the ingredient names and tags in your cookbook.", back: { label: "Household", route: "settings/household" } })}<form data-form="member" class="panel stack" data-id="${editing?.id ?? ""}" data-version="${editing?.version ?? ""}">${field("Name", "name", d.name ?? "", "text", "required")}${field("Likes · ingredients or tags, separated by commas", "likes", (d.likes ?? []).join(", "), "text", 'placeholder="Chickpeas, pasta"')}${field("Dislikes · separated by commas", "dislikes", (d.dislikes ?? []).join(", "), "text", 'placeholder="Mushrooms, olives"')}${select("Spice tolerance", "spice_tolerance", spiceOptions, d.spice_tolerance ?? "")}${area("Notes", "notes", d.notes ?? "", 'rows="3"')}${errorSlot()}<div class="form-footer">${submit(editing ? "Save person" : "Add person", "check")}${link("Cancel", "settings/household", { cls: "btn-quiet" })}</div></form>`;
  return {
    title: editing ? "Edit person" : "Add person",
    active: "settings",
    content,
  };
}
function priceForm(id) {
  const editing = id === "new" ? null : record("price", id);
  if (id !== "new" && !editing)
    return {
      title: "Settings",
      active: "settings",
      content: emptyState(
        "Price not found.",
        "",
        link("Prices", "settings/prices"),
      ),
    };
  const d = editing?.data ?? {};
  const content = `${pageHeader({ title: editing ? "Edit price" : "Add price", subtitle: "A package you actually paid for. Costing uses the latest compatible price on or before the estimate date.", back: { label: "Prices & budget", route: "settings/prices" } })}<form data-form="price" class="panel stack" data-id="${editing?.id ?? ""}" data-version="${editing?.version ?? ""}"><div class="form-grid">${field("Ingredient name", "name", d.name ?? "", "text", "required")}${field("Preparation / form", "preparation", d.preparation ?? "", "text", 'placeholder="Match the recipe if specified"')}</div><div class="form-grid form-grid-4">${field("Package amount", "package_quantity", d.package_quantity ?? "", "number", 'required min="0.01" max="10000" step="any"')}${field("Package unit", "unit", d.unit ?? "", "text", 'placeholder="g, kg, mL, each"')}${field("Package price", "price", d.price ?? "", "number", 'required min="0" max="1000000000" step="0.01"')}${field("Currency", "currency", d.currency ?? currency, "text", 'required pattern="[A-Za-z]{3}" maxlength="3"')}</div><div class="form-grid">${field("Price date", "purchased_on", d.purchased_on ?? today(), "date", "required")}${select(
    "Price source",
    "source",
    [
      ["manual", "Entered by me"],
      ["receipt", "Confirmed from a receipt"],
    ],
    d.source ?? "manual",
  )}</div>${area("Store or receipt note", "notes", d.notes ?? "", 'rows="2"')}${errorSlot()}<div class="form-footer">${submit("Save confirmed price", "check")}${link("Cancel", "settings/prices", { cls: "btn-quiet" })}</div></form>`;
  return {
    title: editing ? "Edit price" : "Add price",
    active: "settings",
    content,
  };
}

// ---------- Login, routing, rendering ----------
function renderLogin() {
  $("#app").innerHTML =
    `<main class="login panel"><a class="brand" href="#/today">${icon("cooking-pot")}kooks</a><div><h1>Sign in to your kitchen</h1><p class="small muted">Enter the access key shared with this household.</p></div><form data-form="login" class="stack">${field("Household access key", "token", "", "password", 'required autocomplete="current-password"')}${errorSlot()}<div>${submit("Open kitchen", "log-in")}</div></form></main>`;
  document.title = "Sign in · Kooks";
}
const notFound = () => ({
  title: "Kooks",
  active: "today",
  content: emptyState(
    "That page isn’t in the kitchen.",
    "",
    link("Today", "today", { primary: true }),
  ),
});
// Older bookmarks keep working: the previous flat routes map onto the sections.
function legacyRoute([first, a, b, c]) {
  const rest = [a, b, c].filter(Boolean).join("/");
  switch (first) {
    case undefined:
      return "today";
    case "capture":
      return "recipes/add";
    case "new-recipe":
      return "recipes/new";
    case "edit":
      return a ? `recipes/${a}/edit` : "recipes";
    case "variant":
      return a ? `recipes/${a}/variant` : "recipes";
    case "memory":
      return a ? `recipes/${a}/memory` : "recipes";
    case "pantry":
      return a ? `shop/pantry/${a}` : "shop/pantry";
    case "household":
      return a ? `settings/household/${a}` : "settings/household";
    case "leftovers":
      return a ? `plan/leftovers/${a}` : "plan/leftovers";
    case "new-batch":
      return `plan/leftovers/new${rest ? `/${rest}` : ""}`;
    case "meals":
      return a ? `plan/meals/${a}` : "plan/meals";
    case "spending":
      return a ? `settings/prices/${a}` : "settings/prices";
    case "cooking":
      return a ? `cook/${a}` : "cook";
    case "review":
      return a && b ? `shop/review/${a}/${b}` : "shop";
    case "shop":
      return a && !["list", "pantry", "review"].includes(a)
        ? `shop/list/${a}`
        : null;
    case "settings":
      return a ? null : "settings/household";
    default:
      return null;
  }
}
async function render({ focus = false } = {}) {
  const token = ++draw;
  const segments = location.hash.slice(2).split("/").filter(Boolean);
  const target = legacyRoute(segments);
  if (target) {
    location.replace(`#/${target}`);
    return;
  }
  const [page, a, b, c, d, e] = segments;
  let view;
  try {
    if (page === "today") view = await todayPage();
    else if (page === "recipes") {
      if (!a) view = libraryPage();
      else if (a === "add") view = capturePage();
      else if (a === "new") view = recipeEditor(null, "new");
      else if (b === "edit") view = recipeEditor(a, "edit");
      else if (b === "variant") view = recipeEditor(a, "variant");
      else if (b === "memory") view = memoryPage(a);
      else view = await recipePage(a);
    } else if (page === "imports") view = recipeEditor(a, "import");
    else if (page === "plan") {
      if (!a) view = await planWeekPage();
      else if (a === "meals") view = mealsPage(b);
      else if (a === "leftovers")
        view =
          b === "new" ? batchForm(c, d, e) : b ? batchPage(b) : leftoversPage();
      else view = notFound();
    } else if (page === "shop") {
      if (!a) view = shopListPage();
      else if (a === "list") view = shopListPage(b);
      else if (a === "pantry") view = b ? pantryForm(b) : pantryPage();
      else if (a === "review") view = await reviewPage(b, c);
      else view = notFound();
    } else if (page === "cook") view = a ? sessionPage(a) : cookPage();
    else if (page === "settings") view = await settingsPage(a, b);
    else view = notFound();
  } catch (error) {
    if (token !== draw) return;
    if (error.code === "SIGN_IN") return renderLogin();
    view = {
      title: "Kooks",
      active: page,
      content: emptyState(
        "Something needs a second look.",
        error.message,
        button("Try again", "reload"),
        "circle-alert",
      ),
    };
  }
  if (token !== draw) return;
  $("#app").innerHTML = shell(view);
  document.title = `${view.title} · Kooks`;
  updateTimers();
  void manageWakeLock(Boolean(view.wakeLock));
  if (focus) $("#main")?.focus({ preventScroll: true });
}
function updateTimers() {
  document.querySelectorAll("[data-deadline]").forEach((el) => {
    const seconds = Math.max(
      0,
      Math.ceil((Date.parse(el.dataset.deadline) - Date.now()) / 1000),
    );
    el.textContent =
      seconds === 0
        ? "Ready"
        : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    el.closest(".timer").classList.toggle("ready", seconds === 0);
  });
}

async function saveRecipe(form, values) {
  const mode = form.dataset.mode,
    id = form.dataset.id;
  const original =
    mode === "import"
      ? record("import", id)?.data.recipe
      : record("recipe", id)?.data;
  const ingredientsText = values.get("ingredients"),
    stepsText = values.get("steps");
  const parsed = await api("recipe_parse", {
    text: `${values.get("title")}\n${values.get("servings") ? `Serves ${values.get("servings")}` : ""}\nIngredients\n${ingredientsText}\nMethod\n${stepsText}`,
  });
  const steps = String(stepsText)
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => original?.steps.find((s) => s.text === text) ?? { text });
  const equipment = lineList(values.get("equipment")).map(
    (name) => original?.equipment.find((e) => e.name === name) ?? { name },
  );
  const ingredients = parsed.recipe.ingredients.map((i) => ({
    ...i,
    category:
      original?.ingredients.find(
        (old) => old.name === i.name && old.preparation === i.preparation,
      )?.category ?? "Other",
  }));
  const links = parseLinkLines(values.get("links"));
  if (links.invalid.length)
    throw new Error(
      `Each link needs a web address such as https://example.com: ${links.invalid.join("; ")}`,
    );
  const recipe = {
    ...(original ?? {}),
    title: String(values.get("title")).trim(),
    servings: inputNumber(values.get("servings")),
    ingredients,
    steps,
    equipment,
    tags: comma(values.get("tags")),
    notes: values.get("notes"),
    source_url: values.get("source_url") || null,
    links: links.links,
    active_minutes: inputNumber(values.get("active_minutes")),
    total_minutes: inputNumber(values.get("total_minutes")),
    pan_count: inputNumber(values.get("pan_count")),
    cleanup: values.get("cleanup") || null,
    spice_level: inputNumber(values.get("spice_level")),
  };
  let result;
  if (mode === "import")
    result = await write("recipe_import_commit", {
      id,
      expected_version: Number(form.dataset.version),
      reviewed: values.has("reviewed"),
      recipe,
    });
  else if (mode === "variant")
    result = await write("recipe_variant_save", {
      original_recipe_id: id,
      recipe,
      preferred: values.has("preferred"),
    });
  else
    result = await write("recipe_save", {
      ...(id ? { id, expected_version: Number(form.dataset.version) } : {}),
      recipe,
    });
  await afterSave("Recipe saved.", `recipes/${result.record.id}`);
}

// ---------- Events ----------
document.addEventListener("input", (event) => {
  const form = event.target.closest("form");
  if (form && form.dataset.form !== "search") form.dataset.dirty = "true";
  if (event.target.id === "search") {
    search = event.target.value;
    const results = $("#library-results");
    if (results)
      results.innerHTML = libraryResults(
        [...records("recipe")].sort((a, b) =>
          a.data.title.localeCompare(b.data.title),
        ),
        records("import").filter((r) => r.data.status === "draft"),
      );
  }
  if (form?.dataset.form === "shopping-review") {
    const apply = $('[data-action="shopping-apply"]');
    if (apply) apply.disabled = true;
    const hint = $("#review-hint");
    if (hint)
      hint.textContent =
        "Update the preview to include your selection changes.";
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity() || form.classList.contains("busy")) return;
  const v = new FormData(form),
    type = form.dataset.form;
  const editing = form.dataset.id
    ? { id: form.dataset.id, expected_version: Number(form.dataset.version) }
    : {};
  form.classList.add("busy");
  busy++;
  const err = form.querySelector("[data-error]");
  if (err) err.textContent = "";
  try {
    if (type === "login") {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: v.get("token") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      await loadState();
      await render();
    } else if (type === "suggest") {
      filters = {
        available_ingredients: comma(v.get("available")),
        member_ids: v.getAll("members"),
        avoid_dislikes: v.has("avoid"),
      };
      for (const [input, key] of [
        ["active", "max_active_minutes"],
        ["total", "max_total_minutes"],
        ["pans", "max_pans"],
        ["servings", "servings"],
      ])
        if (v.get(input) !== "" && v.get(input) !== null)
          filters[key] = Number(v.get(input));
      if (v.get("cleanup")) filters.cleanup = v.get("cleanup");
      await render();
    } else if (type === "search") {
      search = v.get("query");
      await render();
    } else if (type === "servings") {
      portions.set(v.get("id"), Number(v.get("servings")));
      await render();
    } else if (type === "recipe") await saveRecipe(form, v);
    else if (type === "paste") {
      const result = await write("recipe_import_text", { text: v.get("text") });
      await afterSave("Draft ready for review.", `imports/${result.record.id}`);
    } else if (type === "photo") {
      const image = v.get("image");
      if (!image?.size || image.size > 8 * 1024 * 1024)
        throw new Error("Choose a PNG, JPEG or WebP image smaller than 8 MB.");
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read that photo."));
        reader.readAsDataURL(image);
      });
      toast("Reading your photo locally. This may take a moment.");
      const result = await write("recipe_import_image", {
        image: { name: image.name, mime_type: image.type, base64 },
      });
      await afterSave(
        "Photo read. Check the draft beside the original.",
        `imports/${result.record.id}`,
      );
    } else if (type === "pantry") {
      await write("pantry_save", {
        ...editing,
        pantry: {
          name: v.get("name"),
          preparation: v.get("preparation"),
          quantity: inputNumber(v.get("quantity")),
          unit: v.get("unit"),
          available: v.has("available"),
          use_soon: v.has("use_soon"),
          notes: v.get("notes"),
        },
      });
      await afterSave("Pantry updated.", "shop/pantry");
    } else if (type === "member") {
      await write("member_save", {
        ...editing,
        member: {
          name: v.get("name"),
          likes: comma(v.get("likes")),
          dislikes: comma(v.get("dislikes")),
          spice_tolerance: inputNumber(v.get("spice_tolerance")),
          notes: v.get("notes"),
        },
      });
      await afterSave("Preferences saved.", "settings/household");
    } else if (type === "memory") {
      await write("note_save", {
        recipe_id: v.get("recipe_id"),
        cooked_on: v.get("cooked_on"),
        text: v.get("text"),
        changes: v.get("changes"),
        next_time: v.get("next_time"),
        rating: inputNumber(v.get("rating")),
        cook_again:
          v.get("cook_again") === "" ? null : v.get("cook_again") === "yes",
      });
      await afterSave("Saved for next time.", `recipes/${v.get("recipe_id")}`);
    } else if (type === "batch") {
      const result = await write("batch_create", {
        recipe_id: v.get("recipe_id"),
        portions: Number(v.get("portions")),
        cooked_on: v.get("cooked_on"),
        storage: v.get("storage"),
        notes: v.get("notes"),
        ...(v.get("session_id")
          ? { session_id: v.get("session_id"), dish_id: v.get("dish_id") }
          : {}),
      });
      await afterSave(
        "Cooked batch recorded.",
        `plan/leftovers/${result.record.id}`,
      );
    } else if (type === "allocation") {
      await write("batch_allocate", {
        ...editing,
        allocation: {
          portions: Number(v.get("portions")),
          date: v.get("date") || null,
          slot: v.get("slot"),
          storage: v.get("storage"),
          status: v.has("eaten") ? "eaten" : "reserved",
          notes: v.get("notes"),
        },
      });
      await afterSave("Portions allocated. No groceries added.");
    } else if (type === "plan") {
      await write("plan_save", {
        source: sourceFrom(v.get("source")),
        date: v.get("date"),
        slot: v.get("slot"),
      });
      if (form.id === "plan-form") {
        week = monday(v.get("date"));
        await afterSave("Added to your week.", "plan");
      } else await afterSave("Added to your week.");
    } else if (type === "meal") {
      const chosen = v.getAll("recipes");
      if (!chosen.length)
        throw new Error("Choose at least one recipe for this meal.");
      await write("meal_save", {
        ...editing,
        meal: {
          title: v.get("title"),
          notes: v.get("notes"),
          dishes: chosen.map((id) => ({
            recipe_id: id,
            servings:
              record("recipe", id).data.servings === null
                ? null
                : Number(v.get(`portions-${id}`)),
            label: "",
          })),
        },
      });
      await afterSave("Meal saved.", "plan/meals");
    } else if (type === "currency") {
      currency = v.get("currency").toUpperCase();
      week = monday(v.get("week"));
      localStorage.setItem("kooks.currency", currency);
      await render();
    } else if (type === "preferences") {
      theme = v.get("theme") ?? "system";
      localStorage.setItem("kooks.theme", theme);
      applyTheme();
      currency = v.get("currency").toUpperCase();
      localStorage.setItem("kooks.currency", currency);
      await render();
      toast("Preferences saved.");
    } else if (type === "price") {
      await write("price_save", {
        ...editing,
        price: {
          name: v.get("name"),
          preparation: v.get("preparation"),
          package_quantity: Number(v.get("package_quantity")),
          unit: v.get("unit"),
          price: Number(v.get("price")),
          currency: v.get("currency").toUpperCase(),
          purchased_on: v.get("purchased_on"),
          source: v.get("source"),
          notes: v.get("notes"),
        },
      });
      await afterSave("Confirmed price saved.", "settings/prices");
    } else if (type === "budget") {
      await write("budget_save", {
        ...editing,
        budget: { week_start: week, currency, amount: Number(v.get("amount")) },
      });
      await afterSave("Weekly budget saved.");
    } else if (type === "task") {
      await write("cooking_task_save", {
        ...editing,
        task: {
          text: v.get("text"),
          dish_id: v.get("dish_id") || null,
          member_id: v.get("member_id") || null,
        },
      });
      await afterSave("Task added.");
    } else if (type === "timer") {
      await write("cooking_timer", {
        ...editing,
        label: v.get("label"),
        duration_seconds: Math.round(Number(v.get("minutes")) * 60),
        ...(v.get("dish_id") ? { dish_id: v.get("dish_id") } : {}),
        member_id: v.get("member_id") || null,
      });
      await afterSave("Timer started.");
    } else if (type === "finish") {
      await write("cooking_finish", { ...editing, notes: v.get("notes") });
      await afterSave("Enjoy your meal.");
    } else if (type === "shopping-create") {
      await write("shopping_create", { title: v.get("title") });
      await afterSave("Shopping list created.");
    } else if (type === "shopping-item") {
      await write("shopping_manual_item", {
        ...editing,
        item: { name: v.get("name") },
      });
      await afterSave("Item added.");
    } else if (type === "shopping-review") {
      const keys = review.preview.source.dishes.flatMap((d) =>
        d.ingredients.map((_, i) => `${d.dish_id}:${i}`),
      );
      const selected = v.getAll("ingredients");
      exclusions.set(
        `${review.input.source.kind}:${review.input.source.id}`,
        keys.filter((k) => !selected.includes(k)),
      );
      await render();
    }
  } catch (error) {
    if (err && form.isConnected) {
      err.textContent = error.message;
      err.scrollIntoView({ block: "nearest" });
    } else toast(error.message, true);
    if (error.code === "STALE_VERSION" || error.code === "STALE_PREVIEW")
      toast(
        "Someone changed this record. Your draft is kept here; reopen it to review the latest version.",
        true,
      );
  } finally {
    form.classList.remove("busy");
    busy--;
  }
});

document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-action]");
  if (!el || el.disabled) return;
  event.preventDefault();
  const a = el.dataset.action,
    id = el.dataset.id;
  if (a === "dismiss-toast") {
    $("#toast").textContent = "";
    return;
  }
  if (a === "embed-load") {
    loadEmbed(el);
    return;
  }
  if (a === "toggle") {
    const target = $(el.dataset.target);
    if (!target) return;
    target.hidden = !target.hidden;
    document
      .querySelectorAll(
        `[data-action="toggle"][data-target="${el.dataset.target}"][aria-controls]`,
      )
      .forEach((b) => b.setAttribute("aria-expanded", String(!target.hidden)));
    if (!target.hidden)
      target.querySelector("input, select, textarea")?.focus();
    return;
  }
  if (a === "capture-method") {
    captureMethod = el.dataset.method;
    document
      .querySelectorAll('[data-action="capture-method"]')
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.method === captureMethod),
        ),
      );
    document
      .querySelectorAll("[data-method]")
      .forEach(
        (panel) => (panel.hidden = panel.dataset.method !== captureMethod),
      );
    return;
  }
  if (a === "library-filter") {
    libraryFilter = el.dataset.filter;
    await render();
    return;
  }
  el.disabled = true;
  busy++;
  try {
    if (a === "clear-filters") {
      filters = {};
      await render();
    } else if (a === "reload") {
      await loadState();
      await render();
    } else if (a === "week") {
      week = addDays(week, Number(el.dataset.delta));
      await render();
    } else if (a === "week-today") {
      week = monday(today());
      await render();
    } else if (a === "favorite") {
      const r = record("recipe", id);
      await write("recipe_save", {
        id,
        expected_version: r.version,
        recipe: { ...r.data, favorite: !r.data.favorite },
      });
      await afterSave(
        r.data.favorite ? "Favorite removed." : "Saved to favorites.",
      );
    } else if (a === "pantry-soon") {
      const r = record("pantry", id);
      await write("pantry_save", {
        id,
        expected_version: r.version,
        pantry: { ...r.data, use_soon: !r.data.use_soon },
      });
      await afterSave("Pantry updated.");
    } else if (a === "cook") {
      const kind = el.dataset.kind;
      const result = await write("cooking_start", {
        source: {
          kind,
          id,
          ...(kind === "recipe" && portions.has(id)
            ? { servings: portions.get(id) }
            : {}),
        },
      });
      await afterSave("Let’s get cooking.", `cook/${result.record.id}`);
    } else if (a === "allocation-eat" || a === "allocation-release") {
      const b = record("batch", id),
        allocation = b.data.allocations.find(
          (a) => a.id === el.dataset.allocation,
        ),
        { id: allocationId, ...data } = allocation;
      await write("batch_allocate", {
        id,
        expected_version: b.version,
        allocation_id: allocationId,
        allocation:
          a === "allocation-release" ? null : { ...data, status: "eaten" },
      });
      await afterSave(
        a === "allocation-eat"
          ? "Portions marked eaten."
          : "Allocation released.",
      );
    } else if (a === "archive") {
      const kind = el.dataset.kind,
        r = record(kind, id);
      await write("record_archive", {
        kind,
        id,
        expected_version: r.version,
        archived: true,
      });
      await afterSave("Removed from the plan.");
    } else if (a.startsWith("step-")) {
      const s = record("session", id),
        dish = s.data.dishes.find((d) => d.dish_id === el.dataset.dish),
        p = s.data.progress.find((p) => p.dish_id === dish.dish_id);
      const completed =
        a === "step-next"
          ? [...new Set([...p.completed_steps, p.current_step])]
          : p.completed_steps;
      await write("cooking_progress", {
        id,
        expected_version: s.version,
        dish_id: dish.dish_id,
        current_step:
          a === "step-jump"
            ? Number(el.dataset.step)
            : Math.max(
                0,
                Math.min(
                  dish.steps.length - 1,
                  p.current_step + (a === "step-next" ? 1 : -1),
                ),
              ),
        completed_steps: completed,
      });
      await afterSave("Cooking progress saved.");
    } else if (a === "task-remove") {
      const s = record("session", id);
      await write("cooking_task_save", {
        id,
        expected_version: s.version,
        task_id: el.dataset.task,
        task: null,
      });
      await afterSave("Task removed.");
    } else if (a === "timer-cancel") {
      const s = record("session", id);
      await write("cooking_timer", {
        id,
        expected_version: s.version,
        cancel_timer_id: el.dataset.timer,
      });
      await afterSave("Timer cancelled.");
    } else if (a === "shopping-apply") {
      await write("shopping_sync", {
        ...review.input,
        expected_version: review.preview.list_version,
        preview_token: review.preview.preview_token,
      });
      await afterSave("Shopping list updated.", "shop");
    } else if (a === "shopping-remove") {
      const list = record("shopping", id);
      await write("shopping_remove_source", {
        id,
        expected_version: list.version,
        source_key: el.dataset.source,
      });
      await afterSave("Recipe contribution removed.");
    } else if (a === "undo") {
      const previous = lastAction;
      await write("history_undo", { action_id: previous });
      lastAction = null;
      await loadState();
      await render();
      toast("Change undone.");
    } else if (a === "export") {
      const result = await api("backup_export");
      const blob = new Blob([JSON.stringify(result.backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kooks-${today()}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Cookbook exported with photos and leftovers.");
    }
  } catch (error) {
    toast(error.message, true);
    if (error.code === "STALE_VERSION" || error.code === "STALE_PREVIEW") {
      await loadState();
      await render();
    }
  } finally {
    el.disabled = false;
    busy--;
  }
});

document.addEventListener("change", async (event) => {
  const el = event.target,
    type = el.dataset.change;
  if (!type) return;
  busy++;
  el.disabled = true;
  try {
    if (type === "pantry-available") {
      const r = record("pantry", el.dataset.id);
      await write("pantry_save", {
        id: r.id,
        expected_version: r.version,
        pantry: { ...r.data, available: el.checked },
      });
    } else if (type === "task-complete" || type === "task-owner") {
      const s = record("session", el.dataset.id),
        old = s.data.tasks.find((t) => t.id === el.dataset.task),
        { id, ...task } = old;
      if (type === "task-complete") task.completed = el.checked;
      else task.member_id = el.value || null;
      await write("cooking_task_save", {
        id: s.id,
        expected_version: s.version,
        task_id: id,
        task,
      });
    } else if (type === "shopping-check") {
      const s = record("shopping", el.dataset.id);
      await write("shopping_check", {
        id: s.id,
        expected_version: s.version,
        item_ids: [el.dataset.item],
        checked: el.checked,
      });
    }
    await afterSave("Saved.");
  } catch (error) {
    toast(error.message, true);
    await loadState();
    await render();
  } finally {
    busy--;
    el.disabled = false;
  }
});

window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  void render({ focus: true });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && wantsWakeLock) void manageWakeLock(true);
});
setInterval(updateTimers, 1000);
setInterval(async () => {
  if (busy || document.hidden || !revision) return;
  try {
    const changed = await loadState({ polling: true });
    if (changed) await render();
  } catch {
    const notice = $(".sync-note");
    if (notice) {
      notice.hidden = false;
      notice.textContent =
        "Connection interrupted. Your saved kitchen is still on the server. Reconnect before making changes.";
    }
  }
}, 3000);
applyTheme();
try {
  if (await loadState()) await render();
} catch (error) {
  $("#app").innerHTML =
    `<main class="page">${emptyState("Your kitchen is taking a moment.", error.message, button("Try again", "reload"), "circle-alert")}</main>`;
}
