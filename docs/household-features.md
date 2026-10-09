# Kooks household features

The eight requested additions are implemented in the browser interface and the shared MCP/SQLite backend. This is a working local app with persistent data, not an in-memory experience prototype. The native Capacitor app added separately under `app/` retains its own interface and storage; these additions do not automatically appear there.

## Start

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4317`. `npm run web` starts the same server. `PORT` changes the port and `KOOKS_DB_PATH` selects another SQLite database. The default is `.data/kooks.sqlite`, shared with the MCP process. `npm start` still starts the original MCP transport.

No examples are inserted into the household database. Add a recipe manually, paste text, or import a photo to begin. The app keeps the existing warm, editorial cookbook direction and adapts to phone and desktop widths.

## The eight additions

1. **Cook with what you have.** Pantry records can be a simple availability checklist, or can contain known quantities. Flag ingredients to use soon. Today ranks saved recipes by missing ingredient groups, use-soon matches and selected eaters. Known compatible quantities are deducted once in the preview, including duplicate ingredient lines. Unknown or incompatible amounts remain visible for checking. Matching uses normalized names and preparation, not guessed ingredient synonyms. No pantry amounts are silently consumed when cooking.
2. **Leftovers and batch cooking.** Record a cooked recipe batch, its actual portions, cooking date and storage. Allocate portions to dated meals or an undated freezer reserve, and mark allocations eaten. Remaining and unallocated portions are distinct. Over-allocation is rejected. Leftover allocations appear in the week without adding groceries or duplicating cooking costs. A batch linked to a finished session keeps the actual cooked snapshot and cannot be created twice for the same session dish. Storage dates are records, not inferred food-safety deadlines.
3. **Remember your tweaks.** Add ratings, cook-again preference, actual changes and next-time reminders to cooking notes. Recipe views and cooking sessions surface relevant notes. Save a complete reviewed variation and mark one version preferred. Originals and source text/photos are retained, and changing the preferred variant is atomic and undoable. The preferred version is offered explicitly rather than changing an already planned or cooking recipe.
4. **Choose by effort.** Recipes have optional hands-on minutes, total minutes, cooking pan count, cleanup effort and spice level. Today supports separate time/pan/cleanup filters. Unknown effort is excluded when its filter is active, with an explanation. Hands-on time cannot exceed total time. Serving changes preserve recorded times instead of multiplying them.
5. **Household taste profiles.** Record names, liked/disliked ingredients or tags, spice tolerance and notes. Select the actual eaters for dinner suggestions; dislikes can be excluded or shown as conflicts. Unknown spice remains explicitly unknown. These are taste preferences, not allergen certifications.
6. **Cook together.** Persistent cooking sessions have dish progress, shared tasks, assignees and completion, plus timers with a responsible person. Browsers refresh saved changes every three seconds. Dirty forms are retained when another cook changes data, and stale saves are rejected. A client must reopen a stale form to review the newer record. Countdown deadlines persist; the browser does not promise locked-screen alerts.
7. **Meal cost estimates.** Save user-confirmed package prices, dates, currency and manual/receipt provenance. A receipt price is entered and confirmed manually. Costing uses the latest compatible price on or before the estimate date; units normalize within supported dimensions. Missing quantities/prices leave the total incomplete and show a known subtotal. Recipe views show per-portion cost when complete. Spending compares planned cooking occurrences with a Monday-start weekly budget. No exchange rates, retailer prices or density conversions are invented. Costs describe ingredients used, not checkout package totals.
8. **Screenshot/photo import.** Upload PNG, JPEG or WebP up to 8 MB. macOS uses Apple's local Vision text recognition through a small Objective-C helper; other systems use the `tesseract` executable. The original image stays beside editable recipe fields. Text extraction preserves unknown yields, ambiguous units and unstructured source text. English and Hebrew section headings are recognized by the conservative parser; OCR language/handwriting quality depends on the local engine. The review checkbox is required before committing a draft. Saving again with the same action key cannot create a duplicate recipe.

## Photos

On macOS install Apple's command line tools if needed (`xcode-select --install`). Full Xcode is not required for the OCR helper. The helper is compiled once per source revision into `~/Library/Caches/kooks` (override the location with `KOOKS_CACHE_DIR`) and reused by later imports. On other platforms install Tesseract through your usual package manager. Photo content is processed locally and is not uploaded to a model provider. OCR runs outside database transactions; errors leave the cookbook unchanged. An unreadable image can be retried or entered as text.

Original images are retained in SQLite and included in portable backups. Header/type and size checks reject invalid uploads; the macOS helper also bounds image dimensions. Large photo libraries increase database, history and backup size.

## Sharing a household server

By default the server accepts only loopback connections. Multiple tabs can use the same cookbook, and a connected MCP client can use the same database. To use other devices on a trusted private network, explicitly configure `KOOKS_HOST=0.0.0.0` and a `KOOKS_ACCESS_TOKEN` of at least 24 characters, then open this computer's LAN address on each device. The browser asks for the household key and receives a one-day HttpOnly session cookie. Keep the service on a trusted network; plain HTTP is not suitable for public access. No LAN listener is enabled automatically.

This is one shared household with one shared access key, not per-person accounts. Person profiles identify preferences and task assignments. The server must remain running; the browser interface does not have offline storage or cloud synchronization. The separate native app can still operate using its own local storage.

## Data, compatibility and checks

All mutations use the same validated tools, SQLite transactions, optimistic versions, request keys and reversible history as the original MCP implementation. `backup_export` now emits schema version 2 and includes the new records and photos. Restore accepts both versions 1 and 2 and still requires an empty database. It rejects invalid references and over-allocated batches atomically. Browser Export cookbook downloads this portable JSON.

```sh
npm test
KOOKS_TEST_OCR=1 npm test
```

The second command exercises actual local OCR as well as the domain, stdio integration, HTTP and existing native-storage tests. HTTP tests bind ephemeral loopback ports; the OCR integration requires the system image service or installed Tesseract. Restricted sandboxes may need permission for these tests.

Implementation verification: all 29 tests passed with real OCR enabled on macOS. Browser checks used an isolated temporary database, preserving the user's cookbook. They exercised dinner filtering, leftover allocation, task assignment/completion, preferred variants, photo review and cost entry, with phone-width overflow checks. The native interface was not modified by this feature work.
