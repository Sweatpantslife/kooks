import { z } from "zod";
import * as s from "./schemas.js";

// What a household keeps beside its recipes: how-to knowledge, ideas worth
// trying, and the cookbooks on its shelf. Files of every kind live in the
// asset table; these records only reference them by id.
export const imageTypes = ["image/png", "image/jpeg", "image/webp"];
export const bookTypes = ["application/pdf", "application/epub+zip"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_BOOK_BYTES = 64 * 1024 * 1024;

// A photo or an ebook as base64. The string bound follows the byte limit of
// the largest kind; the exact limit per kind is checked on the decoded bytes.
export const file = z.object({
  name: s.text,
  mime_type: z.enum([...imageTypes, ...bookTypes]),
  base64: z.string().min(4).max(89500000),
});

const tags = z.array(s.text).max(100).default([]);
const links = z
  .array(s.link)
  .max(50)
  .default([])
  .describe(
    "Pages and videos. The household apps embed YouTube, Vimeo, Facebook, Instagram and TikTok players and open other links in the browser; the server never fetches them.",
  );
const photoIds = z
  .array(s.id)
  .max(20)
  .default([])
  .describe("Image assets stored with asset_save.");
const recipeIds = z.array(s.id).max(500).default([]);

export const technique = z.object({
  title: s.text,
  summary: z.string().max(30000).default(""),
  steps: z
    .array(z.object({ text: z.string().trim().min(1).max(10000) }))
    .max(200)
    .default([]),
  tips: z.string().max(30000).default(""),
  tags,
  links,
  photo_ids: photoIds,
  recipe_ids: recipeIds.describe("Recipes that use this technique."),
});

export const inspiration = z.object({
  title: s.text,
  notes: z.string().max(30000).default(""),
  source: z
    .string()
    .trim()
    .max(500)
    .default("")
    .describe(
      "Where the idea came from, in words: a restaurant, a friend, a newsletter.",
    ),
  tags,
  links,
  photo_ids: photoIds,
  status: z.enum(["idea", "tried"]).default("idea"),
  recipe_id: s.id
    .nullable()
    .default(null)
    .describe("The recipe this idea became once it was written up."),
});

export const bookmark = z.object({
  label: s.text,
  page: z.number().int().positive().max(100000).nullable().default(null),
});

export const book = z.object({
  title: s.text,
  author: z.string().trim().max(500).default(""),
  file_id: s.id.describe("The PDF or EPUB asset stored with asset_save."),
  cover_id: s.id
    .nullable()
    .default(null)
    .describe("An optional image asset for the cover."),
  notes: z.string().max(30000).default(""),
  tags,
  bookmarks: z.array(bookmark).max(500).default([]),
  recipe_ids: recipeIds.describe("Recipes written up from this book."),
});
