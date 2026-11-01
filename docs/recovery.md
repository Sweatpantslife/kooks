# Recovering the kitchen

What to do when the live kitchen breaks, for whoever runs it on Coolify. Each part says how you notice, what to do, and how to check it worked. Nothing here deletes data: whatever a restore replaces is moved aside.

Most commands run in the application's terminal: in Coolify, open the application and its **Terminal**, or pick its container under **Terminal** in the sidebar. They run in `/app` while Kooks keeps running. When Kooks can't start, its container has no terminal; [When Kooks won't start](#when-kooks-wont-start) runs the same commands from the server's own shell.

[Hosting](hosting.md) explains the settings these steps refer to, and [Backups](hosting.md#backups) how the automatic copies work. Every step here was rehearsed against the Docker image on a scratch volume with made-up records; the Coolify screens were not.

## Before anything goes wrong

Do these once, and again after changing the deployment:

1. Check that the server's log, shortly after a deploy, says `Automatic backups are on`, and that **Household › Backup** shows a recent copy.
2. Point an uptime monitor at `https://<your domain>/healthz/backups`, or set `KOOKS_BACKUP_PING_URL` to a monitor such as healthchecks.io. Either tells you when copies stop.
3. Keep the deployment's settings somewhere off the server, such as a password manager: `KOOKS_PUBLIC_ORIGIN`, `KOOKS_OWNER_EMAIL` and the SMTP settings. Coolify holds them, so losing the server loses them.
4. Make sure something survives losing the server: [off-site copies](hosting.md#off-site-copies), or a backup downloaded from **Household › Backup** now and then and kept on another computer. The automatic copies live on the same volume as the kitchen.
5. Make sure Coolify's **Terminal Access** is on for the server (**Servers › your server › Security**), so you can reach its shell from the browser when you need to.

## A bad deploy

**You notice** Coolify marks the deployment unhealthy, the kitchen doesn't open, sign-in or saving fails, or the log shows errors after a deploy.

1. Note the time and what's wrong. Don't touch the volume, and don't take a copy (see [A copy you take replaces the day's](#a-copy-you-take-replaces-the-days)).
2. Go back to the last version that worked: open the application's **Rollback** in Coolify and roll back to the image before this one. If Coolify no longer has it, revert the change on GitHub so `main` deploys the previous code.
3. If the older version won't start and its log says `This database was created by a newer Kooks server`, the bad version upgraded the database. Restore the copy taken before that deploy, as for [a damaged database](#a-damaged-database), choosing the copy by its time. Its container won't start, so use [When Kooks won't start](#when-kooks-wont-start).

**Check** The deployment log shows the commit you went back to, the server's log says `Automatic backups are on`, and you can sign in, open a recipe, save a change and reload it.

Before a deploy that changes the database (its changelog entry says so), take a copy in the terminal: `node scripts/backup.mjs snapshot`.

## A damaged database

**You notice** Errors such as `database disk image is malformed` in the log, a page that fails for one household, **Household › Backup** saying the last automatic copy failed its check, or Kooks not starting at all with `Kooks could not start: malformed database schema` or similar. A new copy that fails its check never replaces the copies already kept, so the good ones are still there.

1. See what copies there are, newest first:
   ```sh
   node scripts/backup.mjs list
   ```
2. Check the newest copy taken before the trouble began. Its name is its time in UTC:
   ```sh
   node scripts/backup.mjs check 2026-11-01T03-00-00Z
   ```
   Each database in it should say `ok`. If one doesn't, try the copy before.
3. Stage it. For every household and the accounts:
   ```sh
   node scripts/backup.mjs stage 2026-11-01T03-00-00Z
   ```
   For one household started later, leaving the others and the accounts as they are, give its id, which is the name of its file under `households/` in what `check` printed:
   ```sh
   node scripts/backup.mjs stage 2026-11-01T03-00-00Z --household <id>
   ```
   The first household lives in `kooks.sqlite` with the accounts, so it comes back only with a whole restore. Changed your mind? `node scripts/backup.mjs unstage`.
4. Restart the application in Coolify. Before any database opens, Kooks moves the files the copy replaces to `/data/replaced-<time>/` and puts the copy in place.

**Check** The log says `Kooks restored the copy taken …`. Sign in and look at the household's recent recipes and the week. Then take a fresh copy: `node scripts/backup.mjs snapshot`.

What's lost: changes made after the copy was taken. A whole restore also brings back the accounts as they were, so a device signed out since then is signed in again, and someone who joined since must be invited again; **Household › Sign-in** signs devices out. Keep `/data/replaced-<time>/` until you are sure, then delete it to free the space.

## A lost volume

**You notice** The kitchen opens empty and only the owner can sign in: the volume at `/data` was deleted, or the server or its disk is gone. The copies on that volume went with it; off-site copies did not.

1. Tell the household not to add anything for now: a restore replaces whatever the empty kitchen holds by then.
2. If [off-site copies](hosting.md#off-site-copies) are set up, bring the newest back from the bucket, in the application's terminal:
   ```sh
   node scripts/backup.mjs remote
   node scripts/backup.mjs fetch 2026-11-01T03-00-00Z
   node scripts/backup.mjs stage 2026-11-01T03-00-00Z
   ```
   `remote` lists each copy in the bucket with when it was taken and how many records and accounts it holds. Copies taken since the loss are of the empty kitchen, and the server sends them too, so pick the newest copy from before. Then restart the application, and everyone's devices are signed in again as they were. Listing and fetching need a key that may read and list the bucket. If the server's key can only write, put a reading key in front of those two commands for this once: `KOOKS_BACKUP_S3_ACCESS_KEY_ID=… KOOKS_BACKUP_S3_SECRET_ACCESS_KEY=… node scripts/backup.mjs remote`. The provider's console also shows the copies' names.
3. Otherwise, find the newest copy that lives elsewhere: an automatic copy's folder that was copied off the server, or the backup downloaded from **Household › Backup** (`kooks-<day>.json`), and put it on the new volume. Coolify's terminal doesn't take uploads, so copy the file to the server first (with `scp`, say), then in the server's shell (Coolify's **Terminal**, picking the server, or SSH; add `sudo` if your user isn't in the `docker` group):
   ```sh
   docker ps --format '{{.Names}}'     # the Kooks container's name
   docker exec <container> mkdir -p /data/backups
   docker cp 2026-11-01T03-00-00Z <container>:/data/backups/
   docker cp kooks-2026-11-01.json <container>:/data/
   docker exec -u root <container> chown -R node:node /data/backups /data/kooks-2026-11-01.json
   ```
   Make the folder first: copied to a `/data/backups/` that doesn't exist yet, the copy's files land in it loose and Kooks finds no copy. The `chown` matters too: `docker cp` leaves the files to root, and Kooks can't read them until they are its own. Then restore it:
   - **An automatic copy's folder** brings back every household and the accounts. In the application's terminal:
     ```sh
     node scripts/backup.mjs check 2026-11-01T03-00-00Z
     node scripts/backup.mjs stage 2026-11-01T03-00-00Z
     ```
     then restart the application.
   - **A downloaded backup** holds the first household's cookbook, not the accounts or the other households. It goes into the empty kitchen while Kooks runs; then invite everyone again from **Household › Members**:
     ```sh
     node scripts/backup.mjs restore /data/kooks-2026-11-01.json
     ```

**Check** As for a damaged database: the log, the recipes and the week, then `node scripts/backup.mjs snapshot`.

## The owner can't sign in

**You notice** The owner doesn't remember which address they use, the sign-in email never arrives, or the mailbox is gone along with every passkey.

1. Find the address. It's `KOOKS_OWNER_EMAIL` in the application's environment variables in Coolify, and the terminal lists every household with its members and roles:
   ```sh
   node scripts/accounts.mjs list
   ```
2. If the email doesn't arrive, look in the log for `Kooks could not email a sign-in link` and fix the SMTP settings. Meanwhile, or if the mailbox is gone, print a link in the terminal:
   ```sh
   node scripts/accounts.mjs link ada@example.com
   ```
   It works once, in the next 15 minutes, and signs in whichever device opens it as that address, so open it yourself and paste it nowhere else. Once in, add a passkey under **Household › Sign-in**, so the next sign-in needs no email.
3. To move the owner to a new address:
   1. Set `KOOKS_OWNER_EMAIL` to the new address in Coolify and redeploy. The new address gets an account, but no household yet.
   2. Make it an owner of the first household (or of another with `--household <id>`, the id `list` shows in brackets):
      ```sh
      node scripts/accounts.mjs owner new@example.com
      ```
   3. Sign in with the new address (with step 2's link if its email doesn't arrive yet) and add a passkey.
   4. Delete the old address's account:
      ```sh
      node scripts/accounts.mjs remove old@example.com
      ```
      Taking it out under **Household › Members** isn't enough when someone else may have the old mailbox now, a lapsed domain say: the address keeps an account, so it can still sign in and start a household of its own. `remove` deletes the account with its passkeys, signed-in devices, waiting links and invitations, and takes it out of every household. It refuses the `KOOKS_OWNER_EMAIL` address (the server would make it a new account at its next start, hence step 1) and a household's last owner. It also stops at a household the old address is alone in, which may be one someone else started with it: add `--leave-empty` to leave that household with nobody in it, or first make the new address its owner with `owner new@example.com --household <id>`. If such a household has other members whom the old address brought in, `remove` asks for another owner there; remove those addresses first, then the old one with `--leave-empty`, rather than making one of them an owner. With `KOOKS_OPEN_SIGNUP` on, a deleted address can make a new account with an emailed link, so turn open sign-up off first if someone else may hold the mailbox.

**Check** `node scripts/accounts.mjs list` shows the new address as owner and marked `KOOKS_OWNER_EMAIL`, and **Household › Backup** shows the automatic copies' details, which only that address sees.

## When Kooks won't start

A container that stops at start has no terminal, but the server's shell can run the same image on the same volume for one command at a time. Open the server's shell (Coolify's **Terminal**, picking the server, or SSH), then find the image and volume of the stopped container:

```sh
docker ps -a --format '{{.Names}}  {{.Status}}'                          # the Kooks container
docker inspect --format '{{.Config.Image}}' <container>                  # its image
docker inspect --format '{{range .Mounts}}{{.Name}} {{.Destination}}{{end}}' <container>   # its volume, at /data
```

Then run a command with them, for example the steps of [a damaged database](#a-damaged-database):

```sh
docker run --rm -v <volume>:/data <image> node scripts/backup.mjs list
docker run --rm -v <volume>:/data <image> node scripts/backup.mjs check 2026-11-01T03-00-00Z
docker run --rm -v <volume>:/data <image> node scripts/backup.mjs stage 2026-11-01T03-00-00Z
```

and restart the application in Coolify. The staged copy goes in place before Kooks opens anything, so the damaged or too-new database never gets in the way. After a rollback, use the image you rolled back to.

A container run like this has none of the application's environment variables. For `accounts.mjs`, pass the owner's address so that `remove` keeps it, and the public address for `link`: `docker run --rm -e KOOKS_OWNER_EMAIL=ada@example.com -e KOOKS_PUBLIC_ORIGIN=https://kooks.example.com -v <volume>:/data <image> node scripts/accounts.mjs …`.

## A copy you take replaces the day's

Kooks keeps the newest copy of each day. A copy taken by hand with `snapshot` is newer than that morning's automatic one, so it takes its place once it passes its check. After something has gone wrong, such as a deploy that saved bad data or records deleted by mistake, don't take a copy until the kitchen looks right again, or the day's good copy may go. The copies of earlier days stay either way.
