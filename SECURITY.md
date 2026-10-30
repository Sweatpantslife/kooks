# Security policy

## Supported versions

Kooks has no releases yet. Fixes land on `main`, so run the latest commit of `main`.

## Reporting a vulnerability

Report it privately through GitHub: on the repository's **Security** tab choose **Report a vulnerability**, or open [a new advisory](https://github.com/Sweatpantslife/kooks/security/advisories/new) directly. Please do not open a public issue or pull request for a vulnerability that is not fixed yet.

Include what you found, how to reproduce it (steps or a proof of concept), the commit you tested and how that server was set up: loopback only, shared on a private network with a plain-HTTP `KOOKS_PUBLIC_ORIGIN`, or hosted behind HTTPS. Use synthetic data. Never send a real household's cookbook, sign-in links or codes, session cookies, device tokens or passkey material.

The report, the fix and its disclosure are coordinated in the private advisory. The advisory is published once the fix is on `main`.

## What Kooks protects

[Hosting](docs/hosting.md) and [household features](docs/household-features.md) describe the model in full. In short:

- The browser server (`web/`) binds to loopback and asks nobody to sign in. Any other address, a `KOOKS_PUBLIC_ORIGIN` or a household address list turns sign-in on, and beyond loopback the server only answers to the host in `KOOKS_PUBLIC_ORIGIN`. Only the addresses in `KOOKS_HOUSEHOLD_EMAILS` get in, with a passkey or a one-time emailed link, and sessions are HttpOnly, SameSite=Strict cookies. Behind HTTPS the cookies are also Secure and responses send HSTS. The phone app signs in with a six-digit emailed code (one live code per address, ten minutes, five guesses, and at most twenty wrong guesses per address a day, counted from anywhere and reset by a right one) and sends a device token in an `Authorization` header. Only the Capacitor origins `capacitor://localhost` and `https://localhost` may call `/api/` across origins, only with sign-in on, and their requests never count a cookie; email links and passkeys are refused from them whatever they carry. A kitchen whose own address is `https://localhost` treats that origin as a browser's.
- The MCP server (`mcp/`) speaks stdio to the agent that started it, trusts that agent with the cookbook and tells it to treat recipe and source text as data, never as instructions.
- Recipe links are stored, never fetched by the server. Embedded video players load only when played, in a sandbox that cannot navigate the Kooks page. Uploaded photos and ebooks are checked by signature and stored, never summarised by the server; only a photo sent for recipe import is read, by local OCR, and nothing is sent to a model provider.
- The mobile app (`app/`) keeps its cookbook in the device's private app storage and does not talk to the Kooks server.

Reports about any of these are in scope, as are the dependencies Kooks ships. Out of scope: attacks that need control of the machine or account running Kooks, of the MCP host agent or of the deployment's environment variables, and the documented limit that plain-HTTP LAN sharing is unencrypted.

## Dependencies

Dependabot security updates are enabled, and `npm audit` should report no vulnerabilities on `main`.
