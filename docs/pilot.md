# The pilot release

What "pilot ready" means for Kooks, what the pilot lives with, and how it is supported and updated. The pilot is the kitchen the owner already runs on Coolify, opened to a few households they invite, in browsers and on the phones the owner installs the app on. It is not a public service: nobody signs up on their own (sign-up is by invitation), and nobody but the owner runs a server.

## Pilot ready

The pilot can start when each of these holds. The owner checks the ones on the live site; the rest are in the repository.

|                                 | What it takes                                                                                                                                                                                             | Where it stands                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data survives a mistake         | Automatic copies are on and checked daily, a monitor watches `/healthz/backups`, and the owner has done the [recovery drill](#the-owners-drill) once on the live site.                                    | Copies are on in the live kitchen since November 1, 2026, unless `KOOKS_BACKUPS=off` ([backups](hosting.md#backups)), and the [runbook](recovery.md) is written. The monitor and the drill on the live site are the owner's. |
| Data survives losing the server | A copy leaves the server every day: [off-site copies](hosting.md#off-site-copies) to a bucket, or at least a backup downloaded now and then.                                                              | Off-site copies are built; the bucket and its key are the owner's to set up. Downloads work today.                                                                                                                           |
| People can get in               | Invite-only accounts, sign-in by emailed link or passkey, mail that arrives, and a way back in when it doesn't.                                                                                           | Built and live. `scripts/accounts.mjs` prints a link or moves the owner when email fails ([recovery](recovery.md#the-owner-cant-sign-in)).                                                                                   |
| Updates are safe                | Every change goes through CI on `main`, lands with a changelog entry, and can be rolled back.                                                                                                             | In place; see [Updates](#updates).                                                                                                                                                                                           |
| Phones                          | The app installs and updates on the pilot's phones, and passes a device check on each.                                                                                                                    | Debug builds compile in CI. Signed builds, installing them and the device check are not done yet; [native app](native-app.md) describes the phone app.                                                                       |
| The assistant                   | Off until the owner sets a key. Before households use it, the [trial](hosting.md#trying-the-assistant-before-the-household-does) has been run and its answers read, and the allowance fits what it costs. | The trial is ready and has not been run against the real API.                                                                                                                                                                |

## Known limitations

Households in the pilot should hear these before they start:

- **One server.** Everything lives on the owner's server, and the pilot stops while it is down. Without off-site copies, losing it loses everything since the last backup someone downloaded.
- **Restores go back to the last copy.** Automatic copies are daily, so a restore loses up to a day of changes, and a whole restore brings back the accounts as they were then.
- **Sign-in needs email.** There are no passwords. Without a passkey, getting in takes an emailed link, so mail trouble keeps people out until the owner prints a link.
- **Phones keep only some changes without a connection.** Out of the kitchen's reach a phone shows its last copy and the photos it has opened, and keeps grocery changes, leftovers eaten, cooking notes and recipe edits until the kitchen answers, asking which to keep where both sides changed a part of a recipe. Other changes need the server.
- **The assistant is untried.** Ask Kooks has been tested against a scripted stand-in only. Its proposals still need a member's tap, and diet labels are notes, not an allergen check.
- **Browsers.** The tests run in Chromium. Safari and Firefox have not been checked by hand, and passkeys behave differently across them.
- **Imports are partial.** Recipe pages without schema.org data, video, WhatsApp archives and sharing into the app from other apps are not read.
- **Accessibility is checked by machine.** Axe passes on every page in light and dark; no screen reader has been run through the app.
- **No tagged versions yet.** The site runs whatever `main` holds; the changelog says what changed.

## Updates

1. A change lands on `main` through a pull request whose CI is green, with an entry under **Unreleased** in `CHANGELOG.md` saying what changed, how it was checked and what wasn't.
2. Coolify deploys `main`. If the entry says the database changes, take a copy first: `node scripts/backup.mjs snapshot` in the application's terminal.
3. After the deploy, check that the log shows the new commit and `Automatic backups are on`, then sign in and save something.
4. If something is wrong, roll back as [Recovering the kitchen](recovery.md#a-bad-deploy) says.
5. Phones update with a new build of the app. The server keeps working with the app already on the phones unless the changelog says otherwise.

## Support

- **Members** tell the owner directly: what they did, what they saw, when, and on which device and browser. A screenshot helps.
- **The owner** looks first at Coolify's log for the time it happened, then at **Household › Backup** and `/healthz/backups`, then at [Recovering the kitchen](recovery.md) if data is involved.
- **Bugs** go to the repository's issues, described with made-up records. Nothing from the live kitchen goes into the repository: no recipes, names, addresses or copies.

## The owner's drill

Once, before the pilot starts, and again after a large change. Pick a quiet time: anything anyone changes between the copy and the restart goes too.

1. In the application's terminal, print a sign-in link for yourself (`node scripts/accounts.mjs link <your address>`) and open it in a private window.
2. Take a copy and check it: `node scripts/backup.mjs snapshot`, then `node scripts/backup.mjs check`.
3. In the private window, add a made-up recipe called "Drill". Stage the copy you just took (`node scripts/backup.mjs stage <copy>`) and restart the application.
4. The log should say what it restored, the "Drill" recipe should be gone, and the private window should still be signed in, since its session is in the copy.
5. Once the kitchen looks right, delete the `replaced-` folder the log names.

That rehearses the damaged-database path end to end on the live site, losing only the made-up recipe, and the link that gets the owner back in when email fails. The other paths in the runbook need a broken server, and were rehearsed on a local run of the image.
