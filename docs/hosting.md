# Hosting the household web app

The root Dockerfile runs the shared browser/MCP backend on Node 22 with local Tesseract OCR. This is a single household service with one shared access key, not individual accounts or mobile cloud sync.

## Coolify

Create an application from this repository using the Dockerfile build pack. Expose container port `4317` through Coolify's HTTPS proxy; do not map it directly to a public host port. Set the domain to the intended HTTPS origin and enable HTTP-to-HTTPS redirection.

Set these runtime environment variables (never build arguments or committed secrets):

- `KOOKS_PUBLIC_ORIGIN`: the exact HTTPS origin, for example `https://kooks.example.com`.
- `KOOKS_ACCESS_TOKEN`: a randomly generated household key of at least 24 characters. Keep it in the deployment secret store and share it privately with household members.

Alternatively, set `KOOKS_ACCESS_TOKEN_FILE=/data/household.key` and provision that private file in the persistent volume (owned by UID 1000, mode 0600). The file takes precedence over the environment value. This keeps the key out of container environment inspection and build/deployment logs. Back it up privately with the volume and never commit it.

The image sets `KOOKS_HOST=0.0.0.0`, `PORT=4317`, and `KOOKS_DB_PATH=/data/kooks.sqlite`. Mount a dedicated persistent Docker volume at `/data`; it must be writable by the image's `node` user (UID 1000). Never share that volume with another application. Keep one application replica, and stop the old container before a replacement starts.

Ebook uploads for the library reach the server as JSON bodies of up to 96 MB (a 64 MB file in base64) and may take a few minutes on a slow connection; the server allows five minutes per request. Make sure the HTTPS proxy's request body size and timeout limits allow that, or uploads fail before Kooks sees them. Books and photos live in the same SQLite file, so size the volume and its backups accordingly.

The Docker health check requests `GET /healthz`. It exposes no cookbook records. API requests require login, and hosted sessions use Secure, HttpOnly, SameSite=Strict cookies. POST requests must originate from the configured HTTPS origin. Forwarded headers cannot change that origin. Sessions are held in memory and users sign in again after a restart.

## Verification and recovery

After deployment, verify HTTPS and the HTTP redirect, unauthenticated API rejection, login, recipe save/reload/edit, and persistence after a container restart. Test only synthetic records and archive them afterward. Verify the running commit in Coolify's deployment log.

Export the cookbook through the authenticated application and store backups privately outside the server. A volume is persistence, not a backup. For filesystem-level backups, stop the application and snapshot the complete data volume, including SQLite WAL files. Restore into an isolated volume and test before replacing live data.

If health checks, login, or saves fail, stop the new deployment and redeploy the last verified commit with the same volume and runtime configuration. Back up before schema upgrades; restoring older code is not safe when it cannot read the current database schema.
