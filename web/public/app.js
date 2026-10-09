const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const monday = date => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const num = value => value == null ? '—' : Number(value.toFixed(3)).toLocaleString();
const amount = ingredient => ingredient.quantity === null ? 'As written' : `${num(ingredient.quantity)} ${ingredient.unit ?? ''}`.trim();
const inputNumber = value => value === '' || value === null ? null : Number(value);
const comma = value => String(value ?? '').split(',').map(v => v.trim()).filter(Boolean);
const lineList = value => String(value ?? '').split(/\n/).map(v => v.trim()).filter(Boolean);
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const paths = {
  leaf: '<path d="M20 3C11 2 3 6 4 13c1 6 9 7 13 2 3-4 3-8 3-12Z"/><path d="M3 22 15 9M9 16l-1-5m4 2 5 1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  book: '<path d="M12 5v16M3 3c4-1 7 0 9 2 2-2 5-3 9-2v16c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
  meal: '<path d="M4 3v7c0 3 6 3 6 0V3M7 3v19M19 3c-4 3-5 8-1 9h2V3h-1Zm1 9v10"/>',
  basket: '<path d="m3 10 2 11h14l2-11ZM2 10h20M6 10l4-7m8 7-4-7M9 14v3m6-3v3"/>',
  jar: '<path d="M7 2h10v4H7zM7 6c0 3-3 3-3 6v8c0 2 16 2 16 0v-8c0-3-3-3-3-6M4 12h16M4 18h16"/>',
  box: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v12l9 3 9-3V7M12 11v11M7 5l9 4"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3c0-6 14-6 14 0v3m0-17a3 3 0 0 1 0 6m3 5c3 1 3 4 3 6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M16 8c-7-4-10 4-4 4s3 8-4 4m4-11v14"/>',
  flame: '<path d="M13 2c2 7 7 8 7 14 0 9-16 9-16 0 0-4 3-6 4-8 0 5 3 5 3 2l2-8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  edit: '<path d="m14 4 6 6M4 20l5-1L21 7c2-2-2-6-4-4L5 15l-1 5Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  heart: '<path d="M12 21 3 12c-6-7 4-13 9-6 5-7 15-1 9 6l-9 9Z"/>',
  pan: '<path d="M3 10c0 12 13 12 13 0H3Zm13 2h6M7 2v4m5-4v4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.leaf}</svg>`;
const link = (label, route, primary = false, ico = '') => `<a class="button ${primary ? 'primary' : ''}" href="#/${route}">${ico ? icon(ico) : ''}${esc(label)}</a>`;
const button = (label, action, attrs = '', cls = '', ico = '') => `<button type="button" class="button ${cls}" data-action="${action}" ${attrs}>${ico ? icon(ico) : ''}${esc(label)}</button>`;
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const field = (label, name, value = '', type = 'text', extra = '') => `<label class="field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
const area = (label, name, value = '', extra = '') => `<label class="field"><span>${esc(label)}</span><textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
const select = (label, name, options, value = '', extra = '') => `<label class="field"><span>${esc(label)}</span><select name="${name}" ${extra}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const check = (label, name, value = 'on', checked = false, extra = '') => `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} ${extra}>${esc(label)}</label>`;
const submit = label => `<div class="error-message" role="alert" data-error></div><button class="button primary" type="submit">${esc(label)}</button>`;
const empty = (title, text, action = '') => `<div class="panel empty">${icon('leaf')}<h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;
const heading = (kicker, title, text = '', actions = '') => `<header class="heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</header>`;
const spiceOptions = [['', 'Not recorded'], [0, 'No heat'], [1, 'Mild'], [2, 'Medium'], [3, 'Hot']];
const cleanupOptions = [['', 'Not recorded'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
let db = {}, revision = '', busy = 0, draw = 0, lastAction = null, sharing = false, filters = {}, search = '', week = monday(today()), toastTimeout;
let currency = localStorage.getItem('kooks.currency') ?? 'USD';
const pendingWrites = new Map(), portions = new Map();
const records = kind => db[kind] ?? [];
const record = (kind, id) => records(kind).find(r => r.id === id);
const route = () => location.hash.slice(2).split('/').filter(Boolean);
const person = id => record('member', id)?.data.name ?? 'Unassigned';
const optionsFor = kind => records(kind).map(r => [r.id, r.data.title ?? r.data.name]);
const sourceOptions = () => [...records('recipe').map(r => [`recipe:${r.id}`, r.data.title]), ...records('meal').map(r => [`meal:${r.id}`, `${r.data.title} · Meal`])];
const sourceFrom = value => { const [kind, id] = value.split(':'); return { kind, id }; };
const money = (value, code = currency) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value); } catch { return `${code} ${Number(value).toFixed(2)}`; } };

async function api(name, input = {}) {
  const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.message ?? 'Could not complete this action.'); error.code = value.error; throw error; }
  return value;
}
async function write(name, input) {
  const key = JSON.stringify([name, input]);
  const request_id = pendingWrites.get(key) ?? uid(); pendingWrites.set(key, request_id);
  const result = await api(name, { ...input, request_id });
  pendingWrites.delete(key); lastAction = result.action_id;
  return result;
}
function toast(message, error = false, undo = false) {
  const el = $('#toast'); el.hidden = false; el.className = `toast ${error ? 'error' : ''}`;
  el.innerHTML = `<span>${esc(message)}</span>${undo && lastAction ? '<button data-action="undo">Undo</button>' : ''}<button data-action="dismiss-toast" aria-label="Dismiss message">×</button>`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.hidden = true; }, error ? 20000 : 7000);
}
async function loadState({ polling = false } = {}) {
  const response = await fetch(`/api/state${polling ? `?revision=${encodeURIComponent(revision)}` : ''}`);
  if (response.status === 401) { revision = ''; renderLogin(); return false; }
  if (!response.ok) throw new Error('Could not open the kitchen. Check that the server is running.');
  const value = await response.json();
  if (value.unchanged) return false;
  if (polling && document.querySelector('form[data-dirty="true"]')) { const notice = $('.sync-note'); if (notice) { notice.hidden = false; notice.textContent = 'Someone updated the kitchen. Your draft is kept here; save checks for conflicting changes.'; } return false; }
  db = value.records; revision = value.revision; sharing = value.sharing;
  return true;
}
function navigate(target) { if (location.hash === `#/${target}`) void render(); else location.hash = `/${target}`; }
async function afterSave(message, target) { await loadState(); if (target) navigate(target); else await render(); toast(message, false, true); }

function shell(content, active) {
  const nav = [['today', 'sun', 'Today'], ['recipes', 'book', 'Recipes'], ['plan', 'calendar', 'Meals & plan'], ['pantry', 'jar', 'Pantry'], ['leftovers', 'box', 'Leftovers'], ['household', 'people', 'Household'], ['spending', 'coin', 'Spending'], ['shop', 'basket', 'Shopping'], ['cooking', 'flame', 'Cooking']];
  const activeCount = records('session').filter(s => s.data.status === 'active').length;
  return `<div class="topbar"><a class="brand" href="#/today">${icon('leaf')}kooks</a><div class="topright"><span class="household">${icon('people')}${records('member').length ? `${records('member').length} at your table` : 'Your household kitchen'}</span>${link('Add recipe', 'capture', true, 'plus')}</div></div><div class="sync-note" hidden></div><div class="shell"><nav class="sidebar" aria-label="Main navigation">${nav.map(([key, ico, label]) => `<a class="nav" href="#/${key}" ${key === active ? 'aria-current="page"' : ''}>${icon(ico)}${label}${key === 'cooking' && activeCount ? `<span class="badge">${activeCount}</span>` : ''}</a>`).join('')}<div class="sidebar-foot"><p>Good food.<br>In good company.</p><div class="small muted">${records('recipe').length} recipes, all yours.</div>${button('Export cookbook', 'export', '', 'quiet small-button')}</div></nav><main id="main" class="content" tabindex="-1">${content}</main></div>`;
}
function effort(r) {
  const d = r.data ?? r;
  return `<div class="meta"><span>${icon('clock')}${d.active_minutes == null ? 'Hands-on time unset' : `${d.active_minutes} min hands-on`}</span>${d.total_minutes != null ? `<span>${d.total_minutes} min total</span>` : ''}${d.pan_count != null ? `<span>${icon('pan')}${d.pan_count} pan${d.pan_count === 1 ? '' : 's'}</span>` : ''}</div>`;
}
function recipeCard(r, suggestion = null) {
  const d = r.data;
  return `<article class="card"><div class="row between"><span class="tag">${esc(d.tags[0] ?? 'Your collection')}</span>${button(d.favorite ? '♥' : '♡', 'favorite', `data-id="${r.id}" aria-label="${d.favorite ? 'Unfavorite' : 'Favorite'} ${esc(d.title)}"`, 'quiet small-button')}</div><h2><a class="title" href="#/recipes/${r.id}">${esc(d.title)}</a></h2>${effort(r)}${d.preferred ? '<span class="small muted">Your preferred version</span>' : ''}${suggestion ? `<div class="stack"><div class="chips">${suggestion.use_soon.map(n => `<span class="tag warm">Use soon · ${esc(n)}</span>`).join('')}${suggestion.missing.length ? `<span class="tag neutral">${suggestion.missing.length} shopping gap${suggestion.missing.length === 1 ? '' : 's'}</span>` : '<span class="tag">All ingredients on hand</span>'}</div>${suggestion.missing.length ? `<p>Missing: ${esc(suggestion.missing.map(i => `${i.name} (${amount(i)})`).join(', '))}</p>` : ''}${suggestion.check_quantities.length ? `<p>Check amounts: ${esc(suggestion.check_quantities.map(i => i.name).join(', '))}.</p>` : ''}${suggestion.preferences.likes.length ? `<p>${esc(suggestion.preferences.likes.join(' · '))}</p>` : ''}${suggestion.preferences.unknown.length ? `<p>${esc(suggestion.preferences.unknown.join(' · '))}</p>` : ''}${suggestion.preferences.conflicts.length ? `<p>${esc(suggestion.preferences.conflicts.join(' · '))}</p>` : ''}</div>` : ''}<div class="card-end"><span class="small muted">${d.servings == null ? 'Yield not set' : `${num(suggestion?.servings ?? d.servings)} portions`}</span>${link('Open recipe', `recipes/${r.id}`, false, 'arrow')}</div></article>`;
}

async function todayPage() {
  const result = await api('recipe_suggest', { ...filters, limit: 30 });
  const useSoon = records('pantry').filter(p => p.data.use_soon && p.data.available);
  const active = records('session').filter(s => s.data.status === 'active');
  return `${heading('Your everyday kitchen', 'What sounds good today?', 'A good dinner starts with what you already have.')}${active.map(s => `<div class="callout row between"><span>${icon('flame')}On the stove · ${esc(s.data.title)}</span>${link('Keep cooking', `cooking/${s.id}`)}</div>`).join('')}<section class="hero"><div><div class="eyebrow">Make a little more of what’s there</div><h2>A fridge full of possibilities.</h2><p>${useSoon.length ? `Start with ${esc(useSoon.map(p => p.data.name).slice(0, 3).join(', '))}. We’ll find a place for them at the table.` : 'Tell us what’s in your pantry, who’s eating, and how much time you have.'}</p><div class="spacer">${link('Check your pantry', 'pantry', false, 'jar')}</div></div><div class="hero-art" aria-hidden="true"><div class="plate">${icon('leaf')}</div></div></section><form data-form="suggest" class="panel filters"><div class="row between"><h3>Find your next dinner</h3><span class="small muted">From your own cookbook</span></div>${field('Any other ingredients on hand?', 'available', (filters.available_ingredients ?? []).join(', '), 'text', 'placeholder="e.g. zucchini, chickpeas"')}<div class="filter-grid">${field('Hands-on minutes, at most', 'active', filters.max_active_minutes ?? '', 'number', 'min="0" max="10080" placeholder="Any"')}${field('Total minutes, at most', 'total', filters.max_total_minutes ?? '', 'number', 'min="0" max="10080" placeholder="Any"')}${select('Pans, at most', 'pans', [['', 'Any number'], [0, 'No cooking pans'], [1, 'One pan'], [2, 'Two pans']], filters.max_pans ?? '')}${select('Cleanup', 'cleanup', [['', 'Any effort'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], filters.cleanup ?? '')}</div><div class="row">${field('Portions to make', 'servings', filters.servings ?? '', 'number', 'min="0.01" max="10000" step="any" placeholder="Recipe yield"')}${check('Skip ingredients people dislike', 'avoid', 'on', filters.avoid_dislikes !== false)}</div>${records('member').length ? `<div><div class="small muted">Who’s eating?</div><div class="chips spacer">${records('member').map(m => check(m.data.name, 'members', m.id, (filters.member_ids ?? []).includes(m.id))).join('')}</div></div>` : `<p class="small muted">${link('Add the people at your table', 'household')}</p>`}<div class="row">${submit('Find dinner')}${button('Clear filters', 'clear-filters', '', 'quiet')}</div></form><div class="section-heading"><h2>${Object.keys(filters).length ? 'A few good possibilities' : 'From your kitchen'}</h2><span class="small muted">${result.total} recipe${result.total === 1 ? '' : 's'}</span></div>${result.skipped.effort_unknown ? `<p class="callout warning">${result.skipped.effort_unknown} recipes need effort details before they can match these filters.</p>` : ''}${result.skipped.missing_yield ? `<p class="callout warning">${result.skipped.missing_yield} recipes need a serving count before they can be scaled.</p>` : ''}${result.skipped.preferences ? `<p class="small muted">${result.skipped.preferences} recipes excluded by the selected taste preferences.</p>` : ''}${result.results.length ? `<div class="grid">${result.results.map(r => recipeCard(r.record, r)).join('')}</div>` : records('recipe').length ? empty('Nothing fits just yet.', 'Try allowing a little more time or choosing different eaters.', button('Clear filters', 'clear-filters')) : empty('Your first recipe belongs here.', 'Paste a recipe from your messages, photograph a favorite, or write one yourself.', link('Add your first recipe', 'capture', true))}<p class="small muted spacer">Pantry names and preparation must match recipe ingredients. Checklist entries mean you have the ingredient; check amounts before cooking.</p>`;
}

function libraryPage() {
  const found = records('recipe').filter(r => [r.data.title, r.data.notes, ...r.data.ingredients.map(i => i.name), ...r.data.tags].join(' ').toLowerCase().includes(search.toLowerCase()));
  const drafts = records('import').filter(r => r.data.status === 'draft');
  return `${heading('Your everyday cookbook', 'Your kitchen, collected.', 'Old favorites, small discoveries, and your own little adjustments.')}${drafts.length ? `<div class="callout"><h3>Ready for a read-through</h3><div class="row spacer">${drafts.map(r => link(r.data.title, `imports/${r.id}`)).join('')}</div></div>` : ''}<form data-form="search" class="search-bar"><label class="sr-only" for="search">Find a recipe or ingredient</label><input class="input" id="search" name="query" placeholder="Find a recipe, ingredient or tag…" value="${esc(search)}"><button class="button" type="submit">Search</button></form>${found.length ? `<div class="grid three">${found.map(r => recipeCard(r)).join('')}</div>` : empty(search ? 'No recipes found.' : 'A cookbook waiting to happen.', search ? 'Try a different ingredient or name.' : 'Start with something you already love to cook.', link('Add a recipe', 'capture', true))}`;
}

async function recipePage(id) {
  const r = record('recipe', id); if (!r) return empty('Recipe not found.', 'It may have been archived.', link('Your recipes', 'recipes'));
  const source = { kind: 'recipe', id, ...(portions.has(id) ? { servings: portions.get(id) } : {}) };
  const [scaled, memory, cost] = await Promise.all([api('recipe_scale', { id, ...(source.servings ? { servings: source.servings } : {}) }), api('recipe_memory', { id }), api('cost_estimate', { source, currency, as_of: today() })]);
  const d = scaled.recipe;
  return `${link('Recipes', 'recipes', false, 'back')}${heading(r.data.original_recipe_id ? 'Your own variation' : 'From your cookbook', r.data.title, '', link('Edit recipe', `edit/${id}`, false, 'edit'))}${effort(r)}<div class="actions spacer">${button('Start cooking', 'cook', `data-kind="recipe" data-id="${id}"`, 'primary', 'flame')}${link('Review groceries', `review/recipe/${id}`, false, 'basket')}${link('Make a variation', `variant/${memory.original_recipe_id}`, false, 'edit')}${link('Record a cooked batch', `new-batch/${id}`, false, 'box')}</div>${memory.preferred_recipe && memory.preferred_recipe.id !== id ? `<div class="callout spacer row between"><span>Your preferred version: ${esc(memory.preferred_recipe.data.title)}</span>${link('Open variation', `recipes/${memory.preferred_recipe.id}`)}</div>` : ''}${memory.latest ? `<div class="callout spacer"><div class="eyebrow">Remember for next time</div><p class="preline">${esc(memory.latest.data.next_time || memory.latest.data.changes || memory.latest.data.text)}</p><small>${esc(memory.latest.data.cooked_on ?? memory.latest.created_at.slice(0, 10))}</small></div>` : ''}<div class="recipe-columns spacer"><section class="panel"><h3>Ingredients</h3><form data-form="servings" class="row spacer">${hidden('id', id)}${field('Portions', 'servings', d.servings ?? '', 'number', `min="0.01" max="10000" step="any" ${r.data.servings === null ? 'disabled placeholder="Unknown"' : 'required'}`)}${r.data.servings !== null ? '<button class="button" type="submit">Update</button>' : ''}</form>${d.ingredients.map(i => `<div class="ingredient"><span>${esc(i.name)}${i.preparation ? `<br><small class="muted">${esc(i.preparation)}</small>` : ''}</span><span class="amount">${esc(amount(i))}</span></div>`).join('') || '<p class="small muted spacer">Ingredients have not been recorded.</p>'}${d.equipment.length ? `<hr class="divider"><h3>What you’ll use</h3><div class="chips spacer">${d.equipment.map(e => `<span class="tag neutral">${e.quantity > 1 ? e.quantity + ' × ' : ''}${esc(e.name)}${e.capacity ? ` · ${esc(e.capacity)}` : ''}</span>`).join('')}</div>` : ''}<hr class="divider"><h3>Estimated ingredient cost</h3><p class="spacer">${cost.complete ? `<strong>${money(cost.total)}</strong> <span class="small muted">· ${cost.dishes[0].per_portion == null ? '' : `${money(cost.dishes[0].per_portion)} per portion`}</span>` : `<strong>${money(cost.known_cost)}</strong> <span class="small cost-unknown">known subtotal · incomplete</span>`}</p>${cost.missing_prices.length ? `<p class="small muted">Missing amounts or prices: ${esc(cost.missing_prices.map(l => l.ingredient.name).join(', '))}.</p>` : ''}${link('Manage prices', 'spending')}</section><section><h2>The method</h2><ol class="method spacer">${d.steps.map(s => `<li>${esc(s.text)}${s.duration_seconds ? `<p class="small muted">${num(s.duration_seconds / 60)} minutes</p>` : ''}</li>`).join('')}</ol>${d.warnings.length ? `<div class="callout warning">${d.warnings.map(esc).join('<br>')}</div>` : ''}${r.data.notes ? `<div class="note"><p>${esc(r.data.notes)}</p></div>` : ''}<details><summary>Original recipe and sources</summary>${r.data.source_url ? `<a href="${esc(r.data.source_url)}" target="_blank" rel="noreferrer">Original source</a>` : ''}${(r.data.source_image_ids ?? []).map(id => `<img class="source-image" src="/api/assets/${encodeURIComponent(id)}" alt="Original recipe photo">`).join('')}<pre class="source-text">${esc(r.data.original_text || 'No original text was provided.')}</pre></details></section></div><div class="section-heading"><h2>What worked in your kitchen</h2>${link('Add a cooking memory', `memory/${id}`, false, 'plus')}</div>${memory.notes.length ? memory.notes.map(n => `<article class="panel spacer"><div class="row between"><span class="eyebrow">${esc(n.data.cooked_on ?? n.created_at.slice(0, 10))}</span><span>${n.data.rating ? '★'.repeat(n.data.rating) : ''}${n.data.cook_again === true ? ' · Cook again' : n.data.cook_again === false ? ' · Try something else' : ''}</span></div><p class="preline spacer">${esc(n.data.text)}</p>${n.data.changes ? `<p class="small preline spacer"><strong>Changed:</strong> ${esc(n.data.changes)}</p>` : ''}${n.data.next_time ? `<p class="small preline spacer"><strong>Next time:</strong> ${esc(n.data.next_time)}</p>` : ''}</article>`).join('') : '<p class="muted small">Your notes and successful changes will appear here before the next cook.</p>'}${memory.variants.length ? `<div class="section-heading"><h2>Ways you make it</h2></div><div class="chips">${memory.variants.map(v => link(`${v.data.title}${v.data.preferred ? ' · Preferred' : ''}`, `recipes/${v.id}`)).join('')}</div>` : ''}`;
}

function recipeEditor(id, mode = 'edit') {
  const draft = mode === 'import' ? record('import', id) : null;
  const r = mode === 'import' ? null : record('recipe', id);
  const data = draft?.data.recipe ?? r?.data ?? { title: '', servings: null, ingredients: [], steps: [], equipment: [], tags: [], notes: '' };
  if ((id && !r && !draft) || draft?.data.status === 'saved') return empty('This editor is no longer available.', 'Open the saved recipe from your cookbook.', link('Recipes', 'recipes'));
  const ingredientText = data.ingredients.map(i => `${i.quantity == null ? '' : `${i.quantity} ${i.unit ?? ''} `}${i.name}${i.preparation ? `, ${i.preparation}` : ''}`.trim()).join('\n');
  return `${heading(mode === 'import' ? 'A quick read-through' : mode === 'variant' ? 'Keep what you love. Change what you need.' : 'Your recipe, your way', mode === 'import' ? 'Check it, then make it yours.' : mode === 'variant' ? 'Make your own variation.' : r ? 'A little refinement.' : 'Something worth keeping.', mode === 'variant' ? 'The original stays in your cookbook. This version gets its own ingredients and method.' : 'Unknown amounts and timings can stay blank.')}<div class="${draft ? 'review-grid' : ''}"><form data-form="recipe" class="stack" data-mode="${mode}" data-id="${esc(id ?? '')}" data-version="${draft?.version ?? r?.version ?? ''}"><div class="panel stack"><div class="form-grid">${field('Recipe name', 'title', mode === 'variant' ? `${data.title} · My version` : data.title, 'text', 'required maxlength="500"')}${field('Original yield / portions', 'servings', data.servings ?? '', 'number', 'min="0.01" max="10000" step="any" placeholder="Unknown"')}</div><div class="form-grid four">${field('Hands-on minutes', 'active_minutes', data.active_minutes ?? '', 'number', 'min="0" max="10080" placeholder="Unknown"')}${field('Total minutes', 'total_minutes', data.total_minutes ?? '', 'number', 'min="0" max="10080" placeholder="Unknown"')}${field('Cooking pans', 'pan_count', data.pan_count ?? '', 'number', 'min="0" max="100" placeholder="Unknown"')}${select('Cleanup effort', 'cleanup', cleanupOptions, data.cleanup ?? '')}</div><div class="form-grid">${select('Spice level', 'spice_level', spiceOptions, data.spice_level ?? '')}${field('Tags, separated by commas', 'tags', data.tags.join(', '), 'text', 'placeholder="Weeknight, vegetarian"')}</div>${area('Ingredients · one per line', 'ingredients', ingredientText, 'rows="9" placeholder="250 g orzo\n30 mL olive oil\nSalt to taste"')}${area('Method · separate steps with a blank line', 'steps', data.steps.map(s => s.text).join('\n\n'), 'rows="9"')}${area('Equipment · one per line', 'equipment', data.equipment.map(e => e.name).join('\n'), 'rows="3"')}${area('Recipe notes', 'notes', data.notes)}${field('Source link (optional)', 'source_url', data.source_url ?? '', 'url')}${mode === 'variant' ? check('Use this as my preferred version', 'preferred', 'on', true) : ''}${draft ? check('I checked the ingredients, amounts and method against the original.', 'reviewed', 'on', false, 'required') : ''}<div class="row">${submit(draft ? 'Save reviewed recipe' : mode === 'variant' ? 'Save variation' : 'Save recipe')}${link('Cancel', r ? `recipes/${r.id}` : 'recipes')}</div></div></form>${draft ? `<aside class="panel source-pane"><h3>Your original</h3>${draft.data.warnings.map(w => `<p class="small muted">${esc(w)}</p>`).join('')}${draft.data.image_id ? `<img class="source-image spacer" src="/api/assets/${encodeURIComponent(draft.data.image_id)}" alt="Original recipe photo for comparison">` : ''}<details open><summary>Extracted source text</summary><pre class="source-text">${esc(draft.data.original_text)}</pre></details></aside>` : ''}</div>`;
}

function capturePage() {
  return `${heading('Keep the good ones', 'Every recipe starts somewhere.', 'From a message, a handwritten card, or the way you’ve always made it.')}<div class="grid"><form data-form="paste" class="panel stack"><div class="eyebrow">From your messages</div><h2>Paste a recipe.</h2><p class="small muted">Keep the original text and turn it into an editable draft.</p>${area('Recipe text', 'text', '', 'required rows="11" placeholder="Lemon orzo\nServes 4\n\nIngredients\n250 g orzo\n\nMethod\nCook the orzo…"')}${submit('Review pasted recipe')}</form><form data-form="photo" class="panel stack"><div class="eyebrow">From a photo or screenshot</div><h2>A picture worth keeping.</h2><p class="small muted">Read the text on your device’s local server, then check it beside the original image.</p><label class="upload">${icon('photo')}<strong>Choose a recipe photo</strong><span class="small muted">PNG, JPEG or WebP · up to 8 MB</span><input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label><p class="small muted">Clear, upright photos work best. Handwriting may need corrections.</p>${submit('Read photo')}</form></div><div class="panel spacer row between"><div><h3>It’s your own recipe?</h3><p class="small muted">You don’t need a source to save something good.</p></div>${link('Write it myself', 'new-recipe', false, 'edit')}</div>`;
}

function memoryPage(id) {
  const r = record('recipe', id); if (!r) return empty('Choose a recipe first.', '', link('Recipes', 'recipes'));
  return `${heading('A note for your future self', 'Remember the good bits.', r.data.title)}<form data-form="memory" class="panel stack">${hidden('recipe_id', id)}${field('Cooked on', 'cooked_on', today(), 'date', 'required')}${area('How did it turn out?', 'text', '', 'required placeholder="A keeper. Everyone went back for seconds."')}${area('What did you change?', 'changes', '', 'placeholder="Used half the lemon and added fresh dill."')}${area('What should you remember next time?', 'next_time', '', 'placeholder="Use the wide pan, and keep the heat low."')}<div class="form-grid">${select('Your rating', 'rating', [['', 'No rating'], [5, '5 · Loved it'], [4, '4 · Very good'], [3, '3 · Good'], [2, '2 · Needs work'], [1, '1 · Not for us']])}${select('Make it again?', 'cook_again', [['', 'Not sure yet'], ['yes', 'Yes, please'], ['no', 'Probably not']])}</div><div class="row">${submit('Save cooking memory')}${link('Back to recipe', `recipes/${id}`)}</div></form>`;
}

function pantryPage(editId) {
  const editing = record('pantry', editId), d = editing?.data ?? {};
  const pantry = [...records('pantry')].sort((a, b) => Number(b.data.use_soon) - Number(a.data.use_soon) || a.data.name.localeCompare(b.data.name));
  return `${heading('A little less waste', 'Good things on hand.', 'Keep a simple checklist, or add amounts when you know them.', link('Find something to cook', 'today', false, 'arrow'))}<div class="grid"><section class="panel"><h2>In your pantry</h2>${pantry.length ? pantry.map(p => `<div class="list-row"><label class="check"><input type="checkbox" data-change="pantry-available" data-id="${p.id}" ${p.data.available ? 'checked' : ''} aria-label="Have ${esc(p.data.name)}"></label><div class="grow"><strong>${esc(p.data.name)}</strong>${p.data.preparation ? `<small> · ${esc(p.data.preparation)}</small>` : ''}<p>${p.data.quantity == null ? 'Check quantity' : esc(amount(p.data))}${!p.data.available ? ' · Not on hand' : ''}</p></div><div class="actions">${button(p.data.use_soon ? 'Use soon ✓' : 'Use soon', 'pantry-soon', `data-id="${p.id}" aria-pressed="${p.data.use_soon}"`, `small-button ${p.data.use_soon ? 'warm' : 'quiet'}`)}${link('Edit', `pantry/${p.id}`)}</div></div>`).join('') : '<p class="muted small spacer">Start with the ingredients you’d like to use this week.</p>'}</section><form data-form="pantry" class="panel stack" data-id="${editing?.id ?? ''}" data-version="${editing?.version ?? ''}"><h2>${editing ? 'Update an ingredient.' : 'What’s in the kitchen?'}</h2>${field('Ingredient name', 'name', d.name ?? '', 'text', 'required placeholder="Zucchini"')}${field('Preparation / form', 'preparation', d.preparation ?? '', 'text', 'placeholder="Match the recipe, e.g. drained"')}<div class="form-grid">${field('Amount (optional)', 'quantity', d.quantity ?? '', 'number', 'min="0" max="1000000000" step="any" placeholder="Unknown"')}${field('Unit', 'unit', d.unit ?? '', 'text', 'placeholder="g, mL, each…"')}</div>${check('I have this ingredient', 'available', 'on', d.available !== false)}${check('Use this soon', 'use_soon', 'on', d.use_soon ?? false)}${area('A note', 'notes', d.notes ?? '', 'rows="2"')}<div class="row">${submit(editing ? 'Update ingredient' : 'Add to pantry')}${editing ? link('Cancel', 'pantry') : ''}</div></form></div>`;
}

function householdPage(editId) {
  const editing = record('member', editId), d = editing?.data ?? {};
  return `${heading('The people around your table', 'Good food is personal.', 'Keep track of everyone’s tastes, then choose who’s eating when you find dinner.')}<div class="grid"><section class="stack">${records('member').map(m => `<article class="panel"><div class="row"><div class="avatar">${esc(m.data.name[0])}</div><div class="grow"><h3>${esc(m.data.name)}</h3><p class="small muted">${m.data.spice_tolerance == null ? 'Spice preference not set' : spiceOptions.find(o => o[0] === m.data.spice_tolerance)?.[1]}</p></div>${link('Edit', `household/${m.id}`)}</div><hr class="divider"><p class="small"><strong>Likes:</strong> ${esc(m.data.likes.join(', ') || 'Not set')}</p><p class="small spacer"><strong>Dislikes:</strong> ${esc(m.data.dislikes.join(', ') || 'Not set')}</p>${m.data.notes ? `<p class="small muted spacer">${esc(m.data.notes)}</p>` : ''}</article>`).join('') || empty('Who’s coming to dinner?', 'Add a person to tailor meal suggestions and share cooking tasks.')}</section><form data-form="member" class="panel stack" data-id="${editing?.id ?? ''}" data-version="${editing?.version ?? ''}"><h2>${editing ? 'A change of taste.' : 'Make room at the table.'}</h2>${field('Name', 'name', d.name ?? '', 'text', 'required')}${field('Likes · ingredients or tags, separated by commas', 'likes', (d.likes ?? []).join(', '), 'text', 'placeholder="Chickpeas, pasta"')}${field('Dislikes · separated by commas', 'dislikes', (d.dislikes ?? []).join(', '), 'text', 'placeholder="Mushrooms, olives"')}${select('Spice tolerance', 'spice_tolerance', spiceOptions, d.spice_tolerance ?? '')}${area('Notes', 'notes', d.notes ?? '', 'rows="3"')}<p class="small muted">Preferences match the ingredient names and tags in your cookbook.</p><div class="row">${submit(editing ? 'Save preferences' : 'Add household member')}${editing ? link('Cancel', 'household') : ''}</div></form></div>${sharing ? '<p class="small muted spacer">Other browsers connected to this household server see the same recipes and cooking progress.</p>' : ''}`;
}

function leftoversPage() {
  return `${heading('Cook once. Enjoy again.', 'Something good for later.', 'Keep track of cooked portions, tomorrow’s lunch, and the little things in your freezer.', link('Record a batch', 'new-batch', true, 'plus'))}${records('batch').length ? `<div class="grid">${records('batch').map(b => `<article class="card"><div class="row between"><span class="tag">${esc(b.data.storage)}</span><small class="muted">Cooked ${dateLabel(b.data.cooked_on)}</small></div><h2>${esc(b.data.title)}</h2><div class="row"><div><div class="number">${num(b.remaining_portions)}</div><small class="muted">portions remaining</small></div><div class="stat"><strong>${num(b.available_portions)}</strong><p>still unallocated</p></div></div><p>${num(b.reserved_portions)} reserved · ${num(b.eaten_portions)} enjoyed</p><div class="card-end">${link('Plan these portions', `leftovers/${b.id}`, false, 'arrow')}</div></article>`).join('')}</div>` : empty('Tomorrow’s lunch starts here.', 'Record a batch after cooking, then set aside portions for later. Those portions won’t add another set of groceries.', link('Record your first batch', 'new-batch', true))}`;
}

function batchForm(recipeId, sessionId, dishId) {
  const session = record('session', sessionId), dish = session?.data.dishes.find(d => d.dish_id === dishId);
  return `${heading('Already cooked', 'Save some for another day.', 'Record what you made. Allocate it to meals once it’s saved.')}<form data-form="batch" class="panel stack">${session ? `${hidden('session_id', sessionId)}${hidden('dish_id', dishId)}` : ''}${select('Recipe', 'recipe_id', optionsFor('recipe'), dish?.recipe_id ?? recipeId ?? records('recipe')[0]?.id, session ? 'disabled' : 'required')}${session ? hidden('recipe_id', dish.recipe_id) : ''}<div class="form-grid">${field('Portions actually cooked', 'portions', dish?.servings ?? record('recipe', recipeId)?.data.servings ?? '', 'number', `required min="0.01" max="10000" step="any" ${session ? 'readonly' : ''}`)}${field('Cooked on', 'cooked_on', today(), 'date', 'required')}${select('Stored in', 'storage', [['fridge', 'Fridge'], ['freezer', 'Freezer']])}</div>${area('Batch notes', 'notes', '', 'placeholder="Label on the container, or a reheating note from your recipe."')}<div class="row">${submit('Record cooked batch')}${link('Cancel', 'leftovers')}</div></form>`;
}

function batchPage(id) {
  const b = record('batch', id); if (!b) return empty('Batch not found.', '', link('Leftovers', 'leftovers'));
  return `${link('All leftovers', 'leftovers', false, 'back')}${heading('Something good for later', b.data.title, `Cooked ${dateLabel(b.data.cooked_on)} · ${b.data.portions} portions originally`)}<div class="callout row between"><span><strong>${num(b.available_portions)}</strong> portions available to allocate</span><span>${num(b.reserved_portions)} reserved · ${num(b.eaten_portions)} eaten</span></div><div class="grid"><section class="panel"><h2>Where it’s going</h2>${b.data.allocations.map(a => `<div class="list-row"><div class="grow"><strong>${num(a.portions)} portions · ${esc(a.slot)}</strong><p>${a.date ? dateLabel(a.date) : 'No date set'} · ${esc(a.storage)} · ${a.status === 'eaten' ? 'Enjoyed' : 'Reserved'}</p>${a.notes ? `<p>${esc(a.notes)}</p>` : ''}</div><div class="actions">${a.status === 'reserved' ? button('Eaten', 'allocation-eat', `data-id="${id}" data-allocation="${a.id}"`, 'small-button', 'check') : ''}${button('Release', 'allocation-release', `data-id="${id}" data-allocation="${a.id}" aria-label="Remove ${esc(a.slot)} allocation"`, 'quiet small-button')}</div></div>`).join('') || '<p class="small muted spacer">No portions allocated yet.</p>'}${b.data.notes ? `<div class="note"><p>${esc(b.data.notes)}</p></div>` : ''}</section><form data-form="allocation" class="panel stack" data-id="${id}" data-version="${b.version}"><h2>Make a little plan.</h2><div class="form-grid">${field('Portions', 'portions', '', 'number', `required min="0.01" max="${b.available_portions}" step="any"`)}${field('Meal date (optional)', 'date', '', 'date', `min="${b.data.cooked_on}"`)}${select('Meal', 'slot', [['Lunch', 'Lunch'], ['Dinner', 'Dinner'], ['Breakfast', 'Breakfast'], ['For later', 'For later']])}${select('Store these portions in', 'storage', [['fridge', 'Fridge'], ['freezer', 'Freezer']], b.data.storage)}</div>${area('A note for this portion', 'notes', '', 'rows="2"')}${check('Already eaten', 'eaten')}<div class="row">${submit('Allocate portions')}</div><p class="small muted">These portions are already cooked. Planning them adds no groceries.</p></form></div>`;
}

function planPage() {
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  return `${heading('A little thought ahead', 'A good week at the table.', 'A freshly cooked meal, a favorite combination, or yesterday’s good idea.')}<div class="pill-nav"><a href="#/plan" class="active">Weekly plan</a><a href="#/meals">Reusable meals</a></div><div class="row between spacer">${button('Previous week', 'week', 'data-delta="-7"', '', 'back')}<h2>${dateLabel(week)} – ${dateLabel(addDays(week, 6))}</h2>${button('Next week', 'week', 'data-delta="7"', '', 'arrow')}</div><div class="timeline spacer">${days.map(date => {
    const planned = records('plan').filter(p => p.data.date === date);
    const leftovers = records('batch').flatMap(b => b.data.allocations.filter(a => a.date === date).map(a => ({ ...a, batch: b })));
    return `<section class="day"><div><div class="day-name">${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</div><small>${dateLabel(date)}</small></div><div>${planned.map(p => `<div class="list-row"><div class="grow"><strong>${esc(p.data.title)}</strong><p>${esc(p.data.slot)} · ${p.data.dishes.map(d => `${esc(d.title)} ${d.servings ?? 'original'} portions`).join(' + ')}</p></div><div class="actions">${button('Cook', 'cook', `data-kind="plan" data-id="${p.id}"`, 'small-button')}${link('Shop', `review/plan/${p.id}`)}${button('Remove', 'archive', `data-kind="plan" data-id="${p.id}"`, 'quiet small-button')}</div></div>`).join('')}${leftovers.map(a => `<div class="list-row"><div class="grow"><span class="tag">Already cooked</span><p><strong>${esc(a.batch.data.title)}</strong> · ${num(a.portions)} portions · ${esc(a.slot)}${a.status === 'eaten' ? ' · Eaten' : ''}</p></div>${link('Open batch', `leftovers/${a.batch.id}`)}</div>`).join('')}${!planned.length && !leftovers.length ? '<p class="small muted">A little room for spontaneity.</p>' : ''}<details><summary>Plan something to cook</summary><form data-form="plan" class="stack">${hidden('date', date)}${select('Recipe or meal', 'source', sourceOptions(), '', 'required')}${field('Meal', 'slot', 'Dinner', 'text', 'required')}<div class="row">${submit('Add to this day')}${link('Plan leftovers instead', 'leftovers')}</div></form></details></div></section>`;
  }).join('')}</div>`;
}

function mealsPage(editId) {
  const editing = record('meal', editId);
  return `${heading('Made to go together', 'Bring your favorites together.', 'Save combinations you’ll want to cook again, with portions for each dish.')}<div class="pill-nav"><a href="#/plan">Weekly plan</a><a href="#/meals" class="active">Reusable meals</a></div><div class="grid">${records('meal').map(m => `<article class="card"><span class="eyebrow">${m.data.dishes.length} dishes · One meal</span><h2>${esc(m.data.title)}</h2>${m.data.dishes.map(d => `<p>${esc(record('recipe', d.recipe_id)?.data.title)} · ${d.servings ?? 'Original'} portions</p>`).join('')}<div class="card-end">${button('Cook meal', 'cook', `data-kind="meal" data-id="${m.id}"`, 'primary', 'flame')}${link('Shop', `review/meal/${m.id}`)}${link('Edit', `meals/${m.id}`)}</div></article>`).join('')}</div><form data-form="meal" class="panel stack spacer" data-id="${editing?.id ?? ''}" data-version="${editing?.version ?? ''}"><h2>${editing ? 'Refine your meal.' : 'Make a new combination.'}</h2>${field('Meal name', 'title', editing?.data.title ?? '', 'text', 'required placeholder="Friday dinner"')}<div>${records('recipe').map(r => {
    const dish = editing?.data.dishes.find(d => d.recipe_id === r.id);
    return `<div class="list-row"><div class="grow">${check(r.data.title, 'recipes', r.id, Boolean(dish))}</div>${field('Portions', `portions-${r.id}`, dish?.servings ?? r.data.servings ?? '', 'number', `min="0.01" max="10000" step="any" class="inline-number" ${r.data.servings === null ? 'disabled placeholder="Original"' : ''}`)}</div>`;
  }).join('')}</div>${area('Meal notes', 'notes', editing?.data.notes ?? '', 'rows="2"')}<div class="row">${submit('Save meal')}${editing ? link('Cancel', 'meals') : ''}</div></form>`;
}

async function spendingPage(editId) {
  const estimate = await api('cost_week', { week_start: week, currency, as_of: today() });
  const editing = record('price', editId), d = editing?.data ?? {};
  return `${heading('Make your meals add up', 'Good food. Thoughtful spending.', 'Estimates use the prices you confirm and the amounts your recipes need.')}<form data-form="currency" class="row panel">${field('Currency', 'currency', currency, 'text', 'required pattern="[A-Za-z]{3}" maxlength="3" aria-label="Currency code"')}${field('Week starting Monday', 'week', week, 'date', 'required')}<button type="submit" class="button">View week</button></form><div class="grid spacer"><section class="panel"><div class="eyebrow">${estimate.complete ? 'Planned cooking cost' : 'Known ingredient subtotal'}</div><div class="number spacer">${money(estimate.known_cost)}</div><p class="small ${estimate.complete ? 'muted' : 'cost-unknown'}">${estimate.complete ? `${estimate.plans.length} planned cooking occurrences` : 'Incomplete · some prices or quantities are missing'}</p>${estimate.budget ? `<hr class="divider"><p>Weekly budget <strong>${money(estimate.budget.data.amount)}</strong></p><p class="small muted">${estimate.remaining === null ? 'Add missing prices to calculate the remaining budget.' : estimate.remaining >= 0 ? `${money(estimate.remaining)} remaining` : `${money(-estimate.remaining)} over budget`}</p>` : ''}<details><summary>${estimate.budget ? 'Change' : 'Set'} this week’s budget</summary><form data-form="budget" class="stack" data-id="${estimate.budget?.id ?? ''}" data-version="${estimate.budget?.version ?? ''}">${field(`Budget (${currency})`, 'amount', estimate.budget?.data.amount ?? '', 'number', 'required min="0" max="1000000000" step="0.01"')}${submit('Save weekly budget')}</form></details></section><section class="panel"><h2>On the menu</h2>${estimate.plans.map(p => `<div class="list-row"><div class="grow"><strong>${esc(p.title)}</strong><p>${dateLabel(p.date)}${!p.complete ? ` · Missing: ${esc(p.missing_prices.map(i => i.ingredient.name).join(', '))}` : ''}</p></div><span>${money(p.known_cost)}${!p.complete ? '<br><small class="cost-unknown">partial</small>' : ''}</span></div>`).join('') || '<p class="small muted spacer">Plan a recipe or meal to see its ingredient cost here.</p>'}${estimate.leftovers.length ? `<p class="small muted spacer">${estimate.leftovers.length} leftover meals are already cooked and add no new grocery cost.</p>` : ''}${link('Open weekly plan', 'plan')}</section></div><div class="section-heading"><h2>Your ingredient prices</h2><span class="small muted">Confirmed prices · ${esc(currency)}</span></div><div class="panel table-wrap"><table><thead><tr><th>Ingredient</th><th>Package</th><th>Price</th><th>Confirmed</th><th></th></tr></thead><tbody>${records('price').filter(p => p.data.currency === currency).map(p => `<tr><td>${esc(p.data.name)}${p.data.preparation ? `<br><small>${esc(p.data.preparation)}</small>` : ''}</td><td>${num(p.data.package_quantity)} ${esc(p.data.unit)}</td><td>${money(p.data.price)}</td><td>${dateLabel(p.data.purchased_on)}<br><small>${esc(p.data.source)}</small></td><td>${link('Edit', `spending/${p.id}`)}</td></tr>`).join('') || '<tr><td colspan="5">Add your first confirmed price below.</td></tr>'}</tbody></table></div><form data-form="price" class="panel stack spacer" data-id="${editing?.id ?? ''}" data-version="${editing?.version ?? ''}"><h2>${editing ? 'Update a price.' : 'A price worth remembering.'}</h2><div class="form-grid">${field('Ingredient name', 'name', d.name ?? '', 'text', 'required')}${field('Preparation / form', 'preparation', d.preparation ?? '', 'text', 'placeholder="Match the recipe if specified"')}</div><div class="form-grid four">${field('Package amount', 'package_quantity', d.package_quantity ?? '', 'number', 'required min="0.01" max="10000" step="any"')}${field('Package unit', 'unit', d.unit ?? '', 'text', 'placeholder="g, kg, mL, each"')}${field('Package price', 'price', d.price ?? '', 'number', 'required min="0" max="1000000000" step="0.01"')}${field('Currency', 'currency', d.currency ?? currency, 'text', 'required pattern="[A-Za-z]{3}" maxlength="3"')}</div><div class="form-grid">${field('Price date', 'purchased_on', d.purchased_on ?? today(), 'date', 'required')}${select('Price source', 'source', [['manual', 'Entered by me'], ['receipt', 'Confirmed from a receipt']], d.source ?? 'manual')}</div>${area('Store or receipt note', 'notes', d.notes ?? '', 'rows="2"')}<div class="row">${submit('Save confirmed price')}${editing ? link('Cancel', 'spending') : ''}</div></form><p class="small muted spacer">These are ingredient-use estimates, not supermarket checkout totals. Unknown prices remain visible, and currencies are kept separate.</p>`;
}

function cookingPage(id) {
  const s = record('session', id);
  if (!s) {
    const sessions = [...records('session')].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return `${heading('A little help in the kitchen', 'Let’s cook together.', 'Share the preparation, follow each dish, and keep the timers in view.')}${sessions.length ? `<div class="grid">${sessions.map(s => `<article class="card"><span class="tag ${s.data.status === 'finished' ? 'neutral' : ''}">${s.data.status === 'active' ? 'On the stove' : 'Finished'}</span><h2>${esc(s.data.title)}</h2><p>${s.data.dishes.length} dishes · ${dateLabel(s.created_at.slice(0, 10))}</p>${link(s.data.status === 'active' ? 'Keep cooking' : 'Notes & leftovers', `cooking/${s.id}`, s.data.status === 'active', 'arrow')}</article>`).join('')}</div>` : empty('What are we making?', 'Choose a recipe or a saved meal, then start cooking.', link('Find dinner', 'today', true))}`;
  }
  const d = s.data, finished = d.status === 'finished';
  if (finished) return `${heading('Good food, made together', 'That’s one for the cookbook.', d.title)}<div class="grid">${d.dishes.map(dish => {
    const batch = records('batch').find(b => b.data.session_id === id && b.data.dish.dish_id === dish.dish_id);
    return `<article class="card"><h2>${esc(dish.title)}</h2><p>${dish.servings ?? 'Original'} portions cooked</p><div class="actions">${link('Remember what worked', `memory/${dish.recipe_id}`)}${batch ? link('Open cooked batch', `leftovers/${batch.id}`) : dish.servings ? link('Record leftovers', `new-batch/${dish.recipe_id}/${id}/${dish.dish_id}`) : '<p class="small muted">The cooked yield was unknown; record a batch from the leftovers page once the recipe yield is set.</p>'}</div></article>`;
  }).join('')}</div>${d.notes ? `<div class="note spacer"><p>${esc(d.notes)}</p></div>` : ''}`;
  const ownerOptions = [['', 'Unassigned'], ...optionsFor('member')];
  const dishOptions = [['', 'Whole meal'], ...d.dishes.map(dish => [dish.dish_id, dish.title])];
  return `${heading('In good company', d.title, 'Changes are shared with the other cooks connected to this kitchen.')}<div class="grid">${d.dishes.map(dish => {
    const p = d.progress.find(p => p.dish_id === dish.dish_id);
    const current = dish.steps[p.current_step];
    const memory = records('note').filter(n => n.data.recipe_id === dish.recipe_id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return `<section class="panel stack"><div class="row between"><h2>${esc(dish.title)}</h2><span class="tag">${dish.servings ?? 'Original'} portions</span></div>${memory ? `<div class="note"><p>${esc(memory.data.next_time || memory.data.changes || memory.data.text)}</p><small>Your last cooking note</small></div>` : ''}<div><span class="eyebrow">${p.completed_steps.length} of ${dish.steps.length} steps complete</span><progress max="${Math.max(1, dish.steps.length)}" value="${p.completed_steps.length}"></progress></div>${current ? `<p class="preline">${esc(current.text)}</p><div class="row">${button('Previous step', 'step-back', `data-id="${id}" data-dish="${dish.dish_id}" ${p.current_step === 0 ? 'disabled' : ''}`, 'small-button', 'back')}${button(p.current_step === dish.steps.length - 1 ? 'Mark step done' : 'Done, next step', 'step-next', `data-id="${id}" data-dish="${dish.dish_id}"`, 'primary small-button', 'check')}</div>` : '<p class="small muted">This dish has no recorded instructions.</p>'}<details><summary>Ingredients & full method</summary>${dish.ingredients.map(i => `<div class="ingredient"><span>${esc(i.name)}</span><span class="amount">${esc(amount(i))}</span></div>`).join('')}<ol class="method spacer">${dish.steps.map((step, index) => `<li>${esc(step.text)}${button(`Go to step ${index + 1}`, 'step-jump', `data-id="${id}" data-dish="${dish.dish_id}" data-step="${index}"`, 'quiet small-button')}</li>`).join('')}</ol></details></section>`;
  }).join('')}</div><div class="section-heading"><h2>Many hands. One meal.</h2><span class="small muted">Assign a person to each task</span></div><section class="panel">${(d.tasks ?? []).map(t => `<div class="task-row ${t.completed ? 'done' : ''}"><input type="checkbox" data-change="task-complete" data-id="${id}" data-task="${t.id}" ${t.completed ? 'checked' : ''} aria-label="Complete ${esc(t.text)}"><div class="task-title"><strong>${esc(t.text)}</strong>${t.dish_id ? `<p class="small muted">${esc(d.dishes.find(dish => dish.dish_id === t.dish_id)?.title)}</p>` : ''}</div><select data-change="task-owner" data-id="${id}" data-task="${t.id}" aria-label="Assign ${esc(t.text)}">${ownerOptions.map(([v, l]) => `<option value="${v}" ${v === (t.member_id ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${button('×', 'task-remove', `data-id="${id}" data-task="${t.id}" aria-label="Remove task ${esc(t.text)}"`, 'quiet icon-button remove-task')}</div>`).join('') || '<p class="small muted">Split the prep into small tasks, then choose who will handle each one.</p>'}<form data-form="task" class="stack spacer" data-id="${id}" data-version="${s.version}">${field('New task', 'text', '', 'text', 'required maxlength="500" placeholder="Chop the vegetables"')}<div class="form-grid">${select('For which dish?', 'dish_id', dishOptions)}${select('Who’s doing it?', 'member_id', ownerOptions)}</div><div>${submit('Add cooking task')}</div></form></section><div class="section-heading"><h2>Keep an eye on things.</h2></div><div class="stack">${d.timers.filter(t => !t.cancelled).map(t => `<div class="timer" data-timer-row="${t.id}"><div><h3>${esc(t.label)}</h3><small>${t.dish_id ? `${esc(d.dishes.find(d => d.dish_id === t.dish_id)?.title)} · ` : ''}${esc(person(t.member_id))}</small></div><strong data-deadline="${esc(t.deadline)}">—</strong>${button('Cancel', 'timer-cancel', `data-id="${id}" data-timer="${t.id}"`, 'quiet small-button')}</div>`).join('')}</div><form data-form="timer" class="panel stack spacer" data-id="${id}" data-version="${s.version}"><div class="form-grid four">${field('Timer name', 'label', '', 'text', 'required placeholder="Orzo"')}${field('Minutes', 'minutes', '', 'number', 'required min="0.016667" max="10080" step="any"')}${select('Dish', 'dish_id', dishOptions)}${select('Who’s watching it?', 'member_id', ownerOptions)}</div><div>${submit('Start timer')}</div><p class="small muted">Countdowns stay in view here. Use a device alarm for reliable alerts when the screen is locked.</p></form><form data-form="finish" class="panel stack spacer" data-id="${id}" data-version="${s.version}"><h2>Ready for the table?</h2>${area('A note about this meal', 'notes', '', 'rows="2"')}${submit('Finish cooking')}</form>`;
}

let review = null;
const exclusions = new Map();
async function reviewPage(kind, id) {
  const source = { kind, id, ...(kind === 'recipe' && portions.has(id) ? { servings: portions.get(id) } : {}) };
  const list = records('shopping')[0];
  if (!list) return `${heading('Just what you need', 'Start a shopping list.', 'Create a list before reviewing this recipe or meal.')}<form data-form="shopping-create" class="panel stack">${field('List name', 'title', 'Groceries', 'text', 'required')}${submit('Create shopping list')}</form>`;
  const key = `${kind}:${id}`, excluded = exclusions.get(key) ?? [];
  const input = { id: list.id, source, source_key: key, exclude_ingredients: excluded };
  const preview = await api('shopping_preview', input);
  review = { input, preview };
  return `${heading('Just what you need', `Shop for ${preview.source.title}`, 'Check the ingredients you need. Update the preview before adding them to your list.')}<div class="grid"><form data-form="shopping-review" class="panel stack"><h2>Include these ingredients</h2>${preview.source.dishes.map(d => `<section><h3>${esc(d.title)}</h3>${d.ingredients.map((i, index) => `<div class="list-row">${check(`${i.name} · ${amount(i)}`, 'ingredients', `${d.dish_id}:${index}`, !excluded.includes(`${d.dish_id}:${index}`))}</div>`).join('')}</section>`).join('')}<div>${submit('Update preview')}</div></form><section class="panel stack"><h2>Shopping changes</h2><p class="small muted">${preview.diff.added.length} new items · ${preview.diff.changed.length} changed · ${preview.diff.removed.length} removed</p>${preview.items.map(i => `<div class="ingredient"><span>${esc(i.name)}</span><span class="amount">${esc(amount(i))}</span></div>`).join('') || '<p class="small muted">No ingredients remain on this list.</p>'}${button('Apply to shopping list', 'shopping-apply', '', 'primary', 'check')}<p class="small muted" id="review-hint">Repeating this action updates this occurrence without adding it twice.</p>${preview.equipment.requirements.length ? `<details><summary>Required equipment</summary>${preview.equipment.requirements.map(e => `<p class="small">${esc(e.name)} · ${e.available_quantity === null ? 'availability unknown' : `${e.available_quantity} available`}</p>${e.conflicts.map(c => `<p class="small muted">${esc(c)}</p>`).join('')}`).join('')}</details>` : ''}</section></div>`;
}

function shopPage(id) {
  const list = record('shopping', id) ?? records('shopping')[0];
  return `${heading('A short list. A good meal.', 'Pick up something good.', 'Recipe ingredients and the everyday things you need.')}<div class="pill-nav">${records('shopping').map((l, i) => `<a href="#/shop/${l.id}" class="${i === 0 ? 'active' : ''}">${esc(l.data.title)}</a>`).join('')}</div>${list ? `<section class="panel"><h2>${esc(list.data.title)}</h2>${list.items.map(i => `<div class="list-row ${i.checked ? 'done' : ''}"><input type="checkbox" data-change="shopping-check" data-id="${list.id}" data-item="${i.id}" ${i.checked ? 'checked' : ''} aria-label="Bought ${esc(i.name)}"><div class="grow item-title"><strong>${esc(i.name)}</strong><p>${esc([...new Set(i.contributions.map(c => c.recipe_title).filter(Boolean))].join(', ') || 'Everyday item')}</p></div><span class="shopping-quantity">${esc(amount(i))}</span></div>`).join('') || '<p class="small muted spacer">Open a recipe or planned meal to review its groceries.</p>'}<form data-form="shopping-item" class="row spacer" data-id="${list.id}" data-version="${list.version}">${field('Add an everyday item', 'name', '', 'text', 'required placeholder="Coffee"')}<div>${submit('Add item')}</div></form>${list.data.sources.length ? `<details class="spacer"><summary>Recipes contributing to this list</summary>${list.data.sources.map(s => `<div class="list-row"><span class="grow">${esc(s.title)}</span>${button('Remove contribution', 'shopping-remove', `data-id="${list.id}" data-source="${esc(s.source_key)}"`, 'quiet small-button')}</div>`).join('')}</details>` : ''}</section>` : `<form data-form="shopping-create" class="panel stack">${field('List name', 'title', 'Groceries', 'text', 'required')}${submit('Create shopping list')}</form>`}`;
}

function renderLogin() {
  $('#app').innerHTML = `<main class="login panel stack"><a class="brand" href="#/today">${icon('leaf')}kooks</a><h2>Welcome to your kitchen.</h2><p class="small muted">Enter the access key for this household.</p><form data-form="login" class="stack">${field('Household access key', 'token', '', 'password', 'required autocomplete="current-password"')}${submit('Open kitchen')}</form></main>`;
}
async function render() {
  const token = ++draw;
  const [page = 'today', id, extra, last] = route();
  let content, active = page;
  try {
    if (page === 'today') content = await todayPage();
    else if (page === 'recipes') content = id ? await recipePage(id) : libraryPage();
    else if (page === 'edit' || page === 'variant' || page === 'imports') { content = recipeEditor(id, page === 'imports' ? 'import' : page); active = 'recipes'; }
    else if (page === 'new-recipe') { content = recipeEditor(null, 'new'); active = 'recipes'; }
    else if (page === 'memory') { content = memoryPage(id); active = 'recipes'; }
    else if (page === 'capture') { content = capturePage(); active = 'recipes'; }
    else if (page === 'pantry') content = pantryPage(id);
    else if (page === 'household') content = householdPage(id);
    else if (page === 'leftovers') content = id ? batchPage(id) : leftoversPage();
    else if (page === 'new-batch') { content = records('recipe').length ? batchForm(id, extra, last) : empty('Save a recipe first.', 'Then record how much you cooked.', link('Add recipe', 'capture', true)); active = 'leftovers'; }
    else if (page === 'plan') content = planPage();
    else if (page === 'meals') { content = mealsPage(id); active = 'plan'; }
    else if (page === 'spending') content = await spendingPage(id);
    else if (page === 'cooking') content = cookingPage(id);
    else if (page === 'review') { content = await reviewPage(id, extra); active = 'shop'; }
    else if (page === 'shop') content = shopPage(id);
    else content = empty('Let’s get back to the kitchen.', '', link('Today', 'today'));
    if (token !== draw) return;
    $('#app').innerHTML = shell(content, active); updateTimers();
  } catch (error) { if (token === draw) { if (error.code === 'SIGN_IN') renderLogin(); else { $('#app').innerHTML = shell(empty('Something needs a second look.', error.message, button('Try again', 'reload')), active); } } }
}

function updateTimers() {
  document.querySelectorAll('[data-deadline]').forEach(el => {
    const seconds = Math.max(0, Math.ceil((Date.parse(el.dataset.deadline) - Date.now()) / 1000));
    el.textContent = seconds === 0 ? 'Ready' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    el.closest('.timer').classList.toggle('ready', seconds === 0);
  });
}

async function saveRecipe(form, values) {
  const mode = form.dataset.mode, id = form.dataset.id;
  const original = mode === 'import' ? record('import', id)?.data.recipe : record('recipe', id)?.data;
  const ingredientsText = values.get('ingredients'), stepsText = values.get('steps');
  const parsed = await api('recipe_parse', { text: `${values.get('title')}\n${values.get('servings') ? `Serves ${values.get('servings')}` : ''}\nIngredients\n${ingredientsText}\nMethod\n${stepsText}` });
  const steps = String(stepsText).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(text => original?.steps.find(s => s.text === text) ?? { text });
  const equipment = lineList(values.get('equipment')).map(name => original?.equipment.find(e => e.name === name) ?? { name });
  const ingredients = parsed.recipe.ingredients.map(i => ({ ...i, category: original?.ingredients.find(old => old.name === i.name && old.preparation === i.preparation)?.category ?? 'Other' }));
  const recipe = { ...(original ?? {}), title: String(values.get('title')).trim(), servings: inputNumber(values.get('servings')), ingredients, steps, equipment,
    tags: comma(values.get('tags')), notes: values.get('notes'), source_url: values.get('source_url') || null,
    active_minutes: inputNumber(values.get('active_minutes')), total_minutes: inputNumber(values.get('total_minutes')),
    pan_count: inputNumber(values.get('pan_count')), cleanup: values.get('cleanup') || null, spice_level: inputNumber(values.get('spice_level')) };
  let result;
  if (mode === 'import') result = await write('recipe_import_commit', { id, expected_version: Number(form.dataset.version), reviewed: values.has('reviewed'), recipe });
  else if (mode === 'variant') result = await write('recipe_variant_save', { original_recipe_id: id, recipe, preferred: values.has('preferred') });
  else result = await write('recipe_save', { ...(id ? { id, expected_version: Number(form.dataset.version) } : {}), recipe });
  await afterSave('Recipe saved.', `recipes/${result.record.id}`);
}

document.addEventListener('input', event => {
  const form = event.target.closest('form'); if (form) form.dataset.dirty = 'true';
  if (form?.dataset.form === 'shopping-review') {
    const apply = $('[data-action="shopping-apply"]'); if (apply) apply.disabled = true;
    const hint = $('#review-hint'); if (hint) hint.textContent = 'Update the preview to include your selection changes.';
  }
});
document.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-form]'); if (!form) return;
  event.preventDefault(); if (!form.reportValidity() || form.classList.contains('busy')) return;
  const v = new FormData(form), type = form.dataset.form;
  const editing = form.dataset.id ? { id: form.dataset.id, expected_version: Number(form.dataset.version) } : {};
  form.classList.add('busy'); busy++; const err = form.querySelector('[data-error]'); if (err) err.textContent = '';
  try {
    if (type === 'login') {
      const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: v.get('token') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      await loadState(); await render();
    } else if (type === 'suggest') {
      filters = { available_ingredients: comma(v.get('available')), member_ids: v.getAll('members'), avoid_dislikes: v.has('avoid') };
      for (const [input, key] of [['active', 'max_active_minutes'], ['total', 'max_total_minutes'], ['pans', 'max_pans'], ['servings', 'servings']]) if (v.get(input) !== '') filters[key] = Number(v.get(input));
      if (v.get('cleanup')) filters.cleanup = v.get('cleanup'); await render();
    } else if (type === 'search') { search = v.get('query'); await render(); }
    else if (type === 'servings') { portions.set(v.get('id'), Number(v.get('servings'))); await render(); }
    else if (type === 'recipe') await saveRecipe(form, v);
    else if (type === 'paste') { const result = await write('recipe_import_text', { text: v.get('text') }); await afterSave('Draft ready for review.', `imports/${result.record.id}`); }
    else if (type === 'photo') {
      const image = v.get('image'); if (!image?.size || image.size > 8 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image smaller than 8 MB.');
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read that photo.')); reader.readAsDataURL(image); });
      toast('Reading your photo locally. This may take a moment.');
      const result = await write('recipe_import_image', { image: { name: image.name, mime_type: image.type, base64 } });
      await afterSave('Photo read. Check the draft beside the original.', `imports/${result.record.id}`);
    } else if (type === 'pantry') { await write('pantry_save', { ...editing, pantry: { name: v.get('name'), preparation: v.get('preparation'), quantity: inputNumber(v.get('quantity')), unit: v.get('unit'), available: v.has('available'), use_soon: v.has('use_soon'), notes: v.get('notes') } }); await afterSave('Pantry updated.', 'pantry'); }
    else if (type === 'member') { await write('member_save', { ...editing, member: { name: v.get('name'), likes: comma(v.get('likes')), dislikes: comma(v.get('dislikes')), spice_tolerance: inputNumber(v.get('spice_tolerance')), notes: v.get('notes') } }); await afterSave('Preferences saved.', 'household'); }
    else if (type === 'memory') { await write('note_save', { recipe_id: v.get('recipe_id'), cooked_on: v.get('cooked_on'), text: v.get('text'), changes: v.get('changes'), next_time: v.get('next_time'), rating: inputNumber(v.get('rating')), cook_again: v.get('cook_again') === '' ? null : v.get('cook_again') === 'yes' }); await afterSave('Saved for next time.', `recipes/${v.get('recipe_id')}`); }
    else if (type === 'batch') { const result = await write('batch_create', { recipe_id: v.get('recipe_id'), portions: Number(v.get('portions')), cooked_on: v.get('cooked_on'), storage: v.get('storage'), notes: v.get('notes'), ...(v.get('session_id') ? { session_id: v.get('session_id'), dish_id: v.get('dish_id') } : {}) }); await afterSave('Cooked batch recorded.', `leftovers/${result.record.id}`); }
    else if (type === 'allocation') { await write('batch_allocate', { ...editing, allocation: { portions: Number(v.get('portions')), date: v.get('date') || null, slot: v.get('slot'), storage: v.get('storage'), status: v.has('eaten') ? 'eaten' : 'reserved', notes: v.get('notes') } }); await afterSave('Portions allocated. No groceries added.'); }
    else if (type === 'plan') { await write('plan_save', { source: sourceFrom(v.get('source')), date: v.get('date'), slot: v.get('slot') }); await afterSave('Added to your week.'); }
    else if (type === 'meal') {
      const chosen = v.getAll('recipes'); if (!chosen.length) throw new Error('Choose at least one recipe for this meal.');
      await write('meal_save', { ...editing, meal: { title: v.get('title'), notes: v.get('notes'), dishes: chosen.map(id => ({ recipe_id: id, servings: record('recipe', id).data.servings === null ? null : Number(v.get(`portions-${id}`)), label: '' })) } }); await afterSave('Meal saved.', 'meals');
    } else if (type === 'currency') { currency = v.get('currency').toUpperCase(); week = monday(v.get('week')); localStorage.setItem('kooks.currency', currency); await render(); }
    else if (type === 'price') { await write('price_save', { ...editing, price: { name: v.get('name'), preparation: v.get('preparation'), package_quantity: Number(v.get('package_quantity')), unit: v.get('unit'), price: Number(v.get('price')), currency: v.get('currency').toUpperCase(), purchased_on: v.get('purchased_on'), source: v.get('source'), notes: v.get('notes') } }); await afterSave('Confirmed price saved.', 'spending'); }
    else if (type === 'budget') { await write('budget_save', { ...editing, budget: { week_start: week, currency, amount: Number(v.get('amount')) } }); await afterSave('Weekly budget saved.'); }
    else if (type === 'task') { await write('cooking_task_save', { ...editing, task: { text: v.get('text'), dish_id: v.get('dish_id') || null, member_id: v.get('member_id') || null } }); await afterSave('Task added.'); }
    else if (type === 'timer') { await write('cooking_timer', { ...editing, label: v.get('label'), duration_seconds: Math.round(Number(v.get('minutes')) * 60), ...(v.get('dish_id') ? { dish_id: v.get('dish_id') } : {}), member_id: v.get('member_id') || null }); await afterSave('Timer started.'); }
    else if (type === 'finish') { await write('cooking_finish', { ...editing, notes: v.get('notes') }); await afterSave('Enjoy your meal.'); }
    else if (type === 'shopping-create') { await write('shopping_create', { title: v.get('title') }); await afterSave('Shopping list created.'); }
    else if (type === 'shopping-item') { await write('shopping_manual_item', { ...editing, item: { name: v.get('name') } }); await afterSave('Item added.'); }
    else if (type === 'shopping-review') { const keys = review.preview.source.dishes.flatMap(d => d.ingredients.map((_, i) => `${d.dish_id}:${i}`)); const selected = v.getAll('ingredients'); exclusions.set(`${review.input.source.kind}:${review.input.source.id}`, keys.filter(k => !selected.includes(k))); await render(); }
  } catch (error) {
    if (err && form.isConnected) { err.textContent = error.message; err.scrollIntoView({ block: 'nearest' }); } else toast(error.message, true);
    if (error.code === 'STALE_VERSION' || error.code === 'STALE_PREVIEW') toast('Someone changed this record. Your draft is kept here; reopen it to review the latest version.', true);
  } finally { form.classList.remove('busy'); busy--; }
});

document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  event.preventDefault(); const a = el.dataset.action, id = el.dataset.id;
  if (a === 'dismiss-toast') { $('#toast').hidden = true; return; }
  el.disabled = true; busy++;
  try {
    if (a === 'clear-filters') { filters = {}; await render(); }
    else if (a === 'reload') { await loadState(); await render(); }
    else if (a === 'week') { week = addDays(week, Number(el.dataset.delta)); await render(); }
    else if (a === 'favorite') { const r = record('recipe', id); await write('recipe_save', { id, expected_version: r.version, recipe: { ...r.data, favorite: !r.data.favorite } }); await afterSave(r.data.favorite ? 'Favorite removed.' : 'Saved to favorites.'); }
    else if (a === 'pantry-soon') { const r = record('pantry', id); await write('pantry_save', { id, expected_version: r.version, pantry: { ...r.data, use_soon: !r.data.use_soon } }); await afterSave('Pantry updated.'); }
    else if (a === 'cook') { const kind = el.dataset.kind; const result = await write('cooking_start', { source: { kind, id, ...(kind === 'recipe' && portions.has(id) ? { servings: portions.get(id) } : {}) } }); await afterSave('Let’s get cooking.', `cooking/${result.record.id}`); }
    else if (a === 'allocation-eat' || a === 'allocation-release') { const b = record('batch', id), allocation = b.data.allocations.find(a => a.id === el.dataset.allocation), { id: allocationId, ...data } = allocation; await write('batch_allocate', { id, expected_version: b.version, allocation_id: allocationId, allocation: a === 'allocation-release' ? null : { ...data, status: 'eaten' } }); await afterSave(a === 'allocation-eat' ? 'Portions marked eaten.' : 'Allocation released.'); }
    else if (a === 'archive') { const kind = el.dataset.kind, r = record(kind, id); await write('record_archive', { kind, id, expected_version: r.version, archived: true }); await afterSave('Removed from the plan.'); }
    else if (a.startsWith('step-')) { const s = record('session', id), dish = s.data.dishes.find(d => d.dish_id === el.dataset.dish), p = s.data.progress.find(p => p.dish_id === dish.dish_id); const completed = a === 'step-next' ? [...new Set([...p.completed_steps, p.current_step])] : p.completed_steps; await write('cooking_progress', { id, expected_version: s.version, dish_id: dish.dish_id, current_step: a === 'step-jump' ? Number(el.dataset.step) : Math.max(0, Math.min(dish.steps.length - 1, p.current_step + (a === 'step-next' ? 1 : -1))), completed_steps: completed }); await afterSave('Cooking progress saved.'); }
    else if (a === 'task-remove') { const s = record('session', id); await write('cooking_task_save', { id, expected_version: s.version, task_id: el.dataset.task, task: null }); await afterSave('Task removed.'); }
    else if (a === 'timer-cancel') { const s = record('session', id); await write('cooking_timer', { id, expected_version: s.version, cancel_timer_id: el.dataset.timer }); await afterSave('Timer cancelled.'); }
    else if (a === 'shopping-apply') { await write('shopping_sync', { ...review.input, expected_version: review.preview.list_version, preview_token: review.preview.preview_token }); await afterSave('Shopping list updated.', 'shop'); }
    else if (a === 'shopping-remove') { const list = record('shopping', id); await write('shopping_remove_source', { id, expected_version: list.version, source_key: el.dataset.source }); await afterSave('Recipe contribution removed.'); }
    else if (a === 'undo') { const previous = lastAction; await write('history_undo', { action_id: previous }); lastAction = null; await loadState(); await render(); toast('Change undone.'); }
    else if (a === 'export') { const result = await api('backup_export'); const blob = new Blob([JSON.stringify(result.backup, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `kooks-${today()}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Cookbook exported with photos and leftovers.'); }
  } catch (error) { toast(error.message, true); if (error.code === 'STALE_VERSION' || error.code === 'STALE_PREVIEW') { await loadState(); await render(); } }
  finally { el.disabled = false; busy--; }
});

document.addEventListener('change', async event => {
  const el = event.target, type = el.dataset.change; if (!type) return;
  busy++; el.disabled = true;
  try {
    if (type === 'pantry-available') { const r = record('pantry', el.dataset.id); await write('pantry_save', { id: r.id, expected_version: r.version, pantry: { ...r.data, available: el.checked } }); }
    else if (type === 'task-complete' || type === 'task-owner') { const s = record('session', el.dataset.id), old = s.data.tasks.find(t => t.id === el.dataset.task), { id, ...task } = old; if (type === 'task-complete') task.completed = el.checked; else task.member_id = el.value || null; await write('cooking_task_save', { id: s.id, expected_version: s.version, task_id: id, task }); }
    else if (type === 'shopping-check') { const s = record('shopping', el.dataset.id); await write('shopping_check', { id: s.id, expected_version: s.version, item_ids: [el.dataset.item], checked: el.checked }); }
    await afterSave('Saved.');
  } catch (error) { toast(error.message, true); await loadState(); await render(); }
  finally { busy--; el.disabled = false; }
});

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); void render(); });
setInterval(updateTimers, 1000);
setInterval(async () => {
  if (busy || document.hidden || !revision) return;
  try { const changed = await loadState({ polling: true }); if (changed) await render(); }
  catch { const notice = $('.sync-note'); if (notice) { notice.hidden = false; notice.textContent = 'Connection interrupted. Your saved kitchen is still on the server. Reconnect before making changes.'; } }
}, 3000);
try { if (await loadState()) await render(); }
catch (error) { $('#app').innerHTML = `<main class="content">${empty('Your kitchen is taking a moment.', error.message, button('Try again', 'reload'))}</main>`; }
