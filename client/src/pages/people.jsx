import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Pencil, Trash2, UserCheck, UserPlus, Users } from "lucide";
import { auth } from "../lib/api.js";
import { account, change, record, records } from "../lib/store.js";
import { guardLeaving, leave } from "../lib/router.js";
import { SPICE, beAtTable, byName, listOf, me } from "../lib/people.js";
import { toast } from "../lib/toast.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Field, FormError, hint, useWork } from "../ui/form.jsx";
import { Icon } from "../ui/icon.jsx";
import { passFocus } from "../ui/focus.js";
import { toHousehold } from "./household.jsx";

function Person({ person, work, mine, taken, choosing }) {
  const d = person.data;
  const isMe = mine?.id === person.id;
  const pick = () =>
    void work.run(async () => {
      await beAtTable(person.id);
      toast(`You’re ${d.name} at the table.`);
    });
  const remove = (event) => {
    passFocus(event.currentTarget, "#add-person");
    void work.run(() =>
      change(
        "record_archive",
        {
          kind: "member",
          id: person.id,
          expected_version: person.version,
          archived: true,
        },
        { done: `${d.name} is off the list.` },
      ),
    );
  };
  return (
    <li class="card person">
      <span class="avatar avatar-lg" aria-hidden="true">
        {d.name.trim()[0]?.toUpperCase()}
      </span>
      <div class="person-text">
        <h2>{d.name}</h2>
        {isMe && <span class="badge badge-herb">You</span>}
        {!isMe && taken && <span class="badge badge-sky">A member</span>}
        <dl class="tastes-list">
          {d.likes.length > 0 && (
            <div>
              <dt>Likes</dt>
              <dd>{d.likes.join(", ")}</dd>
            </div>
          )}
          {d.dislikes.length > 0 && (
            <div>
              <dt>Doesn’t like</dt>
              <dd>{d.dislikes.join(", ")}</dd>
            </div>
          )}
          {d.spice_tolerance != null && (
            <div>
              <dt>Heat</dt>
              <dd>{SPICE[d.spice_tolerance]}</dd>
            </div>
          )}
        </dl>
        {d.notes && <p class="muted small preline">{d.notes}</p>}
      </div>
      <div class="row person-actions" data-rows>
        {choosing && !taken && (
          <button
            type="button"
            class="btn btn-quiet"
            aria-label={`This is me: ${d.name}`}
            disabled={work.busy}
            onClick={pick}
          >
            <Icon icon={UserCheck} />
            This is me
          </button>
        )}
        <a
          class="btn btn-quiet"
          href={`#/household/people/${encodeURIComponent(person.id)}`}
          aria-label={`Edit ${d.name}`}
        >
          <Icon icon={Pencil} />
          Edit
        </a>
        <button
          type="button"
          class="btn btn-quiet btn-danger"
          data-row="remove"
          aria-label={`Remove ${d.name}`}
          disabled={work.busy}
          onClick={remove}
        >
          <Icon icon={Trash2} />
          Remove
        </button>
      </div>
    </li>
  );
}

// Which person at the table the signed-in member is: who they are now, or
// a way to add themselves; the cards below offer "This is me".
function YouAtTheTable({ mine, work }) {
  const [name, setName] = useState("");
  if (mine)
    return (
      <section class="card" aria-labelledby="you">
        <h2 id="you">You’re {mine.data.name}</h2>
        <p class="muted">
          The household sees your name on what you change, and What can I make?
          and cooking jobs offer you first.
        </p>
        <div class="row">
          <button
            type="button"
            class="btn btn-quiet"
            disabled={work.busy}
            onClick={() =>
              void work.run(async () => {
                await beAtTable(null);
                toast(`You’re no longer ${mine.data.name} at the table.`);
              })
            }
          >
            That’s not me
          </button>
        </div>
      </section>
    );
  const add = (event) => {
    event.preventDefault();
    const named = name.trim();
    if (!named) return;
    void work.run(async () => {
      const { record: person } = await change("member_save", {
        member: {
          name: named,
          likes: [],
          dislikes: [],
          spice_tolerance: null,
          notes: "",
        },
      });
      await beAtTable(person.id);
      setName("");
      toast(`You’re at the table as ${named}.`);
    });
  };
  return (
    <section class="card" aria-labelledby="you">
      <h2 id="you">Which one is you?</h2>
      <p class="muted">
        Say which person you are, so the household sees your name on what you
        change. Pick yourself below with This is me, or add yourself.
      </p>
      <form class="quick-add" onSubmit={add}>
        <label for="me-name" class="sr-only">
          Your name
        </label>
        <input
          id="me-name"
          class="input"
          required
          maxLength={500}
          autoComplete="given-name"
          placeholder="Your name"
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <button type="submit" class="btn btn-primary" disabled={work.busy}>
          <Icon icon={UserPlus} />
          Add me
        </button>
      </form>
    </section>
  );
}

export function People() {
  const people = records("member").slice().sort(byName);
  const work = useWork();
  const signedIn = Boolean(account.value?.household);
  const mine = me();
  // The people other members say they are, which nobody else can be.
  const [taken, setTaken] = useState(new Set());
  useEffect(() => {
    if (!signedIn) return;
    auth("household/members")
      .then(({ members }) =>
        setTaken(
          new Set(
            members
              .filter((m) => m.person && m.email !== account.value?.email)
              .map((m) => m.person),
          ),
        ),
      )
      .catch(() => {});
  }, [signedIn, account.value?.household?.person, people.length]);
  return (
    <div class="stack-lg">
      {toHousehold}
      <PageHeader title="People at the table">
        <a
          id="add-person"
          class="btn btn-primary"
          href="#/household/people/new"
        >
          <Icon icon={UserPlus} />
          Add a person
        </a>
      </PageHeader>
      <p class="lede">
        What they like moves recipes up in What can I make?, and a recipe says
        when it holds something one of them doesn’t like. These are tastes, not
        allergy records.
      </p>
      {signedIn && <YouAtTheTable mine={mine} work={work} />}
      {people.length ? (
        <ul class="people" role="list" data-rows>
          {people.map((p) => (
            <Person
              key={p.id}
              person={p}
              work={work}
              mine={mine}
              taken={taken.has(p.id)}
              choosing={signedIn && !mine}
            />
          ))}
        </ul>
      ) : (
        <Empty icon={Users} title="Nobody yet">
          Add the people you cook for and what they like.
        </Empty>
      )}
      <FormError>{work.error}</FormError>
    </div>
  );
}

const BLANK = {
  name: "",
  likes: [],
  dislikes: [],
  spice_tolerance: null,
  notes: "",
};

export function PersonForm({ id }) {
  const editing = id === "new" ? null : record("member", id);
  const start = editing?.data ?? BLANK;
  const [f, setF] = useState(() => ({
    ...start,
    likes: start.likes.join(", "),
    dislikes: start.dislikes.join(", "),
  }));
  const dirty = useRef(false);
  const work = useWork();
  useEffect(
    () =>
      guardLeaving(
        () =>
          !dirty.current ||
          confirm("Leave without saving? Your changes will be lost."),
      ),
    [],
  );
  if (id !== "new" && !editing)
    return (
      <>
        {toHousehold}
        <PageHeader title="Not found" />
        <Empty icon={Users} title="That person isn’t at the table">
          They may have been removed.
        </Empty>
      </>
    );

  const set = (key, value) => {
    dirty.current = true;
    setF({ ...f, [key]: value });
  };
  const text = (key) => (event) => set(key, event.currentTarget.value);
  const submit = (event) => {
    event.preventDefault();
    void work.run(async () => {
      const name = f.name.trim();
      await change(
        "member_save",
        {
          ...(editing && { id: editing.id, expected_version: editing.version }),
          member: {
            ...editing?.data,
            name,
            likes: listOf(f.likes),
            dislikes: listOf(f.dislikes),
            spice_tolerance: f.spice_tolerance,
            notes: f.notes,
          },
        },
        { done: editing ? `Saved ${name}.` : `${name} is at the table.` },
      );
      dirty.current = false;
      leave("household/people");
    });
  };
  const heat = [
    { value: null, label: "Not set" },
    ...SPICE.map((label, value) => ({ value, label })),
  ];
  return (
    <div class="stack-lg page-narrow">
      {toHousehold}
      <PageHeader
        title={editing ? `Edit ${editing.data.name}` : "Add a person"}
      />
      <form class="card" onSubmit={submit}>
        <Field id="person-name" label="Name">
          <input
            id="person-name"
            class="input"
            required
            maxLength={500}
            autoComplete="off"
            value={f.name}
            onInput={text("name")}
          />
        </Field>
        <Field
          id="person-likes"
          label="Likes"
          help="Ingredients or kinds of dish, separated by commas."
        >
          <input
            id="person-likes"
            class="input"
            placeholder="Chickpeas, pasta, soup"
            aria-describedby={hint("person-likes")}
            value={f.likes}
            onInput={text("likes")}
          />
        </Field>
        <Field
          id="person-dislikes"
          label="Doesn’t like"
          help="Separated by commas. Tastes, not allergies: always check a recipe yourself."
        >
          <input
            id="person-dislikes"
            class="input"
            placeholder="Mushrooms, olives"
            aria-describedby={hint("person-dislikes")}
            value={f.dislikes}
            onInput={text("dislikes")}
          />
        </Field>
        <fieldset class="field">
          <legend>Heat</legend>
          <div class="segmented">
            {heat.map((o) => (
              <label key={o.label}>
                <input
                  type="radio"
                  name="heat"
                  checked={f.spice_tolerance === o.value}
                  onChange={() => set("spice_tolerance", o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="person-notes" label="Notes">
          <textarea
            id="person-notes"
            class="input"
            rows={3}
            value={f.notes}
            onInput={text("notes")}
          />
        </Field>
        <FormError>{work.error}</FormError>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" disabled={work.busy}>
            <Icon icon={Check} />
            {work.busy ? "Saving…" : editing ? "Save" : "Add to the table"}
          </button>
        </div>
      </form>
    </div>
  );
}
