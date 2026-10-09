import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../mcp/store.js';
import { createTools } from '../mcp/tools.js';

test('real local OCR retains the image, produces a reviewable recipe and survives backup restore', {
  skip: process.env.KOOKS_TEST_OCR !== '1' ? 'Run with KOOKS_TEST_OCR=1 and a local OCR engine.' : false,
  timeout: 130000,
}, async t => {
  const store = new Store(':memory:'); const target = new Store(':memory:');
  t.after(() => { store.close(); target.close(); });
  const tools = new Map(createTools(store).map(t => [t.name, t]));
  const image = { name: 'recipe.png', mime_type: 'image/png', base64: readFileSync(new URL('./fixtures/recipe.png', import.meta.url)).toString('base64') };
  const result = await tools.get('recipe_import_image').execute({ request_id: 'photo-import', image });
  assert.match(result.record.data.original_text, /Lemon rice/);
  assert.equal(result.record.data.recipe.servings, 4);
  assert.equal(result.record.data.recipe.ingredients[0].quantity, 250);
  assert.equal(store.list('recipe').length, 0);
  const saved = tools.get('recipe_import_commit').execute({ request_id: 'commit-photo', id: result.record.id, expected_version: 1, reviewed: true, recipe: result.record.data.recipe });
  assert.deepEqual(saved.record.data.source_image_ids, [result.image_id]);
  assert.equal(store.get('asset', result.image_id).data.base64, image.base64);
  const backup = tools.get('backup_export').execute({}).backup;
  const restore = createTools(target).find(t => t.name === 'backup_restore');
  restore.execute({ request_id: 'restore-photo', backup });
  assert.equal(target.get('asset', result.image_id).data.base64, image.base64);
  assert.equal(target.get('recipe', saved.record.id).data.original_text, result.record.data.original_text);
});
