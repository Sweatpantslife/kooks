# Current decisions and open questions

Reconciled October 9, 2026 against the source. See [the developer handoff](handoff.md) for evidence, tests, and acceptance criteria. Personal discovery notes are not part of the public repository.

## Selected and implemented

- Household cooking is the product scope: recipe capture, editing, portions, meals, shopping, equipment, guided cooking, and cooking notes.
- Capacitor is selected for both iOS and Android. Earlier proposals treating platform choice as undecided are historical.
- Node.js and SQLite implement the local MCP backend and persistent browser app. They share validated domain actions and a cookbook.
- The mobile interface has a separate data model and local persistence. Its packaged app operates without the desktop server; this does not provide household synchronization.
- All eight household additions are implemented in the browser/MCP layer: pantry suggestions, leftovers/batching, cooking memory/variants, effort filters, taste profiles, shared tasks/timer ownership, cost estimates, and reviewed photo imports. Older deferrals of these additions are superseded.
- Backup/restore and reversible action history exist in the backend; mobile has its own backup format and storage recovery. Prototype-era statements saying no backups/history exist do not describe the present code.
- Logic both clients need lives in `shared/` as dependency-free modules; image bytes live outside record documents and history (database schema 2).
- Imported recipe text is data. Preserve source values, unknown quantities, independent shopping contributions, and cooking snapshots. Retries and undo must not overwrite later changes.
- Recipe links are stored addresses, never fetched by the server. Both apps embed YouTube, Vimeo, Facebook, Instagram and TikTok players from `shared/links.js`, load a player only when the person presses play, and keep every other link a plain link.
- Techniques, the inspiration board and the ebook shelf are browser/MCP records (`mcp/library*.js`). Uploaded photos and PDF/EPUB files are immutable assets in SQLite, checked by signature, served only to the household and never read or summarized by the server; portable backups include them. The mobile app does not have these sections.

## Open decisions and unfinished delivery

- Choose the canonical shared cookbook and a mobile/backend migration/sync contract, including offline conflict resolution and compatible exports.
- Define individual household membership, joining, authorization, and hosting. A shared LAN key and preference profiles are not individual accounts.
- Confirm native feature parity and the first mobile release scope.
- Select a supported OpenAI/Claude integration and credential boundary. Account login, API access, and subscription entitlements are distinct; no API-key fallback or billing policy is assumed.
- Set assistant autonomy: reviewable proposals, reversible execution, or advisory-only behavior.
- Validate actual device timer behavior, incoming sharing, interface/recipe languages, right-to-left needs, regional units, accessibility, and import quality.
- Establish signing, distribution, durable operational backups, recovery, and release acceptance criteria.

The historical phase plan remains useful design context, but completion must be assessed per feature and platform rather than by its old phase numbers.
