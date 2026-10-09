import {
  describeLink,
  displayLinks,
  formatLinkLines,
  parseLinkLines,
} from "/shared/links.js";
import { icon } from "/shared/icons.js";
import {
  courseLabel,
  courses,
  dietLabel,
  diets,
  facetText,
  formatLabels,
  hasFacetFilters,
  labelKey,
  matchesFacets,
  parseLabels,
  suggestedCuisines,
  taxonomy,
} from "/shared/taxonomy.js";

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
// A pressable filter chip; the count is decoration, not part of its name.
const chip = (label, action, attrs = "", pressed = false, count = null) =>
  `<button type="button" class="chip" data-action="${action}" aria-pressed="${pressed}" ${attrs}>${esc(label)}${count == null ? "" : `<span class="count" aria-hidden="true">${count}</span>`}</button>`;
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
// Recipes, and the know-how, ideas and books around them, share one section.
const RECIPE_TABS = [
  ["recipes", "Recipes", "recipes"],
  ["techniques", "Techniques", "techniques"],
  ["inspiration", "Ideas", "inspiration"],
  ["library", "Books", "library"],
];
// The Recipes page filters: one course or cuisine, every chosen diet label
// and tag, favorites only, recipes with a recorded total time of at most 30
// minutes, and drafts waiting for review.
const noLibraryFilters = () => ({
  course: "",
  cuisine: "",
  diets: [],
  tags: [],
  favorites: false,
  quick: false,
  drafts: false,
});

// ---------- State ----------
let db = {},
  revision = "",
  busy = 0,
  draw = 0,
  lastAction = null,
  sharing = false,
  filters = {},
  library = noLibraryFilters(),
  searches = {},
  captureMethod = "paste",
  week = monday(today()),
  toastTimeout,
  wakeLock = null,
  wantsWakeLock = false;
let currency = localStorage.getItem("kooks.currency") ?? "USD";
let theme = localStorage.getItem("kooks.theme") ?? "system";
let account = null,
  signin = { step: "start", email: "", error: "" },
  conditional = null;
const passkeysSupported = () =>
  Boolean(window.PublicKeyCredential && navigator.credentials?.create);
const bytes = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const base64url = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
const cookbookTaxonomy = () => taxonomy(records("recipe").map((r) => r.data));
// Cuisines for the editor's suggestions: the household's own first, then the
// usual ones it has not used yet.
const cuisineOptions = (inUse) => {
  const seen = new Set(inUse.map((c) => labelKey(c.name)));
  return [
    ...inUse.map((c) => c.name),
    ...suggestedCuisines.filter((name) => !seen.has(labelKey(name))),
  ];
};
// A recipe's course, cuisine, diet labels and tags as small chips; pressing
// one narrows the cookbook to that value.
function facetChips(d, { course = false, cls = "chips chips-sm" } = {}) {
  const items = [
    ...(course && d.course
      ? [["course", d.course, courseLabel(d.course)]]
      : []),
    ...(d.cuisine ? [["cuisine", d.cuisine, d.cuisine]] : []),
    ...(d.diets ?? []).map((key) => ["diets", key, dietLabel(key)]),
    ...(d.tags ?? []).map((tag) => ["tags", tag, tag]),
  ];
  if (!items.length) return "";
  return `<div class="${cls}">${items.map(([facet, value, label]) => `<button type="button" class="facet-chip ${facet}" data-action="library-facet" data-mode="add" data-facet="${facet}" data-value="${esc(value)}" aria-label="Show ${esc(label)} recipes">${esc(label)}</button>`).join("")}</div>`;
}
// A live search box for one list; typing filters that list in place.
const searchBar = (scope, label, placeholder) =>
  `<label class="search grow"><span class="sr-only">${esc(label)}</span>${icon("search")}<input type="search" data-search="${scope}" placeholder="${esc(placeholder)}" value="${esc(searches[scope] ?? "")}" autocomplete="off"></label>`;
const matching = (scope, parts) => {
  const q = (searches[scope] ?? "").trim().toLowerCase();
  return !q || parts.join(" ").toLowerCase().includes(q);
};
const paragraphs = (text) =>
  String(text ?? "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
function linksFrom(text) {
  const links = parseLinkLines(text);
  if (links.invalid.length)
    throw new Error(
      `Each link needs a web address such as https://example.com: ${links.invalid.join("; ")}`,
    );
  return links.links;
}

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
        : playing.closest(".reader")
          ? "Someone updated the kitchen. Your book stays open; the page refreshes when you move on."
          : "Someone updated the kitchen. Your video keeps playing; the page refreshes when you move on.";
    }
    return false;
  }
  db = value.records;
  revision = value.revision;
  sharing = value.sharing;
  account = value.account ?? null;
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
  // After an email link, offer the one-tap way in, once per browser.
  const prompt =
    account?.method === "email" &&
    passkeysSupported() &&
    !localStorage.getItem("kooks.passkey")
      ? `<div class="callout passkey-prompt">${icon("key-round")}<div class="grow">Make next time one tap: add a passkey to this device and sign in with your fingerprint, face or screen lock.</div><div class="actions">${button("Add a passkey", "passkey-add", "", "btn-primary btn-sm")}${button("Not now", "passkey-later", "", "btn-quiet btn-sm")}</div></div>`
      : "";
  return `<div class="app"><nav class="sidebar" aria-label="Main"><a class="brand" href="#/today">${icon("cooking-pot")}kooks</a><a class="btn btn-primary" href="#/recipes/add">${icon("plus")}Add recipe</a>${nav()}<div class="sidebar-foot">${account ? `<a class="nav-item" href="#/account" ${active === "account" ? 'aria-current="page"' : ""}>${icon("key-round")}<span>Sign-in</span></a>` : ""}<a class="nav-item" href="#/settings/household" ${settingsCurrent}>${icon("settings")}<span>Settings</span></a><div class="small">${plural(records("recipe").length, "recipe")} · ${sharing ? "Shared household server" : "This computer only"}</div><a class="source-link" href="https://github.com/Sweatpantslife/kooks">Kooks source code (AGPL-3.0)</a></div></nav><header class="topbar"><a class="brand" href="#/today">${icon("cooking-pot")}kooks</a><div class="topbar-actions"><a class="btn btn-quiet btn-icon" href="#/recipes/add" aria-label="Add recipe">${icon("plus")}</a><a class="btn btn-quiet btn-icon" href="#/settings/household" aria-label="Settings" ${settingsCurrent}>${icon("settings")}</a></div></header><div class="sync-note" role="status" hidden></div><main id="main" class="main" tabindex="-1"><div class="page">${prompt}${content}</div></main><nav class="tabbar" aria-label="Main">${nav()}</nav></div>`;
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
  return `<article class="card"><div class="row between"><span class="tag">${esc(courseLabel(d.course) ?? "Your collection")}</span>${button("", "favorite", `data-id="${r.id}" aria-label="${d.favorite ? "Remove from favorites" : "Add to favorites"}: ${esc(d.title)}" aria-pressed="${Boolean(d.favorite)}"`, `btn-quiet btn-icon btn-sm favorite ${d.favorite ? "is-favorite" : ""}`, "heart")}</div><h2 class="card-title"><a href="#/recipes/${r.id}">${esc(d.title)}</a></h2>${effort(r)}${facetChips(d)}${d.preferred ? '<span class="small muted">Your preferred version</span>' : ""}${suggestion ? suggestionDetails(suggestion) : ""}<div class="card-end"><span class="small muted">${d.servings == null ? "Yield not set" : `${num(suggestion?.servings ?? d.servings)} portions`}</span><a class="btn btn-sm btn-quiet" href="#/recipes/${r.id}">Open${icon("chevron-right")}</a></div></article>`;
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
function loadEmbed(box, src = box?.dataset.src) {
  if (!box) return;
  box.dataset.loaded = "true";
  box.innerHTML = `<iframe src="${esc(src)}" title="${esc(box.dataset.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
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
  const advancedOpen =
    [
      "max_active_minutes",
      "max_total_minutes",
      "max_pans",
      "cleanup",
      "servings",
    ].some((key) => filters[key] !== undefined) ||
    Boolean(filters.diets?.length || filters.tags?.length);
  const vocabulary = cookbookTaxonomy();
  const facetSelects =
    vocabulary.courses.length || vocabulary.cuisines.length
      ? `<div class="form-grid">${select("Course", "course", [["", "Any course"], ...vocabulary.courses.map((c) => [c.key, c.label])], filters.course ?? "")}${select("Cuisine", "cuisine", [["", "Any cuisine"], ...vocabulary.cuisines.map((c) => [c.name, c.name])], filters.cuisine ?? "")}</div>`
      : "";
  const facetChecks = (label, name, entries, keyOf, labelOf, chosen) =>
    entries.length
      ? `<div class="stack-sm"><span class="label">${label}</span><div class="chips">${entries.map((e) => `<label class="chip-input"><input type="checkbox" name="${name}" value="${esc(keyOf(e))}" ${chosen.includes(keyOf(e)) ? "checked" : ""}><span>${esc(labelOf(e))}</span></label>`).join("")}</div></div>`
      : "";
  const content = `${pageHeader({ title: "Today", subtitle: `${longDate(date)}. What sounds good today?` })}${active.map((s) => callout(`<strong>On the stove:</strong> ${esc(s.data.title)}`, { ico: "flame" }).replace("</div></div>", `</div>${link("Continue", `cook/${s.id}`, { primary: true, cls: "btn-sm" })}</div>`)).join("")}${drafts.length ? callout(`<strong>${plural(drafts.length, "draft")} waiting for a read-through:</strong> ${drafts.map((r) => `<a href="#/imports/${r.id}">${esc(r.data.title)}</a>`).join(", ")}`, { kind: "callout-warning", ico: "file-text" }) : ""}<div class="grid-2 spacer">${dayPanel("Today", date)}${dayPanel("Tomorrow", addDays(date, 1))}</div>${useSoon.length ? `<div class="spacer">${callout(`<strong>Use soon:</strong> ${esc(useSoon.map((p) => p.data.name).join(", "))}. <a href="#/shop/pantry">Open the pantry</a>`, { kind: "callout-warning", ico: "refrigerator" })}</div>` : ""}<section class="section"><div class="section-header"><h2>Find dinner</h2><span class="small">From your own cookbook</span></div><form data-form="suggest" class="panel stack"><div class="suggest-row">${field("Ingredients on hand, separated by commas", "available", (filters.available_ingredients ?? []).join(", "), "text", 'placeholder="zucchini, chickpeas"')}${submit("Find dinner", "search")}</div>${facetSelects}${
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
    )}</div><div class="row">${field("Portions to make", "servings", filters.servings ?? "", "number", 'min="0.01" max="10000" step="any" placeholder="Recipe yield"')}${check("Skip ingredients people dislike", "avoid", "on", filters.avoid_dislikes !== false)}</div>${facetChecks(
      "Diet labels",
      "diets",
      vocabulary.diets,
      (d) => d.key,
      (d) => d.label,
      filters.diets ?? [],
    )}${facetChecks(
      "Tags",
      "tags",
      vocabulary.tags,
      (t) => t.name,
      (t) => t.name,
      filters.tags ?? [],
    )}`,
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
  const all = [...records("recipe")].sort((a, b) =>
    a.data.title.localeCompare(b.data.title),
  );
  const drafts = records("import").filter((r) => r.data.status === "draft");
  const vocabulary = taxonomy(all.map((r) => r.data));
  const active =
    library.favorites ||
    library.quick ||
    library.drafts ||
    hasFacetFilters(library);
  const facetRow = (label, items) =>
    items.length
      ? `<div class="facet-row"><span class="facet-label">${esc(label)}</span>${items.join("")}</div>`
      : "";
  const chosen = (facet, value) =>
    Array.isArray(library[facet])
      ? library[facet].some((v) => labelKey(v) === labelKey(value))
      : labelKey(library[facet]) === labelKey(value);
  const options = (facet, entries, nameOf, labelOf) =>
    entries.map((entry) =>
      chip(
        labelOf(entry),
        "library-facet",
        `data-facet="${facet}" data-value="${esc(nameOf(entry))}"`,
        chosen(facet, nameOf(entry)),
        entry.count,
      ),
    );
  const single = (facet, entries, nameOf, labelOf) =>
    entries.length
      ? [
          chip(
            "All",
            "library-facet",
            `data-facet="${facet}" data-value=""`,
            !library[facet],
          ),
          ...options(facet, entries, nameOf, labelOf),
        ]
      : [];
  const content = `${pageHeader({ title: "Recipes", subtitle: all.length ? `${plural(all.length, "recipe")} in your cookbook. Old favorites, small discoveries, and your own adjustments.` : "Your cookbook is empty. Start with something you already love to cook.", actions: link("Add recipe", "recipes/add", { primary: true, ico: "plus" }) })}${segmented(RECIPE_TABS, "recipes", "Recipes sections")}<div class="toolbar">${searchBar("recipes", "Find a recipe, ingredient, cuisine or tag", "Find a recipe, ingredient, cuisine or tag…")}</div><div class="facets" aria-label="Recipe filters">${facetRow(
    "Show",
    [
      chip(
        "Favorites",
        "library-toggle",
        'data-key="favorites"',
        library.favorites,
      ),
      chip(
        "30 minutes or less",
        "library-toggle",
        'data-key="quick"',
        library.quick,
      ),
      ...(drafts.length
        ? [
            chip(
              "Needs review",
              "library-toggle",
              'data-key="drafts"',
              library.drafts,
              drafts.length,
            ),
          ]
        : []),
      ...(active
        ? [
            button(
              "Clear filters",
              "library-clear",
              "",
              "btn-quiet btn-sm",
              "x",
            ),
          ]
        : []),
    ],
  )}${facetRow(
    "Course",
    single(
      "course",
      vocabulary.courses,
      (c) => c.key,
      (c) => c.label,
    ),
  )}${facetRow(
    "Cuisine",
    single(
      "cuisine",
      vocabulary.cuisines,
      (c) => c.name,
      (c) => c.name,
    ),
  )}${facetRow(
    "Diet",
    options(
      "diets",
      vocabulary.diets,
      (d) => d.key,
      (d) => d.label,
    ),
  )}${facetRow(
    "Tags",
    options(
      "tags",
      vocabulary.tags,
      (t) => t.name,
      (t) => t.name,
    ),
  )}</div><div id="list-results">${libraryResults()}</div>`;
  return { title: "Recipes", active: "recipes", content };
}
function libraryResults() {
  const all = [...records("recipe")].sort((a, b) =>
    a.data.title.localeCompare(b.data.title),
  );
  const drafts = records("import").filter((r) => r.data.status === "draft");
  if (library.drafts)
    return drafts.length
      ? `<div class="grid grid-3">${drafts.map((r) => `<article class="card">${tag("Draft", "tag-warm")}<h2 class="card-title"><a href="#/imports/${r.id}">${esc(r.data.title)}</a></h2><p>Check the extracted text against the original, then save it.</p><div class="card-end"><span class="small muted">${dateLabel(r.created_at.slice(0, 10))}</span>${link("Review", `imports/${r.id}`, { cls: "btn-sm" })}</div></article>`).join("")}</div>`
      : emptyState("Nothing is waiting for review.");
  const term = (searches.recipes ?? "").trim().toLowerCase();
  const found = all.filter(
    (r) =>
      (!term ||
        [
          r.data.title,
          r.data.notes,
          ...r.data.ingredients.map((i) => i.name),
          facetText(r.data),
        ]
          .join(" ")
          .toLowerCase()
          .includes(term)) &&
      (!library.favorites || r.data.favorite) &&
      (!library.quick ||
        (r.data.total_minutes != null && r.data.total_minutes <= 30)) &&
      matchesFacets(r.data, library),
  );
  const active = library.favorites || library.quick || hasFacetFilters(library);
  // A filter on something never recorded cannot show those recipes; say so
  // instead of letting them disappear quietly.
  const unseen = [
    ["a course", library.course && all.filter((r) => !r.data.course).length],
    ["a cuisine", library.cuisine && all.filter((r) => !r.data.cuisine).length],
    [
      "a total time",
      library.quick && all.filter((r) => r.data.total_minutes == null).length,
    ],
  ]
    .filter(([, n]) => n)
    .map(([what, n]) => `${n} without ${what} recorded`);
  const header = all.length
    ? `<div class="section-header"><h2 class="h-plain">${active || term ? "What matches" : "Everything you’ve kept"}</h2><span class="small">${found.length} of ${plural(all.length, "recipe")}</span></div>${unseen.length ? `<p class="small muted">Not shown: ${esc(unseen.join(" · "))}. Add the missing details from each recipe’s editor.</p>` : ""}`
    : "";
  if (!found.length)
    return (
      header +
      (all.length
        ? emptyState(
            "No recipes match.",
            "Try another ingredient, name or filter, or show everything.",
            button("Clear filters", "library-clear"),
            "search",
          )
        : emptyState(
            "Your cookbook is empty.",
            "Paste a recipe from your messages, photograph a favorite, or write one yourself.",
            link("Add your first recipe", "recipes/add", { primary: true }),
            "book-open",
          ))
    );
  return `${header}<div class="grid grid-3">${found.map((r) => recipeCard(r)).join("")}</div>`;
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

// `seed` is an idea from the inspiration board whose title, notes, tags and
// links start a new recipe; saving links the idea to the recipe it became.
function recipeEditor(id, mode = "edit", seed = null) {
  const draft = mode === "import" ? record("import", id) : null;
  const r = mode === "import" ? null : record("recipe", id);
  const data = draft?.data.recipe ??
    r?.data ?? {
      title: seed?.data.title ?? "",
      servings: null,
      ingredients: [],
      steps: [],
      equipment: [],
      course: null,
      cuisine: null,
      diets: [],
      tags: seed?.data.tags ?? [],
      notes: seed?.data.notes ?? "",
      links: seed?.data.links ?? [],
    };
  const vocabulary = cookbookTaxonomy();
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
    new: seed
      ? "The idea stays on your board, linked to this recipe once it is saved."
      : "Unknown amounts and timings can stay blank.",
    edit: "Unknown amounts and timings can stay blank.",
  };
  const back =
    r || mode === "variant"
      ? { label: r?.data.title ?? "Recipe", route: `recipes/${id}` }
      : seed
        ? { label: seed.data.title, route: `inspiration/${seed.id}` }
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
  const content = `${pageHeader({ title: titles[mode] ?? "Edit recipe", subtitle: subtitles[mode], back })}<div class="${draft ? "review-grid" : ""}"><form data-form="recipe" class="stack" data-mode="${mode}" data-id="${esc(id ?? "")}" data-version="${draft?.version ?? r?.version ?? ""}">${seed ? hidden("inspiration_id", seed.id) : ""}<section class="panel stack"><h2>Basics</h2><div class="form-grid">${field("Recipe name", "title", mode === "variant" ? `${data.title} · My version` : data.title, "text", 'required maxlength="500"')}${field("Original yield / portions", "servings", data.servings ?? "", "number", 'min="0.01" max="10000" step="any" placeholder="Unknown"')}</div><div class="form-grid">${select("Course", "course", [["", "Not recorded"], ...courses.map((c) => [c.key, c.label])], data.course ?? "")}${field("Cuisine", "cuisine", data.cuisine ?? "", "text", 'list="cuisine-options" maxlength="100" placeholder="Italian, Israeli…"', "Your own words; names already in your cookbook are suggested.")}<datalist id="cuisine-options">${cuisineOptions(
    vocabulary.cuisines,
  )
    .map((name) => `<option value="${esc(name)}"></option>`)
    .join(
      "",
    )}</datalist></div>${field("Tags, separated by commas", "tags", formatLabels(data.tags ?? []), "text", 'placeholder="Weeknight, Shabbat, kid-friendly"', vocabulary.tags.length ? "Press one of your tags below to add it." : "")}${vocabulary.tags.length ? `<p class="small muted">Your tags: ${vocabulary.tags.map((t) => `<button type="button" class="link-button" data-action="append-tag" data-value="${esc(t.name)}">${esc(t.name)}</button>`).join(" ")}</p>` : ""}<div class="stack-sm"><span class="label">Diet labels</span><div class="chips">${diets.map((d) => `<label class="chip-input"><input type="checkbox" name="diets" value="${d.key}" ${(data.diets ?? []).includes(d.key) ? "checked" : ""}><span>${d.label}</span></label>`).join("")}</div><span class="help">What you know about this recipe, not an allergen check.</span></div></section><section class="panel stack"><h2>Ingredients</h2>${area("Ingredients · one per line", "ingredients", ingredientText, 'rows="9" placeholder="250 g orzo\n30 mL olive oil\nSalt to taste"', "Amount, unit, name, then an optional preparation after a comma. Unclear amounts stay as written.")}</section><section class="panel stack"><h2>Method</h2>${area("Method · separate steps with a blank line", "steps", data.steps.map((s) => s.text).join("\n\n"), 'rows="9"')}</section><section class="panel stack"><h2>Equipment</h2>${area("Equipment · one per line", "equipment", data.equipment.map((e) => e.name).join("\n"), 'rows="3" placeholder="Wide pan\nMeasuring jug"', "Leave blank if the recipe does not specify its tools.")}</section>${disclosure(
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
  const content = `${pageHeader({ title: r.data.title, eyebrow: r.data.original_recipe_id ? "Your own variation" : (r.data.tags[0] ?? "Recipe"), back: { label: "Recipes", route: "recipes" }, actions: `${button("", "favorite", `data-id="${id}" aria-label="${r.data.favorite ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${Boolean(r.data.favorite)}"`, `btn-quiet btn-icon favorite ${r.data.favorite ? "is-favorite" : ""}`, "heart")}${link("Edit recipe", `recipes/${id}/edit`, { ico: "pencil" })}` })}${effort(r)}${facetChips(r.data, { course: true, cls: "chips chips-sm spacer-sm" })}<div class="actions spacer">${button("Cook", "cook", `data-kind="recipe" data-id="${id}"`, "btn-primary", "flame")}${link("Shop", `shop/review/recipe/${id}`, { ico: "shopping-basket" })}${button("Plan", "toggle", 'data-target="#plan-form" aria-expanded="false" aria-controls="plan-form"', "", "calendar-days")}</div><form id="plan-form" data-form="plan" class="panel stack spacer" hidden>${hidden("source", `recipe:${id}`)}<h2>Add to the plan</h2><div class="form-grid">${field("Date", "date", today(), "date", "required")}${field("Meal", "slot", "Dinner", "text", "required")}</div>${errorSlot()}<div class="form-footer">${submit("Add to plan", "calendar-days")}${button("Cancel", "toggle", 'data-target="#plan-form"', "btn-quiet")}</div></form>${memory.preferred_recipe && memory.preferred_recipe.id !== id ? `<div class="spacer">${callout(`Your preferred version: ${esc(memory.preferred_recipe.data.title)} <a href="#/recipes/${memory.preferred_recipe.id}">Open variation</a>`, { ico: "star" })}</div>` : ""}${memory.latest ? `<div class="spacer">${callout(`<div class="eyebrow">Remember for next time</div><p class="preline">${esc(memory.latest.data.next_time || memory.latest.data.changes || memory.latest.data.text)}</p><small class="muted">${esc(memory.latest.data.cooked_on ?? memory.latest.created_at.slice(0, 10))}</small>`, { kind: "callout-warning", ico: "notebook-pen" })}</div>` : ""}<div class="cols spacer"><section class="panel stack"><div class="row between"><h2>Ingredients</h2><form data-form="servings" class="row row-nowrap servings-form">${hidden("id", id)}${field("Portions", "servings", d.servings ?? "", "number", `min="0.01" max="10000" step="any" ${r.data.servings === null ? 'disabled placeholder="Unknown"' : "required"}`)}${r.data.servings !== null ? '<button class="btn btn-sm self-end" type="submit">Update</button>' : ""}</form></div><div>${d.ingredients.map((i) => `<div class="ingredient"><span>${esc(i.name)}${i.preparation ? `<small>${esc(i.preparation)}</small>` : ""}</span><span class="amount">${esc(amount(i))}</span></div>`).join("") || '<p class="small muted">Ingredients have not been recorded.</p>'}</div>${d.equipment.length ? `<div><h3>What you’ll use</h3><div class="chips spacer-sm">${d.equipment.map((e) => tag(`${e.quantity > 1 ? `${e.quantity} × ` : ""}${e.name}${e.capacity ? ` · ${e.capacity}` : ""}`, "tag-neutral")).join("")}</div></div>` : ""}<div><h3>Estimated ingredient cost</h3><p class="small spacer-xs">${cost.complete ? `<strong>${money(cost.total)}</strong> <span class="muted">· ${cost.dishes[0].per_portion == null ? "" : `${money(cost.dishes[0].per_portion)} per portion`}</span>` : `<strong>${money(cost.known_cost)}</strong> <span class="muted">known subtotal · incomplete</span>`}</p>${cost.missing_prices.length ? `<p class="small muted">Missing amounts or prices: ${esc([...new Set(cost.missing_prices.map((l) => l.ingredient.name))].join(", "))}.</p>` : ""}<a class="small" href="#/settings/prices">Prices</a></div></section><section class="stack"><h2>Method</h2><ol class="method">${d.steps.map((s) => `<li>${esc(s.text)}${s.duration_seconds ? `<small class="muted">${num(s.duration_seconds / 60)} minutes</small>` : ""}</li>`).join("") || '<li class="small muted">No method recorded.</li>'}</ol>${d.warnings.length ? callout(d.warnings.map(esc).join("<br>"), { kind: "callout-warning", ico: "triangle-alert" }) : ""}${r.data.notes ? `<div class="panel panel-soft"><p class="preline">${esc(r.data.notes)}</p></div>` : ""}${linksSection(r.data)}${recipeConnections(id)}<details class="disclosure quiet"><summary>Original recipe and sources</summary><div class="disclosure-body">${r.data.source_url ? `<a href="${esc(r.data.source_url)}" target="_blank" rel="noreferrer">Original source</a>` : ""}${(r.data.source_image_ids ?? []).map((id) => `<img class="source-image" src="/api/assets/${encodeURIComponent(id)}" alt="Original recipe photo">`).join("")}<pre class="source-text">${esc(r.data.original_text || "No original text was provided.")}</pre></div></details></section></div><section class="section"><div class="section-header"><h2>Cooking notes</h2><div class="actions">${link("Add a cooking note", `recipes/${id}/memory`, { cls: "btn-sm", ico: "notebook-pen" })}${link("Make a variation", `recipes/${memory.original_recipe_id}/variant`, { cls: "btn-sm", ico: "copy" })}${link("Record a cooked batch", `plan/leftovers/new/${id}`, { cls: "btn-sm", ico: "package" })}</div></div>${memory.notes.length ? `<div class="grid">${memory.notes.map((n) => `<article class="panel stack-sm"><div class="row between"><span class="eyebrow">${esc(n.data.cooked_on ?? n.created_at.slice(0, 10))}</span><span class="small">${n.data.rating ? "★".repeat(n.data.rating) : ""}${n.data.cook_again === true ? " · Cook again" : n.data.cook_again === false ? " · Try something else" : ""}</span></div><p class="preline">${esc(n.data.text)}</p>${n.data.changes ? `<p class="small preline"><strong>Changed:</strong> ${esc(n.data.changes)}</p>` : ""}${n.data.next_time ? `<p class="small preline"><strong>Next time:</strong> ${esc(n.data.next_time)}</p>` : ""}</article>`).join("")}</div>` : '<p class="small muted">Your notes and successful changes will appear here before the next cook.</p>'}${memory.variants.length ? `<div class="spacer"><h3>Ways you make it</h3><div class="chips spacer-sm">${memory.variants.map((v) => `<a class="chip" href="#/recipes/${v.id}">${esc(v.data.title)}${v.data.preferred ? " · Preferred" : ""}</a>`).join("")}</div></div>` : ""}</section>`;
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
  const origin = session
    ? { label: session.data.title, route: `cook/${sessionId}` }
    : record("recipe", recipeId)
      ? {
          label: record("recipe", recipeId).data.title,
          route: `recipes/${recipeId}`,
        }
      : { label: "Leftovers", route: "plan/leftovers" };
  const content = `${pageHeader({ title: "Record a batch", subtitle: "Record what you made. Allocate it to meals once it’s saved.", back: origin })}<form data-form="batch" class="panel stack">${session ? `${hidden("session_id", sessionId)}${hidden("dish_id", dishId)}` : ""}${select("Recipe", "recipe_id", optionsFor("recipe"), dish?.recipe_id ?? recipeId ?? records("recipe")[0]?.id, session ? "disabled" : "required")}${session ? hidden("recipe_id", dish.recipe_id) : ""}<div class="form-grid">${field("Portions actually cooked", "portions", dish?.servings ?? record("recipe", recipeId)?.data.servings ?? "", "number", `required min="0.01" max="10000" step="any" ${session ? "readonly" : ""}`)}${field("Cooked on", "cooked_on", today(), "date", "required")}${select(
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
  const origin =
    kind === "recipe" && record("recipe", id)
      ? { label: record("recipe", id).data.title, route: `recipes/${id}` }
      : kind === "meal"
        ? { label: "Meals", route: "plan/meals" }
        : kind === "plan"
          ? { label: "Plan", route: "plan" }
          : { label: "Shop", route: "shop" };
  const list = records("shopping")[0];
  if (!list)
    return {
      title: "Shop",
      active: "shop",
      content: `${pageHeader({ title: "Start a shopping list", subtitle: "Create a list before shopping this recipe or meal.", back: origin })}<form data-form="shopping-create" class="panel stack">${field("List name", "title", "Groceries", "text", "required")}${errorSlot()}<div class="form-footer">${submit("Create shopping list", "plus")}</div></form>`,
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
  const content = `${pageHeader({ title: `Shop for ${preview.source.title}`, subtitle: "Untick what you already have, then add the rest to your list. Repeating this for the same source updates it instead of adding it twice.", back: origin })}<div class="grid-2"><form data-form="shopping-review" class="panel stack"><h2>Ingredients to buy</h2>${preview.source.dishes.map((d) => `<section class="stack-sm"><h3>${esc(d.title)}</h3><div class="list">${d.ingredients.map((i, index) => `<div class="list-item">${check(`${i.name} · ${amount(i)}`, "ingredients", `${d.dish_id}:${index}`, !excluded.includes(`${d.dish_id}:${index}`))}</div>`).join("")}</div></section>`).join("")}${errorSlot()}<div class="form-footer">${submit("Update preview")}</div></form><section class="panel stack"><h2>Changes to your list</h2><p class="small muted">${preview.diff.added.length} new · ${preview.diff.changed.length} changed · ${preview.diff.removed.length} removed</p><div>${preview.items.map((i) => `<div class="ingredient"><span>${esc(i.name)}</span><span class="amount">${esc(amount(i))}</span></div>`).join("") || '<p class="small muted">No ingredients remain on this list.</p>'}</div>${button("Add to shopping list", "shopping-apply", "", "btn-primary", "shopping-basket")}<p class="small muted" id="review-hint">Repeating this action updates this occurrence without adding it twice.</p>${preview.equipment.requirements.length ? disclosure("Required equipment", preview.equipment.requirements.map((e) => `<p class="small">${esc(e.name)} · ${e.available_quantity === null ? "availability unknown" : `${e.available_quantity} available`}</p>${e.conflicts.map((c) => `<p class="small muted">${esc(c)}</p>`).join("")}`).join(""), { quiet: true }) : ""}</section></div>`;
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
const settingsTabs = () => [
  ...SETTINGS_TABS,
  ...(account ? [["account", "Sign-in", "account"]] : []),
];
async function settingsPage(tab, id) {
  const header = (subtitle) =>
    `${pageHeader({ title: "Settings", subtitle })}${segmented(settingsTabs(), tab, "Settings sections")}`;
  if (tab === "account")
    return {
      title: "Sign-in",
      active: "settings",
      content: account
        ? `${header("Your sign-in on this device.")}${await accountTab()}`
        : `${header("")}${emptyState("No sign-in on this computer.", "Kooks is running for this computer only; nobody needs to sign in.", link("Today", "today"))}`,
    };
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

// ---------- Techniques, ideas and books ----------
// The household's know-how, the ideas it wants to try, and the cookbooks it
// owns as files. Records live in the same state as recipes; files are assets
// the server stores and serves.
const fileTypes = {
  image: {
    label: "a PNG, JPEG or WebP image",
    limit: 8,
    types: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" },
  },
  book: {
    label: "a PDF or EPUB file",
    limit: 64,
    types: { "application/pdf": "pdf", "application/epub+zip": "epub" },
  },
};
const fileLabel = { "application/pdf": "PDF", "application/epub+zip": "EPUB" };
const size = (bytes) =>
  bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const readBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
// Store one chosen file as an asset and return its id. The browser's type is
// trusted when it names a supported kind; otherwise the extension decides.
// The server checks the bytes either way.
async function uploadFile(file, category) {
  const { label, limit, types } = fileTypes[category];
  const name = file.name.toLowerCase();
  const mime =
    file.type in types
      ? file.type
      : (Object.keys(types).find((type) => name.endsWith(`.${types[type]}`)) ??
        (category === "image" && name.endsWith(".jpeg") ? "image/jpeg" : null));
  if (!mime) throw new Error(`Choose ${label}.`);
  if (!file.size || file.size > limit * 1024 * 1024)
    throw new Error(`Choose ${label} smaller than ${limit} MB.`);
  const result = await write("asset_save", {
    file: { name: file.name, mime_type: mime, base64: await readBase64(file) },
  });
  return result.record.id;
}
// The photos a form keeps plus the ones it adds.
async function photoIds(values) {
  const ids = values.getAll("keep_photo");
  for (const file of values.getAll("photos"))
    if (file?.size) ids.push(await uploadFile(file, "image"));
  return ids;
}
const photoFields = (ids) =>
  `<div class="field"><span>Photos</span>${ids.length ? `<div class="photos">${ids.map((id) => `<label class="photo-keep"><img class="photo" src="/api/assets/${encodeURIComponent(id)}" alt="" loading="lazy"><span class="check"><input type="checkbox" name="keep_photo" value="${esc(id)}" checked><span>Keep</span></span></label>`).join("")}</div>` : ""}<input type="file" name="photos" accept="image/png,image/jpeg,image/webp" multiple>${help("PNG, JPEG or WebP up to 8 MB each. Photos stay on this household server.")}</div>`;
const photoStrip = (ids) =>
  ids.length
    ? `<div class="photos">${ids.map((id) => `<a href="/api/assets/${encodeURIComponent(id)}" target="_blank" rel="noopener"><img class="photo" src="/api/assets/${encodeURIComponent(id)}" alt="Photo" loading="lazy"></a>`).join("")}</div>`
    : "";
const recipePicker = (selected, label) =>
  records("recipe").length
    ? `<div class="field"><span>${esc(label)}</span>${hidden("recipes_listed", "1")}<div class="chips">${records(
        "recipe",
      )
        .map(
          (r) =>
            `<label class="chip-input"><input type="checkbox" name="recipes" value="${r.id}" ${selected.includes(r.id) ? "checked" : ""}><span>${esc(r.data.title)}</span></label>`,
        )
        .join("")}</div></div>`
    : "";
const recipesHeader = (tab, subtitle, action) =>
  `${pageHeader({ title: "Recipes", subtitle, actions: action })}${segmented(RECIPE_TABS, tab, "Recipes sections")}`;

function techniqueCard(t) {
  const d = t.data;
  const videos = displayLinks(d).filter(
    (l) => describeLink(l.url)?.embed,
  ).length;
  return `<article class="card"><div class="row between">${tag(d.tags[0] ?? "Technique")}${videos ? `<small class="muted">${plural(videos, "video")}</small>` : ""}</div><h2 class="card-title"><a href="#/techniques/${t.id}">${esc(d.title)}</a></h2>${d.summary ? `<p class="clamp">${esc(d.summary)}</p>` : ""}<div class="card-end"><span class="small muted">${d.steps.length ? plural(d.steps.length, "step") : "Notes"}${d.recipe_ids.length ? ` · ${plural(d.recipe_ids.length, "recipe")}` : ""}</span><a class="btn btn-sm btn-quiet" href="#/techniques/${t.id}">Open${icon("chevron-right")}</a></div></article>`;
}
function techniqueResults() {
  const found = [...records("technique")]
    .sort((a, b) => a.data.title.localeCompare(b.data.title))
    .filter((t) =>
      matching("techniques", [
        t.data.title,
        t.data.summary,
        t.data.tips,
        ...t.data.tags,
      ]),
    );
  if (!found.length)
    return searches.techniques
      ? emptyState(
          "No techniques match.",
          "Try another word or tag.",
          "",
          "search",
        )
      : emptyState(
          "Start with one thing you do well.",
          "Write down how you make the dough, or keep the video that finally explained it.",
          link("Add technique", "techniques/new", { primary: true }),
          "chef-hat",
        );
  return `<div class="grid grid-3">${found.map(techniqueCard).join("")}</div>`;
}
function techniquesPage() {
  const content = `${recipesHeader("techniques", "The methods behind your recipes, with the videos that taught you.", records("technique").length ? link("Add technique", "techniques/new", { primary: true, ico: "plus" }) : "")}<div class="toolbar">${searchBar("techniques", "Find a technique", "Find a technique or tag…")}</div><div id="list-results">${techniqueResults()}</div>`;
  return { title: "Techniques", active: "recipes", content };
}
function techniquePage(id) {
  const t = record("technique", id);
  if (!t)
    return {
      title: "Techniques",
      active: "recipes",
      content: emptyState(
        "Technique not found.",
        "It may have been archived.",
        link("Techniques", "techniques"),
      ),
    };
  const d = t.data;
  const used = d.recipe_ids.map((r) => record("recipe", r)).filter(Boolean);
  const content = `${pageHeader({ title: d.title, eyebrow: "Technique", back: { label: "Techniques", route: "techniques" }, actions: `${link("Edit", `techniques/${id}/edit`, { ico: "pencil" })}${button("Archive", "archive", `data-kind="technique" data-id="${id}" data-target="techniques"`, "btn-quiet", "archive")}` })}${d.tags.length ? `<div class="chips">${d.tags.map((label) => tag(label)).join("")}</div>` : ""}<div class="learn-columns spacer"><section class="stack">${d.summary ? `<p class="preline lead">${esc(d.summary)}</p>` : ""}${d.steps.length ? `<div><h2>How it’s done</h2><ol class="method spacer">${d.steps.map((s) => `<li>${esc(s.text)}</li>`).join("")}</ol></div>` : ""}${d.tips ? callout(`<div class="eyebrow">Tips and pitfalls</div><p class="preline">${esc(d.tips)}</p>`, { kind: "callout-warning", ico: "notebook-pen" }) : ""}${photoStrip(d.photo_ids)}${linksSection(d, "Watch and read")}</section><aside class="panel stack-sm"><h3>Recipes that use it</h3>${used.length ? `<div class="chips">${used.map((r) => `<a class="chip" href="#/recipes/${r.id}">${esc(r.data.title)}</a>`).join("")}</div>` : '<p class="small muted">Link recipes from the editor and this technique appears on their pages.</p>'}</aside></div>`;
  return { title: d.title, active: "recipes", content };
}
function techniqueEditor(id) {
  const t = id ? record("technique", id) : null;
  if (id && !t)
    return {
      title: "Techniques",
      active: "recipes",
      content: emptyState(
        "Technique not found.",
        "",
        link("Techniques", "techniques"),
      ),
    };
  const d = t?.data ?? {
    title: "",
    summary: "",
    steps: [],
    tips: "",
    tags: [],
    links: [],
    photo_ids: [],
    recipe_ids: [],
  };
  const content = `${pageHeader({ title: t ? "Edit technique" : "New technique", subtitle: "A method you want to remember. Add the videos that taught you and the recipes it belongs to.", back: t ? { label: t.data.title, route: `techniques/${t.id}` } : { label: "Techniques", route: "techniques" } })}<form data-form="technique" class="panel stack" data-id="${t?.id ?? ""}" data-version="${t?.version ?? ""}">${field("Technique name", "title", d.title, "text", 'required maxlength="500" placeholder="Reverse sear"')}${area("In short", "summary", d.summary, 'rows="3" placeholder="Cook low in the oven first, then sear hard for the crust."')}${area("Steps · separate steps with a blank line", "steps", d.steps.map((s) => s.text).join("\n\n"), 'rows="7"')}${area("Tips and pitfalls", "tips", d.tips, 'rows="3"')}${field("Tags, separated by commas", "tags", d.tags.join(", "), "text", 'placeholder="Meat, knife skills"')}${area("Links and videos · one per line", "links", formatLinkLines(d.links), 'rows="3" placeholder="https://youtu.be/… The video that explains it"', "A web address, then an optional title. YouTube, Vimeo, Facebook, Instagram and TikTok videos play on the technique page.")}${photoFields(d.photo_ids)}${recipePicker(d.recipe_ids, "Recipes that use this technique")}${errorSlot()}<div class="form-footer">${submit(t ? "Save technique" : "Add technique", "check")}${link("Cancel", t ? `techniques/${t.id}` : "techniques", { cls: "btn-quiet" })}</div></form>`;
  return {
    title: t ? "Edit technique" : "New technique",
    active: "recipes",
    content,
  };
}

const ideaState = (d) =>
  d.recipe_id
    ? ["In the cookbook", ""]
    : d.status === "tried"
      ? ["Tried it", "tag-neutral"]
      : ["Want to try", "tag-warm"];
function ideaCard(i) {
  const d = i.data,
    [state, cls] = ideaState(d);
  const first = displayLinks(d)[0],
    info = first ? describeLink(first.url) : null;
  return `<article class="card"><div class="row between">${tag(state, cls)}${d.source ? `<small class="muted">${esc(d.source)}</small>` : ""}</div>${d.photo_ids.length ? `<img class="card-photo" src="/api/assets/${encodeURIComponent(d.photo_ids[0])}" alt="" loading="lazy">` : ""}<h2 class="card-title"><a href="#/inspiration/${i.id}">${esc(d.title)}</a></h2>${d.notes ? `<p class="clamp">${esc(d.notes)}</p>` : ""}${info ? `<p class="small muted">${info.embed ? `${esc(info.label)} video` : esc(info.site)}${first.title ? ` · ${esc(first.title)}` : ""}</p>` : ""}<div class="card-end"><span class="small muted">${esc(d.tags.slice(0, 3).join(" · "))}</span><a class="btn btn-sm btn-quiet" href="#/inspiration/${i.id}">Open${icon("chevron-right")}</a></div></article>`;
}
function ideaResults() {
  const order = (d) => (d.recipe_id ? 2 : d.status === "tried" ? 1 : 0);
  const ideas = [...records("inspiration")]
    .sort(
      (a, b) =>
        order(a.data) - order(b.data) ||
        b.updated_at.localeCompare(a.updated_at),
    )
    .filter((i) =>
      matching("inspiration", [
        i.data.title,
        i.data.notes,
        i.data.source,
        ...i.data.tags,
      ]),
    );
  if (!ideas.length)
    return searches.inspiration
      ? emptyState("No ideas match.", "Try another word or tag.", "", "search")
      : emptyState(
          "What caught your eye lately?",
          "Save the reel, the restaurant dish or the idea from a friend before it slips away.",
          link("Add idea", "inspiration/new", { primary: true }),
          "sparkles",
        );
  return `<div class="grid grid-3">${ideas.map(ideaCard).join("")}</div>`;
}
function inspirationPage() {
  const content = `${recipesHeader("inspiration", "A reel you saved, a dish from a friend’s table, a line in a newsletter. Keep it here until it becomes dinner.", records("inspiration").length ? link("Add idea", "inspiration/new", { primary: true, ico: "plus" }) : "")}<div class="toolbar">${searchBar("inspiration", "Find an idea", "Find an idea, tag or source…")}</div><div id="list-results">${ideaResults()}</div>`;
  return { title: "Ideas", active: "recipes", content };
}
function inspirationDetail(id) {
  const i = record("inspiration", id);
  if (!i)
    return {
      title: "Ideas",
      active: "recipes",
      content: emptyState(
        "Idea not found.",
        "It may have been archived.",
        link("Ideas", "inspiration"),
      ),
    };
  const d = i.data,
    [state, cls] = ideaState(d);
  const made = d.recipe_id ? record("recipe", d.recipe_id) : null;
  const content = `${pageHeader({ title: d.title, eyebrow: d.source ? `From ${d.source}` : "An idea to try", back: { label: "Ideas", route: "inspiration" }, actions: `${link("Edit", `inspiration/${id}/edit`, { ico: "pencil" })}${button("Archive", "archive", `data-kind="inspiration" data-id="${id}" data-target="inspiration"`, "btn-quiet", "archive")}` })}<div class="chips">${tag(state, cls)}${d.tags.map((t) => tag(t, "tag-neutral")).join("")}</div><div class="actions spacer">${made ? link(`Open ${made.data.title}`, `recipes/${made.id}`, { primary: true, ico: "book-open" }) : d.recipe_id ? '<span class="small muted">The recipe it became was archived.</span>' : `${link("Write it up as a recipe", `recipes/new/inspiration/${id}`, { primary: true, ico: "pen-line" })}${button(d.status === "tried" ? "Still want to try it" : "We tried it", "idea-status", `data-id="${id}"`, "", "check")}`}</div><div class="learn-columns spacer"><section class="stack">${d.notes ? `<p class="preline lead">${esc(d.notes)}</p>` : ""}${photoStrip(d.photo_ids)}${linksSection(d, "Watch and read")}</section><aside class="panel stack-sm"><h3>What happens next</h3><p class="small muted">Write it up as a recipe when it’s worth keeping; the idea stays linked to the recipe. Mark it tried to remember you gave it a go.</p></aside></div>`;
  return { title: d.title, active: "recipes", content };
}
function inspirationEditor(id) {
  const i = id ? record("inspiration", id) : null;
  if (id && !i)
    return {
      title: "Ideas",
      active: "recipes",
      content: emptyState("Idea not found.", "", link("Ideas", "inspiration")),
    };
  const d = i?.data ?? {
    title: "",
    notes: "",
    source: "",
    tags: [],
    links: [],
    photo_ids: [],
    status: "idea",
    recipe_id: null,
  };
  const content = `${pageHeader({ title: i ? "Edit idea" : "New idea", subtitle: "A dish, a flavor pairing, a video. Enough to remember why it excited you.", back: i ? { label: i.data.title, route: `inspiration/${i.id}` } : { label: "Ideas", route: "inspiration" } })}<form data-form="inspiration" class="panel stack" data-id="${i?.id ?? ""}" data-version="${i?.version ?? ""}"><div class="form-grid">${field("Idea", "title", d.title, "text", 'required maxlength="500" placeholder="Crispy chickpea bowls with tahini"')}${field("Where it came from", "source", d.source, "text", 'maxlength="500" placeholder="Noa’s dinner, a newsletter, a reel"')}</div>${area("Notes", "notes", d.notes, 'rows="4" placeholder="What made it special, and what you’d change."')}${field("Tags, separated by commas", "tags", d.tags.join(", "), "text", 'placeholder="Weeknight, vegetarian"')}${area("Links and videos · one per line", "links", formatLinkLines(d.links), 'rows="3" placeholder="www.instagram.com/reel/… The reel"', "A web address, then an optional title. Instagram, TikTok, YouTube, Vimeo and Facebook videos play on the idea’s page.")}${photoFields(d.photo_ids)}<div class="form-grid">${select(
    "Status",
    "status",
    [
      ["idea", "Want to try"],
      ["tried", "Tried it"],
    ],
    d.status,
  )}${select("The recipe it became", "recipe_id", [["", "Not written up yet"], ...optionsFor("recipe")], d.recipe_id ?? "")}</div>${errorSlot()}<div class="form-footer">${submit(i ? "Save idea" : "Add idea", "check")}${link("Cancel", i ? `inspiration/${i.id}` : "inspiration", { cls: "btn-quiet" })}</div></form>`;
  return { title: i ? "Edit idea" : "New idea", active: "recipes", content };
}

function bookCover(b) {
  const d = b.data;
  return d.cover_id
    ? `<img class="cover" src="/api/assets/${encodeURIComponent(d.cover_id)}" alt="" loading="lazy">`
    : `<div class="cover spine" aria-hidden="true"><span>${esc(d.title)}</span><small>${esc(d.author)}</small></div>`;
}
function bookCard(b) {
  const d = b.data,
    file = record("asset", d.file_id);
  return `<article class="card book"><a class="cover-link" href="#/library/${b.id}" tabindex="-1" aria-hidden="true">${bookCover(b)}</a><h2 class="card-title"><a href="#/library/${b.id}">${esc(d.title)}</a></h2><p>${esc(d.author || "Author not recorded")}</p><div class="card-end"><span class="small muted">${file ? `${fileLabel[file.data.mime_type] ?? "File"} · ${size(file.data.byte_length)}` : "File missing"}${d.bookmarks.length ? ` · ${plural(d.bookmarks.length, "bookmark")}` : ""}</span><a class="btn btn-sm btn-quiet" href="#/library/${b.id}">Open${icon("chevron-right")}</a></div></article>`;
}
function bookResults() {
  const books = [...records("book")]
    .sort((a, b) => a.data.title.localeCompare(b.data.title))
    .filter((b) =>
      matching("library", [
        b.data.title,
        b.data.author,
        b.data.notes,
        ...b.data.tags,
      ]),
    );
  if (!books.length)
    return searches.library
      ? emptyState(
          "No books match.",
          "Try another title, author or tag.",
          "",
          "search",
        )
      : emptyState(
          "An empty shelf, for now.",
          "Add a cookbook you own as a PDF or EPUB. Files stay on this household server.",
          link("Add a book", "library/new", { primary: true }),
          "book-open",
        );
  return `<div class="grid grid-3">${books.map(bookCard).join("")}</div>`;
}
function shelfPage() {
  const content = `${recipesHeader("library", "The cookbooks you own as PDF or EPUB files, the pages you return to, and the recipes you write up from them.", records("book").length ? link("Add a book", "library/new", { primary: true, ico: "plus" }) : "")}<div class="toolbar">${searchBar("library", "Find a book", "Find a book, author or tag…")}</div><div id="list-results">${bookResults()}</div>`;
  return { title: "Books", active: "recipes", content };
}
function bookForm() {
  const content = `${pageHeader({ title: "Add a book", subtitle: "A cookbook you own, as a file. It stays on this household server and goes into your backups.", back: { label: "Books", route: "library" } })}<form data-form="book" class="panel stack"><label class="upload">${icon("upload")}<strong>Choose a PDF or EPUB</strong><span class="small muted">Up to 64 MB. Stays on this household server.</span><input type="file" name="file" accept="application/pdf,application/epub+zip,.pdf,.epub" required></label><div class="form-grid">${field("Title", "title", "", "text", 'required maxlength="500"')}${field("Author", "author", "", "text", 'maxlength="500"')}</div>${field("Tags, separated by commas", "tags", "", "text", 'placeholder="Baking, Middle Eastern"')}${area("Notes", "notes", "", 'rows="2" placeholder="A gift from Noa. The lamb chapter is the one."')}<div class="field"><span>Cover photo (optional)</span><input type="file" name="cover" accept="image/png,image/jpeg,image/webp">${help("PNG, JPEG or WebP up to 8 MB.")}</div>${errorSlot()}<div class="form-footer">${submit("Add to shelf", "check")}${link("Cancel", "library", { cls: "btn-quiet" })}</div></form>`;
  return { title: "Add a book", active: "recipes", content };
}
const fileName = (d, file) =>
  file.data.name ||
  `${d.title}.${fileLabel[file.data.mime_type]?.toLowerCase() ?? "bin"}`;
function bookPage(id, editing = false) {
  const b = record("book", id);
  if (!b)
    return {
      title: "Books",
      active: "recipes",
      content: emptyState(
        "Book not found.",
        "It may have been archived.",
        link("Books", "library"),
      ),
    };
  const d = b.data,
    file = record("asset", d.file_id);
  const kind = file ? fileLabel[file.data.mime_type] : null,
    readable = kind === "PDF";
  const href = `/api/assets/${encodeURIComponent(d.file_id)}`;
  const written = d.recipe_ids.map((r) => record("recipe", r)).filter(Boolean);
  const content = `${pageHeader({ title: editing ? "Edit book" : d.title, eyebrow: editing ? "" : d.author ? `By ${d.author}` : "On your shelf", back: editing ? { label: d.title, route: `library/${id}` } : { label: "Books", route: "library" }, actions: editing ? "" : `${link("Edit details", `library/${id}/edit`, { ico: "pencil" })}${button("Remove from shelf", "archive", `data-kind="book" data-id="${id}" data-target="library"`, "btn-quiet", "archive")}` })}<div class="book-columns"><aside class="stack">${bookCover(b)}<div class="actions">${file ? `<a class="btn" href="${href}?download=1" download="${esc(fileName(d, file))}">${icon("download")}Download ${kind} · ${size(file.data.byte_length)}</a>${readable ? `<a class="btn" href="${href}" target="_blank" rel="noopener">${icon("external-link")}Open in a new tab</a>` : ""}` : '<p class="small muted">The file for this book is missing.</p>'}</div>${d.tags.length ? `<div class="chips">${d.tags.map((t) => tag(t, "tag-neutral")).join("")}</div>` : ""}${d.notes ? `<div class="panel panel-soft"><p class="preline">${esc(d.notes)}</p></div>` : ""}<section class="panel stack-sm"><h3>Bookmarks</h3><div class="list">${d.bookmarks.map((m, index) => `<div class="list-item"><div class="list-body"><strong>${esc(m.label)}</strong>${m.page ? `<p>Page ${m.page}</p>` : ""}</div><div class="list-actions">${readable && m.page ? button("Read", "reader-page", `data-page="${m.page}" aria-label="Read ${esc(m.label)} on page ${m.page}"`, "btn-sm", "play") : ""}${button("", "bookmark-remove", `data-id="${id}" data-index="${index}" aria-label="Remove bookmark ${esc(m.label)}"`, "btn-quiet btn-icon btn-sm", "x")}</div></div>`).join("") || '<p class="small muted">The pages you keep coming back to.</p>'}</div><form data-form="bookmark" class="stack-sm" data-id="${id}" data-version="${b.version}"><div class="form-grid">${field("What’s there", "label", "", "text", 'required maxlength="500" placeholder="The braise"')}${field("Page", "page", "", "number", 'min="1" max="100000" placeholder="Optional"')}</div>${errorSlot()}<div>${submit("Add bookmark", "plus")}</div></form></section>${written.length ? `<section class="panel stack-sm"><h3>Written up from this book</h3><div class="chips">${written.map((r) => `<a class="chip" href="#/recipes/${r.id}">${esc(r.data.title)}</a>`).join("")}</div></section>` : ""}</aside><section class="stack">${editing ? bookEditor(b) : readable ? `<div class="embed reader" data-shape="page" data-src="${esc(href)}" data-title="${esc(d.title)}">${button("Read here", "embed-load", `aria-label="Read ${esc(d.title)} here"`, "embed-load", "book-open")}<small>Opens the PDF from this household server on this page.</small></div>` : `<div class="panel"><h3>Read it in your reading app</h3><p class="small muted spacer-sm">${kind ? `${kind} books don’t open in the browser. Download the file and open it in your reader.` : "This book has no readable file."}</p></div>`}</section></div>`;
  return { title: editing ? "Edit book" : d.title, active: "recipes", content };
}
function bookEditor(b) {
  const d = b.data;
  return `<form data-form="book" class="panel stack" data-id="${b.id}" data-version="${b.version}"><h2>Details</h2><div class="form-grid">${field("Title", "title", d.title, "text", 'required maxlength="500"')}${field("Author", "author", d.author, "text", 'maxlength="500"')}</div>${field("Tags, separated by commas", "tags", d.tags.join(", "), "text")}${area("Notes", "notes", d.notes, 'rows="3"')}<div class="field"><span>${d.cover_id ? "Replace the cover" : "Cover photo (optional)"}</span><input type="file" name="cover" accept="image/png,image/jpeg,image/webp">${help("PNG, JPEG or WebP up to 8 MB.")}</div>${d.cover_id ? check("Remove the current cover", "remove_cover") : ""}${recipePicker(d.recipe_ids, "Recipes written up from this book")}${errorSlot()}<div class="form-footer">${submit("Save book", "check")}${link("Cancel", `library/${b.id}`, { cls: "btn-quiet" })}</div></form>`;
}

// What a recipe is connected to beyond its own page: the techniques it uses,
// the book it came from and the idea it grew out of.
function recipeConnections(id) {
  const groups = [
    [
      "Techniques",
      records("technique")
        .filter((t) => t.data.recipe_ids.includes(id))
        .map(
          (t) =>
            `<a class="chip" href="#/techniques/${t.id}">${icon("chef-hat")}${esc(t.data.title)}</a>`,
        ),
    ],
    [
      "From your shelf",
      records("book")
        .filter((b) => b.data.recipe_ids.includes(id))
        .map(
          (b) =>
            `<a class="chip" href="#/library/${b.id}">${icon("book-open")}${esc(b.data.title)}</a>`,
        ),
    ],
    [
      "Inspired by",
      records("inspiration")
        .filter((i) => i.data.recipe_id === id)
        .map(
          (i) =>
            `<a class="chip" href="#/inspiration/${i.id}">${icon("sparkles")}${esc(i.data.title)}</a>`,
        ),
    ],
  ].filter(([, items]) => items.length);
  return groups.length
    ? `<section class="connections">${groups.map(([title, items]) => `<div class="stack-sm"><div class="eyebrow">${title}</div><div class="chips">${items.join("")}</div></div>`).join("")}</section>`
    : "";
}

// ---------- Sign-in ----------
async function authApi(path, input) {
  const response = await fetch(
    `/api/auth/${path}`,
    input === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
  );
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.message ?? "Could not complete this action.");
    error.code = value.error;
    throw error;
  }
  return value;
}
// Browser credential objects hold ArrayBuffers; the server reads base64url.
function serializeCredential(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: base64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    response: {
      clientDataJSON: base64url(r.clientDataJSON),
      ...(r.attestationObject
        ? {
            attestationObject: base64url(r.attestationObject),
            transports: r.getTransports?.() ?? [],
          }
        : {
            authenticatorData: base64url(r.authenticatorData),
            signature: base64url(r.signature),
            userHandle: r.userHandle ? base64url(r.userHandle) : null,
          }),
    },
  };
}
const passkeyMessage = (error) =>
  error.name === "NotAllowedError"
    ? "The passkey request was cancelled or timed out. Try again."
    : error.name === "InvalidStateError"
      ? "This device already holds a passkey for your account."
      : error.name === "SecurityError"
        ? "Passkeys need a secure (HTTPS) address. Use an email link instead."
        : error.message;
const deviceName = () => {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "This device";
  return `${device} · ${dateLabel(today())}`;
};
async function passkeySignIn(quiet = false) {
  // A quiet (suggestion) request can be abandoned while its options load.
  const controller = quiet ? new AbortController() : null;
  if (quiet) conditional = controller;
  const { options } = await authApi("passkey/options", {});
  if (controller?.signal.aborted) return;
  const request = {
    publicKey: {
      ...options,
      challenge: bytes(options.challenge),
      allowCredentials: (options.allowCredentials ?? []).map((c) => ({
        ...c,
        id: bytes(c.id),
      })),
    },
  };
  if (quiet) {
    request.mediation = "conditional";
    request.signal = controller.signal;
  }
  const credential = await navigator.credentials.get(request);
  await authApi("passkey/signin", {
    credential: serializeCredential(credential),
  });
  await signedIn("Welcome back.");
}
// Browsers that can list passkeys among the email field's suggestions do so
// without a tap; the button stays for everyone else.
async function offerConditionalPasskey() {
  if (
    !passkeysSupported() ||
    !PublicKeyCredential.isConditionalMediationAvailable
  )
    return;
  try {
    if (!(await PublicKeyCredential.isConditionalMediationAvailable())) return;
  } catch {
    return;
  }
  if (!$('input[autocomplete~="webauthn"]')) return;
  try {
    await passkeySignIn(true);
  } catch (error) {
    if (error.name !== "AbortError") loginError(passkeyMessage(error));
  }
}
async function addPasskey() {
  const { options } = await authApi("passkey/register/options", {});
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: bytes(options.challenge),
      user: { ...options.user, id: bytes(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
        ...c,
        id: bytes(c.id),
      })),
    },
  });
  await authApi("passkey/register", {
    credential: serializeCredential(credential),
    name: deviceName(),
  });
  localStorage.setItem("kooks.passkey", "added");
}
async function signedIn(message) {
  signin = { step: "start", email: "", error: "" };
  await loadState();
  await render();
  toast(message);
}
// The emailed link lands on #/signin/<token>; the token never reaches a server log.
async function confirmLink(token) {
  history.replaceState(null, "", "#/today");
  try {
    await authApi("link/confirm", { token });
    await signedIn("You’re signed in.");
  } catch (error) {
    signin = {
      step: "start",
      email: "",
      error: error.code === "SIGN_IN_DISABLED" ? "" : error.message,
    };
    // Already signed in, or no sign-in on this computer: carry on inside.
    if (await loadState()) {
      await render();
      if (signin.error) toast(signin.error, true);
      signin.error = "";
    }
  }
}
function loginError(message) {
  const el = $("[data-login-error]");
  if (el) el.textContent = message;
}
// Settings › Sign-in: the passkeys of the signed-in member, and the way out.
async function accountTab() {
  const { passkeys } = await authApi("passkeys");
  return `<div class="grid-2"><section class="panel stack"><h2>Signed in as ${esc(account.email)}</h2><p class="small muted">Passkeys let you sign in with your fingerprint, face or screen lock instead of waiting for an email.</p><div class="list">${
    passkeys.length
      ? passkeys
          .map(
            (p) =>
              `<div class="list-item"><div class="list-body"><strong>${esc(p.name)}</strong><p>Added ${dateLabel(p.created_at.slice(0, 10))}${p.used_at ? ` · Last used ${dateLabel(p.used_at.slice(0, 10))}` : ""}${p.backed_up ? " · Synced by your password manager" : ""}</p></div>${button("Remove", "passkey-remove", `data-id="${esc(p.id)}" aria-label="Remove passkey ${esc(p.name)}"`, "btn-quiet btn-sm btn-danger")}</div>`,
          )
          .join("")
      : '<p class="small muted">No passkeys yet. Add one on each phone or computer you cook from.</p>'
  }</div><div>${passkeysSupported() ? button("Add a passkey on this device", "passkey-add", "", "btn-primary", "key-round") : '<p class="small muted">This browser cannot create passkeys. Email links keep working here.</p>'}</div></section><section class="panel stack"><h2>Email links</h2><p class="small muted">On a device without a passkey, ask for a one-time link at ${esc(account.email)}. Links work for 15 minutes.</p><h3>Sign out</h3><p class="small muted">Signing out ends this session on this device; your passkeys stay.</p><div>${button("Sign out", "sign-out", "", "", "log-in")}</div></section></div>`;
}

// ---------- Login, routing, rendering ----------
function renderLogin() {
  conditional?.abort();
  conditional = null;
  const sent = signin.step === "sent";
  $("#app").innerHTML =
    `<main class="login panel"><a class="brand" href="#/today">${icon("cooking-pot")}kooks</a>${
      sent
        ? `<div><h1>Check your inbox.</h1><p class="small muted">We sent a sign-in link to <strong>${esc(signin.email)}</strong>. Open it on this device within 15 minutes; it works once.</p><p class="small muted">Nothing there? Look in spam, or ask whoever runs this kitchen to add your address.</p></div><div>${button("Use a different address", "signin-restart", "", "btn-quiet")}</div>`
        : `<div><h1>Welcome to your kitchen.</h1><p class="small muted">${passkeysSupported() ? "Sign in with the passkey on this device, or get a link by email." : "Get a sign-in link by email."}</p></div><div class="error" role="alert" data-login-error>${esc(signin.error)}</div>${passkeysSupported() ? `${button("Sign in with a passkey", "passkey-signin", "", "btn-primary btn-block", "key-round")}<div class="or">or</div>` : ""}<form data-form="email-link" class="stack">${field("Email address", "email", signin.email, "email", 'required autocomplete="username webauthn" placeholder="you@example.com"')}${errorSlot()}<div>${submit("Email me a sign-in link", "log-in")}</div></form>`
    }</main>`;
  document.title = "Sign in · Kooks";
  if (!sent) void offerConditionalPasskey();
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
      return a === "inspiration" && b
        ? `recipes/new/inspiration/${b}`
        : "recipes/new";
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
  if (page === "signin") {
    if (a) await confirmLink(a);
    else navigate("today");
    return;
  }
  let view;
  try {
    if (page === "today") view = await todayPage();
    else if (page === "recipes") {
      if (!a) view = libraryPage();
      else if (a === "add") view = capturePage();
      else if (a === "new")
        view = recipeEditor(
          null,
          "new",
          b === "inspiration" ? record("inspiration", c) : null,
        );
      else if (b === "edit") view = recipeEditor(a, "edit");
      else if (b === "variant") view = recipeEditor(a, "variant");
      else if (b === "memory") view = memoryPage(a);
      else view = await recipePage(a);
    } else if (page === "imports") view = recipeEditor(a, "import");
    else if (page === "techniques")
      view =
        a === "new"
          ? techniqueEditor(null)
          : b === "edit"
            ? techniqueEditor(a)
            : a
              ? techniquePage(a)
              : techniquesPage();
    else if (page === "inspiration")
      view =
        a === "new"
          ? inspirationEditor(null)
          : b === "edit"
            ? inspirationEditor(a)
            : a
              ? inspirationDetail(a)
              : inspirationPage();
    else if (page === "library")
      view =
        a === "new" ? bookForm() : a ? bookPage(a, b === "edit") : shelfPage();
    else if (page === "account") view = await settingsPage("account");
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
  $("#app").innerHTML = shell({
    ...view,
    active: page === "account" ? "account" : view.active,
  });
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
    course: values.get("course") || null,
    cuisine: values.get("cuisine") || null,
    diets: values.getAll("diets"),
    tags: parseLabels(values.get("tags")),
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
  const idea = record("inspiration", values.get("inspiration_id"));
  if (idea && idea.data.recipe_id !== result.record.id)
    try {
      await write("inspiration_save", {
        id: idea.id,
        expected_version: idea.version,
        inspiration: { ...idea.data, recipe_id: result.record.id },
      });
    } catch (error) {
      toast(
        `The recipe is saved, but the idea could not be linked to it: ${error.message}`,
        true,
      );
    }
  await afterSave("Recipe saved.", `recipes/${result.record.id}`);
}

// ---------- Events ----------
const listResults = {
  recipes: () => libraryResults(),
  techniques: () => techniqueResults(),
  inspiration: () => ideaResults(),
  library: () => bookResults(),
};
document.addEventListener("input", (event) => {
  const form = event.target.closest("form");
  if (form) form.dataset.dirty = "true";
  const scope = event.target.dataset.search;
  if (scope) {
    searches[scope] = event.target.value;
    const results = $("#list-results");
    if (results && listResults[scope]) results.innerHTML = listResults[scope]();
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
    if (type === "email-link") {
      const email = String(v.get("email")).trim();
      await authApi("link", { email });
      signin = { step: "sent", email, error: "" };
      renderLogin();
    } else if (type === "technique") {
      const t = record("technique", form.dataset.id);
      const result = await write("technique_save", {
        ...editing,
        technique: {
          ...(t?.data ?? {}),
          title: v.get("title"),
          summary: v.get("summary"),
          steps: paragraphs(v.get("steps")).map((text) => ({ text })),
          tips: v.get("tips"),
          tags: comma(v.get("tags")),
          links: linksFrom(v.get("links")),
          photo_ids: await photoIds(v),
          recipe_ids: v.has("recipes_listed")
            ? v.getAll("recipes")
            : (t?.data.recipe_ids ?? []),
        },
      });
      await afterSave("Technique saved.", `techniques/${result.record.id}`);
    } else if (type === "inspiration") {
      const i = record("inspiration", form.dataset.id);
      const result = await write("inspiration_save", {
        ...editing,
        inspiration: {
          ...(i?.data ?? {}),
          title: v.get("title"),
          notes: v.get("notes"),
          source: v.get("source"),
          tags: comma(v.get("tags")),
          links: linksFrom(v.get("links")),
          photo_ids: await photoIds(v),
          status: v.get("status"),
          recipe_id: v.get("recipe_id") || null,
        },
      });
      await afterSave("Idea saved.", `inspiration/${result.record.id}`);
    } else if (type === "book") {
      const b = record("book", form.dataset.id);
      const upload = v.get("file"),
        cover = v.get("cover");
      if (!b && !upload?.size) throw new Error("Choose a PDF or EPUB file.");
      if (upload?.size) toast("Storing your book on the household server…");
      const file_id = upload?.size
        ? await uploadFile(upload, "book")
        : b.data.file_id;
      const cover_id = cover?.size
        ? await uploadFile(cover, "image")
        : v.has("remove_cover")
          ? null
          : (b?.data.cover_id ?? null);
      const result = await write("book_save", {
        ...editing,
        book: {
          ...(b?.data ?? { bookmarks: [] }),
          title: v.get("title"),
          author: v.get("author"),
          tags: comma(v.get("tags")),
          notes: v.get("notes"),
          file_id,
          cover_id,
          recipe_ids: v.has("recipes_listed")
            ? v.getAll("recipes")
            : (b?.data.recipe_ids ?? []),
        },
      });
      await afterSave(
        b ? "Book updated." : "Added to your shelf.",
        `library/${result.record.id}`,
      );
    } else if (type === "bookmark") {
      const b = record("book", form.dataset.id);
      await write("book_save", {
        ...editing,
        book: {
          ...b.data,
          bookmarks: [
            ...b.data.bookmarks,
            { label: v.get("label"), page: inputNumber(v.get("page")) },
          ],
        },
      });
      await afterSave("Bookmark added.");
    } else if (type === "suggest") {
      filters = {
        available_ingredients: comma(v.get("available")),
        member_ids: v.getAll("members"),
        avoid_dislikes: v.has("avoid"),
        diets: v.getAll("diets"),
        tags: v.getAll("tags"),
      };
      for (const key of ["course", "cuisine"])
        if (v.get(key)) filters[key] = v.get(key);
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
    loadEmbed(el.closest(".embed"));
    return;
  }
  if (a === "reader-page") {
    // A bookmark opens the PDF reader at its page; the viewer reads the
    // fragment when the document loads, so the frame is created afresh.
    const box = document.querySelector(".embed.reader");
    if (box) {
      loadEmbed(
        box,
        `${box.dataset.src.split("#")[0]}#page=${Number(el.dataset.page)}`,
      );
      box.scrollIntoView({ block: "start" });
    }
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
  if (a === "library-toggle") {
    library[el.dataset.key] = !library[el.dataset.key];
    navigate("recipes");
    return;
  }
  if (a === "library-facet") {
    // Chips on the Recipes page toggle; chips on a card or recipe only add.
    const { facet, value } = el.dataset,
      add = el.dataset.mode === "add",
      same = (v) => labelKey(v) === labelKey(value);
    if (Array.isArray(library[facet])) {
      if (!library[facet].some(same)) library[facet].push(value);
      else if (!add) library[facet] = library[facet].filter((v) => !same(v));
    } else library[facet] = !add && same(library[facet]) ? "" : value;
    if (add) library.drafts = false;
    navigate("recipes");
    return;
  }
  if (a === "library-clear") {
    library = noLibraryFilters();
    navigate("recipes");
    return;
  }
  if (a === "append-tag") {
    const input = el.closest("form")?.querySelector('input[name="tags"]');
    if (input) {
      const tags = parseLabels(input.value);
      if (!tags.some((t) => labelKey(t) === labelKey(el.dataset.value)))
        tags.push(el.dataset.value);
      input.value = formatLabels(tags);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
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
    } else if (a === "idea-status") {
      const i = record("inspiration", id);
      const tried = i.data.status !== "tried";
      await write("inspiration_save", {
        id,
        expected_version: i.version,
        inspiration: { ...i.data, status: tried ? "tried" : "idea" },
      });
      await afterSave(tried ? "Marked as tried." : "Back on the list to try.");
    } else if (a === "bookmark-remove") {
      const b = record("book", id);
      await write("book_save", {
        id,
        expected_version: b.version,
        book: {
          ...b.data,
          bookmarks: b.data.bookmarks.filter(
            (_, index) => index !== Number(el.dataset.index),
          ),
        },
      });
      await afterSave("Bookmark removed.");
    } else if (a === "archive") {
      const kind = el.dataset.kind,
        r = record(kind, id);
      await write("record_archive", {
        kind,
        id,
        expected_version: r.version,
        archived: true,
      });
      await afterSave(
        kind === "plan"
          ? "Removed from the plan."
          : "Archived. Undo brings it back.",
        el.dataset.target,
      );
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
    } else if (a === "passkey-signin") {
      conditional?.abort();
      conditional = null;
      try {
        await passkeySignIn();
      } catch (error) {
        loginError(passkeyMessage(error));
      }
    } else if (a === "passkey-add") {
      try {
        await addPasskey();
      } catch (error) {
        throw new Error(passkeyMessage(error));
      }
      await render();
      toast("Passkey added. Next time, sign in with one tap.");
    } else if (a === "passkey-later") {
      localStorage.setItem("kooks.passkey", "later");
      await render();
    } else if (a === "passkey-remove") {
      await authApi("passkey/remove", { id });
      await render();
      toast("Passkey removed.");
    } else if (a === "sign-out") {
      await authApi("signout", {});
      account = null;
      db = {};
      revision = "";
      signin = { step: "start", email: "", error: "" };
      // The next person to sign in starts at Today, not on this page.
      history.replaceState(null, "", "#/today");
      renderLogin();
      toast("Signed out. See you at the next meal.");
    } else if (a === "signin-restart") {
      signin = { step: "start", email: signin.email, error: "" };
      renderLogin();
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
      toast("Cookbook exported with photos, books and leftovers.");
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
  const [page, token] = location.hash.slice(2).split("/");
  if (page === "signin" && token) await confirmLink(token);
  else if (await loadState()) await render();
} catch (error) {
  $("#app").innerHTML =
    `<main class="page">${emptyState("Your kitchen is taking a moment.", error.message, button("Try again", "reload"), "circle-alert")}</main>`;
}
