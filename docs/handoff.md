# Kooks developer handoff

Reconciled October 9, 2026. This is the current continuation guide for the local browser app, MCP backend, and Capacitor mobile app. The public publication packages existing work; it does not implement missing features or represent a production release.

## Status and evidence

“Implemented and verified” below means source plus the stated automated checks, not a guarantee of production or real-device behavior. “Implemented but untested” means native code is present but has not been executed in its target environment. Historical browser/real-OCR checks in other guides are distinguished from fresh checks below.

| Area                                          | Status                                                                                  | Evidence and remaining boundary                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser/MCP core                              | Implemented and verified by automated tests                                             | `web/server.js`, `web/public/app.js`, `mcp/tools.js`, `mcp/kooks.js`, `mcp/shopping.js`, `mcp/quantities.js`, `mcp/store.js`: recipe editing/scaling, meals, independent occurrences, reviewed shopping contributions, equipment checks, cooking progress/timer deadlines, stale-write protection, retry IDs, history/undo, and persistent SQLite. No scheduling optimizer or server-delivered alarm.            |
| Eight household additions                     | Implemented in browser/MCP; domain/API behavior verified                                | `mcp/features.js`, `mcp/feature-tools.js`, `mcp/feature-schemas.js`, `mcp/imports.js`, `web/public/app.js`: pantry, leftovers, memory/variants, effort, taste profiles, shared tasks, costs, reviewed image imports. `test/features.test.js` covers domain behavior; OCR integration is separate. UI checks were recorded during original implementation.                                                        |
| Mobile core                                   | Implemented; storage/timer logic verified independently of native plugins               | `app/cookbook.js`, `app/model.js`, `app/repository.js`, `app/storage.js`, `app/timers.js`: recipes, portions, meals, shopping, weekly placement, independent cooking progress/timers, notes, favorites, export/restore. Browser uses IndexedDB, native uses Filesystem.                                                                                                                                          |
| Native bridges/projects                       | Implemented but native execution untested                                               | `app/native.js`, `ios/`, `android/`, `capacitor.config.json`: notifications, outbound share/export, haptics, Android back handling, app lifecycle, safe areas, icons, splash, privacy manifest. Web build/sync does not prove simulator compilation or plugin execution.                                                                                                                                         |
| AI assistance                                 | Partially implemented                                                                   | Mobile Assistant offers explicitly labeled preset demonstrations in `app/cookbook.js`. `mcp/server.js` exposes real validated actions to an external host agent. There is no built-in inference, arbitrary natural-language agent, or provider request implementation. Do not describe existing MCP actions as missing.                                                                                          |
| OpenAI/Claude login                           | Not implemented                                                                         | Mobile provider state is “Not connected”; no OAuth/device-login callback, credential/session store, refresh/revocation, or live provider integration. `docs/archive/ai-connections.md` is dated research, not an implemented authentication path.                                                                                                                                                                |
| Household accounts/cloud sync                 | Partially implemented local sharing; individual accounts and cloud sync not implemented | `web/server.js` supports a shared access key and one-day HttpOnly session on an explicitly enabled LAN listener. Member records describe tastes/assignees; they are not authenticated identities. The browser polls the same server; it has no offline database or cloud service.                                                                                                                                |
| Shared cookbook across mobile/browser/backend | Partially integrated                                                                    | Browser and MCP use the same SQLite store. Mobile is separate (`app/model.js`, `app/storage.js`) with a `kooks-mobile` JSON backup; backend exports schema version 2 (`mcp/backup.js`). No mobile/backend bridge, compatible backup importer, or cross-device sync exists. `shared/` holds the unit table and ingredient tokenizer both parsers now build on; data models and measurement policies still differ. |
| Mobile household parity                       | Not implemented for the eight additions as a set                                        | Mobile already has basic notes, recipe editing, meals, portions, and timers. It lacks the browser/MCP pantry suggestions, batch allocations, structured memories/preferred variants, effort filters, taste profiles, shared task ownership, costing/budgets, and reviewed OCR workflow. Implementing these server-side did not add them to mobile.                                                               |
| Imports                                       | Partially implemented                                                                   | Manual/paste capture and reviewed text parsing exist; browser/MCP can OCR images through `ocr/recognize.m` on macOS or Tesseract elsewhere. Mobile has no photo extractor. No direct WhatsApp archive connection, incoming native share extension, arbitrary website importer, or video extraction. Outbound native sharing is implemented.                                                                      |
| Release                                       | Not ready                                                                               | No verified native binaries/device runs, store signing/distribution, hosted household service, operational recovery exercise, or completed real-household pilot. Local backup implementations exist; do not confuse that with a hosted backup service.                                                                                                                                                           |

## Setup and entry points

Use Node.js 22.13 or newer. Install from the committed lockfile with `npm ci`.

| Command                 | Purpose                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`           | Browser/SQLite server at `http://127.0.0.1:4317`                                             |
| `node mcp/index.js`     | MCP stdio entry point; use an absolute executable/script path in a client                    |
| `npm run dev:mobile`    | Separate mobile browser preview at `http://127.0.0.1:5173`                                   |
| `npm run build:mobile`  | Vite production web bundle                                                                   |
| `npm run test:e2e`      | Playwright suites for the mobile interface and the browser app (`--project mobile` or `web`) |
| `npm run format:check`  | Prettier check enforced by CI; `npm run format` rewrites files                               |
| `npm run cap:sync`      | Build and regenerate copied assets/plugin configuration for both native projects             |
| `npm run native:doctor` | Diagnose required native tooling                                                             |
| `npm run build:ios`     | Unsigned simulator app; not a physical-device IPA                                            |
| `npm run build:android` | Debug APK; not a signed store release                                                        |

Private cookbook data defaults to `.data/kooks.sqlite`. Tests use temporary or in-memory databases; use `KOOKS_DB_PATH` to isolate manual testing too. Do not seed tests from a personal cookbook. Generated assets and dependencies are excluded from Git and recreated by installation/build/sync.

Backend schemas live in `mcp/schemas.js` and `mcp/feature-schemas.js`; keep validation and write behavior shared across browser and agent tools. Preserve optimistic versions, request IDs, snapshot semantics, and shopping preview tokens when adding new clients.

Native setup expected by the checked-in project: Xcode 26+ with iOS SDK/simulator on macOS; JDK 21+ and Android SDK Platform 36/build tools for Android. iOS deployment target is 15; Android minimum API is 24. `scripts/native-build.mjs` checks tooling. The publication environment still lacks the required native setup. Device signing and store credentials must remain outside Git.

## Meaningful verification

```sh
npm run format:check
npm test
KOOKS_TEST_OCR=1 npm test
npm run test:e2e
npm run cap:sync
npm run native:doctor
```

`npm test` covers domain rules, backup round-trips, independent SQLite connections, real MCP client persistence, HTTP access protection, mobile storage failure/recovery, and notification reconciliation. The OCR case is skipped unless explicitly enabled. macOS OCR needs command-line tools and system image services; other platforms need Tesseract. HTTP tests require permission to bind loopback ports. `test/assets.test.js` covers schema 2 image storage and its in-place upgrade; `test/mobile-logic.test.js` and `test/shared.test.js` cover the extracted mobile logic and the shared tokenizer; `test/ocr-cache.test.js` covers the compiled-helper cache without clang.

Playwright uses its managed Chromium by default (`npx playwright install chromium` once); `PLAYWRIGHT_CHANNEL=chrome` uses an installed Chrome and `PLAYWRIGHT_EXECUTABLE_PATH` points at a specific binary. The mobile project builds and previews the mobile interface and covers recipe editing/scaling/persistence, meal shopping, cooking/paused timers, backup restore, compatibility fallbacks, and narrow/wide layouts. The web project starts `web/server.js` on a fresh temporary database and covers pasted capture, pantry/household suggestions, planned meals reviewed into one shopping list, cooking with tasks, timers and leftovers, prices and budgets, memories and variations, and export. Neither executes native plugins. Use synthetic records.

Fresh publication validation on October 9, 2026:

- `KOOKS_TEST_OCR=1 npm test`: 29 passed, zero failures or skips, including real local OCR and HTTP/MCP integration. Run with loopback/system-service permissions available.
- `npm run test:mobile:e2e`: all 6 browser workflows passed in Chrome; this also built the mobile production bundle.
- `npm run cap:sync`: production web build and synchronization of both native projects passed.
- `npm run native:doctor`: native setup still required (Xcode, JDK, Android SDK). No native binary or physical-device run is claimed.

Follow-up validation on October 9, 2026, after the review follow-ups (CI, Prettier, image storage, OCR cache, mobile extraction, shared tokenizer, web suite):

- `npm run format:check`, `npm test` (45 passed, the OCR case skipped) and `npm run build:mobile` pass on Linux; the GitHub Actions workflow runs the same steps plus both Playwright projects.
- `npm run test:e2e`: 6 mobile and 7 web workflows passed in Chromium.
- Image storage: with 20 images of 3 MB, `/api/state` fell from about one second to under 10 ms and the database from roughly 3x to 1x the image bytes. Schema 1 databases upgrade in place on first open.
- Native builds, real OCR and physical devices were not exercised in this environment.
- Gitleaks 8.30.1 found no secrets in the reviewed publication snapshot. All 31 bundled PNGs were visually inspected; they contain app artwork and a synthetic OCR fixture, with no EXIF/IPTC/XMP/comment metadata.

Earlier September implementation notes report successful additional browser checks. They remain historical evidence, not fresh tests of every screen.

## Ordered continuation work

1. **Establish a reproducible native baseline.** Install the tooling, run doctor/sync and both native builds, then test on actual iOS and Android devices. Acceptance: record versions/results for cold launch, keyboard/safe areas, back navigation, offline editing, export/restore, failed storage, termination/relaunch, notification permissions, pause/resume/cancel, and locked-screen delivery. Document platform timing limits; Android ordinary notifications do not guarantee exact alarms. Also confirm that the Filesystem plugin's `rename` replaces an existing `cookbook.json` on both platforms, which `app/storage.js` relies on for atomic saves.
2. **Choose and implement the shared cookbook contract.** Start with `app/model.js`, `app/storage.js`, `mcp/store.js`, and `mcp/backup.js`. Decide canonical records, migration, backup compatibility, offline queueing, duplicate prevention, and conflict handling before wiring mobile to HTTP. Acceptance: a recipe/meal edited in either client appears correctly in the other; simultaneous edits preserve data; offline retries do not duplicate shopping or actions; existing mobile and backend backups migrate without loss or silent reset. Extend `shared/` for logic both clients need rather than adding a third copy.
3. **Add real household identity and access.** Start with `web/server.js` and schema/access boundaries. Choose hosting, membership/invitation model, credentials, TLS, and per-household authorization. Acceptance: two members share the intended records; an unrelated household cannot read or mutate them; revoked access stops working; login/logout/session expiry and network failures are tested. Retain a usable local mode if part of the agreed scope.
4. **Bring the eight household additions to mobile.** Reuse the backend's validated operations and reference `web/public/app.js`/`mcp/features.js`; avoid diverging arithmetic and import rules. Acceptance: each of the eight workflows is exercised on both mobile platforms with synthetic records, including rejected over-allocation, stale shared tasks, incomplete costs, unknown effort/spice, preferred variants, and required image review.
5. **Implement supported AI connections and live assistance.** Recheck provider documentation, choose approved login or explicit API-key fallback and billing, and define autonomy/data-sharing boundaries. Start from the mobile Assistant and MCP action contracts. Acceptance: actual login/cancel/expiry/reconnect/revocation for each selected provider; a real recipe or meal request produces a reviewable validated action; undo, retries, stale data, provider failure, and manual continuity work. Never embed provider secrets in client bundles or claim consumer login equals API entitlement.
6. **Complete the pilot and release process.** Validate languages/units, accessibility, realistic import samples, and cooking behavior with an agreed pilot. Settle incoming sharing/URL import and advanced scheduling requirements explicitly. Acceptance: platform builds and all relevant checks pass; release scope and known limitations are documented; signing/distribution, hosted service configuration if selected, backup/restore recovery, and support/update procedures are ready. Source publication alone does not satisfy this gate.

These are ordered implementation steps, not claims that one person must finish every item before independent work can proceed. Do not implement speculative features simply because older documents mention them.

## Documentation precedence and publication privacy

Use this handoff, `docs/decisions.md`, and current implementation guides as status authority. Research, product brief, project plan, meal design, and prototype review retain historical rationale but carry a superseded-status notice. In particular: platform choice is settled; browser/MCP batching, photos, history, and backups now exist; native compilation and connected AI remain unfinished.

The public snapshot excludes runtime databases/WAL files, personal uploads/photos, cookbook backups, environment files, signing credentials, logs, local tooling, and generated outputs. Personal discovery context was removed from public documentation; original notes remain local in the ignored data directory. Bundled recipes and the OCR image are synthetic examples, not a household archive. Review the exact staged content and full included Git history for every future public push; ignore rules cannot protect already-tracked private files.
