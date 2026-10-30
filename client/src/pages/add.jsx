import { useEffect, useState } from "preact/hooks";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  ChefHat,
  ClipboardPaste,
  Globe,
  Lightbulb,
  PenLine,
  ScanText,
  Trash2,
  UtensilsCrossed,
} from "lucide";
import { parseLinkLines } from "../../../shared/links.js";
import { change, records } from "../lib/store.js";
import { navigate } from "../lib/router.js";
import { readImage, uploadPhoto } from "../lib/files.js";
import { dateLabel, localDay } from "../lib/format.js";
import { PageHeader } from "../ui/page.jsx";
import { Field, FormError, hint, useWork } from "../ui/form.jsx";
import { Icon } from "../ui/icon.jsx";
import { showKind } from "./recipes.jsx";

const WAYS = [
  {
    href: "#/recipes/add/link",
    icon: Globe,
    tone: "tomato",
    title: "From a link",
    text: "A recipe page on the web. Your kitchen reads the recipe from it, and you check the draft.",
  },
  {
    href: "#/recipes/add/paste",
    icon: ClipboardPaste,
    tone: "tomato",
    title: "Paste it",
    text: "From a message, an email or a page that won’t share its recipe. You check the draft before it’s saved.",
  },
  {
    href: "#/recipes/add/photo",
    icon: Camera,
    tone: "sky",
    title: "Photograph a page",
    text: "From a cookbook or a handwritten card. Your kitchen’s own server reads it.",
  },
  {
    href: "#/recipes/new",
    icon: PenLine,
    tone: "herb",
    title: "Write it yourself",
    text: "The way you make it, in your own words.",
  },
  {
    href: "#/recipes/meal/new",
    icon: UtensilsCrossed,
    tone: "herb",
    title: "Put a meal together",
    text: "Recipes you cook together, like a main, a side and a salad.",
  },
  {
    href: "#/recipes/add/idea",
    icon: Lightbulb,
    tone: "saffron",
    title: "Save an idea",
    text: "A dish to try one day: a link, a photo or a few words.",
  },
  {
    href: "#/recipes/technique/new",
    icon: ChefHat,
    tone: "stone",
    title: "Keep a technique",
    text: "A method worth remembering, with the videos that taught you.",
  },
  {
    href: "#/recipes/book/new",
    icon: BookOpen,
    tone: "plum",
    title: "Add a book",
    text: "A cookbook you own, as a PDF or EPUB, with its bookmarks.",
  },
];

const back = (to, label) => (
  <a class="back" href={to}>
    <Icon icon={ArrowLeft} />
    {label}
  </a>
);

function Drafts() {
  const drafts = records("import").filter((r) => r.data.status === "draft");
  const work = useWork();
  if (!drafts.length) return null;
  const discard = (draft) =>
    work.run(() =>
      change(
        "record_archive",
        {
          kind: "import",
          id: draft.id,
          expected_version: draft.version,
          archived: true,
        },
        { done: "Draft discarded." },
      ),
    );
  return (
    <section class="stack" aria-labelledby="drafts">
      <h2 id="drafts">Waiting for your check</h2>
      <ul class="drafts" role="list">
        {drafts.map((draft) => (
          <li key={draft.id} class="draft">
            <a
              class="draft-link"
              href={`#/recipes/draft/${encodeURIComponent(draft.id)}`}
            >
              <span class="draft-title">{draft.data.recipe.title}</span>
              <span class="muted small">
                {draft.data.image_id
                  ? "Photo"
                  : draft.data.recipe.source_url
                    ? "From a link"
                    : "Pasted"}
                {draft.created_at &&
                  `, ${dateLabel(localDay(draft.created_at))}`}
              </span>
            </a>
            <button
              type="button"
              class="btn btn-quiet btn-icon"
              aria-label={`Discard ${draft.data.recipe.title}`}
              disabled={work.busy}
              onClick={() => discard(draft)}
            >
              <Icon icon={Trash2} />
            </button>
          </li>
        ))}
      </ul>
      <FormError>{work.error}</FormError>
    </section>
  );
}

export function Add() {
  return (
    <>
      {back("#/recipes", "Recipes")}
      <PageHeader title="Add to your cookbook" />
      <ul class="ways" role="list">
        {WAYS.map((way) => (
          <li key={way.href}>
            <a class="way" href={way.href}>
              <span class={`way-icon tone-${way.tone}`}>
                <Icon icon={way.icon} />
              </span>
              <span class="way-text">
                <span class="way-title">{way.title}</span>
                <span class="muted">{way.text}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <Drafts />
    </>
  );
}

// A draft opens in the editor in place of the form that made it, so Back
// from the draft returns to the choices.
const review = (result) =>
  navigate(`recipes/draft/${encodeURIComponent(result.record.id)}`, {
    replace: true,
  });

// What someone types as a page's address: https unless they wrote a scheme.
const pageAddress = (text) => {
  const typed = text.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
};

export function FromLink() {
  const [address, setAddress] = useState("");
  const work = useWork();
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () =>
      review(await change("recipe_import_link", { url: pageAddress(address) })),
    );
  };
  return (
    <div class="stack-lg page-narrow">
      {back("#/recipes/add", "Add to your cookbook")}
      <PageHeader title="Add from a link" />
      <form class="card" onSubmit={submit}>
        <Field
          id="link-address"
          label="The recipe’s web address"
          help="Your kitchen opens that one page and reads the recipe the site publishes for search engines. Nothing else on the page is fetched, and the site sees your kitchen’s address."
        >
          <input
            id="link-address"
            class="input"
            type="text"
            inputMode="url"
            autocapitalize="none"
            autocomplete="off"
            spellcheck={false}
            required
            placeholder="https://"
            aria-describedby={hint("link-address")}
            value={address}
            onInput={(event) => setAddress(event.currentTarget.value)}
          />
        </Field>
        <p class="muted small" role="status">
          {work.busy ? "Reading the page." : ""}
        </p>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={ScanText} />
            {work.busy ? "Reading…" : "Read it"}
          </button>
        </div>
      </form>
      <p class="muted">
        No recipe on the page? <a href="#/recipes/add/paste">Paste it</a>{" "}
        instead.
      </p>
    </div>
  );
}

export function Paste() {
  const [text, setText] = useState("");
  const work = useWork();
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () =>
      review(await change("recipe_import_text", { text })),
    );
  };
  return (
    <div class="stack-lg page-narrow">
      {back("#/recipes/add", "Add to your cookbook")}
      <PageHeader title="Paste a recipe" />
      <form class="card" onSubmit={submit}>
        <Field
          id="paste-text"
          label="The recipe"
          help="All of it: the name, the ingredients and the method. Your original is kept beside the draft."
        >
          <textarea
            id="paste-text"
            class="input"
            rows={14}
            required
            aria-describedby={hint("paste-text")}
            value={text}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        </Field>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={ScanText} />
            {work.busy ? "Reading…" : "Read it"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Photo() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const work = useWork();
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
  const choose = (event) => {
    const chosen = event.currentTarget.files?.[0] ?? null;
    work.setError("");
    setFile(chosen);
    setPreview(chosen ? URL.createObjectURL(chosen) : "");
  };
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      const image = await readImage(file);
      review(await change("recipe_import_image", { image }));
    });
  };
  return (
    <div class="stack-lg page-narrow">
      {back("#/recipes/add", "Add to your cookbook")}
      <PageHeader title="Photograph a recipe" />
      <form class="card" onSubmit={submit}>
        <Field
          id="photo-file"
          label="Photo of the recipe"
          help="One recipe, upright and sharp. PNG, JPEG or WebP up to 8 MB. The photo stays on your kitchen’s server."
        >
          <input
            id="photo-file"
            class="input input-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            aria-describedby={hint("photo-file")}
            onChange={choose}
          />
        </Field>
        {preview && (
          <img class="photo-preview" src={preview} alt="The photo you chose" />
        )}
        <p class="muted small" role="status">
          {work.busy ? "Reading the photo. This can take up to a minute." : ""}
        </p>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={ScanText} />
            {work.busy ? "Reading…" : "Read the photo"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Idea() {
  const [f, setF] = useState({ title: "", link: "", source: "", notes: "" });
  const [photo, setPhoto] = useState(null);
  const work = useWork();
  const set = (key) => (event) =>
    setF({ ...f, [key]: event.currentTarget.value });
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      const links = parseLinkLines(f.link);
      if (links.invalid.length)
        throw new Error(
          "The link needs a web address such as https://example.com.",
        );
      const photo_ids = photo ? [await uploadPhoto(photo)] : [];
      await change(
        "inspiration_save",
        {
          inspiration: {
            title: f.title.trim(),
            notes: f.notes,
            source: f.source.trim(),
            links: links.links,
            photo_ids,
            status: "idea",
          },
        },
        { done: `${f.title.trim()} is on your list to try.` },
      );
      showKind("inspiration");
      navigate("recipes", { replace: true });
    });
  };
  return (
    <div class="stack-lg page-narrow">
      {back("#/recipes/add", "Add to your cookbook")}
      <PageHeader title="Save an idea" />
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
        <Field
          id="idea-link"
          label="Link"
          help="A recipe, a video or a post, if there is one."
        >
          <input
            id="idea-link"
            class="input"
            inputMode="url"
            autoComplete="url"
            aria-describedby={hint("idea-link")}
            value={f.link}
            onInput={set("link")}
          />
        </Field>
        <Field
          id="idea-source"
          label="Where it’s from"
          help="A friend, a restaurant, a newsletter."
        >
          <input
            id="idea-source"
            class="input"
            maxLength={500}
            aria-describedby={hint("idea-source")}
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
          id="idea-photo"
          label="Photo"
          help="PNG, JPEG or WebP up to 8 MB."
        >
          <input
            id="idea-photo"
            class="input input-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby={hint("idea-photo")}
            onChange={(event) =>
              setPhoto(event.currentTarget.files?.[0] ?? null)
            }
          />
        </Field>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={Lightbulb} />
            {work.busy ? "Saving…" : "Save idea"}
          </button>
        </div>
      </form>
    </div>
  );
}
