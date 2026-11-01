import { useEffect, useState } from "preact/hooks";
import {
  ArrowLeft,
  ArrowLeftRight,
  DoorOpen,
  Download,
  History,
  House,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Palette,
  Sun,
  Trash2,
  UserMinus,
  Users,
  Wallet,
} from "lucide";
import { auth, backups } from "../lib/api.js";
import * as passkeys from "../lib/passkeys.js";
import {
  account,
  enterHousehold,
  letWaitingGo,
  record,
  records,
  refresh,
  sharing,
  signOut,
} from "../lib/store.js";
import { theme } from "../lib/theme.js";
import { UNITS, units } from "../lib/units.js";
import { budgetFor, currency, money } from "../lib/money.js";
import { names } from "../lib/people.js";
import { toast } from "../lib/toast.js";
import { kitchen, phone, setKitchen } from "../lib/device.js";
import { navigate } from "../lib/router.js";
import {
  dateLabel,
  localDay,
  momentLabel,
  monday,
  plural,
  sizeLabel,
} from "../lib/format.js";
import { Empty, PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";
import { FileLink } from "../ui/asset.jsx";
import { StartHousehold, WaitingInvites } from "./welcome.jsx";

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
    if (!letWaitingGo()) return;
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
        <ul class="entries" role="list">
          {list.map((p) => (
            <li key={p.id}>
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

// Every phone and browser signed in to this account. Each stays signed in
// for as long as it is used at least every six months; any of them can be
// signed out from here, as when a phone is lost.
function Devices() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    auth("sessions")
      .then(({ sessions }) => setList(sessions))
      .catch((error) => toast(error.message, { error: true }));
  useEffect(() => void load(), []);
  const run = (work, done) => async () => {
    setBusy(true);
    try {
      await work();
      toast(done);
      await load();
    } catch (error) {
      toast(error.message, { error: true });
    } finally {
      setBusy(false);
    }
  };
  const others = (list ?? []).filter((s) => !s.current).length;
  return (
    <section class="card" aria-labelledby="devices">
      <h2 id="devices">Signed-in devices</h2>
      <p class="muted small">
        Kooks keeps you signed in on each device as long as you use it at least
        every six months. Sign out any you no longer use.
      </p>
      {list === null ? (
        <p class="muted">Loading devices…</p>
      ) : (
        <ul class="entries" role="list">
          {list.map((d) => (
            <li key={d.id}>
              <Icon icon={Laptop} />
              <div>
                <strong>{d.label}</strong>
                <p class="muted small">
                  {d.current
                    ? "This device"
                    : `Last used ${dateLabel(localDay(d.used_at ?? d.created_at))}`}
                  {` · Signed in ${dateLabel(localDay(d.created_at))}`}
                </p>
              </div>
              {!d.current && (
                <button
                  type="button"
                  class="btn btn-quiet btn-danger"
                  disabled={busy}
                  aria-label={`Sign out ${d.label}`}
                  onClick={run(
                    () => auth("session/end", { id: d.id }),
                    `${d.label} is signed out.`,
                  )}
                >
                  <Icon icon={LogOut} />
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {others > 1 && (
        <div class="row">
          <button
            type="button"
            class="btn"
            disabled={busy}
            onClick={run(
              () => auth("sessions/end-others", {}),
              "Every other device is signed out.",
            )}
          >
            Sign out everywhere else
          </button>
        </div>
      )}
    </section>
  );
}

// On a phone: who it is signed in as, and to which kitchen. Passkeys
// belong to the kitchen's own address, so they are for browsers.
function ThisPhone({ email }) {
  const [busy, setBusy] = useState(false);
  const leave = (forget) => async () => {
    if (!letWaitingGo()) return;
    setBusy(true);
    await signOut();
    if (forget) setKitchen("");
    navigate("week", { replace: true });
    toast("Signed out. See you at the next meal.");
  };
  return (
    <section class="card" aria-labelledby="this-phone">
      <h2 id="this-phone">This phone</h2>
      <p>
        Signed in as <strong>{email}</strong> to{" "}
        <strong>{kitchen.value}</strong>.
      </p>
      <p class="muted small">
        On this phone you sign in with a link from your email. Passkeys are for
        browsers, at the kitchen’s own address.
      </p>
      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={busy}
          onClick={leave(false)}
        >
          <Icon icon={LogOut} />
          Sign out
        </button>
        <button
          type="button"
          class="btn btn-quiet"
          disabled={busy}
          onClick={leave(true)}
        >
          Sign out and use another kitchen
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
      {email && phone ? (
        <>
          <ThisPhone email={email} />
          <Devices />
        </>
      ) : email ? (
        <>
          <Passkeys email={email} />
          <Devices />
        </>
      ) : (
        <Empty icon={KeyRound} title="Nobody signs in here">
          This kitchen runs for this computer only. Whoever runs Kooks can share
          it with the household by turning on sign-in.
        </Empty>
      )}
    </div>
  );
}

// Who shares this kitchen: the household's name, its members, invites on
// their way, and the other households this person belongs to.
export function Members() {
  const mine = account.value?.household;
  const [list, setList] = useState(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState(mine?.name ?? "");
  const [busy, setBusy] = useState(false);
  const load = () =>
    auth("household/members")
      .then(setList)
      .catch((error) => toast(error.message, { error: true }));
  useEffect(() => {
    if (mine) void load();
  }, [mine?.id]);
  const run = (work, done) => async (event) => {
    event?.preventDefault();
    setBusy(true);
    try {
      await work();
      if (done) toast(done);
      await load();
    } catch (error) {
      toast(error.message, { error: true });
    } finally {
      setBusy(false);
    }
  };
  if (!mine)
    return (
      <div class="stack-lg page-narrow">
        {toHousehold}
        <PageHeader title="Members" />
        <Empty icon={Users} title="Nobody signs in here">
          This kitchen runs for this computer only. Whoever runs Kooks can share
          it with the household by turning on sign-in.
        </Empty>
      </div>
    );
  const owner = mine.role === "owner";
  const others = (account.value?.households ?? []).filter(
    (h) => h.id !== mine.id,
  );
  const invite = run(async () => {
    await auth("household/invite", { email: email.trim() });
    setEmail("");
  }, `Invite sent to ${email.trim()}.`);
  const rename = run(async () => {
    await auth("household/rename", { name: name.trim() });
    await refresh();
  }, "Household renamed.");
  async function leave() {
    if (
      !confirm(
        `Leave ${mine.name}? You won’t see its recipes, week or groceries until someone invites you again.`,
      ) ||
      !letWaitingGo()
    )
      return;
    setBusy(true);
    try {
      await enterHousehold("household/leave", {}, `You left ${mine.name}.`);
      navigate("week", { replace: true });
    } catch (error) {
      toast(error.message, { error: true });
      setBusy(false);
    }
  }
  const switchTo = (h) => async () => {
    if (!letWaitingGo()) return;
    setBusy(true);
    try {
      await enterHousehold(
        "household/switch",
        { id: h.id },
        `You’re in ${h.name}.`,
      );
      navigate("week", { replace: true });
    } catch (error) {
      toast(error.message, { error: true });
      setBusy(false);
    }
  };
  return (
    <div class="stack-lg page-narrow">
      {toHousehold}
      <PageHeader title="Members" />
      <section class="card" aria-labelledby="who">
        <h2 id="who">Who cooks in {mine.name}</h2>
        {list === null ? (
          <p class="muted">Loading members…</p>
        ) : (
          <ul class="entries" role="list">
            {list.members.map((m) => (
              <li key={m.email}>
                <Icon icon={Users} />
                <div>
                  <strong>{m.email}</strong>
                  <p class="muted small">
                    {m.role === "owner" ? "Owner" : "Member"}
                    {m.email === account.value.email && " · You"}
                    {m.person &&
                      record("member", m.person) &&
                      ` · At the table as ${record("member", m.person).data.name}`}
                    {` · Joined ${dateLabel(localDay(m.joined_at))}`}
                  </p>
                </div>
                {owner &&
                  m.email !== account.value.email &&
                  m.person &&
                  record("member", m.person) && (
                    <button
                      type="button"
                      class="btn btn-quiet"
                      disabled={busy}
                      aria-label={`Unlink ${m.email} from ${record("member", m.person).data.name}`}
                      onClick={run(
                        () => auth("household/person", { member: m.email }),
                        `${m.email} is no longer ${record("member", m.person).data.name} at the table.`,
                      )}
                    >
                      Unlink
                    </button>
                  )}
                {owner && m.email !== account.value.email && (
                  <button
                    type="button"
                    class="btn btn-quiet btn-danger"
                    disabled={busy}
                    aria-label={`Remove ${m.email} from the household`}
                    onClick={(event) =>
                      confirm(
                        `Remove ${m.email} from ${mine.name}? They lose the kitchen at once; their recipes and notes stay.`,
                      ) &&
                      run(
                        () => auth("household/remove", { email: m.email }),
                        `${m.email} is no longer in the household.`,
                      )(event)
                    }
                  >
                    <Icon icon={UserMinus} />
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section class="card" aria-labelledby="invite">
        <h2 id="invite">Invite someone</h2>
        <p class="muted small">
          They get an email with a link that works once, for a week. Opening it
          signs them in and into {mine.name}; no password, nothing to install.
        </p>
        <form class="stack" onSubmit={invite}>
          <div class="field">
            <label for="invite-email">Their email address</label>
            <input
              id="invite-email"
              class="input"
              type="email"
              required
              autocomplete="off"
              placeholder="them@example.com"
              value={email}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
          </div>
          <div class="row">
            <button type="submit" class="btn btn-primary" disabled={busy}>
              <Icon icon={Mail} />
              Send an invite
            </button>
          </div>
        </form>
        {list?.invites.length > 0 && (
          <>
            <h3>Waiting to join</h3>
            <ul class="entries" role="list">
              {list.invites.map((i) => (
                <li key={i.id}>
                  <Icon icon={Mail} />
                  <div>
                    <strong>{i.email}</strong>
                    <p class="muted small">
                      Invited by {i.invited_by} · Until{" "}
                      {dateLabel(localDay(i.expires_at))}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="btn btn-quiet"
                    disabled={busy}
                    aria-label={`Withdraw the invite to ${i.email}`}
                    onClick={run(
                      () => auth("household/invite/withdraw", { id: i.id }),
                      "Invite withdrawn.",
                    )}
                  >
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section class="card" aria-labelledby="name">
        <h2 id="name">Name</h2>
        <form class="row" onSubmit={rename}>
          <div class="field">
            <label for="rename-household" class="sr-only">
              Household name
            </label>
            <input
              id="rename-household"
              class="input"
              required
              maxLength={60}
              value={name}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </div>
          <button type="submit" class="btn" disabled={busy}>
            Rename
          </button>
        </form>
      </section>
      <section class="card" aria-labelledby="kitchens">
        <h2 id="kitchens">Your other kitchens</h2>
        <WaitingInvites />
        {others.length ? (
          <ul class="entries" role="list">
            {others.map((h) => (
              <li key={h.id}>
                <Icon icon={House} />
                <div>
                  <strong>{h.name}</strong>
                  <p class="muted small">{plural(h.members, "member")}</p>
                </div>
                <button
                  type="button"
                  class="btn"
                  disabled={busy}
                  onClick={switchTo(h)}
                >
                  <Icon icon={ArrowLeftRight} />
                  Switch
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">
            You can belong to more than one household, such as your own and your
            parents’. Each has its own recipes, week and groceries.
          </p>
        )}
        <details>
          <summary>Start another household</summary>
          <StartHousehold label="Start it" />
        </details>
      </section>
      <section class="card" aria-labelledby="leave">
        <h2 id="leave">Leave</h2>
        <p class="muted small">
          {mine.members > 1
            ? `You stop seeing ${mine.name}; what you added stays for the others.${owner ? " Whoever has been in it longest becomes its owner." : ""}`
            : "You’re the only member, so you can’t leave: nobody could open this kitchen again. Invite someone first."}
        </p>
        <div class="row">
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy || mine.members <= 1}
            onClick={leave}
          >
            <Icon icon={DoorOpen} />
            Leave {mine.name}
          </button>
        </div>
      </section>
    </div>
  );
}

// The server's automatic backups, read once per visit. A failure to read
// them is not worth a message: the page works without.
function useBackups() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    backups()
      .then((value) => live && setStatus(value))
      .catch(() => {});
    return () => (live = false);
  }, []);
  return status;
}
// Whether whoever runs the server should look at its backups.
const backupsNeedALook = (status) =>
  Boolean(
    status?.operator &&
    status.on &&
    (status.late ||
      status.failure ||
      status.offsite?.late ||
      status.offsite?.failure),
  );

function AutomaticCopies({ status }) {
  if (!status || (!status.on && !status.operator)) return null;
  if (!status.operator)
    return (
      <section class="card" aria-labelledby="automatic">
        <h2 id="automatic">Automatic copies</h2>
        <p class="muted">
          The server also keeps copies of every household on it, for whoever
          runs it to put back if something goes wrong.
        </p>
      </section>
    );
  if (!status.on)
    return (
      <section class="card" aria-labelledby="automatic">
        <h2 id="automatic">Automatic copies</h2>
        <p>
          Automatic copies are off on this server. Set KOOKS_BACKUPS=on where
          Kooks runs to have it copy every household once a day.
        </p>
      </section>
    );
  const last = status.copies[0];
  const every =
    status.every_hours === 24
      ? "once a day"
      : `every ${plural(status.every_hours, "hour")}`;
  return (
    <section class="card" aria-labelledby="automatic">
      <h2 id="automatic">Automatic copies</h2>
      {status.failure && (
        <p class="form-error" role="alert">
          The last automatic copy failed ({momentLabel(status.failure.at)}):{" "}
          {status.failure.error.replace(/([^.!?])$/, "$1.")} Kooks tries again
          every hour.
        </p>
      )}
      {status.late && !status.failure && (
        <p class="form-error" role="alert">
          {last
            ? `No automatic copy since ${momentLabel(last.taken_at)}. Check the server’s log.`
            : "No automatic copy has been taken yet. Check the server’s log."}
        </p>
      )}
      <p>
        {`Kooks copies every household on this server ${every} and keeps one for each of the last ${plural(status.keep_daily, "day")}${status.keep_weekly ? ` and ${plural(status.keep_weekly, "week")}` : ""}.`}
      </p>
      <p class="muted">
        {last
          ? `Last copy ${momentLabel(last.taken_at)}, ${sizeLabel(last.bytes)}. ${plural(status.copies.length, "copy", "copies")} kept in ${status.dir}.`
          : "The first copy is taken a minute after Kooks starts."}
      </p>
      {status.offsite ? (
        <OffsiteCopies offsite={status.offsite} />
      ) : (
        <p class="muted small">
          These copies are on the same disk as the kitchen. To be safe if the
          server itself is lost, download a backup above now and then and keep
          it somewhere else, or have Kooks send each copy off-site.
        </p>
      )}
    </section>
  );
}

function OffsiteCopies({ offsite }) {
  return (
    <>
      {offsite.failure && (
        <p class="form-error" role="alert">
          The last copy didn’t reach {offsite.to} (
          {momentLabel(offsite.failure.at)}):{" "}
          {offsite.failure.error.replace(/([^.!?])$/, "$1.")} Kooks tries again
          every hour.
        </p>
      )}
      {offsite.late && !offsite.failure && (
        <p class="form-error" role="alert">
          {offsite.last_sent_at
            ? `No copy has reached ${offsite.to} since ${momentLabel(offsite.last_sent_at)}. Check the server’s log.`
            : `No copy has reached ${offsite.to} yet. Check the server’s log.`}
        </p>
      )}
      <p class="muted">
        {offsite.last_sent_at
          ? `Each copy also goes to ${offsite.to}; the last went ${momentLabel(offsite.last_sent_at)}.`
          : `Each copy also goes to ${offsite.to}; none has gone yet.`}
      </p>
    </>
  );
}

export function Backup() {
  const status = useBackups();
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
          <FileLink
            class="btn btn-primary"
            path="/api/backup"
            name={`kooks-${localDay()}.json`}
            download
          >
            <Icon icon={Download} />
            Download a backup
          </FileLink>
        </div>
        <p class="muted small">
          A backup restores into a new, empty kitchen, just as this one is
          today. Whoever runs Kooks does that on the server, with its backup
          script.
        </p>
      </section>
      <AutomaticCopies status={status} />
    </div>
  );
}

function Kitchen() {
  return (
    <section class="card" aria-labelledby="kitchen">
      <h2 id="kitchen">This kitchen</h2>
      <p class="muted">
        {sharing.value
          ? "A shared household server: everyone in this household sees the same recipes, plans and cooking. Other households on it have kitchens of their own."
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
  const backupStatus = useBackups();
  const email = account.value?.email;
  const mine = account.value?.household;
  const people = records("member");
  const prices = records("price").filter(
    (p) => p.data.currency === currency.value,
  ).length;
  const budget = budgetFor(monday());
  const look = THEMES.find((t) => t.value === theme.value).label;
  const amounts = UNITS.find((u) => u.value === units.value).label;
  const sections = [
    mine && {
      href: "#/household/members",
      icon: House,
      tone: "tomato",
      title: "Members",
      text: `${plural(mine.members, "member")} · Invite someone`,
    },
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
      href: "#/household/history",
      icon: History,
      tone: "plum",
      title: "Recent changes",
      text: "Who changed what, with Undo.",
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
      text: backupsNeedALook(backupStatus)
        ? "Automatic copies need a look"
        : "Download everything this kitchen keeps.",
    },
  ].filter(Boolean);
  return (
    <div class="stack-lg">
      <PageHeader
        eyebrow="Settings for this kitchen"
        title={mine?.name ?? "Household"}
      />
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
