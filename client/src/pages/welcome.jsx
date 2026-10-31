import { useEffect, useRef, useState } from "preact/hooks";
import { Check, House, LogOut, Smartphone, UserPlus } from "lucide";
import {
  acceptInvite,
  account,
  appLink,
  approveAppLink,
  enterHousehold,
  invitation,
  signOut,
} from "../lib/store.js";
import { auth } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { navigate } from "../lib/router.js";
import { Icon } from "../ui/icon.jsx";
import { Frame } from "./signin.jsx";

function useHeading(title) {
  const heading = useRef(null);
  useEffect(() => {
    document.title = `${title} · Kooks`;
    heading.current?.focus();
  }, [title]);
  return (
    <h1 ref={heading} tabIndex={-1}>
      {title}
    </h1>
  );
}

// Run a step, showing why it failed in the page's alert.
function useStep() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = (task) => async (event) => {
    event?.preventDefault();
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const alert = (
    <p class="form-error" role="alert">
      {error}
    </p>
  );
  return { busy, run, alert };
}

// The form that starts a household, here and on the Household page.
export function StartHousehold({ label = "Start your kitchen" }) {
  const [name, setName] = useState("");
  const { busy, run, alert } = useStep();
  const start = run(async () => {
    await enterHousehold(
      "household/create",
      { name: name.trim() },
      `${name.trim()} is ready.`,
    );
    navigate("week", { replace: true });
  });
  return (
    <form class="stack" onSubmit={start}>
      {alert}
      <div class="field">
        <label for="household-name">Household name</label>
        <input
          id="household-name"
          class="input"
          required
          maxLength={60}
          placeholder="The Garcias, Flat 3B, Grandma’s"
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </div>
      <button type="submit" class="btn btn-primary btn-block" disabled={busy}>
        <Icon icon={House} />
        {label}
      </button>
    </form>
  );
}

// Invites waiting for the signed-in person, to take or turn down.
export function WaitingInvites() {
  const invites = account.value?.invites ?? [];
  const { busy, run, alert } = useStep();
  if (!invites.length) return null;
  return (
    <section class="stack" aria-labelledby="waiting-invites">
      <h2 id="waiting-invites">Invites for you</h2>
      {alert}
      <ul class="entries" role="list">
        {invites.map((invite) => (
          <li key={invite.id}>
            <Icon icon={UserPlus} />
            <div>
              <strong>{invite.household}</strong>
              <p class="muted small">From {invite.invited_by}</p>
            </div>
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              onClick={run(async () => {
                await enterHousehold(
                  "household/join",
                  { id: invite.id },
                  `Welcome to ${invite.household}.`,
                );
                navigate("week", { replace: true });
              })}
            >
              Join
            </button>
            <button
              type="button"
              class="btn btn-quiet"
              disabled={busy}
              aria-label={`Turn down the invite to ${invite.household}`}
              onClick={run(async () => {
                await auth("household/decline", { id: invite.id });
                account.value = {
                  ...account.value,
                  invites: invites.filter((i) => i.id !== invite.id),
                };
              })}
            >
              No thanks
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Signed in, to no household yet: take an invite, or start a kitchen.
export function Welcome() {
  const title = useHeading("Welcome to Kooks.");
  const email = account.value?.email;
  return (
    <Frame>
      <div class="stack">
        {title}
        <p class="muted">
          You’re signed in as <strong>{email}</strong>. A household is where
          your recipes, week and groceries live, shared with the people you cook
          with.
        </p>
      </div>
      <WaitingInvites />
      <StartHousehold />
      <p class="muted small">
        Joining someone else’s kitchen? Ask them to invite {email} from
        Household › Members; the invite shows up here and in your email.
      </p>
      <button
        type="button"
        class="btn btn-quiet"
        onClick={async () => {
          try {
            await signOut();
          } catch (error) {
            toast(error.message, { error: true });
          }
        }}
      >
        <Icon icon={LogOut} />
        Sign out
      </button>
    </Frame>
  );
}

// A link the phone app asked for, opened in this browser: it signs the app
// in, not this browser, once the person here says so.
export function ApproveApp() {
  const link = appLink.value;
  const title = useHeading(
    link.approved ? "The app is signing in." : "Sign in the Kooks app?",
  );
  const { busy, run, alert } = useStep();
  const done = () => {
    appLink.value = null;
    navigate("week", { replace: true });
  };
  return (
    <Frame>
      <div class="stack">
        {title}
        {link.approved ? (
          <p class="muted">
            Go back to the Kooks app: it’s signed in as{" "}
            <strong>{link.email}</strong> in a moment.
          </p>
        ) : (
          <>
            <p class="muted">
              This link signs the Kooks app in as <strong>{link.email}</strong>.
            </p>
            <p class="muted small">
              Only continue if you just asked for a link in the app yourself. If
              you didn’t, someone else is trying to get in: close this page.
            </p>
          </>
        )}
      </div>
      {alert}
      {link.approved ? (
        <button type="button" class="btn btn-block" onClick={done}>
          Close
        </button>
      ) : (
        <>
          <button
            type="button"
            class="btn btn-primary btn-block"
            disabled={busy}
            onClick={run(approveAppLink)}
          >
            <Icon icon={Smartphone} />
            Sign in the app
          </button>
          <button type="button" class="btn btn-quiet" onClick={done}>
            Not me, cancel
          </button>
        </>
      )}
    </Frame>
  );
}

// An invite link: who asked, to which household, and as whom it signs in.
export function JoinInvite() {
  const invite = invitation.value;
  const title = useHeading(
    invite.error ? "This invite can’t be used" : `Join ${invite.household}`,
  );
  const { busy, run, alert } = useStep();
  const close = () => {
    invitation.value = null;
    navigate("week", { replace: true });
  };
  if (invite.error)
    return (
      <Frame>
        <div class="stack">
          {title}
          <p class="muted">{invite.error}</p>
        </div>
        <button type="button" class="btn btn-block" onClick={close}>
          Continue
        </button>
      </Frame>
    );
  const other = invite.signed_in_as && invite.signed_in_as !== invite.email;
  return (
    <Frame>
      <div class="stack">
        {title}
        <p class="muted">
          {invite.invited_by} invited <strong>{invite.email}</strong> to share
          their kitchen on Kooks: recipes, the week’s meals and the grocery
          list.
        </p>
        {other && (
          <p class="muted small">
            This browser is signed in as {invite.signed_in_as}. Joining signs it
            in as {invite.email} instead.
          </p>
        )}
      </div>
      {alert}
      <button
        type="button"
        class="btn btn-primary btn-block"
        disabled={busy}
        onClick={run(acceptInvite)}
      >
        <Icon icon={Check} />
        Join as {invite.email}
      </button>
      <button type="button" class="btn btn-quiet" onClick={close}>
        Not now
      </button>
    </Frame>
  );
}
