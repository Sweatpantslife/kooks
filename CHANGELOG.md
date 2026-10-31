# Changelog

What changed in Kooks and how each change was verified, newest first. Kooks has no tagged releases yet; `package.json` has said 0.2.0 since the first publication. Add an entry under **Unreleased** with every change: what changed, the checks run with their counts, and what was not exercised.

## Unreleased

### Accounts and households instead of one address list

People now have accounts, named by their email address, and an account belongs to one or more households. Each household is a kitchen with its own cookbook: the first one is the server's database, so an existing kitchen keeps every record, and households started later get a SQLite file each in `households/` beside it. Households grow by invitation: any member invites an address from **Household › Members**, the invite is emailed, works once for seven days, and opening it shows the household and who asked; joining signs that browser in as the invited address and makes the account if there was none. Someone already signed in sees invites to their address in the app too. Owners remove members (out at their next request, still signed in to their other households); anyone leaves except a household's last member, and a leaving owner hands over to the longest-standing member. Anyone with an account can start another household and switch between theirs; someone signed in to no household gets a welcome page to start one or take an invite.

`KOOKS_OWNER_EMAIL` names the first person, who owns the first household and always gets their account back. `KOOKS_HOUSEHOLD_EMAILS` from earlier versions seeds the first household once: those addresses keep their passkeys and sessions (the phone's too), and accounts of addresses no longer on it go. Sign-up is by invitation only unless `KOOKS_OPEN_SIGNUP` is set. The server refuses to start with sign-in on and nobody who could sign in.

Sign-in is emailed links and passkeys only. The phone app's six-digit codes are gone: the app asks for a link and waits with a secret of its own, the member opens the link on any device, which asks before it signs the app in (and never signs itself in), and the app picks up its session. Sessions now slide to 180 days from the last day of use (were 30), so a device used twice a year stays signed in; **Household › Sign-in** lists every signed-in device with its last use, signs any of them out, or all but this one. Tokens are not rotated, since the phone's must survive offline work; ending a device covers a lost one. Each household has its own assistant allowance. Sign-in and invite emails share the 100-an-hour budget, and a member sends at most 20 invites a day.

`npm run format:check`, `npm run lint`, `npm test` (126 tests: 125 passed, the OCR case skipped; 4 new for households and invites, the devices list, open sign-up and the move from the old list; the phone's confirmed link replaces the two code tests) and `npx playwright test` (52 passed; 1 new for inviting, joining, removal and the welcome page, and the phone test now confirms its link in a second browser, with axe scans of the new pages) pass. Not exercised: real email delivery, a phone build with the new sign-in (an installed app from before asks for a code the server no longer sends, so phones need the new build), and Safari and Firefox.

### Automated accessibility checks for the current apps

The mobile, web and web-auth Playwright projects each gain an `accessibility.spec.js` that runs `@axe-core/playwright` (already a dev dependency for the redesigned app's tests) through a shared `test/axe-scan.js` and fails on any WCAG 2.2 A or AA violation or axe best-practice finding, in the light and dark themes: all 37 web routes at 1280 and 390 px, 16 mobile views on a phone in the Olive and Clay palettes and on a wide screen, and the five sign-in screens (sign in, check your inbox, the passkey offer, sign-in settings, a spent link). All pass on the current apps; the scan helper reports a planted unlabeled field and a low-contrast paragraph. The new tests add about 1 minute 30 seconds to `npm run test:e2e` locally. The sign-in scan runs with Chromium's virtual authenticator, as the sign-in tests do: without one the browser rejects the quiet passkey suggestion in the background, and the app shows that raw message in the sign-in alert in place of the spent link's reason. Their extra records exposed a race in the web filter test, which checked a recipe page's facet chip before the page had replaced the cookbook list; it now waits for the recipe's heading. `npm run format:check`, `npm run lint`, `npm test` (115 tests: 114 passed, the OCR case skipped) and `npx playwright test` (43 passed, 5 new) pass. Axe cannot judge everything WCAG asks, such as whether names and announcements make sense or whether keyboard order is logical; the end-to-end tests cover the focus and announcement behaviour, and no screen reader was run.

### The redesigned app's foundation, at /next/

A new app for browser and phone starts in `client/` (Preact with signals, built by Vite) and the server shows it at `/next/` beside the current one, which stays at `/` until the new app covers everything. This first part is the frame the rest is built in: the Market look (warm white, tomato and herb, Bricolage Grotesque titles, light and dark, field borders and focus ring at 3:1 or more), three tabs (Week, Recipes, Groceries) at the bottom on phones and in a rail from 840 px, Household behind the initials, the kitchen kept up to date every 3 seconds with only the changed records, changes that retry with the same request id and offer Undo, sign-in by passkey (including the quiet suggestion in the email field) or emailed link, and Household with the look, passkeys and sign-out. Week, Recipes and Groceries say what is coming and link to the current app. Addresses from the current app (`#/today`, `#/shop/pantry`, `#/settings/…`) open the page that replaces them. The Docker image builds the app in a separate stage; CI runs `npm run build:client`.

The new app's files revalidate and compress like the current app's, and its hashed bundles are cached for a year. `npm run format:check`, `npm run lint`, `npm test` (112 tests: 111 passed, the OCR case skipped; 3 new) and `npm run test:e2e` (38 passed; 8 new in the `next` project, which scan every page with axe-core for WCAG 2.2 AA and best practices at 390 and 1280 px in light and dark, with 0 violations) pass. Not exercised: the full Docker build (the sandbox's Docker cannot reach Debian or npm; the client stage's files build outside it), Safari and Firefox, and a real device's passkey prompt.

### The redesigned app's Recipes tab

Recipes in the new app at `/next/#/recipes`: one search over recipes, meals, ideas to try, techniques and books (titles, ingredients, cuisines, tags and notes), a chip per kind, and Favorites, Under 30 min and "What can I make?", which ranks recipes by what is at home through `recipe_suggest` and says how many ingredients are missing. Tiles without a photo take their course's color and icon; the heart beside each recipe saves it as a favorite, with Undo. A recipe page shows time, pans and labels, the last cooking note, ingredients that scale with the servings (written as ½ cup or 313 g) and are marked when at home, the method with step times, and links to its variations, meals, techniques, videos and source. Meal pages list their dishes. Adding, editing, planning and cooking still open the current app. The new app's layout uses logical sides, like the current app's since #30.

`npm run format:check`, `npm run lint`, `npm test` (116 tests: 115 passed, the OCR case skipped; 1 new for amounts) and `npm run test:e2e` (43 passed; 5 new, with axe-core scans of the list, a recipe and a meal in light and dark at 0 violations) pass. "What can I make?" uses the server's matching, which needs the preparation to match too, so "lemon, zested" is not covered by "lemon" at home.

### Adding and editing recipes in the redesigned app

Recipes › Add a recipe at `/next/#/recipes/add` offers four ways in: paste the text, photograph a page, write it yourself, or save an idea to try. Pasted text and photos become a draft checked beside the original (the warnings, the photo and the full text) and are saved once the person ticks that they checked it. Drafts waiting for that check are listed with Discard and Undo. An idea takes a name, a link (a bare address such as `example.com/dish` is fine), where it came from, notes and a photo, and opens the To try list once saved.

One editor serves a new recipe, a change, your own version of a recipe (from "Make your own version" on its page) and a draft. Ingredient lines read as a cook writes them (½ cup, 2 cloves), with "As Kooks reads it" listing each amount as it will be stored, so a misread line shows before saving; a line left as shown keeps its stored form, including units the reader does not know. Course, cuisine (the household's names first), diets, tags, effort, equipment, notes, source and links sit in sections that start open only when filled. Leaving with unsaved changes asks first, whether by a link, Back or closing the tab. A change saved meanwhile by someone else is reported, with "Save mine over theirs". Saving an edit offers Undo, and the editor closes into the page it was opened from, so Back does not reopen it. "Remove from cookbook" archives the recipe with Undo. Old addresses `#/capture`, `#/imports` and `#/new-recipe` open the new pages.

The new app's tests now use the accessibility suites' shared scan (`test/axe-scan.js`, both themes per call). `npm run format:check`, `npm run lint`, `npm test` and `npm run test:e2e` (58 passed; 9 new for adding and editing, with scans of the choices, paste, photo, idea, draft, editor at phone and wide sizes, and a variation).

### The redesigned app's Week tab

The Week tab at `/next/#/week` shows the days from today on, with days gone by folded into "Earlier this week", and pages back and forward a week at a time (`#/week/<monday>` for any other week). Each day lists what is planned, by meal (breakfast, lunch, dinner), with its picture, and leftovers set aside for that day. Add on a day opens a search over recipes and meals, favorites first, with a choice of breakfast, lunch or dinner. "Add to the week" on a recipe or meal page, and Move on anything planned, open a choice of the rest of this week and all of the next, each day saying how much is already planned. Taking a dish off a day offers Undo. Shopping for the week's plan comes with the Groceries tab.

`npm run format:check`, `npm run lint`, `npm test` and `npm run test:e2e` (62 passed; 4 new for the Week, with axe scans of the week, adding to a day and moving). Two sign-in tests of the current app now wait for the sign-out to land before opening a spent link: opened sooner, the link was read while still signed in and the sign-out then cleared its reason, which failed CI once on Node 22 and fails every time with the sign-out held back 0.8 s.

### The redesigned app's Groceries tab

The Groceries tab at `/next/#/groceries` has two parts. To buy is the shopping list by aisle, from fruit and vegetables to household things; a grocery without an aisle of its own is placed by the last words of its name, so "red pepper flakes" is a spice and "chicken stock" pantry. A line such as "2 lemons" adds a grocery. Ticking one moves it to the basket and keeps keyboard focus in the list, and any row can come off the list with Undo, including one recipe's share of it. "Put it all away" notes what was bought as at home (household things such as paper towels are left out unless ticked) and empties the basket. At home lists what the household has, what to use soon, what ran out (one tap puts it back on the list) and leftovers with the portions left, which can be marked eaten. "Shop for the week" on the Week tab and on the list, and "Add to groceries" on a recipe or meal, open each meal's ingredients to tick: what is at home starts unticked, a meal already on the list shows what was picked before, and adding it again replaces its groceries instead of doubling them. "Lemons" at home now counts as a recipe's "lemon". After a change, the redesigned app reads the kitchen again instead of taking an answer that was already on its way and might not include the change.

`npm run format:check`, `npm run lint`, `npm test` (117 passed, 1 skipped; 2 new for aisles, amounts and names) and `npm run test:e2e` (66 passed; 4 new for Groceries, with axe scans of shopping for the week, To buy, putting away and At home).

### Cooking in the redesigned app

Cook on a recipe or meal, or on one of today's plans in the Week tab, opens cooking at `/next/#/cook/<session>`. It fills the screen, without the navigation, and shows one step at a time in large type, with Back and Next, and each dish of a meal in turn. Beside the step are the dish's ingredients, every step to jump to, and the timers. A step with a time offers a timer of that length, and any timer can be started by minutes; when one runs out, on any page, the app says so, chimes and buzzes. The screen stays on where the browser allows it. Leaving the stove keeps the cooking: a Now cooking bar on every page shows the step or the next timer and goes back to it, and Cook on the same recipe, meal or plan picks it up where it was. Finishing asks how it went for each dish (a rating out of 5, what to do next time, notes, and the portions left over, in the fridge or freezer): the note shows as "Last time" on the recipe and the first step of its next cooking, and leftovers go to At home. Portions eaten no longer show on the Week as leftovers set aside.

`npm run format:check`, `npm run lint`, `npm test` (118 passed, 1 skipped; 1 new for timer clocks) and `npm run test:e2e` (69 passed; 3 new for cooking, with axe scans of a step, a running timer, the Now cooking bar and finishing).

### The redesigned app's Household

Household is now a menu of its own pages at `/next/#/household`. People at the table holds each person's likes, dislikes, heat and notes, added, changed and removed with Undo; a recipe then lists who likes something in it and who doesn't (a taste names the thing or its last words, so "olives" finds "kalamata olives" but not "olive oil"), and What can I make? breaks ties by what they like. Prices and budget shows what this week's planned food comes to at the prices paid, a weekly budget that holds from the week it is set until it is changed, the ingredients in the week's plans still without a price (each opens the price form filled in), the latest price of each thing with Edit and Remove, and the currency; the Week shows one line with the planned cost and the budget once the household keeps prices or a budget. Look and units chooses colors and shows amounts as written, metric or US, rounded to what a scale or a cup shows; cans, cloves and cups of no stated size stay as written, the editor keeps the recipe's own units, and both choices belong to the device. Sign-in keeps passkeys and signing out, and Backup downloads the whole kitchen as one file. The previous app's settings addresses open their new pages (`#/settings/prices`, `#/settings/household/<id>`, `#/account`). On a 390 px phone, the Cook, Move and remove buttons of today's plans now wrap under the dish instead of pushing the page sideways.

`npm run format:check`, `npm run lint`, `npm test` (120 passed, 1 skipped; 2 new for converted amounts and tastes) and `npm run test:e2e` (72 passed; 3 new for Household, with axe scans of the menu, people, the person form, prices, the price form, look and units, backup and the Week's cost line).

### Ideas, techniques and books in the redesigned app

Ideas to try, techniques and books now open in the new app instead of the current one, at `/next/#/recipes/idea/<id>`, `/technique/<id>` and `/book/<id>`. An idea shows where it came from, its notes, photos and links, and is marked as tried, edited, removed with Undo, or written up as a recipe in the recipe editor, which starts from its title, notes, links and tags and then points the idea at the new recipe. A technique shows its summary, steps, tips, photos, links and the recipes that use it. A book shows its cover and author, opens a PDF in a new tab or downloads the file, keeps page bookmarks (a PDF opens at the bookmarked page), and lists the recipes written up from it. The Add page now also keeps a technique and adds a book from a PDF or EPUB, and each has an edit form with a recipe picker. A recipe's "More about this recipe" now also lists the book it is from and the idea it grew from. Addresses from the current app (`#/inspiration/<id>`, `#/techniques/new`, `#/library/<id>/edit`) open the new pages, and the Recipes tab keeps a kind's chip when its last item is removed.

`npm run format:check`, `npm run lint`, `npm test` (120 passed, 1 skipped) and `npm run test:e2e` (76 passed; 4 new for ideas, techniques and books, with axe scans of an idea, the idea form, a technique, the technique form, a book, the book form and a missing book).

### Meals are put together in the redesigned app

The Add page now puts a meal together: a name, the recipes cooked together (found with the recipe picker), what each one is in the meal and how many it serves when that differs from the recipe, and notes. A meal's page has Edit meal and Remove meal, with Undo; removing it shows the Recipes tab on Meals. The previous app was the only place meals could be made or changed, and it goes away next. In the recipe pickers of every form, a recipe unticked while the form is open stays in place with the focus instead of disappearing.

`npm run format:check`, `npm run lint`, `npm test` (120 passed, 1 skipped) and `npm run test:e2e` (77 passed; 1 new for putting a meal together, changing it and removing it with Undo, with axe scans of the meal form).

### The redesigned app replaces the previous browser app

The server now shows the redesigned app at `/` and the previous browser app (`web/public/`) is gone. Sign-in emails, which always linked to `/#/signin/<token>`, now open the new app. Addresses under `/next/`, where it was tried out, redirect to the same page at `/`, and the previous app's addresses open the page that replaced them, now also for a draft (`#/imports/<id>`), a meal (`#/meals/<id>`, `#/plan/meals/<id>`), a recipe's variation and cooking notes (`#/recipes/<id>/variant`, `/memory`), an idea written up as a recipe (`#/recipes/new/inspiration/<id>`) and shopping for a recipe or meal (`#/shop/review/<kind>/<id>`). The "You’re trying the new Kooks" note is gone. The Docker image now builds the app with the `shared/` modules it imports; without them its client stage failed, which a build of the client folder and `package.json` alone reproduces and adding `shared/` fixes.

Messages now hand the focus back where it was before them: pressing Undo, Escape or the close button returns it to the control that made the change (the heart Undo just reversed, for example), or to the page when that control is gone. Their countdown runs from the moment they appear, held while the pointer or the focus is on them, instead of from when the page finished drawing them.

The previous app's own tests went with it. Its Playwright projects `web` and `web-auth` are replaced by the new app's suite, which moves from `test/next-e2e` to `test/web-e2e` as the `web` project and now opens the sign-in link exactly as the email gives it. Three of the previous app's checks are carried over in `together.spec.js`: another cook's recipe arriving and leaving while the search keeps the focus and the typing, every page at 320, 390, 768 and 1280 px without sideways scrolling (24 addresses), and Undo's timing and focus. The server tests serve a stand-in build instead of the previous app's files. `docs/ia-ux.md` is rewritten for the new app, and the README, handoff, decisions, contributing, hosting and household guides follow it.

Costs now count per week (Household › Prices and budget, and the Week's line) instead of per recipe. Shared cooking jobs and the list of past cooking notes under a recipe came back in the next change. The mobile app is unchanged.

`npm run format:check`, `npm run lint`, `npm test` (120 passed, 1 skipped) and `npm run test:e2e` (58 passed: 14 for the mobile app and 44 for this one, 3 of them new in `together.spec.js`; the 22 tests of the previous app and its sign-in screens are gone with it). A Docker image was not built here; the client stage was checked by building from a folder with only `package.json`, `client/` and `shared/`.

### Cooking jobs and every time a recipe was cooked

Cooking now has a Jobs card beside the timers for the work around the dishes, like setting the table: anyone adds one, ticks it off, says who is on it (or leaves it to anyone), and removes it with Undo, and everyone cooking sees the same list. A recipe now lists every time it or another version of it was cooked under "Cooked before", newest first, with the rating, what was changed and what to do next time, three at a time and the rest behind "N earlier times"; a note left empty at the finish shows only its day. "Add a note" there records a cooking without the stove, at `#/recipes/<id>/note`, which the previous app's `/memory` address now opens. Days from an earlier year say which year. These were the two parts of the previous app the new one did not have yet.

`cooking_task_save` now keeps a changed job in its place instead of moving it to the end of the list, so ticking one or naming who is on it no longer reorders the jobs (the correctness and performance threads that held `mcp/features.js` have finished).

`npm run format:check`, `npm run lint`, `npm test` (122 passed, 1 skipped; 2 new, for the task order, which failed before the fix, and for the year on older days) and `npm run test:e2e` (60 passed: 14 for the mobile app and 46 for this one; 2 new, for jobs with focus, Undo and a reload, and for Cooked before and adding a note, with axe scans of cooking with jobs, a recipe's history and the note form; the recipe page test now reads its Last time note inside that note, as the same words also show under Cooked before).

### The server signs the phone app in with an emailed code

The phone app is about to run the redesigned app against the household server, where an emailed link cannot reach it and a passkey cannot serve each household's own address. The server now signs it in with a code instead: `POST /api/auth/code` emails a member a six-digit code (and answers every address the same way, at once, as links do), and `POST /api/auth/code/confirm` takes the address and the code and returns a device token, which the app sends as `Authorization: Bearer <token>`. A code works once, for 10 minutes; five wrong guesses spend it, a new request replaces it, and an address takes at most twenty wrong guesses a day, however many codes are asked for and from wherever (a right code starts the count again). The email says Kooks will never ask for the code. Device tokens are sessions like a browser's: they slide over 30 days of use, end at Sign out, and stop when the member leaves the household.

Only the Capacitor origins, `capacitor://localhost` on iOS and `https://localhost` on Android, may call `/api/` across origins, and only when sign-in is on. Their requests never count a cookie, and they cannot ask for an email link or a passkey, whatever token they carry. A kitchen whose own address is `https://localhost` treats that origin as a browser's. Nothing else of the server is open to them, and a loopback server without sign-in answers them like any other site. SECURITY.md and the hosting guide describe the code, the token and what the HTTPS proxy must pass.

`npm run format:check`, `npm run lint` and `npm test` (126 passed, 1 skipped; 4 new: the phone's sign-in, token, origins, links and passkeys refused even with a made-up token, spent and expired codes and the daily guess limit across client addresses; a kitchen at `https://localhost` signing a browser in; a server without sign-in opening nothing to the app's origins; and wrong codes counted for strangers as for members, while long or invalid addresses are never kept). The security thread reviewed it; its findings, a made-up token reaching link and passkey routes, `https://localhost` as the kitchen's own address, and an unbounded count of wrong codes keyed by whatever address was sent, are fixed and tested here. Wrong codes are counted only for real addresses: exactly for members, and for the latest 10,000 other addresses.

### The phone app is the redesigned app

The phone app now packages the same client as the browser (`client/`), so phones get the redesign's Week, Recipes, Groceries, cooking and Household, and work on the household's kitchen instead of a cookbook of their own. The first screen asks where the kitchen is, checks that it answers like a Kooks kitchen with sign-in on, and signs the member in with an emailed six-digit code; the app keeps the kitchen's address and a device token and sends the token with every request, never a cookie. **Household › Sign-in** shows **This phone**, with Sign out and Sign out and use another kitchen. A phone reaches the kitchen only over https. Photos and files are fetched with the token: a book, the backup and the bookmarks file go to the phone's share sheet. Cooking timers still counting are scheduled as notifications, and taken off when they are cancelled or changed on any device; the Android back button goes back through the app and leaves it from Week; coming back to the app fetches what changed; finishing a cooking step gives a light tap. Plugins load only on a phone.

The previous phone app's recipes come with it: when its `kooks/cookbook.json` is on the phone, Recipes offers **Recipes on this phone**, and **Bring them in** saves each recipe written there as a kitchen recipe (ingredients, steps with their minutes, equipment, links, course, cuisine, diet labels, tags, notes, favorite), each under its own request key so a bring-in that stopped half way never saves one twice, then renames the file `cookbook.imported.json`. Its sample recipes, meals, plans and settings stay behind.

The previous phone app is retired: `app/`, its Vite config, `shared/icons.js`, `shared/ui.css`, `shared/tokens.css`, `shared/a11y.js`, `scripts/icons.mjs`, its unit tests and its Playwright project, and the `dev:mobile`, `preview:mobile`, `test:mobile`, `test:mobile:e2e`, `icons` and `build:mobile` scripts. Capacitor now copies `client/dist`. Because no server sends the phone's page a policy, the built page carries one in a meta tag (`client/page-policy.js`): only its own script, styles, fonts and images, requests to itself and to https addresses, and the video players' origins; in a browser the server's stricter policy applies too. The guides, README, SECURITY.md and decisions describe one app on both.

`npm run format:check`, `npm run lint`, `npm test` (106 passed, 1 skipped: 5 new for kitchen addresses, timer notifications and their ids, and the previous app's recipes and their limits, each checked against the kitchen's recipe schema; 25 removed with the previous app) and `npm run test:e2e` (47 passed; 1 new: in a browser set to the phone's sign-in, a member finds the kitchen, is told when an address is not one, signs in with a wrong and then the right code, stays signed in after a reload with a token and no cookie, downloads a backup with the token, signs out so the kitchen ends the token, and signs out to another kitchen, with axe on each screen; the built page's policy is checked there too). Not exercised: a native build, a WebView, the plugins (notifications, share sheet, haptics, back button, files) and the import from a real previous-app file on a device.

### The phone keeps working out of the kitchen's reach

A phone now keeps a copy of the kitchen as it last saw it (in the app's IndexedDB, written a moment after each change arrives), shows it at once when the app starts and catches up from it. When the kitchen does not answer, every page says **Can’t reach the kitchen** and since when, and the week, recipes and grocery list stay readable. Ticks on the grocery list keep working: a tick made out of reach shows at once, waits on the phone (the latest per grocery) and is sent when the kitchen answers, against the list as it is by then; a grocery that changed meanwhile is a new grocery, and its old tick is let go. A browser shows the bar too when its kitchen stops answering, and keeps ticks the same way. Signing out, or the kitchen ending the token, removes the copy and the waiting ticks. Other changes still need the kitchen, and photos stay blank until it answers.

`npm run format:check`, `npm run lint`, `npm test` (107 passed, 1 skipped; 1 new: waiting ticks keep only the latest per grocery, a tick changed since stays after a send, and one made online supersedes it) and `npm run test:e2e` (48 passed; 1 new: on the phone's sign-in in a browser, a member ticks a grocery with the kitchen's API cut off, sees the bar with the waiting tick, restarts the app and finds the copy with the tick, then the kitchen answers, the bar goes and the kitchen has the tick; signing out leaves no copy; axe on the page out of reach). Not exercised: a real phone losing its connection, or a WebView's IndexedDB.

### A recipe from a link

**Add › From a link** takes a recipe page's address, and the kitchen reads the recipe the site publishes for search engines (schema.org Recipe JSON-LD: name, yield, ingredients, steps and sections, times, course and cuisine) into a draft to check beside its original, like a paste or a photo. The page's address becomes the recipe's source. A page without that data says so and offers Paste. The new tool `recipe_import_link` does this for MCP agents too; it is the only tool marked open-world, and its description tells agents to call it only for a link the user asked to import.

This is the first time the server fetches anything, so the fetch is guarded (`mcp/fetch-page.js`), with the security thread's notes:

- Only http and https, on the standard ports, without credentials.
- Literal addresses are checked on every hop. Every address a name resolves to must be public, and the connection goes to the address checked. Loopback, `0.0.0.0`, private, shared, link-local and metadata, multicast, reserved and documentation ranges are refused, with their IPv4-mapped, IPv4-compatible, NAT64, 6to4 and Teredo forms.
- Names are resolved by DNS queries that give up after a few seconds rather than the system lookup, which holds one of Node's four pool threads until the name answers.
- At most five redirects, 3 MB after decompression and 10 seconds.
- Its own agents, without keep-alive or proxy, and certificates checked.
- One generic message whatever the site answered, so nothing it says is repeated.
- No images or other resources are fetched, and the page is not kept. Only the recipe's fields are read, as text, from blocks found by scanning rather than one pattern over the page. The scan lowercases ASCII only, so a title with "İ" (which lowercases to two characters) does not shift it.
- At most two pages at once, and 30 an hour from one client address.

SECURITY.md, the hosting guide (outbound access, and the site seeing the server's address), the MCP guide and decisions say so. Docs that still described click-to-play video players, which the redesign replaced with links that open in a new tab, are corrected.

Checks:

- `npm run format:check` and `npm run lint` pass.
- `npm test`: 115 passed, 1 skipped. 8 tests are new:
  - refusals before any connection, for 25 addresses in every form, including `2130706433`, `0x7f.1`, `0`, `[::ffff:127.0.0.1]`, `[::7f00:1]`, `[64:ff9b::7f00:1]` and `169.254.169.254`;
  - schemes, credentials and ports;
  - names with any non-public address, among others;
  - redirects, including to metadata and to a name that resolves inward;
  - errors that never repeat the site, a gzip bomb, an unknown or `constructor` encoding, and a page that never answers;
  - reading the JSON-LD, including `@graph`, sections, entities, durations, a Turkish title before the block, a `javascript:` URL that is not used and an own `__proto__` key that pollutes nothing;
  - the tool's draft and commit with the fetched address as source;
  - the web server's two-at-once and hourly limits.

  The MCP test also checks that only this tool is open-world.

- `npm run test:e2e`: 49 passed. 1 is new: a link to this computer is refused on the page, with axe, and Paste is offered. `#/recipes/add/link` joins the layout check at four widths.
- **Not exercised:** a real recipe site (the sandbox has no direct internet), and a household network's own hairpin.

### The Anthropic SDK, for the assistant

`@anthropic-ai/sdk` 1.3.0 joins the runtime dependencies, pinned exactly, in a pull request of its own as CONTRIBUTING asks. The assistant that follows calls Claude through it from the server, and only when the host gives the kitchen an API key. It brings seven small packages with it (`standardwebhooks`, `@stablelib/base64`, `fast-sha256`, `json-schema-to-ts`, `ts-algebra`, `@babel/runtime` and `@opentelemetry/api`); nothing loads it yet.

`npm audit` finds no vulnerabilities, and `npm run format:check`, `npm run lint` and `npm test` pass unchanged.

### Ask Kooks, the assistant

A household whose host sets `KOOKS_ANTHROPIC_API_KEY` gets **Ask Kooks**, beside Household in the top bar and at the rail's foot. A member asks about the recipes, the week or the groceries, or taps a starter, and sees what the assistant is doing while it reads ("Looking through your recipes"). The answer is plain text, with a card for each change it suggests: plan a dish on a day, add things to the groceries, shop for a week or a dish, or save a recipe draft. The card describes the change from the kitchen's own records, and nothing changes until the member taps Plan it, Add them, Choose what to buy or Save the draft, through the usual tools, so history and Undo apply. The next question tells the assistant what became of its suggestions. The conversation lasts until Start over or the tab closes. Without a key, Ask isn't shown and its address says how to turn it on.

The server (`web/assistant.js`) calls Claude through the Anthropic SDK with adaptive thinking, medium effort, prompt caching and server-side fallback to another model when the default is overloaded. The assistant has the kitchen's read-only tools, without stored files, import drafts, history or sign-in data, and four proposal tools whose input is checked against the schemas and the records; it has nothing that changes the kitchen or reaches the web. Its client is built from the kitchen's key and endpoint only, so none of the host's own `ANTHROPIC_*` settings (another key, another endpoint, extra headers, a request-printing log level) reach it. `POST /api/assistant` answers in lines of JSON as it works. A member asks one question at a time and 30 an hour, the kitchen 300 a day; a question carries at most 60,000 characters of the conversation before it (the app sends the latest turns that fit), makes at most eight model calls, reads at most 120,000 characters and stops after three minutes with a plain message, and a daily token allowance kept in the database (`KOOKS_ASSISTANT_DAILY_TOKENS`, two million by default) stops it once spent. API errors are logged by status only, a refused call names `KOOKS_ASSISTANT_MODEL` in the log, and members get plain messages. Hosting, SECURITY.md, the decisions, the IA and the handoff describe it, and the two open decisions about provider credentials and assistant autonomy are settled there.

`npm run format:check`, `npm run lint` and `npm run build:client` pass. `npm test` runs 123 tests, 122 passing and 1 skipped as before, seven of them new: the client ignores the host's Anthropic settings and prints nothing, reads and proposals change nothing in the kitchen, disallowed calls come back as errors, the read cap and the daily allowance hold, refusals and failed calls end plainly without the key's text, a question that runs out of time ends plainly and a conversation is cut to fit, and the endpoint streams, takes one question at a time per member and answers 404 without a key. `npx playwright test` passes 51 tests, two of them new for Ask (with the assistant played by the test), with no axe violations on the empty and answered page.

### A failed passkey suggestion stays silent on the sign-in screen

When the browser turns down the quiet passkey suggestion in the email field (no authenticator, nothing saved, or the request abandoned), both apps now say nothing, instead of putting the browser's raw message ("Resident credentials or empty 'allowCredentials' lists are not supported at this time.") in the sign-in alert, where it replaced a real reason such as "This sign-in link has expired or was already used." Only the kitchen turning down a passkey the person picked is shown. The quiet request's own failure to load its options is silent too.

`npm run format:check`, `npm run lint` and `npm run test:e2e` for `web-auth` and `next` (16 passed; 1 new for the current app, which failed before the fix with the browser's message, and the new app's spent-link test now checks the exact reason after the suggestion settles).

### Undo kept for 90 days, older history trimmed to its summary ([#39](https://github.com/Sweatpantslife/kooks/pull/39))

Actions older than 90 days keep their history line (the kinds, ids and versions they changed) but drop the before and after copies undo needs and the result a retry would replay: `history_list` marks them `trimmed`, `history_undo` refuses them with `UNDO_EXPIRED`, and polling still sees which records they changed. Kooks trims when it opens a database and once a day while it writes. In a simulated year of 30 saves a day, history falls from 89 MB to 23.5 MB and then stays at about 90 days' worth; that first trim takes 0.4 s and a daily one 4 ms. `test/history.test.js` covers trimming, refused undo, replays and polling, and with mocked clocks the daily trim, the 90-day boundary and the trim on open; removing either trim fails it. `npm run lint`, `npm run format:check`, `npm test` (110 passed, the OCR case skipped) and `npm run test:e2e` (30 passed) pass. An older Kooks server opening a trimmed database fails to page history back past 90 days or undo those actions.

### Direction-neutral layout CSS ([#30](https://github.com/Sweatpantslife/kooks/pull/30))

Every left and right margin, padding, border, offset and text alignment in `shared/ui.css` and `app/styles.css` is now logical (`inline-start`/`inline-end`, `start`/`end`), so `dir="rtl"` mirrors both apps; the disclosure chevron and safe-area padding stay physical on purpose, and a unit test rejects new physical directions. The status message now centres with auto margins, which also stops it wrapping into half the screen width on phones. Screenshots of 7 web routes at 1280 and 390 px and 4 mobile views at both widths are pixel-identical in left-to-right apart from that message, and mirror correctly with `dir="rtl"`. `npm run format:check`, `npm run lint`, `npm test` (110 tests: 109 passed, the OCR case skipped) and `npx playwright test` (30 passed) pass. No right-to-left language, translated strings or mirrored icons exist yet.

### Shopping rows hashed once and status counted in SQL ([#38](https://github.com/Sweatpantslife/kooks/pull/38))

Building a shopping list hashes each row's key once instead of once per contribution, finds checked rows in a set and compares rows as text: preview and sync for 1,335 contributions take 56.8 ms instead of 92.7 ms. `kooks_status` counts active records per kind in SQLite instead of reading every record: 14 ms instead of 39 ms at 3,000 recipes. A workflow test checks that archived records are not counted (removing the filter fails it); the existing shopping tests cover the unchanged rows, diffs and checkmarks. `npm run lint`, `npm run format:check`, `npm test` (108 passed, the OCR case skipped) and `npm run test:e2e` (30 passed) pass.

### The app's files revalidate and large replies are compressed ([#36](https://github.com/Sweatpantslife/kooks/pull/36))

The browser app's files now revalidate against an ETag (`Cache-Control: no-cache`) instead of downloading again on every load (`no-store`), and files over 1 KB travel as Brotli or gzip, whichever the browser accepts: a page load's 255 KB becomes 67 KB, and an unchanged file costs an empty 304. JSON replies over 32 KB, such as a cookbook's first load, are compressed off the main thread (Brotli quality 5 turns 7.8 MB at 3,000 recipes into about 160 KB in some 50 ms); API replies stay `no-store`. `test/static.test.js` covers both encodings, a refused encoding (`q=0`), 304s, a small file left uncompressed, a 404 and a compressed `/api/state`. `npm run lint`, `npm run format:check`, `npm test` (107 passed, the OCR case skipped) and `npm run test:e2e` (30 passed) pass. Behaviour behind a compressing or caching proxy was not tried.

### Backups stream, so a full ebook shelf exports and restores ([#31](https://github.com/Sweatpantslife/kooks/pull/31))

Settings › Backup downloads the same JSON as before, streamed record by record with each file in 3 MB slices, and `node scripts/backup.mjs export` and `restore` write and restore a backup of any size on the computer that keeps the cookbook. Through MCP, `backup_export` refuses with `BACKUP_TOO_LARGE` beyond 64 MB of photos and ebooks. `test/backup.test.js` checks that the stream matches `backup_export`, that restores read at 1 MiB, 4,093 and 1,021 bytes (and indented files) re-export identically, and that bad files restore nothing. By hand with seven 64 MB PDFs and 300 recipes, `main` fails with "Invalid string length"; the script exports the 626 MB file in 4.3 s, the download streams in 2.6 s with the server peaking at 380 MB, and the restore takes 18 s and re-exports identically. `npm run lint`, `npm run format:check`, `npm test` (105 passed, the OCR case skipped) and `npm run test:e2e` (30 passed) pass. The download was fetched over HTTP, not saved through a real browser's download manager.

### Capacitor packages installed only for development

The eight Capacitor runtime packages moved to `devDependencies`, so `npm ci --omit=dev`, which the server's Docker image runs, leaves them out: a production install shrinks from 20.8 MB to 17 MB. From that install the browser server answers `/healthz` and the MCP server initialises. After a full `npm ci`, `npx cap sync` still finds the same five plugins for Android and iOS and changes no tracked files. The native apps were not compiled here.

### CI on Node 22 and 24, cached browsers, coverage and Dependabot ([#29](https://github.com/Sweatpantslife/kooks/pull/29))

Pull requests run CI once and pushes run it for `main` only; a newer push cancels the older run of the same pull request. The token is read-only and checkout does not keep it. Every check runs on Node 22 and 24, Playwright's Chromium is cached by Playwright version, `npm run test:coverage` puts a per-directory table in the job summary, and Dependabot proposes weekly npm and Actions updates, with Capacitor's packages grouped. `npm run test:coverage` (91 tests: 90 passed, the OCR case skipped; 95.5% of lines) passes on Node 22.22 and 24.22, and `npm run lint`, `npm run format:check`, `npm run build:mobile` and `npm run test:e2e` (28 passed) pass on Node 22.

### The browser recipe editor keeps what it did not change ([#28](https://github.com/Sweatpantslife/kooks/pull/28))

Saving from the browser editor no longer sends every ingredient line through the parser again: a line or step left as shown keeps its stored form, and a changed line keeps the category of the ingredient it replaced. The parser moved to `shared/ingredients.js` so the browser can use it, and dates shown from timestamps use the local day. Failing-first unit tests and a browser round trip that edits one amount cover it. `npm run format:check`, `npm run lint`, `npm test` (92 passed, the OCR case skipped) and `npm run test:e2e` (29 passed) pass.

### Mobile unit display, unit conversions and Celsius temperatures ([#27](https://github.com/Sweatpantslife/kooks/pull/27))

The mobile app picks a unit's plural after rounding, converts masses and volumes through the shared unit table (a bare cup or spoon uses 240, 15 and 5 mL), converts Celsius values with or without a space or decimals, and shows a recipe's first tag above its title. Failing-first tests in `test/mobile-logic.test.js`. `npm run format:check`, `npm run lint`, `npm test` (92 passed, the OCR case skipped) and `npm run test:e2e` (28 passed) pass.

### Older mobile backups stay saveable and storage errors readable ([#26](https://github.com/Sweatpantslife/kooks/pull/26))

A long label from a backup made before facets is cut to the tag limit, two unreadable cookbook files give a plain message saying the original file was kept, and backups are named after the local day. Failing-first tests in `test/mobile.test.js`. `npm run format:check`, `npm run lint` and `npm test` (92 passed, the OCR case skipped) pass, and `npm run test:e2e` passed 27 tests; a passkey sign-in test this change does not touch failed once.

### Refusals that name their reason ([#25](https://github.com/Sweatpantslife/kooks/pull/25))

Archiving a recipe that active meals or variations use, or undoing its creation, is refused with `IN_USE` and names them; finishing a finished cooking session is refused with `SESSION_FINISHED`; a batch from a recipe without a yield is refused with `MISSING_YIELD` and says how to fix it. Failing-first tests in the workflow and features suites. `npm run format:check`, `npm run lint`, `npm test` (89 passed, the OCR case skipped) and `npm run test:e2e` (28 passed) pass.

### Polls answered from the action log with only changed records ([#23](https://github.com/Sweatpantslife/kooks/pull/23))

An unchanged poll of `/api/state` no longer reads any records, and a tab that sends its revision gets only the records changed since. With 3,000 recipes an unchanged poll fell from 52.5 ms to 2.2 ms and a poll after one save from 8.9 MB in 112 ms to 3 KB in 2.9 ms. `test/state.test.js` covers the delta, full loads after a restart or more than 200 actions, and writes from the MCP process; a new browser test shows another cook's changes reaching an open page. `npm run format:check`, `npm test` and `npm run test:e2e` (24 passed) pass.

### Security policy, contributing guide, .env.example and changelog ([#24](https://github.com/Sweatpantslife/kooks/pull/24))

Added this changelog, [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and a commented [.env.example](.env.example) with every setting the servers read. The dated verification log moved here from the [developer handoff](docs/handoff.md). Documentation only: `npm run format:check` and `npm run lint` pass, and the server starts with the loopback and private-network settings the example describes.

### ESLint ([#21](https://github.com/Sweatpantslife/kooks/pull/21))

`npm run lint` runs ESLint 10's recommended rules and CI runs it after the Prettier check. Of the 18 problems the rules first reported, four were in the code: a lost passkey error cause, a dead assignment and two intentional patterns that now say so. `npm run lint`, `npm run format:check`, `npm test` (89 tests: 88 passed, the OCR case skipped), `npm run build:mobile` and `npm run test:e2e` (27 passed) pass on Linux.

### Cooking steps read aloud and messages kept off the cooking footer ([#22](https://github.com/Sweatpantslife/kooks/pull/22))

Both apps announce the new step after Next, Previous or a jump, the device app moves focus to Finish on the last step, and on phones the status message sits above the sticky cooking footer instead of covering Previous and Next. `npm run format:check`, `npm test` (88 passed, 1 skipped) and `npx playwright test` (28 passed) pass; the new footer check fails without the CSS change.

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
