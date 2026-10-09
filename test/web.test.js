import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../mcp/store.js';
import { createWebServer } from '../web/server.js';
import http from 'node:http';

async function setup(t, accessToken = '') {
  const store = new Store(':memory:');
  const server = createWebServer({ store, accessToken });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, post(path, input, extra = {}) { return fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...extra }, body: JSON.stringify(input) }); } };
}
test('browser API shares persistent actions, reports revisions and rejects stale writes and cross-site posts', async t => {
  const { origin, post } = await setup(t);
  const page = await fetch(origin); assert.equal(page.status, 200); assert.match(await page.text(), /Your everyday kitchen/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const initial = await (await fetch(`${origin}/api/state`)).json();
  const response = await post('/api/tools/recipe_save', { request_id: 'http-create', recipe: { title: 'Shared rice', servings: 2 } });
  assert.equal(response.status, 200); const saved = await response.json();
  const next = await (await fetch(`${origin}/api/state?revision=${initial.revision}`)).json();
  assert.equal(next.records.recipe[0].id, saved.record.id); assert.notEqual(next.revision, initial.revision);
  const unchanged = await (await fetch(`${origin}/api/state?revision=${next.revision}`)).json(); assert.equal(unchanged.unchanged, true);
  const stale = await post('/api/tools/recipe_save', { request_id: 'stale', id: saved.record.id, expected_version: 999, recipe: { title: 'Overwritten' } });
  assert.equal(stale.status, 409);
  const rejected = await post('/api/tools/recipe_save', { request_id: 'cross-site', recipe: { title: 'Unwanted' } }, { Origin: 'https://outside.example' });
  assert.equal(rejected.status, 403);
  // Fetch normalizes Host; use the HTTP client to exercise an actual rebinding request.
  const badHost = await new Promise((resolve, reject) => { const req = http.get(`${origin}/api/state`, { headers: { Host: 'outside.example' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); }); assert.equal(badHost, 403);
  const final = await (await fetch(`${origin}/api/state`)).json(); assert.equal(final.records.recipe.length, 1);
});
test('optional household access key protects records and issues a scoped browser session', async t => {
  const { origin, post } = await setup(t, 'a-long-household-access-key-for-tests');
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await post('/api/login', { token: 'wrong' })).status, 401);
  const login = await post('/api/login', { token: 'a-long-household-access-key-for-tests' }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
  const isolated = new Store(':memory:');
  try { assert.throws(() => createWebServer({ store: isolated, host: '0.0.0.0' }), /access_token/i); }
  finally { isolated.close(); }
});
