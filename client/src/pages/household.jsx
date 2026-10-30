import { useEffect, useState } from "preact/hooks";
import {
  ArrowLeft,
  Download,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Sun,
  Trash2,
  Users,
  Wallet,
} from "lucide";
import { auth } from "../lib/api.js";
import * as passkeys from "../lib/passkeys.js";
import { account, records, sharing, signOut } from "../lib/store.js";
import { theme } from "../lib/theme.js";
import { UNITS, units } from "../lib/units.js";
import { budgetFor, currency, money } from "../lib/money.js";
import { names } from "../lib/people.js";
import { toast } from "../lib/toast.js";
import { navigate } from "../lib/router.js";
import { dateLabel, localDay, monday, plural } from "../lib/format.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";

export const toHousehold = (
  <a class="back" href="#/household">
    <Icon icon={ArrowLeft} />
    Household
  </a>
);

const THEMES = [
  { value: "system", label: "Device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function Choice({ name, legend, options, value }) {
  return (
    <fieldset class="segmented">
      <legend class="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.value}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value.value === o.value}
            onChange={() => (value.value = o.value)}
          />
          {o.icon && <Icon icon={o.icon} class="icon-sm" />}
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function Look() {
  return (
    <div class="stack-lg page-narrow">
      {toHousehold}
      <PageHeader title="Look and units" />
      <section class="card" aria-labelledby="colors">
        <h2 id="colors">Colors</h2>
        <Choice name="theme" legend="Colors" options={THEMES} value={theme} />
        <p class="muted small">
          Device follows this phone or computer’s light or dark setting.
        </p>
      </section>
      <section class="card" aria-labelledby="amounts">
        <h2 id="amounts">Amounts</h2>
        <Choice name="units" legend="Amounts" options={UNITS} value={units} />
        <p class="muted small">
          Metric shows grams and millilitres; US shows ounces, pounds, cups and
          spoons. Cans, cloves and cups a recipe didn’t size stay as written,
          and the recipes themselves never change.
        </p>
      </section>
      <p class="muted small">
        Both choices belong to this device, so each cook can read the kitchen
        their own way.
      </p>
    </div>
  );
}

function Passkeys({ email }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    auth("passkeys")
      .then(({ passkeys }) => setList(passkeys))
      .catch((error) => toast(error.message, { error: true }));
  useEffect(() => void load(), []);

  const run = (work, done) => async () => {
    setBusy(true);
    try {
      await work();
      if (done) toast(done);
      await load();
    } catch (error) {
      toast(passkeys.message(error), { error: true });
    } finally {
      setBusy(false);
    }
  };

  async function leave() {
    setBusy(true);
    try {
      await signOut();
      // The next person to sign in starts at the week, not on this page.
      navigate("week", { replace: true });
      toast("Signed out. See you at the next meal.");
    } catch (error) {
      toast(error.message, { error: true });
      setBusy(false);
    }
  }

  return (
    <section class="card" aria-labelledby="passkeys">
      <p>
        Signed in as <strong>{email}</strong>.
      </p>
      <h2 id="passkeys">Passkeys</h2>
      <p class="muted small">
        Passkeys let you sign in with your fingerprint, face or screen lock
        instead of waiting for an email.
      </p>
      {list === null ? (
        <p class="muted">Loading passkeys…</p>
      ) : list.length ? (
        <ul class="stack" role="list">
          {list.map((p) => (
            <li key={p.id} class="row">
              <Icon icon={KeyRound} />
              <div>
                <strong>{p.name}</strong>
                <p class="muted small">
                  Added {dateLabel(localDay(p.created_at))}
                  {p.used_at &&
                    ` · Last used ${dateLabel(localDay(p.used_at))}`}
                  {p.backed_up && " · Synced by your password manager"}
                </p>
              </div>
              <button
                type="button"
                class="btn btn-quiet btn-danger"
                disabled={busy}
                aria-label={`Remove passkey ${p.name}`}
                onClick={run(
                  () => auth("passkey/remove", { id: p.id }),
                  "Passkey removed.",
                )}
              >
                <Icon icon={Trash2} />
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">
          No passkeys yet. Add one on each phone or computer you cook from.
        </p>
      )}
      <div class="row">
        {passkeys.supported() && (
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onClick={run(
              passkeys.add,
              "Passkey added. Next time, sign in with one tap.",
            )}
          >
            <Icon icon={KeyRound} />
            Add a passkey on this device
          </button>
        )}
        <button type="button" class="btn" disabled={busy} onClick={leave}>
          <Icon icon={LogOut} />
          Sign out
        </button>
      </div>
    </section>
  );
}

export function Account() {
  const email = account.value?.email;
  return (
    <div class="stack-lg page-narrow">
      {toHousehold}
      <PageHeader title="Sign-in" />
      {email ? (
        <Passkeys email={email} />
      ) : (
        <Empty icon={KeyRound} title="Nobody signs in here">
          This kitchen runs for this computer only. Whoever runs Kooks can share
          it with the household by turning on sign-in.
        </Empty>
      )}
    </div>
  );
}

export function Backup() {
  return (
    <div class="stack-lg page-narrow">
      {toHousehold}
      <PageHeader title="Backup" />
      <section class="card" aria-labelledby="download">
        <h2 id="download">Keep a copy</h2>
        <p>
          One file with every recipe, plan, note, photo, book and price this
          kitchen keeps. Put it somewhere other than the computer Kooks runs on.
        </p>
        <div class="row">
          <a
            class="btn btn-primary"
            href="/api/backup"
            download={`kooks-${localDay()}.json`}
          >
            <Icon icon={Download} />
            Download a backup
          </a>
        </div>
        <p class="muted small">
          A backup restores into a new, empty kitchen, just as this one is
          today. Whoever runs Kooks does that on the server, with its backup
          script.
        </p>
      </section>
    </div>
  );
}

function Kitchen() {
  return (
    <section class="card" aria-labelledby="kitchen">
      <h2 id="kitchen">This kitchen</h2>
      <p class="muted">
        {sharing.value
          ? "A shared household server: everyone who signs in sees the same recipes, plans and cooking."
          : "On this computer only. Whoever runs Kooks can share it with the household by turning on sign-in."}
      </p>
      <p class="muted small">
        Kooks {__KOOKS_VERSION__} ·{" "}
        <a href="https://github.com/Sweatpantslife/kooks">
          Source code (AGPL-3.0)
        </a>
      </p>
    </section>
  );
}

export function Household() {
  const email = account.value?.email;
  const people = records("member");
  const prices = records("price").filter(
    (p) => p.data.currency === currency.value,
  ).length;
  const budget = budgetFor(monday());
  const look = THEMES.find((t) => t.value === theme.value).label;
  const amounts = UNITS.find((u) => u.value === units.value).label;
  const sections = [
    {
      href: "#/household/people",
      icon: Users,
      tone: "herb",
      title: "People at the table",
      text: people.length
        ? names(people)
        : "Who you cook for, and what they like.",
    },
    {
      href: "#/household/prices",
      icon: Wallet,
      tone: "saffron",
      title: "Prices and budget",
      text:
        [
          budget && `${money(budget.data.amount)} a week`,
          prices && plural(prices, "price"),
        ]
          .filter(Boolean)
          .join(" · ") || "What things cost, and what a week may spend.",
    },
    {
      href: "#/household/look",
      icon: Palette,
      tone: "plum",
      title: "Look and units",
      text: `${look} colors · ${amounts === "As written" ? "Amounts as written" : `${amounts} amounts`}`,
    },
    email && {
      href: "#/household/signin",
      icon: KeyRound,
      tone: "sky",
      title: "Sign-in",
      text: email,
    },
    {
      href: "#/household/backup",
      icon: Download,
      tone: "stone",
      title: "Backup",
      text: "Download everything this kitchen keeps.",
    },
  ].filter(Boolean);
  return (
    <div class="stack-lg">
      <PageHeader eyebrow="Settings for this kitchen" title="Household" />
      <ul class="ways" role="list">
        {sections.map((s) => (
          <li key={s.href}>
            <a class="way" href={s.href}>
              <span class={`way-icon tone-${s.tone}`}>
                <Icon icon={s.icon} />
              </span>
              <span class="way-text">
                <span class="way-title">{s.title}</span>
                <span class="muted">{s.text}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <Kitchen />
    </div>
  );
}
