import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../mcp/store.js';
import { createTools } from '../mcp/tools.js';
import { extractRecipe, parseIngredient, imageBytes } from '../mcp/imports.js';

function setup(t) {
  const store = new Store(':memory:'); t.after(() => store.close());
  const tools = new Map(createTools(store).map(t => [t.name, t]));
  let n = 0;
  return { store, call(name, input = {}) { const tool = tools.get(name); return tool.execute({ ...(!tool.readOnly ? { request_id: `feature-${++n}` } : {}), ...input }); } };
}
const recipe = (title = 'Rice bowl', overrides = {}) => ({ title, servings: 2, original_text: 'An original family recipe',
  ingredients: [{ name: 'Rice', quantity: 500, unit: 'g' }], steps: [{ text: 'Cook the rice.' }],
  active_minutes: 10, total_minutes: 25, pan_count: 1, cleanup: 'low', spice_level: 1, ...overrides });
const code = expected => error => error.code === expected;

test('pantry matching subtracts a known stock only once, preserves unknown amounts and uses exact names', t => {
  const { call } = setup(t);
  const r = call('recipe_save', { recipe: recipe('Oil and rice', { ingredients: [
    { name: 'Oil', quantity: 30, unit: 'mL' }, { name: 'Oil', quantity: 30, unit: 'mL' }, { name: 'Rice', quantity: 0.5, unit: 'kg' },
  ] }) }).record;
  call('pantry_save', { pantry: { name: 'Oil', quantity: 0.04, unit: 'l', use_soon: true } });
  call('pantry_save', { pantry: { name: 'Rice' } });
  call('pantry_save', { pantry: { name: 'Rice vinegar', quantity: 100, unit: 'mL' } });
  let result = call('recipe_suggest').results[0];
  assert.equal(result.record.id, r.id);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].quantity, 20);
  assert.equal(result.missing[0].unit, 'mL');
  assert.deepEqual(result.use_soon, ['Oil']);
  assert.equal(result.check_quantities[0].name, 'Rice');
  result = call('recipe_suggest', { servings: 4 }).results[0];
  assert.equal(result.missing[0].quantity, 80);
  assert.equal(call('kooks_get', { kind: 'recipe', id: r.id }).record.data.ingredients[0].quantity, 30);
  assert.equal(call('kooks_list', { kind: 'pantry' }).total, 3);
});

test('dinner suggestions respect selected eaters and effort limits without assuming unknowns are quick', t => {
  const { call } = setup(t);
  call('recipe_save', { recipe: recipe() });
  call('recipe_save', { recipe: recipe('Slow rice', { active_minutes: 45, total_minutes: 80 }) });
  call('recipe_save', { recipe: recipe('Unknown rice', { active_minutes: null, cleanup: null }) });
  call('recipe_save', { recipe: recipe('Hot rice', { spice_level: 3 }) });
  call('recipe_save', { recipe: { title: 'Unfinished recipe' } });
  const mild = call('member_save', { member: { name: 'Ari', likes: ['Rice'], spice_tolerance: 1 } }).record;
  const dislikes = call('member_save', { member: { name: 'Sam', dislikes: ['Rice'] } }).record;
  const result = call('recipe_suggest', { max_active_minutes: 15, max_pans: 1, cleanup: 'low', member_ids: [mild.id] });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].record.data.title, 'Rice bowl');
  assert.equal(result.results[0].preferences.likes.length, 1);
  assert.equal(result.skipped.effort_unknown, 1);
  assert.equal(result.skipped.effort_over_limit, 1);
  assert.equal(result.skipped.preferences, 1);
  assert.equal(result.skipped.incomplete, 1);
  assert.equal(call('recipe_suggest', { member_ids: [dislikes.id] }).total, 0);
  assert.ok(call('recipe_suggest', { member_ids: [dislikes.id], avoid_dislikes: false }).total > 0);
  assert.throws(() => call('recipe_save', { recipe: recipe('Impossible time', { active_minutes: 50, total_minutes: 10 }) }), code('INVALID_EFFORT'));
});

test('cooking memories and preferred variants preserve the original and undo the whole preference change', t => {
  const { call } = setup(t);
  const original = call('recipe_save', { recipe: recipe() }).record;
  call('note_save', { recipe_id: original.id, text: 'Loved it.', changes: 'Less salt.', next_time: 'Use the wide pan.', rating: 5, cook_again: true, cooked_on: '2026-09-18' });
  const first = call('recipe_variant_save', { original_recipe_id: original.id, recipe: recipe('Rice, less salt', { original_text: 'Should not replace the original source' }) }).record;
  const second = call('recipe_variant_save', { original_recipe_id: original.id, recipe: recipe('Rice with herbs') });
  assert.equal(call('recipe_memory', { id: first.id }).preferred_recipe.id, second.record.id);
  assert.equal(call('recipe_memory', { id: first.id }).latest.data.next_time, 'Use the wide pan.');
  assert.equal(call('kooks_get', { kind: 'recipe', id: original.id }).record.data.title, 'Rice bowl');
  assert.equal(first.data.original_text, original.data.original_text);
  call('history_undo', { action_id: second.action_id });
  assert.equal(call('recipe_memory', { id: original.id }).preferred_recipe.id, first.id);
  assert.throws(() => call('recipe_variant_save', { original_recipe_id: first.id, recipe: recipe('Nested') }), code('INVALID_VARIANT'));
  assert.throws(() => call('record_archive', { kind: 'recipe', id: original.id, expected_version: original.version, archived: true }), code('ARCHIVED'));
});

test('leftover allocations cap portions, survive changes to source recipes, and never create groceries', t => {
  const { call } = setup(t);
  const r = call('recipe_save', { recipe: recipe() }).record;
  let b = call('batch_create', { recipe_id: r.id, portions: 6, cooked_on: '2026-09-19' }).record;
  b = call('batch_allocate', { id: b.id, expected_version: b.version, allocation: { portions: 2, date: '2026-09-19', status: 'eaten' } }).record;
  const lunch = call('batch_allocate', { id: b.id, expected_version: b.version, allocation: { portions: 2, date: '2026-09-20', slot: 'Lunch' } }); b = lunch.record;
  assert.equal(b.available_portions, 2);
  assert.equal(b.remaining_portions, 4);
  assert.throws(() => call('batch_allocate', { id: b.id, expected_version: b.version, allocation: { portions: 3, storage: 'freezer' } }), code('INSUFFICIENT_PORTIONS'));
  assert.throws(() => call('batch_allocate', { id: b.id, expected_version: 1, allocation: { portions: 1 } }), code('STALE_VERSION'));
  assert.throws(() => call('batch_allocate', { id: b.id, expected_version: b.version, allocation: { portions: 1, date: '2026-09-18' } }), code('INVALID_DATE'));
  call('recipe_save', { id: r.id, expected_version: r.version, recipe: recipe('Changed') });
  const saved = call('batch_list').records[0];
  assert.equal(saved.data.dish.title, 'Rice bowl');
  assert.equal(saved.data.dish.ingredients[0].quantity, 1500);
  assert.equal(call('kooks_status').counts.shopping, 0);
  const { id, ...allocation } = saved.data.allocations.find(a => a.id === lunch.allocation_id);
  b = call('batch_allocate', { id: b.id, expected_version: b.version, allocation_id: id, allocation: { ...allocation, status: 'eaten' } }).record;
  assert.equal(b.remaining_portions, 2);
  assert.equal(b.available_portions, 2);
});

test('shared tasks and timer owners use session versions and finish before creating a linked cooked batch', t => {
  const { call } = setup(t);
  const r = call('recipe_save', { recipe: recipe() }).record;
  const member = call('member_save', { member: { name: 'Jo' } }).record;
  let s = call('cooking_start', { source: { kind: 'recipe', id: r.id } }).record;
  const task = call('cooking_task_save', { id: s.id, expected_version: s.version, task: { text: 'Rinse rice', dish_id: 'dish-1', step_index: 0, member_id: member.id } });
  assert.throws(() => call('cooking_task_save', { id: s.id, expected_version: s.version, task: { text: 'Stale task' } }), code('STALE_VERSION'));
  s = task.record;
  s = call('cooking_timer', { id: s.id, expected_version: s.version, label: 'Rice', duration_seconds: 300, dish_id: 'dish-1', member_id: member.id }).record;
  assert.equal(s.data.tasks[0].member_id, member.id);
  assert.equal(s.data.timers[0].member_id, member.id);
  assert.throws(() => call('batch_create', { recipe_id: r.id, portions: 2, cooked_on: '2026-09-19', session_id: s.id, dish_id: 'dish-1' }), code('SESSION_ACTIVE'));
  s = call('cooking_finish', { id: s.id, expected_version: s.version }).record;
  call('recipe_save', { id: r.id, expected_version: r.version, recipe: recipe('Edited after dinner') });
  const args = { recipe_id: r.id, portions: 2, cooked_on: '2026-09-19', session_id: s.id, dish_id: 'dish-1' };
  assert.equal(call('batch_create', args).record.data.title, 'Rice bowl');
  assert.throws(() => call('batch_create', args), code('DUPLICATE_BATCH'));
  assert.throws(() => call('cooking_task_save', { id: s.id, expected_version: s.version, task: { text: 'Too late' } }), code('SESSION_FINISHED'));
});

test('costs use compatible dated prices, keep unknown totals incomplete, and count leftover meals zero additional times', t => {
  const { call } = setup(t);
  const r = call('recipe_save', { recipe: recipe() }).record;
  const source = { kind: 'recipe', id: r.id };
  const usd = { name: 'Rice', package_quantity: 1, unit: 'kg', price: 4, currency: 'USD', purchased_on: '2026-09-14' };
  call('price_save', { price: usd });
  call('price_save', { price: { ...usd, price: 400, currency: 'EUR' } });
  call('price_save', { price: { ...usd, price: 40, purchased_on: '2026-10-01' } });
  const args = { source, currency: 'USD', as_of: '2026-09-19' };
  assert.equal(call('cost_estimate', args).total, 2);
  assert.equal(call('cost_estimate', args).dishes[0].per_portion, 1);
  assert.equal(call('cost_estimate', { ...args, source: { ...source, servings: 3 } }).total, 3);
  assert.equal(call('cost_estimate', { ...args, currency: 'ILS' }).total, null);
  assert.equal(call('cost_estimate', { ...args, as_of: '2026-01-01' }).complete, false);
  call('plan_save', { source, date: '2026-09-19' });
  call('plan_save', { source, date: '2026-09-20' });
  call('budget_save', { budget: { week_start: '2026-09-14', currency: 'USD', amount: 10 } });
  const batch = call('batch_create', { recipe_id: r.id, portions: 6, cooked_on: '2026-09-19' }).record;
  call('batch_allocate', { id: batch.id, expected_version: batch.version, allocation: { portions: 2, date: '2026-09-20' } });
  const week = call('cost_week', { week_start: '2026-09-14', currency: 'USD', as_of: '2026-09-19' });
  assert.equal(week.total, 4); assert.equal(week.remaining, 6); assert.equal(week.leftovers.length, 1);
  const unknown = call('recipe_save', { recipe: recipe('Unknown amount', { ingredients: [{ name: 'Rice', quantity: null, unit: 'g' }] }) }).record;
  assert.equal(call('cost_estimate', { ...args, source: { kind: 'recipe', id: unknown.id } }).total, null);
  assert.throws(() => call('budget_save', { budget: { week_start: '2026-09-15', currency: 'USD', amount: 10 } }), code('INVALID_WEEK'));
  assert.throws(() => call('budget_save', { budget: { week_start: '2026-09-14', currency: 'USD', amount: 10 } }), code('DUPLICATE_BUDGET'));
});

test('recipe drafts require review, preserve source wording and ambiguous units, and commit once', t => {
  const { call } = setup(t);
  const text = 'Family bread\nServes 4\nIngredients\n1½ cups flour\n1/2 tsp salt\nWater as needed\nMethod\n1. Mix.\n2. Bake.';
  const parsed = extractRecipe(text);
  assert.equal(parsed.recipe.ingredients[0].quantity, 1.5);
  assert.equal(parsed.recipe.ingredients[0].unit, 'cup');
  assert.equal(parsed.recipe.ingredients[2].quantity, null);
  assert.ok(parsed.warnings.some(w => w.includes('conventions')));
  assert.equal(parseIngredient('1/0 cup nonsense').quantity, null);
  const draft = call('recipe_import_text', { text }).record;
  const args = { id: draft.id, expected_version: draft.version, recipe: { ...draft.data.recipe, title: 'Our bread' } };
  assert.throws(() => call('recipe_import_commit', { ...args, reviewed: false }));
  assert.equal(call('kooks_status').counts.recipe, 0);
  const saved = call('recipe_import_commit', { ...args, reviewed: true });
  assert.equal(saved.record.data.original_text, text);
  assert.equal(saved.record.data.title, 'Our bread');
  assert.throws(() => call('recipe_import_commit', { ...args, expected_version: 2, reviewed: true }), code('ALREADY_IMPORTED'));
  assert.equal(call('kooks_status').counts.recipe, 1);
  assert.equal(extractRecipe('Unstructured family note').recipe.servings, null);
  assert.throws(() => imageBytes({ mime_type: 'image/png', base64: Buffer.from('not an image').toString('base64') }), code('INVALID_IMAGE'));
  assert.throws(() => call('recipe_save', { recipe: { title: 'Unsafe source', source_url: 'javascript:alert(1)' } }));
});

test('portable backups round-trip new data and still accept legacy version-one exports', t => {
  const { call } = setup(t);
  const r = call('recipe_save', { recipe: recipe() }).record;
  call('pantry_save', { pantry: { name: 'Rice', use_soon: true } });
  const m = call('member_save', { member: { name: 'Taylor' } }).record;
  call('price_save', { price: { name: 'Rice', package_quantity: 1, unit: 'kg', price: 4, currency: 'USD', purchased_on: '2026-09-19' } });
  call('budget_save', { budget: { week_start: '2026-09-14', currency: 'USD', amount: 20 } });
  call('batch_create', { recipe_id: r.id, portions: 4, cooked_on: '2026-09-19' });
  call('recipe_variant_save', { original_recipe_id: r.id, recipe: recipe('My rice') });
  call('recipe_import_text', { text: 'A pending draft' });
  call('note_save', { recipe_id: r.id, text: 'Good.', rating: 4, next_time: 'Repeat.' });
  let s = call('cooking_start', { source: { kind: 'recipe', id: r.id } }).record;
  s = call('cooking_task_save', { id: s.id, expected_version: s.version, task: { text: 'Cook', member_id: m.id } }).record;
  call('cooking_timer', { id: s.id, expected_version: s.version, label: 'Rice', duration_seconds: 60, member_id: m.id });
  const backup = call('backup_export').backup;
  assert.equal(backup.schema_version, 2);
  const target = setup(t); target.call('backup_restore', { backup });
  assert.deepEqual(target.call('backup_export').backup.records, backup.records);
  const legacy = { ...backup, schema_version: 1, records: backup.records.filter(r => r.kind === 'recipe' && !r.data.original_recipe_id).map(r => { const { active_minutes, total_minutes, pan_count, cleanup, spice_level, ...data } = r.data; return { ...r, data }; }) };
  const old = setup(t); old.call('backup_restore', { backup: legacy });
  assert.equal(old.call('kooks_status').counts.recipe, 1);
  const broken = structuredClone(backup); broken.records.find(r => r.kind === 'batch').data.allocations = [{ id: 'bad', portions: 100, date: null, slot: 'Lunch', storage: 'fridge', status: 'reserved', notes: '' }];
  const empty = setup(t); assert.throws(() => empty.call('backup_restore', { backup: broken }), code('INSUFFICIENT_PORTIONS'));
  assert.equal(empty.call('kooks_status').counts.recipe, 0);
});
