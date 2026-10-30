# Changelog

What changed in Kooks and how each change was verified, newest first. Kooks has no tagged releases yet; `package.json` has said 0.2.0 since the first publication. Add an entry under **Unreleased** with every change: what changed, the checks run with their counts, and what was not exercised.

## Unreleased

### The redesigned app's foundation, at /next/

A new app for browser and phone starts in `client/` (Preact with signals, built by Vite) and the server shows it at `/next/` beside the current one, which stays at `/` until the new app covers everything. This first part is the frame the rest is built in: the Market look (warm white, tomato and herb, Bricolage Grotesque titles, light and dark, field borders and focus ring at 3:1 or more), three tabs (Week, Recipes, Groceries) at the bottom on phones and in a rail from 840 px, Household behind the initials, the kitchen kept up to date every 3 seconds with only the changed records, changes that retry with the same request id and offer Undo, sign-in by passkey (including the quiet suggestion in the email field) or emailed link, and Household with the look, passkeys and sign-out. Week, Recipes and Groceries say what is coming and link to the current app. Addresses from the current app (`#/today`, `#/shop/pantry`, `#/settings/…`) open the page that replaces them. The Docker image builds the app in a separate stage; CI runs `npm run build:client`.

`npm run format:check`, `npm run lint`, `npm test` (105 tests: 104 passed, the OCR case skipped; 3 new) and `npm run test:e2e` (38 passed; 8 new in the `next` project, which scan every page with axe-core for WCAG 2.2 AA and best practices at 390 and 1280 px in light and dark, with 0 violations) pass. Not exercised: the Docker build (no Docker here), Safari and Firefox, and a real device's passkey prompt.

### Security policy, contributing guide, .env.example and changelog

Added this changelog, [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and a commented [.env.example](.env.example) with every setting the servers read. The dated verification log moved here from the [developer handoff](docs/handoff.md). Documentation only: `npm run format:check` and `npm run lint` pass, and the server starts with the loopback and private-network settings the example describes.

### ESLint ([#21](https://github.com/Sweatpantslife/kooks/pull/21))

`npm run lint` runs ESLint 10's recommended rules and CI runs it after the Prettier check. Of the 18 problems the rules first reported, four were in the code: a lost passkey error cause, a dead assignment and two intentional patterns that now say so. `npm run lint`, `npm run format:check`, `npm test` (89 tests: 88 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (27 passed) pass on Linux.

### HSTS, sandboxed video players and a stricter SMTP client ([#20](https://github.com/Sweatpantslife/kooks/pull/20))

Behind an HTTPS origin responses send `Strict-Transport-Security` without `includeSubDomains`. Video players in both apps are sandboxed without top navigation; the PDF reader is not, because Chrome refuses to render PDFs in a sandboxed frame. The mail client refuses STARTTLS when the server sent bytes after its go-ahead, and connecting and both TLS handshakes now time out. The new mail test fails on the old client. `npm run format:check`, `npm test` and `npm run test:e2e` (23 passed) pass. Real YouTube, Vimeo, Facebook, Instagram and TikTok players were not tried under the sandbox.

### Accessibility: focus through redraws, reachable Undo, announcements, contrast ([#14](https://github.com/Sweatpantslife/kooks/pull/14))

Both apps keep focus, typing and open sections when a page redraws, the Undo message can be reached, paused and gives focus back, finished timers and search results are announced, and focus rings and field borders have more contrast. `npm test` (72 passed, the OCR case skipped) and `npx playwright test` (27 passed, 4 new) pass. An ad-hoc axe-core scan of every web route and mobile view, light and dark, at 390 and 1280 px, found 172 violation entries before and 0 after; it is not committed.

### Dependency upgrades ([#12](https://github.com/Sweatpantslife/kooks/pull/12))

zod 4.6.7 checks size limits before parsing a list's entries, the MCP SDK moved to 2.4.0, and Vite, sharp and the Capacitor CLI moved past their advisories; `npm audit` reports no vulnerabilities. A flaky mobile test that compared two cookbooks made a millisecond apart now compares one cookbook with its own round trip (6 of 40 runs failed before, 0 of 40 after). `npm run format:check`, `npm test` (85 tests: 84 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (23 passed) pass after merging main.

### Sign-in link requests answered the same way for everyone ([#19](https://github.com/Sweatpantslife/kooks/pull/19))

Members and strangers get the same immediate answer, before any email is sent, and strangers cannot spend the members' email budget; mail trouble goes to the log instead of the response. The new test fails against the old code. `npm run format:check`, `npm test` and `npm run test:e2e` pass.

### Writes check only the records they touch ([#18](https://github.com/Sweatpantslife/kooks/pull/18))

`test/relations.test.js` runs 600 seeded writes and, after each accepted one, the full relation check, and confirms that every refusal still happens; another test shows that saving, varying and archiving a recipe never lists a whole kind. `npm run format:check` and `npm test` pass, and the stack of performance changes passes `npm run test:e2e` (24 passed).

### Android shares only exports and backs up only the cookbook ([#17](https://github.com/Sweatpantslife/kooks/pull/17))

`test/native-config.test.js` keeps the FileProvider paths, the export path, the backup rules and the storage folder in step. `npm run format:check`, `npm test` (76 passed, 1 skipped) and `npm run test:e2e` (23 passed) pass. The Android project was not compiled here (no Android SDK), and export and share were not tried on a device.

### Kooks-shaped record ids, escaped ids in markup and a mobile CSP ([#16](https://github.com/Sweatpantslife/kooks/pull/16))

`test/security.test.js` covers the accepted and rejected id shapes, free-text request ids, backups with hostile ids, unescaped ids in either app's markup and the mobile Content Security Policy; every mobile browser test now fails on a policy violation. `npm run format:check`, `npm test` (78 passed, 1 skipped) and `npm run test:e2e` (23 passed) pass.

### Request body limits per route and large uploads in turns ([#15](https://github.com/Sweatpantslife/kooks/pull/15))

The new test refuses a declared 50 MB sign-in body before reading it, answers 413 to oversized bodies and 429 to a third concurrent upload, and accepts a 200,000-character recipe and a 3 MB PDF. `npm run format:check`, `npm test` (76 passed, 1 skipped) and `npm run test:e2e` (23 passed) pass.

### Plural and abbreviated units combine ([#13](https://github.com/Sweatpantslife/kooks/pull/13))

Shopping, pantry stock and costs treat plural and abbreviated spellings of a unit as one unit, with failing-first tests in the shared, workflow, features and mobile suites. `npm run format:check`, `npm test` (76 passed, the OCR case skipped) and `npm run test:e2e` (23 passed) pass.

### Dinner suggestions linear in cookbook size ([#11](https://github.com/Sweatpantslife/kooks/pull/11))

Suggesting from 1,000 recipes takes about 0.25 s instead of 11.2 s, and a new test fails above 1 s. `npm run format:check`, `npm test` (73 passed, the OCR case skipped) and `npm run test:e2e` (23 passed) pass.

### Sign-in links and the accepted host come from a configured origin ([#10](https://github.com/Sweatpantslife/kooks/pull/10))

Beyond loopback the server needs `KOOKS_PUBLIC_ORIGIN`, builds sign-in links from it and refuses any other `Host`; forged `X-Forwarded-For` no longer escapes the throttle. The three new or extended tests fail against the old code. `npm run format:check`, `npm test` (74 passed, the OCR case skipped) and `npm run test:e2e` (23 passed) pass.

## October 9, 2026

### Interface redesign merged with facets, techniques, ideas, books and sign-in ([#9](https://github.com/Sweatpantslife/kooks/pull/9))

`npm run format:check`, `npm test` (72 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (9 mobile, 12 web and 2 web-auth workflows) pass on Linux with the preinstalled Chromium selected through `PLAYWRIGHT_EXECUTABLE_PATH`. Techniques, ideas and books became section tabs of Recipes, the member's sign-in became a Settings tab, and the ways back follow the redesign's routes and labels; the browser checks cover all of them.

### Interface redesign ([#9](https://github.com/Sweatpantslife/kooks/pull/9))

`npm run format:check`, `npm test` (52 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (7 mobile and 9 web workflows) pass on Linux with the preinstalled Chromium. Every page of both apps was screenshotted at 320, 390, 768 and 1280 px in the light and dark themes and inspected; the browser app reports no console errors under its Content Security Policy. Native WebViews, real devices and the system dark mode of iOS and Android were not exercised.

### Recipe facets ([#7](https://github.com/Sweatpantslife/kooks/pull/7))

Measured after merging the techniques, inspiration and library change, the back links and the passkey sign-in: `npm run format:check`, `npm test` (72 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (9 mobile, 11 web and 2 web-auth workflows) pass on Linux with the preinstalled Chromium selected through `PLAYWRIGHT_EXECUTABLE_PATH`. The browser checks cover the course, diet and tag filters, chips on cards and recipe pages, the editor round trip and the dinner finder; the mobile checks cover the same filters, the editor and persistence after a reload. Native builds, real OCR and physical devices were not exercised.

### Passkeys and emailed links ([#6](https://github.com/Sweatpantslife/kooks/pull/6))

the shared household access key is gone. `npm run format:check`, `npm test` (69 tests: 68 passed, the OCR case skipped) and `npm run test:e2e` (7 mobile, 9 web and 2 web-auth workflows) pass on Linux with the preinstalled Chromium selected through `PLAYWRIGHT_EXECUTABLE_PATH`. The unit suite exercises passkey verification with a software authenticator for all three offered algorithms, the SMTP client against a fake server over STARTTLS and implicit TLS, and the HTTP flows (link request and single use, expiry, sliding sessions, passkey registration, sign-in, replay refusal, removal, revocation, mail failure and throttling). The browser suite drives Chromium's virtual authenticator through the email link, the passkey prompt, sign-out, the button and the suggested-passkey ways back in, and passkey removal. No real mail provider, real authenticator hardware or HTTPS deployment was exercised here.

### Techniques, inspiration and library ([#5](https://github.com/Sweatpantslife/kooks/pull/5))

`npm run format:check`, `npm test` (58 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (7 mobile and 9 web workflows) pass on Linux with the preinstalled Chromium (`PLAYWRIGHT_EXECUTABLE_PATH=/opt/pw-browsers/chromium`). The browser check uploads a synthetic PDF, adds a bookmark and confirms that the reader frame is created only on request and points at the bookmarked page; no real PDF was rendered, and the frame was not exercised in Firefox, Safari or a native WebView. Ebook uploads near the 64 MB limit were not timed over a real network.

### Links and videos ([#4](https://github.com/Sweatpantslife/kooks/pull/4))

`npm run format:check`, `npm test` (52 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (7 mobile and 8 web workflows) pass on Linux with the preinstalled Chromium. The browser checks confirm that a player is created only after play is pressed and carries the expected provider address; no real video was loaded, and the embeds were not exercised inside a native WebView.

### Review follow-ups: CI, Prettier, image storage, OCR cache, mobile extraction, shared tokenizer, web suite ([#2](https://github.com/Sweatpantslife/kooks/pull/2))

- `npm run format:check`, `npm test` (45 passed, the OCR case skipped) and `npm run build:mobile` pass on Linux; the GitHub Actions workflow runs the same steps plus both Playwright projects.
- `npm run test:e2e`: 6 mobile and 7 web workflows passed in Chromium.
- Image storage: with 20 images of 3 MB, `/api/state` fell from about one second to under 10 ms and the database from roughly 3x to 1x the image bytes. Schema 1 databases upgrade in place on first open.
- Native builds, real OCR and physical devices were not exercised in this environment.
- Gitleaks 8.30.1 found no secrets in the reviewed publication snapshot. All 31 bundled PNGs were visually inspected; they contain app artwork and a synthetic OCR fixture, with no EXIF/IPTC/XMP/comment metadata.

### First publication

- `KOOKS_TEST_OCR=1 npm test`: 29 passed, zero failures or skips, including real local OCR and HTTP/MCP integration. Run with loopback/system-service permissions available.
- `npm run test:mobile:e2e`: all 6 browser workflows passed in Chrome; this also built the mobile production bundle.
- `npm run cap:sync`: production web build and synchronization of both native projects passed.
- `npm run native:doctor`: native setup still required (Xcode, JDK, Android SDK). No native binary or physical-device run is claimed.

Earlier September implementation notes report successful additional browser checks. They remain historical evidence, not fresh tests of every screen.
