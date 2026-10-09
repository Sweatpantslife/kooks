import { requireThat } from "./store.js";
import { imageBytes } from "./imports.js";
import { bookTypes, imageTypes, MAX_BOOK_BYTES } from "./library-schemas.js";

export const isImageType = (mimeType) => imageTypes.includes(mimeType);
export const isBookType = (mimeType) => bookTypes.includes(mimeType);

// The header belongs at offset zero; a few writers put some bytes before it.
const looksLikePdf = (bytes) =>
  bytes.subarray(0, 1024).indexOf("%PDF-", 0, "latin1") >= 0;
// An EPUB is a ZIP archive whose first entry, stored uncompressed, is a file
// named mimetype holding this value.
const looksLikeEpub = (bytes) =>
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 3 &&
  bytes[3] === 4 &&
  bytes.subarray(0, 65536).indexOf("application/epub+zip", 0, "latin1") >= 0;
const signatures = {
  "application/pdf": looksLikePdf,
  "application/epub+zip": looksLikeEpub,
};

// Decode and check an uploaded file: photos through the image rules, ebooks
// by their own signatures and the larger size limit. Returns the bytes.
export function fileBytes(file) {
  if (isImageType(file.mime_type)) return imageBytes(file);
  requireThat(
    /^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) && file.base64.length % 4 === 0,
    "INVALID_FILE",
    "File data must be valid base64.",
  );
  const bytes = Buffer.from(file.base64, "base64");
  requireThat(
    bytes.length > 0 && bytes.length <= MAX_BOOK_BYTES,
    "FILE_TOO_LARGE",
    "Choose an ebook smaller than 64 MB.",
  );
  requireThat(
    signatures[file.mime_type]?.(bytes),
    "INVALID_FILE",
    "File contents do not match the selected ebook type.",
  );
  return bytes;
}

// Every reference a technique, idea or book makes must point at a record of
// the right kind. Archived recipes and assets stay valid targets, as they do
// for recipe photos, so archiving never has to cascade.
export function validateLibraryRelations(store) {
  const unique = (ids, code, message) =>
    requireThat(new Set(ids).size === ids.length, code, message);
  const asset = (id, accept, code, message) =>
    requireThat(
      accept(store.get("asset", id, true).data.mime_type),
      code,
      message,
    );
  for (const record of store.list("technique")) {
    unique(
      record.data.recipe_ids,
      "INVALID_TECHNIQUE",
      "List each recipe once.",
    );
    for (const id of record.data.recipe_ids) store.get("recipe", id, true);
    for (const id of record.data.photo_ids)
      asset(
        id,
        isImageType,
        "INVALID_TECHNIQUE",
        "Technique photos must be images.",
      );
  }
  for (const record of store.list("inspiration")) {
    if (record.data.recipe_id) store.get("recipe", record.data.recipe_id, true);
    for (const id of record.data.photo_ids)
      asset(
        id,
        isImageType,
        "INVALID_INSPIRATION",
        "Idea photos must be images.",
      );
  }
  for (const record of store.list("book")) {
    asset(
      record.data.file_id,
      isBookType,
      "INVALID_BOOK",
      "A book’s file must be a PDF or EPUB asset.",
    );
    if (record.data.cover_id)
      asset(
        record.data.cover_id,
        isImageType,
        "INVALID_BOOK",
        "A book cover must be an image.",
      );
    unique(record.data.recipe_ids, "INVALID_BOOK", "List each recipe once.");
    for (const id of record.data.recipe_ids) store.get("recipe", id, true);
  }
}
