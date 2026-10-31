# Hosting the household web app

The root Dockerfile runs the shared browser/MCP backend on Node 24, the current LTS release, with local Tesseract OCR. Node 22.13 or newer still runs Kooks outside the image, and CI tests both. People have accounts named by their email address and sign in with a passkey or a one-time link sent to their email; there are no passwords and no shared household key. Each account belongs to one or more households, and each household is a kitchen with its own cookbook. Households grow by invitation.

## Coolify

Create an application from this repository using the Dockerfile build pack. Expose container port `4317` through Coolify's HTTPS proxy; do not map it directly to a public host port. Set the domain to the intended HTTPS origin and enable HTTP-to-HTTPS redirection.

Set these runtime environment variables (never build arguments or committed secrets):

- `KOOKS_PUBLIC_ORIGIN`: the exact HTTPS origin, for example `https://kooks.example.com`. Passkeys are bound to this host name, sign-in links point here, and requests that name any other host are refused. The server refuses to start beyond loopback without it.
- `KOOKS_OWNER_EMAIL`: the first person's email address, for example `ada@example.com`. On the first start they get an account and own the first household, whose cookbook is the database already on the volume, so a kitchen from before accounts keeps all its recipes. On later starts it only puts their account back if it went, and makes them owner of the first household if nobody is left in it, so the server can always be entered. Everyone else joins by invitation (Household › Members › Invite someone).
- `KOOKS_HOUSEHOLD_EMAILS` (from earlier versions, optional): on the first start with accounts, these addresses join the first household as members, and their passkeys and sessions keep working. Accounts of addresses no longer on it are removed. After that first start the variable is ignored and can be deleted.
- `KOOKS_OPEN_SIGNUP` (optional, off by default): `true` lets any email address make an account with a sign-in link and start a household of its own. Off, links go only to people who have an account, and new people get one by accepting an invite.
- `KOOKS_SMTP_HOST`, `KOOKS_SMTP_PORT`, `KOOKS_SMTP_USER` and `KOOKS_SMTP_PASSWORD`: the plain SMTP account that sends sign-in links and invites, the same settings any mail client takes. `KOOKS_SMTP_SECURITY` is `starttls` by default (port 587; the connection must upgrade before anything is sent), `tls` for a server that is encrypted from the first byte (port 465), or `none` for an unencrypted relay on a trusted private network (port 25). Leave the user and password empty for a relay that needs no login. AUTH PLAIN and AUTH LOGIN are supported, and Kooks sends one short text message per link or invite.
- `KOOKS_MAIL_FROM`: the sender, for example `Kooks <kooks@example.com>`. Optional when the SMTP user name is itself an email address. Keep the password in the deployment secret store.

`KOOKS_ACCESS_TOKEN` and `KOOKS_ACCESS_TOKEN_FILE` from earlier versions are no longer used; the server refuses to start while either is set, so an old shared key cannot linger in a deployment.

The image sets `KOOKS_HOST=0.0.0.0`, `PORT=4317`, and `KOOKS_DB_PATH=/data/kooks.sqlite`. That file holds the accounts and the first household's cookbook; every household started later has its own file in `/data/households/`. Mount a dedicated persistent Docker volume at `/data`; it must be writable by the image's `node` user (UID 1000). Never share that volume with another application. Keep one application replica, and stop the old container before a replacement starts.

Ebook uploads for the library reach the server as JSON bodies of up to 96 MB (a 64 MB file in base64) and may take a few minutes on a slow connection; the server allows five minutes per request. Make sure the HTTPS proxy's request body size and timeout limits allow that, or uploads fail before Kooks sees them. Only file uploads (`asset_save`), restores (`backup_restore`) and photo imports (12 MB) get that room, and at most two of them are received at once; other actions are limited to 2 MB and sign-in requests to 64 KB, so nobody can make the server hold a large body before signing in. Books and photos live in the same SQLite file, so size the volume and its backups accordingly. Kooks compresses its own large replies (Brotli or gzip, whichever the browser accepts) and lets browsers revalidate the app's files with ETags, so the proxy does not need to compress or cache them.

Adding a recipe **From a link** makes the server fetch that one page from the internet, so the container needs outbound HTTP and HTTPS if your network restricts it; the recipe site sees the server's public address. Kooks refuses addresses on the server itself or its networks, including the proxy's and the cloud provider's metadata address, whatever a name resolves to. It ignores `HTTP_PROXY` and similar settings for these requests.

The Docker health check requests `GET /healthz`. It exposes no cookbook records. API requests require a signed-in member. Responses carry `Strict-Transport-Security: max-age=31536000` (without `includeSubDomains`, so other services on the household's subdomains are unaffected). Sessions use Secure, HttpOnly, SameSite=Strict cookies and are stored in the database, so a redeploy does not sign everyone out. A session lasts as long as it is used: each day of use extends it to 180 days from then, so someone who cooks at least twice a year never signs in again on that device. Members see every device they are signed in on under Household › Sign-in and can sign any of them out, or all but the one in hand. POST requests must originate from the configured HTTPS origin, or from the phone app with its device token. Forwarded headers cannot change that origin. Sign-in attempts are throttled per client address, which behind the HTTPS proxy is the last `X-Forwarded-For` entry; a plain-HTTP origin has no proxy, so the header is ignored there. Running Kooks on `KOOKS_HOST=127.0.0.1` behind a proxy on the same machine works the same way, as long as the proxy passes the original `Host`.

## The assistant

**Ask Kooks** answers questions about the household's recipes, week and groceries, and suggests changes that members make with a tap. It runs on Claude through the Anthropic API, and is off until you give the kitchen an API key:

- `KOOKS_ANTHROPIC_API_KEY`: an API key from the Claude Console (console.anthropic.com), kept in the deployment's secret store. Use a key of its own with a spending limit set in the Console. Kooks reads only this variable: it ignores `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the SDK's other settings, so another tool's key on the same machine neither turns the assistant on nor is used by it.
- `KOOKS_ASSISTANT_DAILY_TOKENS`: what the kitchen may spend in a day, in tokens, 2,000,000 by default. Tokens read from the prompt cache count a tenth. When the day's allowance is used, members are told the assistant is back tomorrow. The count is kept in the database, by UTC day, so a restart does not reset it.
- `KOOKS_ASSISTANT_MODEL`: the Claude model, `claude-opus-5-5` by default. Leave it unless you have a reason. Another model must take adaptive thinking, the effort setting and server-side fallback, as the default does; one that doesn't fails every question, and the server log says so with a 400.

With the key set, the server says at start that the assistant is on, members see **Ask Kooks** beside Household, and the container needs outbound HTTPS to `api.anthropic.com`. Without it, nothing is sent and `/api/assistant` answers 404.

What leaves the house: the member's question and the conversation so far, and what the assistant reads to answer it. It reads recipes, meals, the plan, the grocery list, what is at home, equipment, cooking notes and sessions, leftovers, prices and budget, techniques, ideas and books, and the people at the table with their tastes and diet labels, which may include allergies or other health details. It never reads photos or ebook files, import drafts, sign-in addresses, passkeys or sessions, history or backups. Anthropic handles the data under its API terms. Every member's records can be sent when any member asks, so tell the household before you turn it on. The Ask page says so under the question box.

Each member asks one question at a time, 30 an hour, and the kitchen 300 a day. A question carries at most 60,000 characters of the conversation before it (the app leaves the oldest turns out), takes at most eight model calls, reads at most 120,000 characters of the kitchen, and gives up after three minutes.

## Signing in

Someone with an account opens the site and either presses **Sign in with a passkey** or types their email address and opens the link that arrives. A link works once, for 15 minutes, on the device where it is opened; nothing happens for addresses without an account (unless `KOOKS_OPEN_SIGNUP` is on), and the page says the same thing either way. After a link sign-in, Kooks offers to add a passkey to that device; from then on the device signs in with a fingerprint, face or screen lock, and browsers that support it suggest the passkey right in the email field. Members review, add and remove their passkeys, see their signed-in devices and sign out on the **Sign-in** page. Passkeys need HTTPS (or localhost), so plain-HTTP LAN sharing offers email links only.

The phone app cannot open an emailed link or use a passkey for each household's own address, so it asks for a link and waits: the member enters the household's address and their email, then opens the link that arrives on the phone or any other device. That page asks them to confirm that the Kooks app may sign in (it does not sign the browser in), and the app, which asks the server every few seconds with a secret only it holds, then receives its own session. The email and the page both say to confirm only a sign-in the member just asked for themselves. The app keeps a device token, which slides like a browser session and ends at Sign out, when it is signed out from another device, or when the account is gone. The app's requests come from `capacitor://localhost` (iOS) or `https://localhost` (Android), which may call `/api/` across origins only with that token; the HTTPS proxy must pass the `Authorization` header and `OPTIONS` requests through to Kooks.

## Households and invitations

Any member can invite someone by email under **Household › Members**. The invite works once, for seven days; opening it shows the household and who invited them, and joining signs that browser in as the invited address, making an account if there was none. Someone already signed in sees invites to their address in the app as well. Owners can remove members, who lose the kitchen at their next request but stay signed in to their other households; anyone can leave a household except its last member, since nobody could open it again, and an owner who leaves hands it to whoever has been in it longest. Anyone with an account can start another household, which gets an empty cookbook of its own. Each household has its own assistant allowance and backup.

Sign-in state lives in `auth_` tables inside the first household's SQLite file and is not part of cookbook backups. After restoring to a fresh database, people sign in with a link again and add their passkeys afresh. The page answers every link request the same way and at once, and the email follows in the background, so neither the reply nor its timing reveals who has an account. That also means people are not told when mail fails: if links are not arriving, look for “Kooks could not email a sign-in link” in the application log, which carries the SMTP server's reply. At most 100 sign-in and invite emails go out per hour, sign-in links only to people with accounts, so requests for other addresses cannot use up that budget; a member sends at most 20 invites a day.

## Backups

Kooks copies the whole server once a day while it runs: every household's cookbook, with its photos and books, and the accounts with their members, passkeys and sessions. It is on unless `KOOKS_BACKUPS=off`. A copy is a folder named by when it was taken (`/data/backups/2026-11-01T03-00-00Z/`) holding each database compressed and a `manifest.json` with each file's checksum and record count.

- `KOOKS_BACKUPS`: `on` (the default) or `off`.
- `KOOKS_BACKUP_DIR`: where copies go; `backups/` beside the database by default, which in the image is `/data/backups` on the same volume as the kitchen. Mount another volume there, on another disk if the host has one, to keep the copies apart from the database.
- `KOOKS_BACKUP_EVERY_HOURS`: how often, 24 by default (1 to 168).
- `KOOKS_BACKUP_KEEP_DAILY` and `KOOKS_BACKUP_KEEP_WEEKLY`: Kooks keeps the newest copy of each of the last 7 days and of each of the last 4 weeks that have one (Monday to Sunday), so about a month back. Days the server was off do not count, so a long outage never empties the folder.
- `KOOKS_BACKUP_PING_URL` (optional): a monitor such as [healthchecks.io](https://healthchecks.io) or Uptime Kuma's push monitor. Kooks requests the address after every good copy and the address with `/fail` added after a failed one; the monitor raises the alarm when the pings stop, which also covers a server that is down.

Every quarter of an hour the server looks at its newest copy and takes a new one once it is older than the interval, so restarts and deploys neither skip nor repeat a day; after a failure it tries again an hour later. A copy is taken in a background thread with SQLite's `VACUUM INTO`, which writes one consistent moment of each database while people go on cooking. Each file is checked with SQLite's integrity check before it is compressed, and only a complete, checked copy takes its name and lets older copies go. A damaged database therefore fails the backup, which is reported, and keeps every older copy. A copy is not taken when it would leave less than 1 GB free on the disk. Copies are readable by the container's user only. Each is about the size of the databases compressed; record text shrinks about tenfold, but photos and ebooks barely shrink, so a kitchen with 300 MB of books keeps about eleven times that.

Watching them:

- **Household › Backup** shows the server's owner (the address in `KOOKS_OWNER_EMAIL`, or anyone on a kitchen without sign-in) when the last copy was taken, its size and how many are kept, and says so plainly when the last attempt failed or there has been no copy for a day and a half. The Household page then reads "Automatic copies need a look". Other members only learn that copies exist.
- **`GET /healthz/backups`** answers 200 with the time of the last copy, 503 once there has been none for an interval and a half (counting from the start when there is none yet), and 404 when backups are off. Point an uptime monitor at `https://<your origin>/healthz/backups`.
- The application log says when each copy was taken and how large it was, or why it failed.

The copies sit on the server, so they help after a bad deploy, a damaged database or a change someone regrets, but not when the server or its volume is lost. Keep a copy elsewhere too: download a portable backup from Household › Backup now and then.

### The backup script

In Coolify, open the application's **Terminal** and run these in `/app` (elsewhere, from the repository with `KOOKS_DB_PATH` set as for the server):

```sh
node scripts/backup.mjs snapshot          # take a copy now, as the schedule does
node scripts/backup.mjs list              # the copies kept, newest first
node scripts/backup.mjs check [copy]      # expand a copy and check it (the newest without a name)
node scripts/backup.mjs stage <copy>      # put a whole copy back at the next start
node scripts/backup.mjs stage <copy> --household <id>   # or only one household's cookbook
node scripts/backup.mjs unstage           # forget a staged copy
```

Restoring is two steps so that it works while the server runs. `stage` checks the copy and expands it into `/data/restore/`; nothing live changes. Restart the application, and before it opens any database the server moves the files the copy replaces into `/data/replaced-<time>/`, with their write-ahead logs, and puts the copy's files in their place. The log says what it restored. A whole restore brings back the accounts, members, passkeys and sessions as they were, and also moves aside any household started after the copy, since the accounts it brings back do not know it. Changes made after the copy are not in it; the replaced files keep them. Delete the `replaced-` folder once the kitchen looks right. A household's id is the name of its file in `/data/households/`; the first household lives in `kooks.sqlite` with the accounts, so it comes back only with a whole restore. A restore that stops part way, such as at a power cut, finishes at the next start.

## Verification and recovery

After deployment, verify HTTPS and the HTTP redirect, unauthenticated API rejection, an email link sign-in as the owner, adding a passkey and signing in with it, an invite, recipe save/reload/edit, and persistence after a container restart. Test only synthetic records and archive them afterward. Verify the running commit in Coolify's deployment log, and that the log says automatic backups are on.

Export the cookbook through the authenticated application (Household › Backup streams the download, so the proxy needs no extra body or buffering limits for it) and store backups privately outside the server. `node scripts/backup.mjs export` and `restore` do the same on the server itself for the first household; see [household features](household-features.md). A volume is persistence, not a backup: the automatic copies above live on it too.

If health checks, sign-in, or saves fail, stop the new deployment and redeploy the last verified commit with the same volume and runtime configuration. Take a copy (`node scripts/backup.mjs snapshot`) before a deployment that upgrades the database; older code refuses a database a newer Kooks wrote, so going back means restoring the copy taken before the upgrade.
