# Kooks household features

The eight requested additions are implemented in the browser interface and the shared MCP/SQLite backend. This is a working local app with persistent data, not an in-memory experience prototype. The phone app is the same client, so they are there too.

## Start

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4317`. `npm run web` starts the same server. `PORT` changes the port and `KOOKS_DB_PATH` selects another SQLite database. The default is `.data/kooks.sqlite`, shared with the MCP process. `npm start` still starts the original MCP transport.

No examples are inserted into the household database. Add a recipe manually, paste text, or import a photo to begin. The app follows [the IA and UX guide](ia-ux.md): Week, Recipes and Groceries, with the people at your table, prices and budget, look and units, sign-in and backup under Household. It adapts to phone and desktop widths and follows the device's light or dark appearance.

## The eight additions

1. **Cook with what you have** (Groceries › At home; Recipes › What can I make?). Pantry records can be a simple availability checklist, or can contain known quantities. Flag ingredients to use soon. What can I make? ranks saved recipes by missing ingredient groups, use-soon matches and the people at the table. Known compatible quantities are deducted once in the preview, including duplicate ingredient lines. Unknown or incompatible amounts remain visible for checking. Matching uses normalized names and preparation, not guessed ingredient synonyms. No pantry amounts are silently consumed when cooking.
2. **Leftovers and batch cooking** (finishing cooking; Groceries › At home; the Week). Record a cooked recipe batch, its actual portions, cooking date and storage. Allocate portions to dated meals or an undated freezer reserve, and mark allocations eaten. Remaining and unallocated portions are distinct. Over-allocation is rejected. Leftover allocations appear in the week without adding groceries or duplicating cooking costs. A batch linked to a finished session keeps the actual cooked snapshot and cannot be created twice for the same session dish. Storage dates are records, not inferred food-safety deadlines.
3. **Remember your tweaks** (finishing cooking; a recipe's Cooked before and Add a note; a recipe's Your own version). Add ratings, cook-again preference (through the MCP tools), actual changes and next-time reminders to cooking notes. A recipe shows the latest note as Last time and lists every time it or another version was cooked under Cooked before; cooking shows the latest note on the first step. Save a complete reviewed variation and mark one version preferred. Originals and source text/photos are retained, and changing the preferred variant is atomic and undoable. The preferred version is offered explicitly rather than changing an already planned or cooking recipe.
4. **Choose by effort** (Recipes › 30 minutes or less; the MCP tools for the rest). Recipes have optional hands-on minutes, total minutes, cooking pan count, cleanup effort and spice level. The browser app filters by total time; the MCP tools also filter by pans and cleanup. Unknown effort is excluded when its filter is active, with an explanation. Hands-on time cannot exceed total time. Serving changes preserve recorded times instead of multiplying them.
5. **Household taste profiles** (Household › People at the table). Record names, liked/disliked ingredients or tags, spice tolerance and notes. A recipe lists who at the table likes something in it and who doesn't, and What can I make? breaks ties by what they like; through the MCP tools, dislikes can be excluded or shown as conflicts. Unknown spice remains explicitly unknown. These are taste preferences, not allergen certifications.
6. **Cook together** (cooking, from a recipe, meal or planned day). Persistent cooking sessions have dish progress, timers and shared jobs: anyone adds a job, ticks it off or names who is on it, and a changed job keeps its place in the list. A timer's responsible person is kept by the MCP tools only. Browsers refresh saved changes every three seconds. Dirty forms are retained when another cook changes data, and stale saves are rejected. A client must reopen a stale form to review the newer record. Countdown deadlines persist; the browser does not promise locked-screen alerts.
7. **Meal cost estimates** (Household › Prices and budget; the week's cost line also appears on the Week). Save user-confirmed package prices, dates, currency and manual/receipt provenance. A receipt price is entered and confirmed manually. Costing uses the latest compatible price on or before the estimate date; units normalize within supported dimensions. Missing quantities/prices leave the total incomplete and show a known subtotal. Spending compares planned cooking occurrences with a Monday-start weekly budget. No exchange rates, retailer prices or density conversions are invented. Costs describe ingredients used, not checkout package totals.
8. **Screenshot/photo import** (Recipes › Add › Photograph a page). Upload PNG, JPEG or WebP up to 8 MB. macOS uses Apple's local Vision text recognition through a small Objective-C helper; other systems use the `tesseract` executable. The original image stays beside editable recipe fields. Text extraction preserves unknown yields, ambiguous units and unstructured source text. English and Hebrew section headings are recognized by the conservative parser; OCR language/handwriting quality depends on the local engine. The review checkbox is required before committing a draft. Saving again with the same action key cannot create a duplicate recipe.

## Editing a recipe

The browser editor shows one ingredient per line and separates steps with a blank line. Saving keeps every line you left as shown exactly as it was stored: its unit, even one the reader does not know such as a knob, its category, the preparation of an unmeasured line and the source wording. A line you change is read again like a pasted recipe and keeps the category of the ingredient it replaced. A step you leave unchanged keeps its timer and equipment; a blank line inside a stored step shows as a single line break, because a blank line starts the next step.

## Links and videos

A recipe can carry any number of links (up to 50) beside its source link: the written original, a technique video, a family post. In the editor, **Links and videos** takes one link per line, a web address with an optional title in either order; `youtu.be/…` without a scheme is accepted. YouTube (videos, Shorts, playlists, shared start times), Vimeo (including unlisted links), Facebook videos and reels, Instagram posts and reels, and TikTok videos appear on the recipe page as players; every other link, and short links such as `fb.watch` or `vm.tiktok.com`, opens in a new tab. A video used as the recipe's source link is shown the same way.

Players are not loaded with the page. Each one shows a play button, and only pressing it loads the provider's player, so viewing a recipe sends nothing to a video site. The server stores the addresses and never fetches them; its Content-Security-Policy allows frames only from the five player origins. While a video is playing, other cooks' changes are held back until you leave the page so the video is not restarted. Cooking sessions snapshot the links and show them as plain links beside the steps.

## Courses, cuisines, diet labels and tags

Every recipe can carry a course (one of Breakfast, Starter, Main, Side, Soup, Salad, Dessert, Baking, Snack, Drink or Basics), a cuisine in your own words, diet labels (Vegetarian, Vegan, Pescatarian, Gluten-free, Dairy-free, Nut-free, Egg-free, Kosher, Halal, Low-carb) and any number of tags. The editor offers the cuisines and tags already in your cookbook, so one spelling is enough; tags are compared without regard to case and duplicates are dropped when you save.

The Recipes tab searches names, notes, ingredients and the course, cuisine, diet labels and tags in one box, so typing "vegetarian" or "thai" finds those recipes. Chips narrow it to one kind (recipes, meals, ideas, techniques or books), to favorites, to recipes that take 30 minutes or less, and to What can I make?. A recipe without a recorded time is left out of the 30-minute chip rather than guessed. The MCP tools filter by each facet separately, and the editor keeps all four.

Diet labels record what you know about a recipe. They are not allergen checks, and nothing is inferred from the ingredients.

## Techniques, inspiration and the shelf

**Inspiration** in the sidebar opens two boards. **Techniques** keeps the methods behind your recipes: a short summary, numbered steps, tips, tags, photos, the same click-to-play videos recipes have, and the recipes that use the technique, which show it under _Techniques_ on their own pages. **Inspiration** keeps ideas worth trying: a reel, a dish at a friend’s table, a line in a newsletter, with notes, where it came from, links, photos and tags. An idea starts as _Want to try_ and can be marked _Tried it_; **Write it up as a recipe** opens the recipe editor with the idea’s title, notes, tags and links, and once the recipe is saved the idea shows _In the cookbook_ while the recipe lists the idea under _Inspired by_.

**Library** is the household’s shelf of cookbooks it owns as files. Add a PDF or EPUB of up to 64 MB with a title, author, tags, notes and an optional cover photo; the file is stored once in the household database and served only to signed-in browsers. A book page offers the file for download, opens a PDF in a new tab, and can show it in an in-page reader frame that is created only when you press **Read here**; bookmarks with page numbers open the reader at that page. EPUBs are downloaded to your reading app rather than shown in the browser. Link the recipes you write up from a book in its edit form and they appear under _From your shelf_ on the recipe page. Removing a book from the shelf archives the entry, which undo reverses; the file stays in the database.

Photos for techniques and ideas use the same PNG, JPEG and WebP limit as recipe photos (8 MB each). While a book is open in the reader, other cooks’ changes are held back until you leave the page, as they are for a playing video. The server never reads, summarizes or sends any of this anywhere: techniques, ideas and books are plain records searched by their words, and files are only ever served back to the household.

## Photos

On macOS install Apple's command line tools if needed (`xcode-select --install`). Full Xcode is not required for the OCR helper. The helper is compiled once per source revision into `~/Library/Caches/kooks` (override the location with `KOOKS_CACHE_DIR`) and reused by later imports. On other platforms install Tesseract through your usual package manager. Photo content is processed locally and is not uploaded to a model provider. OCR runs outside database transactions; errors leave the cookbook unchanged. An unreadable image can be retried or entered as text.

Original images are retained in SQLite and included in portable backups. Header/type and size checks reject invalid uploads; the macOS helper also bounds image dimensions. Image bytes are stored once, outside record history, so large photo libraries grow the database and portable backups but not history or the browser's polling payload.

## Sharing a household server

By default the server accepts only loopback connections and asks nobody to sign in. Multiple tabs can use the same cookbook, and a connected MCP client can use the same database. Each open tab asks every three seconds whether anything changed. The server answers from its action log without reading the cookbook, and a tab that is behind receives only the records changed since it last looked, or everything after a server restart or more than 200 actions.

To use other devices, list the household's addresses in `KOOKS_HOUSEHOLD_EMAILS` and give the server a way to send mail: `KOOKS_SMTP_HOST` with its port, user, password and `KOOKS_MAIL_FROM` for real email, or `KOOKS_MAIL_OUTBOX=/some/private/directory` to write each sign-in email to a file while developing. Then either host it behind HTTPS as [hosting](hosting.md) describes, or, on a trusted private network, explicitly set `KOOKS_HOST=0.0.0.0` and `KOOKS_PUBLIC_ORIGIN` to the address every device opens, such as `http://192.168.1.20:4317`. Sign-in links point to that address and requests naming any other host are refused, so a forged `Host` header cannot redirect a member's link. Plain HTTP is accepted only for private-network addresses (10.x, 172.16–31.x, 192.168.x, 100.64–127.x as Tailscale uses, IPv6 unique-local and link-local) and local names (single-label names and `.local`, `.lan`, `.internal`, `.home.arpa`); a public name needs HTTPS. The server refuses to start beyond loopback without `KOOKS_PUBLIC_ORIGIN`, and no LAN listener is enabled automatically.

Each member signs in with a one-time link sent to their address, then adds a passkey so the next sign-in is a fingerprint, face or screen lock. Passkeys need HTTPS or localhost, so a plain-HTTP LAN address offers email links only. Sessions last through 30 days of use, survive restarts, and end on sign-out or when an address leaves the list. Setting `KOOKS_HOUSEHOLD_EMAILS` on the loopback server also turns sign-in on, which is how to try the flow locally with an outbox. Sign-in state lives in `auth_` tables beside the cookbook and is left out of portable backups.

Members are known by email address; person profiles remain taste preferences and task assignments, not accounts. The server must remain running. The phone app shows its last copy of the kitchen and keeps grocery ticks while the kitchen is out of reach; browsers need the kitchen, and there is no cloud synchronization.

## Data, compatibility and checks

All mutations use the same validated tools, SQLite transactions, optimistic versions, request keys and reversible history as the original MCP implementation. Each change can be undone for 90 days; older entries stay in the history without their saved copies. `backup_export` now emits schema version 2 and includes the new records, photos, recipe links, recipe facets, techniques, ideas and books together with their PDF and EPUB files, so a large shelf makes exports large; exports made before the facets restore with them unset. Restore accepts both versions 1 and 2 and still requires an empty database. It rejects invalid references and over-allocated batches atomically. Household › Backup › Download a backup downloads this portable JSON as the server writes it, so a shelf of large ebooks downloads like a small cookbook. On the computer that keeps the cookbook, a backup of any size can also be written and restored from the command line; both read and write one record at a time:

```sh
node scripts/backup.mjs export kooks-backup.json
KOOKS_DB_PATH=/path/to/empty.sqlite node scripts/backup.mjs restore kooks-backup.json
```

`KOOKS_DB_PATH` selects the database as it does for the servers, and the backup file is created readable by its owner only. Through MCP, `backup_export` and `backup_restore` carry the whole backup in one message, so `backup_export` refuses a cookbook whose photos and ebooks exceed 64 MB and names these two ways instead.

```sh
npm test
KOOKS_TEST_OCR=1 npm test
```

The second command exercises actual local OCR as well as the domain, stdio integration and HTTP tests. HTTP tests bind ephemeral loopback ports; the OCR integration requires the system image service or installed Tesseract. Restricted sandboxes may need permission for these tests.

Implementation verification: all 29 tests passed with real OCR enabled on macOS. Browser checks used an isolated temporary database, preserving the user's cookbook. They exercised dinner filtering, leftover allocation, task assignment/completion, preferred variants, photo review and cost entry, with phone-width overflow checks. The native interface was not modified by this feature work.
