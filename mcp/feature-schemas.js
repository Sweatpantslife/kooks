import { z } from 'zod';
import * as s from './schemas.js';

export const pantry = s.ingredient.extend({ available: z.boolean().default(true), use_soon: z.boolean().default(false), notes: z.string().max(3000).default('') });
export const member = z.object({
  name: s.text,
  likes: z.array(s.text).max(100).default([]),
  dislikes: z.array(s.text).max(100).default([]),
  spice_tolerance: z.number().int().min(0).max(3).nullable().default(null),
  notes: z.string().max(3000).default(''),
});
export const currency = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, such as USD, EUR or ILS.');
export const price = z.object({
  name: s.text, preparation: z.string().trim().max(500).default(''),
  package_quantity: s.servings, unit: z.string().trim().max(80),
  price: z.number().nonnegative().max(1e9), currency,
  purchased_on: s.date, source: z.enum(['manual', 'receipt']).default('manual'),
  notes: z.string().max(3000).default(''),
});
export const budget = z.object({ week_start: s.date, currency, amount: z.number().nonnegative().max(1e9) });
export const allocation = z.object({
  id: s.id, portions: s.servings, date: s.date.nullable().default(null),
  slot: s.text.default('Lunch'), storage: z.enum(['fridge', 'freezer']).default('fridge'),
  status: z.enum(['reserved', 'eaten']).default('reserved'), notes: z.string().max(3000).default(''),
});
export const task = z.object({
  id: s.id, text: s.text, dish_id: s.id.nullable().default(null),
  step_index: z.number().int().nonnegative().nullable().default(null),
  member_id: s.id.nullable().default(null), completed: z.boolean().default(false),
});
export const noteExtras = {
  rating: z.number().int().min(1).max(5).nullable().optional(),
  cook_again: z.boolean().nullable().optional(),
  changes: z.string().max(10000).optional(),
  next_time: z.string().max(10000).optional(),
};
export const asset = z.object({
  name: s.text, mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  base64: z.string().min(4).max(11200000),
});
export const importDraft = z.object({
  title: s.text, original_text: s.recipe.shape.original_text, image_id: s.id.nullable(),
  recipe: s.recipe, warnings: z.array(z.string()).max(100),
  status: z.enum(['draft', 'saved']), recipe_id: s.id.nullable(),
});
