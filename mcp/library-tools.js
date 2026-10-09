import * as s from "./schemas.js";
import * as l from "./library-schemas.js";
import { fileBytes } from "./library.js";

export function addLibraryTools(tool, store, kooks) {
  tool(
    "asset_save",
    "Store a file for the household: a photo (PNG, JPEG or WebP up to 8 MB) or an ebook (PDF or EPUB up to 64 MB) as base64. Returns the asset id with its type, SHA-256 and size; bytes are immutable and this server never fetches, reads or summarizes them. Use the id in book_save (file_id, cover_id), technique_save or inspiration_save (photo_ids). kooks_get returns an asset with its bytes, so avoid reading ebooks back through MCP.",
    { ...s.write, file: l.file },
    false,
    (args) => {
      fileBytes(args.file);
      return { record: store.put("asset", args.file) };
    },
  );
  tool(
    "technique_save",
    "Create or replace a cooking technique: a summary, ordered steps, tips, tags, links and videos that show it, photos, and the recipes that use it. Read before editing and carry the fields you are not changing. Links are stored, never fetched.",
    { ...s.save, technique: l.technique },
    false,
    (args) => ({ record: kooks.save("technique", args, args.technique) }),
  );
  tool(
    "inspiration_save",
    "Create or replace an idea on the inspiration board: something seen, tasted or read that the household wants to try, with notes, where it came from, links and videos, photos and tags. status is idea or tried; set recipe_id once the idea is written up as a recipe. Links are stored, never fetched.",
    { ...s.save, inspiration: l.inspiration },
    false,
    (args) => ({ record: kooks.save("inspiration", args, args.inspiration) }),
  );
  tool(
    "book_save",
    "Add or edit an ebook on the household shelf: title, author, notes, tags, page bookmarks and the recipes written up from it. file_id is the PDF or EPUB asset from asset_save; cover_id is an optional image asset. The file is kept locally and is not read by this server.",
    { ...s.save, book: l.book },
    false,
    (args) => ({ record: kooks.save("book", args, args.book) }),
  );
}
