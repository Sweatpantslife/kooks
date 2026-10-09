# Hosting the household web app

The root Dockerfile runs the shared browser/MCP backend on Node 22 with local Tesseract OCR. This is a single household service: the people on its address list sign in with a passkey, or with a one-time link sent to their email, and share one cookbook. There are no passwords, no shared household key, and no mobile cloud sync.

## Coolify

Create an application from this repository using the Dockerfile build pack. Expose container port `4317` through Coolify's HTTPS proxy; do not map it directly to a public host port. Set the domain to the intended HTTPS origin and enable HTTP-to-HTTPS redirection.

Set these runtime environment variables (never build arguments or committed secrets):

- `KOOKS_PUBLIC_ORIGIN`: the exact HTTPS origin, for example `https://kooks.example.com`. Passkeys are bound to this host name, and sign-in links point here.
- `KOOKS_HOUSEHOLD_EMAILS`: the addresses allowed to sign in, separated by commas, for example `ada@example.com, sam@example.com`. Editing the list and redeploying adds or removes members; a removed member's sessions and passkeys stop working at their next request.
- `KOOKS_SMTP_HOST`, `KOOKS_SMTP_PORT`, `KOOKS_SMTP_USER` and `KOOKS_SMTP_PASSWORD`: the plain SMTP account that sends sign-in links, the same settings any mail client takes. `KOOKS_SMTP_SECURITY` is `starttls` by default (port 587; the connection must upgrade before anything is sent), `tls` for a server that is encrypted from the first byte (port 465), or `none` for an unencrypted relay on a trusted private network (port 25). Leave the user and password empty for a relay that needs no login. AUTH PLAIN and AUTH LOGIN are supported, and Kooks sends one short text message per link.
- `KOOKS_MAIL_FROM`: the sender, for example `Kooks <kooks@example.com>`. Optional when the SMTP user name is itself an email address. Keep the password in the deployment secret store.

`KOOKS_ACCESS_TOKEN` and `KOOKS_ACCESS_TOKEN_FILE` from earlier versions are no longer used; the server refuses to start while either is set, so an old shared key cannot linger in a deployment.

The image sets `KOOKS_HOST=0.0.0.0`, `PORT=4317`, and `KOOKS_DB_PATH=/data/kooks.sqlite`. Mount a dedicated persistent Docker volume at `/data`; it must be writable by the image's `node` user (UID 1000). Never share that volume with another application. Keep one application replica, and stop the old container before a replacement starts.

The Docker health check requests `GET /healthz`. It exposes no cookbook records. API requests require a signed-in member. Sessions use Secure, HttpOnly, SameSite=Strict cookies, last through 30 days of use, and are stored in the database, so a redeploy does not sign everyone out. POST requests must originate from the configured HTTPS origin. Forwarded headers cannot change that origin. Sign-in attempts are throttled per address.

## Signing in

A member opens the site and either presses **Sign in with a passkey** or types their email address and opens the link that arrives. A link works once, for 15 minutes, on the device where it is opened; nothing happens for addresses outside the list, and the page says the same thing either way. After a link sign-in, Kooks offers to add a passkey to that device; from then on the device signs in with a fingerprint, face or screen lock, and browsers that support it suggest the passkey right in the email field. Members review, add and remove their passkeys and sign out on the **Sign-in** page. Passkeys need HTTPS (or localhost), so plain-HTTP LAN sharing offers email links only.

Sign-in state lives in `auth_` tables inside the same SQLite file and is not part of cookbook backups. After restoring to a fresh database, members sign in with a link again and add their passkeys afresh. If mail is not getting through, members see that the link could not be sent; check the SMTP settings in the application log.

## Verification and recovery

After deployment, verify HTTPS and the HTTP redirect, unauthenticated API rejection, an email link sign-in, adding a passkey and signing in with it, recipe save/reload/edit, and persistence after a container restart. Test only synthetic records and archive them afterward. Verify the running commit in Coolify's deployment log.

Export the cookbook through the authenticated application and store backups privately outside the server. A volume is persistence, not a backup. For filesystem-level backups, stop the application and snapshot the complete data volume, including SQLite WAL files. Restore into an isolated volume and test before replacing live data.

If health checks, sign-in, or saves fail, stop the new deployment and redeploy the last verified commit with the same volume and runtime configuration. Back up before schema upgrades; restoring older code is not safe when it cannot read the current database schema.
