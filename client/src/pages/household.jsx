import { useEffect, useState } from "preact/hooks";
import { KeyRound, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide";
import { auth } from "../lib/api.js";
import * as passkeys from "../lib/passkeys.js";
import { account, sharing, signOut } from "../lib/store.js";
import { theme } from "../lib/theme.js";
import { toast } from "../lib/toast.js";
import { navigate } from "../lib/router.js";
import { dateLabel, localDay } from "../lib/format.js";
import { PageHeader } from "../ui/page.jsx";
import { Icon } from "../ui/icon.jsx";

const THEMES = [
  { value: "system", label: "Device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function Look() {
  return (
    <section class="card" aria-labelledby="look">
      <h2 id="look">Look</h2>
      <fieldset class="segmented">
        <legend class="sr-only">Colors</legend>
        {THEMES.map((t) => (
          <label key={t.value}>
            <input
              type="radio"
              name="theme"
              value={t.value}
              checked={theme.value === t.value}
              onChange={() => (theme.value = t.value)}
            />
            <Icon icon={t.icon} class="icon-sm" />
            {t.label}
          </label>
        ))}
      </fieldset>
      <p class="muted small">
        Device follows this phone or computer’s light or dark setting. Cooking
        mode is always dark.
      </p>
    </section>
  );
}

function SignIn({ email }) {
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
    <section class="card" aria-labelledby="signin">
      <h2 id="signin">Sign-in</h2>
      <p>
        Signed in as <strong>{email}</strong>.
      </p>
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
  return (
    <>
      <PageHeader eyebrow="Settings for this kitchen" title="Household" />
      <div class="stack">
        <Look />
        {email && <SignIn email={email} />}
        <Kitchen />
      </div>
    </>
  );
}
