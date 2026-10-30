import { useEffect, useRef, useState } from "preact/hooks";
import { CookingPot, KeyRound, Mail } from "lucide";
import { auth } from "../lib/api.js";
import * as passkeys from "../lib/passkeys.js";
import { signedIn, signInError } from "../lib/store.js";
import { Icon } from "../ui/icon.jsx";

export function SignIn() {
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
    <main id="main" class="signin" tabIndex={-1}>
      <div class="signin-card">
        <span class="brand">
          <Icon icon={CookingPot} />
          kooks
        </span>
        {sent ? (
          <>
            <div class="stack">
              <h1 ref={heading} tabIndex={-1}>
                Check your inbox.
              </h1>
              <p class="muted">
                We sent a sign-in link to <strong>{sent}</strong>. Open it on
                this device within 15 minutes; it works once.
              </p>
              <p class="muted small">
                Nothing there after a few minutes? Look in spam, or ask whoever
                runs this kitchen to check that your address is on the list and
                that its mail is going out.
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
      </div>
    </main>
  );
}
