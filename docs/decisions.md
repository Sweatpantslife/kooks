# Current decisions and open questions

Reconciled October 9, 2026 against the source. See [the developer handoff](handoff.md) for evidence, tests, and acceptance criteria. Personal discovery notes are not part of the public repository.

## Selected and implemented

- Household cooking is the product scope: recipe capture, editing, portions, meals, shopping, equipment, guided cooking, and cooking notes.
- Capacitor is selected for both iOS and Android. Earlier proposals treating platform choice as undecided are historical.
- Node.js and SQLite implement the local MCP backend and persistent browser app. They share validated domain actions and a cookbook.
- The phone app is the same client as the browser's, packaged with Capacitor, and works on the household's kitchen: it signs in with an emailed six-digit code and keeps a device token, because an emailed link opens in the browser and a passkey belongs to the kitchen's web address. The previous phone app's separate cookbook, data model and backup format are retired; the recipes written in it come into the kitchen once, when the member asks.
- All eight household additions are implemented in the browser/MCP layer: pantry suggestions, leftovers/batching, cooking memory/variants, effort filters, taste profiles, shared tasks/timer ownership, cost estimates, and reviewed photo imports. Older deferrals of these additions are superseded.
- Backup/restore and reversible action history exist in the backend. Prototype-era statements saying no backups/history exist do not describe the present code.
- Logic both clients need lives in `shared/` as dependency-free modules; image bytes live outside record documents and history (database schema 2).
- Imported recipe text is data. Preserve source values, unknown quantities, independent shopping contributions, and cooking snapshots. Retries and undo must not overwrite later changes.
- Recipes carry four facets for search and filtering: a course and diet labels from the fixed lists in `shared/taxonomy.js`, a free-text cuisine and free tags. The app filters on them, the MCP server exposes `recipe_taxonomy` so an agent reuses the household's names, and the previous phone app's single label becomes a tag when its recipes come in. A filter never matches an unrecorded facet, and diet labels are household declarations, not allergen checks.
- Household members sign in with passkeys, with a one-time emailed link as the fallback and as the first proof of an address; the list in `KOOKS_HOUSEHOLD_EMAILS` is the membership. Passkeys are verified with Node's own crypto in `web/webauthn.js` and links are sent by the small SMTP client in `web/mail.js`; neither adds a dependency. Loopback-only use stays sign-in free.
- The browser app was redesigned from scratch in October 2026 and replaced the previous one: a Preact client in `client/`, built by Vite and served at `/`, that talks to the server only through `/api/state` and the validated tools. Three tabs, Week, Recipes (recipes, meals, ideas, techniques and books) and Groceries (to buy, by aisle, and at home), with Household (people, prices and budget, look and units, sign-in, backup) behind the household's initials. Cooking is a full-screen mode with a Now cooking bar elsewhere. The previous app's addresses redirect. `docs/ia-ux.md` is the authority. The phone app is the same client.
- The look is "Market": warm white, tomato for actions and herb for what is done or at home, Bricolage Grotesque titles and the system sans for text, with a device-following dark theme that Household can fix per browser. Every color is a token in `client/src/styles/tokens.css`.
- Costs moved from each recipe to the week: Household › Prices and budget and one line on the Week count what the planned food comes to. Shared cooking jobs with owners live in cooking mode beside the timers, and a recipe lists every time it was cooked under "Cooked before", with Add a note for cooking done without the stove.
- Recipe links are stored addresses, never fetched by the server. The app names YouTube, Vimeo, Facebook, Instagram and TikTok videos from `shared/links.js` and opens every link in a new tab, or the phone's browser.
- Techniques, the inspiration board and the ebook shelf are browser/MCP records (`mcp/library*.js`). Uploaded photos and PDF/EPUB files are immutable assets in SQLite, checked by signature, served only to the household and never read or summarized by the server; portable backups include them.

## Open decisions and unfinished delivery

- Decide what the phone keeps for use without a connection, and how changes made offline meet changes made meanwhile.
- Decide how members join beyond the configured address list (invitations from inside the app), whether taste profiles should link to sign-in identities, and hosting for more than one household on a server.
- Confirm the first phone release scope.
- Select a supported OpenAI/Claude integration and credential boundary. Account login, API access, and subscription entitlements are distinct; no API-key fallback or billing policy is assumed.
- Set assistant autonomy: reviewable proposals, reversible execution, or advisory-only behavior.
- Validate actual device timer behavior, incoming sharing, interface/recipe languages, right-to-left needs, regional units, accessibility, and import quality.
- Establish signing, distribution, durable operational backups, recovery, and release acceptance criteria.

The historical phase plan remains useful design context, but completion must be assessed per feature and platform rather than by its old phase numbers.
