import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowRight, CookingPot, KeyRound, Mail } from "lucide";
import { auth } from "../lib/api.js";
import {
  keepToken,
  kitchen,
  kitchenAddress,
  phone,
  setKitchen,
} from "../lib/device.js";
import * as passkeys from "../lib/passkeys.js";
import { signedIn, signInError } from "../lib/store.js";
import { Icon } from "../ui/icon.jsx";

export const SignIn = () => (phone ? <PhoneSignIn /> : <BrowserSignIn />);

export function Frame({ children }) {
  return (
    <main id="main" class="signin" tabIndex={-1}>
      <div class="signin-card">
        <span class="brand">
          <Icon icon={CookingPot} />
          kooks
        </span>
        {children}
      </div>
    </main>
  );
}

function BrowserSignIn() {
  const [sent, setSent] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // Bumped to offer the quiet passkey request again after a failed attempt.
  const [attempt, setAttempt] = useState(0);
  const quiet = useRef(null);
  const heading = useRef(null);
  const error = signInError.value;
  const fail = (message) => (signInError.value = message);

  useEffect(() => {
    document.title = "Sign in · Kooks";
    heading.current?.focus();
  }, [sent]);

  // Browsers that can list passkeys among the email field's suggestions do
  // so without a tap; the button stays for everyone else.
  useEffect(() => {
    if (sent) return;
    const controller = new AbortController();
    quiet.current = controller;
    (async () => {
      if (!(await passkeys.conditionalAvailable())) return;
      try {
        if (await passkeys.signIn(controller.signal))
          await signedIn("Welcome back.");
      } catch (e) {
        if (e.name !== "AbortError" && !controller.signal.aborted)
          fail(passkeys.message(e));
      }
    })();
    return () => controller.abort();
  }, [sent, attempt]);

  async function withPasskey() {
    // The browser holds one passkey request at a time.
    quiet.current?.abort();
    fail("");
    setBusy(true);
    try {
      await passkeys.signIn();
      await signedIn("Welcome back.");
    } catch (e) {
      fail(passkeys.message(e));
      setBusy(false);
      setAttempt((n) => n + 1);
    }
  }

  async function emailLink(event) {
    event.preventDefault();
    fail("");
    setBusy(true);
    const address = email.trim();
    try {
      await auth("link", { email: address });
      setSent(address);
    } catch (e) {
      fail(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame>
      {sent ? (
        <>
          <div class="stack">
            <h1 ref={heading} tabIndex={-1}>
              Check your inbox.
            </h1>
            <p class="muted">
              We sent a sign-in link to <strong>{sent}</strong>. Open it on this
              device within 15 minutes; it works once.
            </p>
            <p class="muted small">
              Nothing there after a few minutes? Look in spam. Links go only to
              people with an account: if you don’t have one yet, ask someone in
              your household to invite you.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-quiet"
            onClick={() => setSent("")}
          >
            Use a different address
          </button>
        </>
      ) : (
        <>
          <div class="stack">
            <h1 ref={heading} tabIndex={-1}>
              Welcome to your kitchen.
            </h1>
            <p class="muted">
              {passkeys.supported()
                ? "Sign in with the passkey on this device, or get a link by email."
                : "Get a sign-in link by email."}
            </p>
          </div>
          <p class="form-error" role="alert">
            {error}
          </p>
          {passkeys.supported() && (
            <>
              <button
                type="button"
                class="btn btn-primary btn-block"
                disabled={busy}
                onClick={withPasskey}
              >
                <Icon icon={KeyRound} />
                Sign in with a passkey
              </button>
              <div class="or">or</div>
            </>
          )}
          <form class="stack" onSubmit={emailLink}>
            <div class="field">
              <label for="signin-email">Email address</label>
              <input
                id="signin-email"
                class="input"
                type="email"
                required
                autocomplete="username webauthn"
                placeholder="you@example.com"
                value={email}
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
            </div>
            <button type="submit" class="btn btn-block" disabled={busy}>
              <Icon icon={Mail} />
              Email me a sign-in link
            </button>
          </form>
        </>
      )}
    </Frame>
  );
}

// The phone app comes without a kitchen: it asks where the household runs
// Kooks, then for the person's email, and waits while they open the link
// that arrives, on this phone or any other device, and confirm. Passkeys
// belong to the kitchen's own address, which the app is not.
const WAIT_EVERY = 3000;
const WAIT_FOR = 15 * 60 * 1000;
function PhoneSignIn() {
  const [step, setStep] = useState(kitchen.value ? "email" : "kitchen");
  const [address, setAddress] = useState(kitchen.value);
  const [email, setEmail] = useState("");
  const [wait, setWait] = useState(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef(null);
  const error = signInError.value;
  const fail = (message) => (signInError.value = message);
  // Without a kitchen, as after "Sign out and use another kitchen", the
  // first question comes first again.
  const at = kitchen.value ? step : "kitchen";

  useEffect(() => {
    document.title = "Sign in · Kooks";
    heading.current?.focus();
  }, [at]);

  // While a link is on its way, ask every few seconds, and at once on coming
  // back to the app from the mail app or the browser.
  useEffect(() => {
    if (at !== "waiting" || !wait) return;
    let stopped = false;
    const until = Date.now() + WAIT_FOR;
    async function check() {
      if (stopped) return;
      if (Date.now() > until) {
        stopped = true;
        fail("That link has expired. Send a new one.");
        setWait(null);
        return;
      }
      try {
        const answer = await auth("link/wait", { wait });
        if (stopped || !answer.token) return;
        stopped = true;
        keepToken(answer.token);
        await signedIn("Welcome to your kitchen.");
      } catch {
        // Out of reach for a moment: the next check tries again.
      }
    }
    const timer = setInterval(check, WAIT_EVERY);
    const back = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", back);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [at, wait]);

  const go = (next) => {
    fail("");
    setStep(next);
  };
  const work = (task) => async (event) => {
    event?.preventDefault();
    fail("");
    setBusy(true);
    try {
      await task();
    } catch (e) {
      fail(e.message);
    } finally {
      setBusy(false);
    }
  };

  const findKitchen = work(async () => {
    const origin = kitchenAddress(address);
    if (!origin && /^\s*http:/i.test(address))
      throw new Error(
        "The app reaches Kooks only over https. Use the address that starts with https://.",
      );
    if (!origin)
      throw new Error(
        "Enter the address you open Kooks at, such as kooks.example.com.",
      );
    let response;
    try {
      response = await fetch(`${origin}/api/state`, { credentials: "omit" });
    } catch {
      throw new Error(
        "Could not reach a kitchen at that address. Check it and your connection.",
      );
    }
    const value = await response.json().catch(() => ({}));
    if (response.status !== 401 || value.error !== "SIGN_IN")
      throw new Error(
        "That address doesn’t answer like a Kooks kitchen that members sign in to. Check it with whoever runs Kooks.",
      );
    setKitchen(origin);
    setAddress(origin);
    go("email");
  });
  const sendLink = work(async () => {
    const answer = await auth("link", { email: email.trim(), app: true });
    setWait(answer.wait);
    go("waiting");
  });

  const alert = (
    <p class="form-error" role="alert">
      {error}
    </p>
  );
  const title = (text) => (
    <h1 ref={heading} tabIndex={-1}>
      {text}
    </h1>
  );
  if (at === "kitchen")
    return (
      <Frame>
        <div class="stack">
          {title("Where is your kitchen?")}
          <p class="muted">
            The address your household opens Kooks at in a browser. Whoever runs
            Kooks knows it.
          </p>
        </div>
        {alert}
        <form class="stack" onSubmit={findKitchen}>
          <div class="field">
            <label for="signin-kitchen">Kitchen address</label>
            <input
              id="signin-kitchen"
              class="input"
              type="url"
              inputMode="url"
              autocapitalize="none"
              autocomplete="url"
              required
              placeholder="kooks.example.com"
              value={address}
              onInput={(event) => setAddress(event.currentTarget.value)}
            />
          </div>
          <button
            type="submit"
            class="btn btn-primary btn-block"
            disabled={busy}
          >
            <Icon icon={ArrowRight} />
            {busy ? "Looking…" : "Continue"}
          </button>
        </form>
      </Frame>
    );
  if (at === "email")
    return (
      <Frame>
        <div class="stack">
          {title("Welcome to your kitchen.")}
          <p class="muted">
            We’ll email you a link to sign this app in to{" "}
            <strong>{kitchen.value}</strong>.
          </p>
        </div>
        {alert}
        <form class="stack" onSubmit={sendLink}>
          <div class="field">
            <label for="signin-email">Email address</label>
            <input
              id="signin-email"
              class="input"
              type="email"
              required
              autocomplete="username"
              placeholder="you@example.com"
              value={email}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
          </div>
          <button
            type="submit"
            class="btn btn-primary btn-block"
            disabled={busy}
          >
            <Icon icon={Mail} />
            Email me a sign-in link
          </button>
        </form>
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() => go("kitchen")}
        >
          Use a different kitchen
        </button>
      </Frame>
    );
  return (
    <Frame>
      <div class="stack">
        {title("Check your inbox.")}
        <p class="muted">
          We sent a link to <strong>{email.trim()}</strong>. Open it on this
          phone or any other device and confirm; the app signs in by itself. It
          works once, for 15 minutes.
        </p>
        <p class="muted small" aria-live="polite">
          {wait ? "Waiting for the link…" : ""}
        </p>
        <p class="muted small">
          Links go only to people with an account: if you don’t have one yet,
          ask someone in your household to invite you.
        </p>
      </div>
      {alert}
      <div class="row">
        <button
          type="button"
          class="btn btn-quiet"
          disabled={busy}
          onClick={sendLink}
        >
          Send a new link
        </button>
        <button type="button" class="btn btn-quiet" onClick={() => go("email")}>
          Use a different address
        </button>
      </div>
    </Frame>
  );
}
