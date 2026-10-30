import { write } from "./api.js";

// Photos the server accepts, as the household server checks them again.
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const LIMIT = 8 * 1024 * 1024;

// A chosen photo as the tools take it. The browser's type is trusted when it
// names a supported kind; otherwise the file's extension decides.
export async function readImage(file) {
  const name = file.name.toLowerCase();
  const mime_type =
    file.type in IMAGE_TYPES
      ? file.type
      : (Object.keys(IMAGE_TYPES).find((type) =>
          name.endsWith(`.${IMAGE_TYPES[type]}`),
        ) ?? (name.endsWith(".jpeg") ? "image/jpeg" : null));
  if (!mime_type) throw new Error("Choose a PNG, JPEG or WebP photo.");
  if (!file.size || file.size > LIMIT)
    throw new Error("Choose a photo smaller than 8 MB.");
  return { name: file.name, mime_type, base64: await base64Of(file) };
}

const base64Of = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });

// Store a photo on the household server and return its id.
export async function uploadPhoto(file) {
  const { record } = await write("asset_save", {
    file: await readImage(file),
  });
  return record.id;
}

// A cookbook the household owns, as a PDF or an EPUB, the same way.
const BOOK_TYPES = { "application/pdf": "pdf", "application/epub+zip": "epub" };
const BOOK_LIMIT = 64 * 1024 * 1024;
export async function uploadBook(file) {
  const name = file.name.toLowerCase();
  const mime_type =
    file.type in BOOK_TYPES
      ? file.type
      : Object.keys(BOOK_TYPES).find((type) =>
          name.endsWith(`.${BOOK_TYPES[type]}`),
        );
  if (!mime_type) throw new Error("Choose a PDF or an EPUB file.");
  if (!file.size || file.size > BOOK_LIMIT)
    throw new Error("Choose a book smaller than 64 MB.");
  const { record } = await write("asset_save", {
    file: { name: file.name, mime_type, base64: await base64Of(file) },
  });
  return record.id;
}
