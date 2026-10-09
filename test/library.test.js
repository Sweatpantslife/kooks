import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { fileBytes } from "../mcp/library.js";

const png = readFileSync(new URL("./fixtures/recipe.png", import.meta.url));
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
// The smallest EPUB shape: a ZIP whose first, stored entry is the mimetype
// file. Nothing reads further than that header.
const epub = Buffer.concat([
  Buffer.from([0x50, 0x4b, 3, 4, 10, 0, 0, 0, 0, 0]),
  Buffer.alloc(16),
  Buffer.from([20, 0, 0, 0, 20, 0, 0, 0, 8, 0, 0, 0]),
  Buffer.from("mimetypeapplication/epub+zip"),
]);
const file = (name, mime_type, bytes) => ({
  name,
  mime_type,
  base64: bytes.toString("base64"),
});
const code = (expected) => (error) => error.code === expected;

function setup(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const tools = new Map(createTools(store).map((t) => [t.name, t]));
  let n = 0;
  return {
    store,
    call(name, input = {}) {
      const tool = tools.get(name);
      return tool.execute({
        ...(!tool.readOnly ? { request_id: `library-${++n}` } : {}),
        ...input,
      });
    },
  };
}
const recipe = (title) => ({
  title,
  servings: 2,
  ingredients: [{ name: "Rice", quantity: 500, unit: "g" }],
  steps: [{ text: "Cook the rice." }],
});

test("uploaded files are checked by type and size, stored once and listed without their bytes", (t) => {
  const { call } = setup(t);
  const stored = call("asset_save", {
    file: file("Family cookbook.pdf", "application/pdf", pdf),
  }).record;
  assert.equal(stored.data.base64, undefined);
  assert.equal(stored.data.mime_type, "application/pdf");
  assert.equal(stored.data.byte_length, pdf.length);
  assert.match(stored.data.sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    call("asset_save", {
      file: file("novel.epub", "application/epub+zip", epub),
    }).record.data.byte_length,
    epub.length,
  );
  assert.equal(
    call("asset_save", { file: file("photo.png", "image/png", png) }).record
      .data.mime_type,
    "image/png",
  );
  assert.equal(call("kooks_list", { kind: "asset" }).total, 3);
  assert.equal(
    call("kooks_get", { kind: "asset", id: stored.id }).record.data.base64,
    pdf.toString("base64"),
  );
  for (const [bad, expected] of [
    [file("not.pdf", "application/pdf", png), "INVALID_FILE"],
    [
      file("not.epub", "application/epub+zip", Buffer.from("just text")),
      "INVALID_FILE",
    ],
    [file("not.png", "image/png", pdf), "INVALID_IMAGE"],
    [
      { name: "x.pdf", mime_type: "application/pdf", base64: "%%%%" },
      "INVALID_FILE",
    ],
  ])
    assert.throws(() => call("asset_save", { file: bad }), code(expected));
  assert.throws(() =>
    call("asset_save", { file: file("notes.txt", "text/plain", pdf) }),
  );
  const huge = Buffer.alloc(64 * 1024 * 1024 + 1, 0x20);
  huge.write("%PDF-1.4");
  assert.throws(
    () => fileBytes(file("huge.pdf", "application/pdf", huge)),
    code("FILE_TOO_LARGE"),
  );
});

test("techniques keep steps, links, photos and the recipes they belong to, and reject unknown references", (t) => {
  const { call } = setup(t);
  const r = call("recipe_save", { recipe: recipe("Seared rice") }).record;
  const photo = call("asset_save", {
    file: file("crust.png", "image/png", png),
  }).record;
  const book = call("asset_save", {
    file: file("book.pdf", "application/pdf", pdf),
  }).record;
  const saved = call("technique_save", {
    technique: {
      title: "Reverse sear",
      summary: "Low oven first, hard sear last.",
      steps: [{ text: "Oven at 120 °C." }, { text: "Sear." }],
      tags: ["Meat"],
      links: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "Watch it" }],
      photo_ids: [photo.id],
      recipe_ids: [r.id],
    },
  }).record;
  assert.equal(saved.data.tips, "");
  assert.deepEqual(saved.data.links[0], {
    url: "https://youtu.be/dQw4w9WgXcQ",
    title: "Watch it",
  });
  assert.deepEqual(
    call("technique_save", { technique: { title: "Bare" } }).record.data,
    {
      title: "Bare",
      summary: "",
      steps: [],
      tips: "",
      tags: [],
      links: [],
      photo_ids: [],
      recipe_ids: [],
    },
  );
  assert.throws(() =>
    call("technique_save", {
      technique: { title: "Bad link", links: [{ url: "javascript:alert(1)" }] },
    }),
  );
  assert.throws(
    () =>
      call("technique_save", {
        technique: { title: "Missing recipe", recipe_ids: ["nope"] },
      }),
    code("NOT_FOUND"),
  );
  assert.throws(
    () =>
      call("technique_save", {
        technique: { title: "Not a photo", photo_ids: [book.id] },
      }),
    code("INVALID_TECHNIQUE"),
  );
  assert.throws(
    () =>
      call("technique_save", {
        technique: { title: "Twice", recipe_ids: [r.id, r.id] },
      }),
    code("INVALID_TECHNIQUE"),
  );
  assert.equal(
    call("kooks_list", { kind: "technique", query: "hard sear" }).records[0]
      .title,
    "Reverse sear",
  );
  // The recipe can be archived while a technique still points at it.
  call("record_archive", {
    kind: "recipe",
    id: r.id,
    expected_version: r.version,
    archived: true,
  });
  const edited = call("technique_save", {
    id: saved.id,
    expected_version: saved.version,
    technique: { ...saved.data, tips: "Dry the surface first." },
  });
  assert.equal(edited.record.data.tips, "Dry the surface first.");
  call("history_undo", { action_id: edited.action_id });
  assert.equal(
    call("kooks_get", { kind: "technique", id: saved.id }).record.data.tips,
    "",
  );
  assert.throws(
    () =>
      call("technique_save", {
        id: saved.id,
        expected_version: 1,
        technique: saved.data,
      }),
    code("STALE_VERSION"),
  );
});

test("ideas move from wanting to try, to tried, to a written-up recipe", (t) => {
  const { call } = setup(t);
  const idea = call("inspiration_save", {
    inspiration: {
      title: "Crispy chickpea bowls",
      source: "Noa’s dinner",
      links: [{ url: "https://www.instagram.com/reel/C1abcdefg/" }],
    },
  }).record;
  assert.equal(idea.data.status, "idea");
  assert.equal(idea.data.recipe_id, null);
  assert.deepEqual(idea.data.photo_ids, []);
  assert.throws(() =>
    call("inspiration_save", { inspiration: { title: "Bad", status: "done" } }),
  );
  assert.throws(
    () =>
      call("inspiration_save", {
        inspiration: { title: "Bad", recipe_id: "nope" },
      }),
    code("NOT_FOUND"),
  );
  const tried = call("inspiration_save", {
    id: idea.id,
    expected_version: idea.version,
    inspiration: { ...idea.data, status: "tried" },
  }).record;
  assert.equal(
    call("kooks_list", { kind: "inspiration" }).records[0].status,
    "tried",
  );
  const r = call("recipe_save", {
    recipe: recipe("Crispy chickpea bowls"),
  }).record;
  const written = call("inspiration_save", {
    id: idea.id,
    expected_version: tried.version,
    inspiration: { ...tried.data, recipe_id: r.id },
  }).record;
  assert.equal(written.data.recipe_id, r.id);
  assert.equal(written.data.source, "Noa’s dinner");
  assert.equal(call("kooks_status").counts.inspiration, 1);
});

test("books need an ebook file, an image cover and known recipes, and keep page bookmarks", (t) => {
  const { call } = setup(t);
  const r = call("recipe_save", { recipe: recipe("Grandma’s rice") }).record;
  const pdfAsset = call("asset_save", {
    file: file("family.pdf", "application/pdf", pdf),
  }).record;
  const cover = call("asset_save", {
    file: file("cover.png", "image/png", png),
  }).record;
  assert.throws(
    () =>
      call("book_save", {
        book: { title: "Not a book", file_id: cover.id },
      }),
    code("INVALID_BOOK"),
  );
  assert.throws(
    () =>
      call("book_save", {
        book: {
          title: "Bad cover",
          file_id: pdfAsset.id,
          cover_id: pdfAsset.id,
        },
      }),
    code("INVALID_BOOK"),
  );
  assert.throws(
    () => call("book_save", { book: { title: "No file", file_id: "nope" } }),
    code("NOT_FOUND"),
  );
  assert.throws(
    () =>
      call("book_save", {
        book: {
          title: "Unknown recipe",
          file_id: pdfAsset.id,
          recipe_ids: ["x"],
        },
      }),
    code("NOT_FOUND"),
  );
  assert.throws(() =>
    call("book_save", {
      book: {
        title: "Bad page",
        file_id: pdfAsset.id,
        bookmarks: [{ label: "Nowhere", page: 0 }],
      },
    }),
  );
  const book = call("book_save", {
    book: {
      title: "Family cookbook",
      author: "Grandma",
      file_id: pdfAsset.id,
      cover_id: cover.id,
      bookmarks: [{ label: "The braise", page: 12 }, { label: "Sweets" }],
      recipe_ids: [r.id],
    },
  }).record;
  assert.deepEqual(book.data.bookmarks[1], { label: "Sweets", page: null });
  assert.equal(book.data.notes, "");
  const edited = call("book_save", {
    id: book.id,
    expected_version: book.version,
    book: { ...book.data, bookmarks: book.data.bookmarks.slice(1) },
  }).record;
  assert.equal(edited.data.bookmarks.length, 1);
  assert.equal(edited.data.cover_id, cover.id);
  const status = call("kooks_status");
  assert.equal(status.counts.book, 1);
  for (const capability of ["techniques", "inspiration_board", "ebook_library"])
    assert.ok(status.capabilities.includes(capability));
  const archived = call("record_archive", {
    kind: "book",
    id: book.id,
    expected_version: edited.version,
    archived: true,
  });
  assert.equal(archived.record.archived, true);
  assert.equal(call("kooks_list", { kind: "book" }).total, 0);
  // The file is still served to anyone holding the id; only the shelf entry is gone.
  assert.equal(
    call("kooks_get", { kind: "asset", id: pdfAsset.id }).record.data.name,
    "family.pdf",
  );
});

test("techniques, ideas and the shelf survive a backup with their files, and restore rejects missing ones", (t) => {
  const { call } = setup(t);
  const r = call("recipe_save", { recipe: recipe("Rice") }).record;
  const pdfAsset = call("asset_save", {
    file: file("family.pdf", "application/pdf", pdf),
  }).record;
  const photo = call("asset_save", {
    file: file("shot.png", "image/png", png),
  }).record;
  call("technique_save", {
    technique: { title: "Folding", photo_ids: [photo.id], recipe_ids: [r.id] },
  });
  call("inspiration_save", {
    inspiration: { title: "Idea", recipe_id: r.id, photo_ids: [photo.id] },
  });
  const book = call("book_save", {
    book: {
      title: "Family cookbook",
      file_id: pdfAsset.id,
      bookmarks: [{ label: "The braise", page: 12 }],
      recipe_ids: [r.id],
    },
  }).record;
  const backup = call("backup_export").backup;
  assert.equal(
    backup.records.find((x) => x.kind === "asset" && x.id === pdfAsset.id).data
      .base64,
    pdf.toString("base64"),
  );
  const target = setup(t);
  target.call("backup_restore", { backup });
  assert.deepEqual(target.call("backup_export").backup.records, backup.records);
  assert.ok(target.store.blob("asset", pdfAsset.id).equals(pdf));
  assert.equal(
    target.call("kooks_get", { kind: "book", id: book.id }).record.data
      .bookmarks[0].page,
    12,
  );
  const missingFile = structuredClone(backup);
  missingFile.records = missingFile.records.filter(
    (x) => !(x.kind === "asset" && x.id === pdfAsset.id),
  );
  assert.throws(
    () => setup(t).call("backup_restore", { backup: missingFile }),
    code("INVALID_BACKUP"),
  );
  const wrongFile = structuredClone(backup);
  wrongFile.records.find((x) => x.kind === "book").data.file_id = photo.id;
  const empty = setup(t);
  assert.throws(
    () => empty.call("backup_restore", { backup: wrongFile }),
    code("INVALID_BOOK"),
  );
  assert.equal(empty.call("kooks_status").counts.book, 0);
  const missingRecipe = structuredClone(backup);
  missingRecipe.records.find((x) => x.kind === "inspiration").data.recipe_id =
    "nope";
  assert.throws(
    () => setup(t).call("backup_restore", { backup: missingRecipe }),
    code("INVALID_BACKUP"),
  );
});
