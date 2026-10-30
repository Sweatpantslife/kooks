import { useState } from "preact/hooks";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Check,
  ChefHat,
  Download,
  ExternalLink,
  PenLine,
  Pencil,
  Trash2,
  Upload,
} from "lucide";
import { formatLabels, parseLabels } from "../../../shared/taxonomy.js";
import { editedSteps, stepsText } from "../../../shared/ingredients.js";
import { formatLinkLines, parseLinkLines } from "../../../shared/links.js";
import { change, record } from "../lib/store.js";
import { leave } from "../lib/router.js";
import { uploadBook, uploadPhoto } from "../lib/files.js";
import { hrefOf } from "../lib/kitchen.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Field, FormError, hint, useDirty, useWork } from "../ui/form.jsx";
import { Icon } from "../ui/icon.jsx";
import { AssetImage, FileLink, assetPath } from "../ui/asset.jsx";
import { Art } from "../ui/tile.jsx";
import { MoreList, linkItems } from "../ui/more.jsx";
import { RecipePicker } from "../ui/recipe-picker.jsx";
import { showKind } from "./recipes.jsx";

const back = (href, label) => (
  <a class="back" href={href}>
    <Icon icon={ArrowLeft} />
    {label}
  </a>
);
const toRecipes = back("#/recipes", "Recipes");

const NOUNS = { inspiration: "idea", technique: "technique", book: "book" };

function Gone({ kind }) {
  return (
    <>
      {toRecipes}
      <PageHeader title="Not found" />
      <Empty icon={BookOpen} title={`That ${NOUNS[kind]} isn’t in the kitchen`}>
        It may have been removed, or the link is from another kitchen.
      </Empty>
    </>
  );
}

// Off the shelf with Undo, back to the Recipes tab showing its kind.
export function RemoveButton({ kind, item, label, done }) {
  const work = useWork();
  const remove = () =>
    work.run(async () => {
      await change(
        "record_archive",
        {
          kind,
          id: item.id,
          expected_version: item.version,
          archived: true,
        },
        { done },
      );
      showKind(kind);
      leave("recipes");
    });
  return (
    <>
      <button
        type="button"
        class="btn btn-quiet btn-danger"
        disabled={work.busy}
        onClick={remove}
      >
        <Icon icon={Trash2} />
        {label}
      </button>
      <FormError>{work.error}</FormError>
    </>
  );
}

function Photos({ ids, title }) {
  if (ids.length < 2) return null;
  return (
    <ul class="photos" role="list">
      {ids.slice(1).map((id, index) => (
        <li key={id}>
          <AssetImage
            id={id}
            alt={`${title}, photo ${index + 2}`}
            loading="lazy"
          />
        </li>
      ))}
    </ul>
  );
}

function Labels({ tags }) {
  if (!tags.length) return null;
  return (
    <ul class="labels" role="list">
      {tags.map((label) => (
        <li key={label} class="label">
          {label}
        </li>
      ))}
    </ul>
  );
}

const recipeItems = (ids, note) =>
  ids
    .map((id) => record("recipe", id))
    .filter(Boolean)
    .map((r) => ({ href: hrefOf("recipe", r.id), title: r.data.title, note }));

// ---------- Ideas to try ----------

export function IdeaPage({ id }) {
  const idea = record("inspiration", id);
  const work = useWork();
  if (!idea) return <Gone kind="inspiration" />;
  const d = idea.data;
  const made = d.recipe_id && record("recipe", d.recipe_id);
  const tried = () =>
    work.run(() =>
      change(
        "inspiration_save",
        {
          id,
          expected_version: idea.version,
          inspiration: {
            ...d,
            status: d.status === "tried" ? "idea" : "tried",
          },
        },
        {
          done:
            d.status === "tried"
              ? `${d.title} is back on your list to try.`
              : `${d.title} is marked as tried.`,
        },
      ),
    );
  return (
    <article class="recipe">
      {toRecipes}
      <Art kind="inspiration" data={d} class="art-hero" />
      <PageHeader
        eyebrow={d.source ? `From ${d.source}` : "An idea to try"}
        title={d.title}
      >
        <a class="btn" href={`${hrefOf("inspiration", id)}/edit`}>
          <Icon icon={Pencil} />
          Edit
        </a>
        {!made && (
          <button
            type="button"
            class="btn"
            aria-pressed={d.status === "tried" ? "true" : "false"}
            disabled={work.busy}
            onClick={tried}
          >
            <Icon icon={Check} />
            We tried it
          </button>
        )}
        {made ? (
          <a class="btn btn-primary" href={hrefOf("recipe", made.id)}>
            <Icon icon={BookOpen} />
            Open the recipe
          </a>
        ) : (
          <a
            class="btn btn-primary"
            href={`${hrefOf("inspiration", id)}/write`}
          >
            <Icon icon={PenLine} />
            Write it up as a recipe
          </a>
        )}
      </PageHeader>
      <FormError>{work.error}</FormError>
      <Labels tags={d.tags} />
      {d.notes && <p class="preline lede">{d.notes}</p>}
      <Photos ids={d.photo_ids} title={d.title} />
      <MoreList
        id="links"
        title="Links and videos"
        items={[
          ...(made ? recipeItems([made.id], "The recipe it became") : []),
          ...linkItems(d),
        ]}
      />
      <div class="row">
        <RemoveButton
          kind="inspiration"
          item={idea}
          label="Remove idea"
          done={`${d.title} is off your list.`}
        />
      </div>
    </article>
  );
}

// ---------- Techniques ----------

export function TechniquePage({ id }) {
  const t = record("technique", id);
  if (!t) return <Gone kind="technique" />;
  const d = t.data;
  return (
    <article class="recipe">
      {toRecipes}
      <Art kind="technique" data={d} class="art-hero" />
      <PageHeader eyebrow="Technique" title={d.title}>
        <a class="btn" href={`${hrefOf("technique", id)}/edit`}>
          <Icon icon={Pencil} />
          Edit
        </a>
      </PageHeader>
      <Labels tags={d.tags} />
      {d.summary && <p class="preline lede">{d.summary}</p>}
      <div class="recipe-columns">
        {d.steps.length > 0 && (
          <section class="card" aria-labelledby="how">
            <h2 id="how">How it’s done</h2>
            <ol class="steps">
              {d.steps.map((s, index) => (
                <li key={index}>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </section>
        )}
        {d.tips && (
          <aside class="last-time" aria-label="Tips">
            <p class="eyebrow">Tips and pitfalls</p>
            <p class="preline">{d.tips}</p>
          </aside>
        )}
      </div>
      <Photos ids={d.photo_ids} title={d.title} />
      <MoreList
        id="more"
        title="Where it’s used and shown"
        items={[...recipeItems(d.recipe_ids, "Uses it"), ...linkItems(d)]}
      />
      <div class="row">
        <RemoveButton
          kind="technique"
          item={t}
          label="Remove technique"
          done={`${d.title} is off your techniques.`}
        />
      </div>
    </article>
  );
}

// ---------- Books ----------

const FILE_LABELS = {
  "application/pdf": "PDF",
  "application/epub+zip": "EPUB",
};
const size = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Bookmarks({ book }) {
  const d = book.data;
  const [label, setLabel] = useState("");
  const [page, setPage] = useState("");
  const work = useWork();
  const file = record("asset", d.file_id)?.data;
  const pdf = file?.mime_type === "application/pdf";
  const save = (bookmarks, done) =>
    work.run(() =>
      change(
        "book_save",
        {
          id: book.id,
          expected_version: book.version,
          book: { ...d, bookmarks },
        },
        { done },
      ),
    );
  const add = (event) => {
    event.preventDefault();
    const mark = { label: label.trim(), page: page ? Number(page) : null };
    void save([...d.bookmarks, mark], `Bookmarked ${mark.label}.`).then(() => {
      setLabel("");
      setPage("");
    });
  };
  const href = assetPath(d.file_id);
  return (
    <section class="card" aria-labelledby="bookmarks">
      <h2 id="bookmarks">Bookmarks</h2>
      {d.bookmarks.length ? (
        <ul class="price-list" role="list">
          {d.bookmarks.map((mark, index) => (
            <li key={`${index}-${mark.label}`}>
              <span class="price-text">
                {pdf && mark.page ? (
                  <FileLink
                    class="link-button"
                    path={`${href}#page=${mark.page}`}
                    name={file.name || `${d.title}.pdf`}
                  >
                    <strong>{mark.label}</strong>
                  </FileLink>
                ) : (
                  <strong>{mark.label}</strong>
                )}
                {mark.page && <span class="muted small">Page {mark.page}</span>}
              </span>
              <button
                type="button"
                class="btn btn-quiet btn-icon btn-danger"
                aria-label={`Remove the bookmark ${mark.label}`}
                disabled={work.busy}
                onClick={() =>
                  save(
                    d.bookmarks.filter((_, at) => at !== index),
                    `Removed the bookmark ${mark.label}.`,
                  )
                }
              >
                <Icon icon={Trash2} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No bookmarks yet. Mark the pages you come back to.</p>
      )}
      <form class="inline-form" onSubmit={add}>
        <Field id="mark-label" label="Bookmark">
          <input
            id="mark-label"
            class="input"
            required
            maxLength={500}
            placeholder="Lamb shoulder"
            value={label}
            onInput={(event) => setLabel(event.currentTarget.value)}
          />
        </Field>
        <Field id="mark-page" label="Page">
          <input
            id="mark-page"
            class="input input-short"
            type="number"
            inputMode="numeric"
            min="1"
            max="100000"
            step="1"
            value={page}
            onInput={(event) => setPage(event.currentTarget.value)}
          />
        </Field>
        <button type="submit" class="btn" disabled={work.busy}>
          <Icon icon={Bookmark} />
          Add bookmark
        </button>
      </form>
      <FormError>{work.error}</FormError>
    </section>
  );
}

export function BookPage({ id }) {
  const book = record("book", id);
  if (!book) return <Gone kind="book" />;
  const d = book.data;
  const file = record("asset", d.file_id)?.data;
  const kind = file && FILE_LABELS[file.mime_type];
  const href = assetPath(d.file_id);
  const name = file?.name || `${d.title}.${kind?.toLowerCase()}`;
  return (
    <article class="recipe">
      {toRecipes}
      <div class="book-head">
        <Art kind="book" data={d} class="book-cover" />
        <div class="stack">
          <PageHeader
            eyebrow={d.author ? `By ${d.author}` : "On your shelf"}
            title={d.title}
          />
          <div class="row">
            {file ? (
              <>
                {kind === "PDF" && (
                  <FileLink class="btn btn-primary" path={href} name={name}>
                    <Icon icon={ExternalLink} />
                    Open the book
                  </FileLink>
                )}
                <FileLink
                  class={kind === "PDF" ? "btn" : "btn btn-primary"}
                  path={`${href}?download=1`}
                  name={name}
                  download
                >
                  <Icon icon={Download} />
                  Download {kind}
                  {file.byte_length ? `, ${size(file.byte_length)}` : ""}
                </FileLink>
              </>
            ) : (
              <p class="muted">The file for this book is missing.</p>
            )}
            <a class="btn" href={`${hrefOf("book", id)}/edit`}>
              <Icon icon={Pencil} />
              Edit details
            </a>
          </div>
          <Labels tags={d.tags} />
        </div>
      </div>
      {d.notes && <p class="preline lede">{d.notes}</p>}
      <Bookmarks book={book} />
      <MoreList
        id="from"
        title="Recipes from this book"
        items={recipeItems(d.recipe_ids, "Written up from it")}
      />
      <div class="row">
        <RemoveButton
          kind="book"
          item={book}
          label="Remove from the shelf"
          done={`${d.title} is off the shelf.`}
        />
      </div>
    </article>
  );
}

// ---------- Forms ----------

function PhotoField({ id, label, has, setFile, remove, setRemove }) {
  return (
    <>
      <Field id={id} label={label} help="PNG, JPEG or WebP up to 8 MB.">
        <input
          id={id}
          class="input input-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby={hint(id)}
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
      </Field>
      {has > 0 && (
        <label class="check-row">
          <input
            type="checkbox"
            checked={remove}
            onChange={(event) => setRemove(event.currentTarget.checked)}
          />
          {has === 1 ? "Remove the photo" : "Remove the photos"}
        </label>
      )}
    </>
  );
}

const linkError = new Error(
  "Each link needs a web address such as https://example.com.",
);

export function IdeaForm({ id }) {
  const idea = record("inspiration", id);
  const [f, setF] = useState(() => ({
    title: idea?.data.title ?? "",
    source: idea?.data.source ?? "",
    notes: idea?.data.notes ?? "",
    links: formatLinkLines(idea?.data.links),
    tags: formatLabels(idea?.data.tags),
  }));
  const [photo, setPhoto] = useState(null);
  const [drop, setDrop] = useState(false);
  const dirty = useDirty();
  const work = useWork();
  if (!idea) return <Gone kind="inspiration" />;
  const set = (key) => (event) => {
    dirty.current = true;
    setF({ ...f, [key]: event.currentTarget.value });
  };
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      const links = parseLinkLines(f.links);
      if (links.invalid.length) throw linkError;
      const kept = drop ? [] : idea.data.photo_ids;
      const photo_ids = photo ? [...kept, await uploadPhoto(photo)] : kept;
      await change(
        "inspiration_save",
        {
          id,
          expected_version: idea.version,
          inspiration: {
            ...idea.data,
            title: f.title.trim(),
            source: f.source.trim(),
            notes: f.notes,
            links: links.links,
            tags: parseLabels(f.tags),
            photo_ids,
          },
        },
        { done: "Changes saved." },
      );
      dirty.current = false;
      leave(hrefOf("inspiration", id).slice(2));
    });
  };
  return (
    <div class="stack-lg page-narrow">
      {back(hrefOf("inspiration", id), idea.data.title)}
      <PageHeader title="Edit idea" />
      <form class="card" onSubmit={submit}>
        <Field id="idea-title" label="What is it?">
          <input
            id="idea-title"
            class="input"
            required
            maxLength={500}
            value={f.title}
            onInput={set("title")}
          />
        </Field>
        <Field id="idea-source" label="Where it’s from">
          <input
            id="idea-source"
            class="input"
            maxLength={500}
            value={f.source}
            onInput={set("source")}
          />
        </Field>
        <Field id="idea-notes" label="Notes">
          <textarea
            id="idea-notes"
            class="input"
            rows={4}
            value={f.notes}
            onInput={set("notes")}
          />
        </Field>
        <Field
          id="idea-links"
          label="Links and videos"
          help="One per line, with a title after the address if you like."
        >
          <textarea
            id="idea-links"
            class="input"
            rows={3}
            aria-describedby={hint("idea-links")}
            value={f.links}
            onInput={set("links")}
          />
        </Field>
        <Field id="idea-tags" label="Tags" help="Separated by commas.">
          <input
            id="idea-tags"
            class="input"
            aria-describedby={hint("idea-tags")}
            value={f.tags}
            onInput={set("tags")}
          />
        </Field>
        <PhotoField
          id="idea-photo"
          label="Add a photo"
          has={idea.data.photo_ids.length}
          setFile={setPhoto}
          remove={drop}
          setRemove={setDrop}
        />
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={Check} />
            {work.busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TechniqueForm({ id }) {
  const t = id === "new" ? null : record("technique", id);
  const start = t?.data;
  const [f, setF] = useState(() => ({
    title: start?.title ?? "",
    summary: start?.summary ?? "",
    steps: stepsText(start?.steps ?? []),
    tips: start?.tips ?? "",
    tags: formatLabels(start?.tags),
    links: formatLinkLines(start?.links),
    recipe_ids: start?.recipe_ids ?? [],
  }));
  const [photo, setPhoto] = useState(null);
  const [drop, setDrop] = useState(false);
  const dirty = useDirty();
  const work = useWork();
  if (id !== "new" && !t) return <Gone kind="technique" />;
  const set = (key) => (event) => {
    dirty.current = true;
    setF({ ...f, [key]: event.currentTarget.value });
  };
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      const links = parseLinkLines(f.links);
      if (links.invalid.length) throw linkError;
      const kept = drop ? [] : (start?.photo_ids ?? []);
      const photo_ids = photo ? [...kept, await uploadPhoto(photo)] : kept;
      const title = f.title.trim();
      const { record: saved } = await change(
        "technique_save",
        {
          ...(t && { id, expected_version: t.version }),
          technique: {
            ...start,
            title,
            summary: f.summary,
            steps: editedSteps(f.steps, start?.steps),
            tips: f.tips,
            tags: parseLabels(f.tags),
            links: links.links,
            photo_ids,
            recipe_ids: f.recipe_ids,
          },
        },
        { done: t ? "Changes saved." : `${title} is in your techniques.` },
      );
      dirty.current = false;
      leave(hrefOf("technique", saved.id).slice(2));
    });
  };
  return (
    <div class="stack-lg page-narrow">
      {t
        ? back(hrefOf("technique", id), t.data.title)
        : back("#/recipes/add", "Add to your cookbook")}
      <PageHeader title={t ? "Edit technique" : "New technique"} />
      <form class="card" onSubmit={submit}>
        <Field id="technique-title" label="Name">
          <input
            id="technique-title"
            class="input"
            required
            maxLength={500}
            placeholder="Reverse sear"
            value={f.title}
            onInput={set("title")}
          />
        </Field>
        <Field id="technique-summary" label="In short">
          <textarea
            id="technique-summary"
            class="input"
            rows={3}
            value={f.summary}
            onInput={set("summary")}
          />
        </Field>
        <Field
          id="technique-steps"
          label="Steps"
          help="A blank line between steps."
        >
          <textarea
            id="technique-steps"
            class="input"
            rows={7}
            aria-describedby={hint("technique-steps")}
            value={f.steps}
            onInput={set("steps")}
          />
        </Field>
        <Field id="technique-tips" label="Tips and pitfalls">
          <textarea
            id="technique-tips"
            class="input"
            rows={3}
            value={f.tips}
            onInput={set("tips")}
          />
        </Field>
        <Field
          id="technique-links"
          label="Links and videos"
          help="The videos that taught you, one per line."
        >
          <textarea
            id="technique-links"
            class="input"
            rows={3}
            aria-describedby={hint("technique-links")}
            value={f.links}
            onInput={set("links")}
          />
        </Field>
        <Field id="technique-tags" label="Tags" help="Separated by commas.">
          <input
            id="technique-tags"
            class="input"
            aria-describedby={hint("technique-tags")}
            value={f.tags}
            onInput={set("tags")}
          />
        </Field>
        <RecipePicker
          id="technique-recipes"
          legend="Recipes that use it"
          chosen={f.recipe_ids}
          onChange={(recipe_ids) => {
            dirty.current = true;
            setF({ ...f, recipe_ids });
          }}
        />
        <PhotoField
          id="technique-photo"
          label="Add a photo"
          has={start?.photo_ids.length ?? 0}
          setFile={setPhoto}
          remove={drop}
          setRemove={setDrop}
        />
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={ChefHat} />
            {work.busy ? "Saving…" : "Save technique"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BookForm({ id }) {
  const book = id === "new" ? null : record("book", id);
  const start = book?.data;
  const [f, setF] = useState(() => ({
    title: start?.title ?? "",
    author: start?.author ?? "",
    notes: start?.notes ?? "",
    tags: formatLabels(start?.tags),
    recipe_ids: start?.recipe_ids ?? [],
  }));
  const [file, setFile] = useState(null);
  const [cover, setCover] = useState(null);
  const [drop, setDrop] = useState(false);
  const dirty = useDirty();
  const work = useWork();
  if (id !== "new" && !book) return <Gone kind="book" />;
  const set = (key) => (event) => {
    dirty.current = true;
    setF({ ...f, [key]: event.currentTarget.value });
  };
  const choose = (event) => {
    const chosen = event.currentTarget.files?.[0] ?? null;
    dirty.current = true;
    setFile(chosen);
    // The file's name is a fair first guess at the title.
    if (chosen && !f.title)
      setF({ ...f, title: chosen.name.replace(/\.(pdf|epub)$/i, "") });
  };
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      const file_id = book ? start.file_id : await uploadBook(file);
      const cover_id = cover
        ? await uploadPhoto(cover)
        : drop
          ? null
          : (start?.cover_id ?? null);
      const title = f.title.trim();
      const { record: saved } = await change(
        "book_save",
        {
          ...(book && { id, expected_version: book.version }),
          book: {
            ...start,
            title,
            author: f.author.trim(),
            notes: f.notes,
            tags: parseLabels(f.tags),
            recipe_ids: f.recipe_ids,
            file_id,
            cover_id,
          },
        },
        { done: book ? "Changes saved." : `${title} is on your shelf.` },
      );
      dirty.current = false;
      leave(hrefOf("book", saved.id).slice(2));
    });
  };
  return (
    <div class="stack-lg page-narrow">
      {book
        ? back(hrefOf("book", id), book.data.title)
        : back("#/recipes/add", "Add to your cookbook")}
      <PageHeader title={book ? "Edit book" : "Add a book"} />
      <form class="card" onSubmit={submit}>
        {!book && (
          <Field
            id="book-file"
            label="The book"
            help="A PDF or EPUB up to 64 MB. It stays on your kitchen’s server and goes into its backups."
          >
            <input
              id="book-file"
              class="input input-file"
              type="file"
              accept="application/pdf,application/epub+zip,.pdf,.epub"
              required
              aria-describedby={hint("book-file")}
              onChange={choose}
            />
          </Field>
        )}
        <div class="fields-2">
          <Field id="book-title" label="Title">
            <input
              id="book-title"
              class="input"
              required
              maxLength={500}
              value={f.title}
              onInput={set("title")}
            />
          </Field>
          <Field id="book-author" label="Author">
            <input
              id="book-author"
              class="input"
              maxLength={500}
              value={f.author}
              onInput={set("author")}
            />
          </Field>
        </div>
        <Field id="book-notes" label="Notes">
          <textarea
            id="book-notes"
            class="input"
            rows={3}
            value={f.notes}
            onInput={set("notes")}
          />
        </Field>
        <Field id="book-tags" label="Tags" help="Separated by commas.">
          <input
            id="book-tags"
            class="input"
            aria-describedby={hint("book-tags")}
            value={f.tags}
            onInput={set("tags")}
          />
        </Field>
        {book && (
          <RecipePicker
            id="book-recipes"
            legend="Recipes written up from it"
            chosen={f.recipe_ids}
            onChange={(recipe_ids) => {
              dirty.current = true;
              setF({ ...f, recipe_ids });
            }}
          />
        )}
        <PhotoField
          id="book-cover"
          label={start?.cover_id ? "Replace the cover" : "Cover photo"}
          has={start?.cover_id ? 1 : 0}
          setFile={setCover}
          remove={drop}
          setRemove={setDrop}
        />
        <p class="muted small" role="status">
          {work.busy && !book ? "Uploading the book…" : ""}
        </p>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={book ? Check : Upload} />
            {work.busy ? "Saving…" : book ? "Save changes" : "Add to the shelf"}
          </button>
        </div>
      </form>
    </div>
  );
}

// An idea written up becomes a recipe; the idea then points to it.
export async function linkIdea(ideaId, recipeId) {
  const idea = record("inspiration", ideaId);
  if (!idea) return;
  await change(
    "inspiration_save",
    {
      id: ideaId,
      expected_version: idea.version,
      inspiration: { ...idea.data, recipe_id: recipeId, status: "tried" },
    },
    { undo: false },
  );
}
