# Kooks for iOS and Android

The phone app is the same app as the browser's (`client/`, [the IA and UX guide](ia-ux.md)), packaged with Capacitor 8 in the Xcode and Android Studio projects in `ios/` and `android/`. It signs in to the household's kitchen, the Kooks server the household already runs, and works on the same recipes, plans and groceries as everyone's browsers. The phone keeps no cookbook of its own.

## Run and build

Use Node.js 22.13 or newer. From this project directory:

```sh
npm ci
npm run cap:sync       # Build client/dist and copy it into both native projects
```

The Capacitor packages are development dependencies: Vite bundles them into the app and the native projects read them from `node_modules`, so build from a full `npm ci`. `npm ci --omit=dev`, which the server's Docker image uses, leaves them out. In a browser the plugins never load.

To try the phone's screens without a phone, run a kitchen with sign-in on, open it in a browser and set `localStorage["kooks.phone"] = "1"` in the developer tools: the page then signs in the phone's way, with the kitchen's address, an emailed link opened and confirmed in another tab or on another device, and a device token, and hands files over as downloads.

```sh
npm run native:doctor  # Check the local native build tools
npm run cap:ios        # Sync and open Xcode
npm run cap:android    # Sync and open Android Studio
```

After the native tools are installed:

```sh
npm run cap:run:ios
npm run cap:run:android
npm run build:ios
npm run build:android
```

`build:ios` makes an unsigned **simulator** application at `build/ios/Build/Products/Debug-iphonesimulator/App.app`. It does not create a device IPA. `build:android` makes a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`.

Native requirements follow [Capacitor's environment guide](https://capacitorjs.com/docs/getting-started/environment-setup):

- iOS: macOS, Xcode 26 or newer, its iOS SDK and a simulator runtime. Select Xcode's Command Line Tools in Xcode Settings → Locations. Dependencies use Swift Package Manager; CocoaPods is not needed. Deployment target: iOS 15.
- Android: Android Studio 2025.2.1 or newer, JDK 21 or newer, Android SDK Platform 36 and build tools. Set `JAVA_HOME` and `ANDROID_HOME`, or configure the SDK through Android Studio. Minimum Android API: 24; compile/target API: 36.

For a physical iPhone, select your Apple development team in Xcode's Signing & Capabilities. Store releases also require your signing credentials and distribution setup. The development identifier is `app.kooks.household`; confirm the identifier before a store release and update it consistently in Capacitor, the Xcode target, and `android/app/build.gradle` if needed. No signing credentials are stored here.

## Signing in

The first screen asks where the kitchen is: the address the household opens Kooks at, such as `kooks.example.com`. The app checks that it answers like a Kooks kitchen with sign-in on, then asks for the member's email address and emails a sign-in link. The member opens it on the phone or any other device and confirms that the app may sign in; the app, asking every few seconds, then signs in by itself. The app keeps the kitchen's address and a device token in its web storage and sends the token with every request; [the hosting guide](hosting.md) describes the server's side. The kitchen must be reachable over https: Android refuses plain-http traffic, and so does the page's own policy. **Household › This phone** signs out, or signs out and forgets the kitchen to use another one.

Passkeys stay browser-only, since a passkey belongs to the kitchen's own web address, and so does opening a link: it opens in the browser, which signs the app in rather than itself.

## What the phone adds

- The Android back button goes back through the app's pages, and leaves the app from Week.
- Cooking timers ring as notifications with the phone locked or the app closed. Kooks asks for permission when the first timer starts. Every timer still counting in an active cooking session is scheduled, and a timer that is cancelled, changed or done is taken off again, whichever device did it, the next time the app is open. Android uses ordinary notifications without special exact-alarm access, so alerts can be late; Focus, Do Not Disturb and battery settings affect them too. See the [Local Notifications plugin](https://capacitorjs.com/docs/apis/local-notifications).
- A light tap when a cooking step is done.
- Photos and books come with the device token, so they load into memory rather than by address. **Download** and **Open** on a book, the backup and the bookmarks file hand the file to the phone's share sheet (Books, Files, Mail). The file is written to an `exports` folder in the app's cache first, the only folder Android's file provider shares (`android/app/src/main/res/xml/file_paths.xml`).
- The status and navigation bars follow the phone's light or dark look, and the layout keeps to the safe areas.
- Coming back to the app fetches what changed while it was away.

## Without a connection

The phone keeps a copy of the kitchen as it last saw it, in the app's IndexedDB, written a moment after each change arrives. When the app starts, it shows that copy at once and then catches up from it. When the kitchen does not answer, in a shop's basement or on a train, every page says **Can’t reach the kitchen** and since when, and everything stays readable: the week, the recipes, the grocery list. A request that hangs, as one can on a bar of signal, counts as no answer after 20 seconds.

Some changes still work, the ones that cannot overwrite anyone when they arrive late:

| Change                                                       | Where                                     | When it arrives                                                                                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticking a grocery into the basket, or back                   | To buy                                    | Sent against whatever version the list has by then: a tick only says "in the basket" or not. A grocery that changed meanwhile, say because its amount grew, is a new grocery, and the old tick is let go.      |
| Adding a grocery by hand                                     | To buy, and At home's **Add to the list** | Added to the list as it is by then, beside what others added. Ticked while it waits, it is ticked once it is on the list.                                                                                      |
| **Ate one** and **All gone** on leftovers                    | At home                                   | One portion is refused if none is free by then; All gone eats whatever is left, or nothing.                                                                                                                    |
| A cooking note (**Add a note**)                              | A recipe                                  | A note is a record of its own, so nothing meets it.                                                                                                                                                            |
| An edit of a recipe (**Edit**, and the heart for a favorite) | A recipe                                  | Met part by part with the recipe as the kitchen has it by then: a part only one side changed keeps that side's change. Where both changed the same part differently, nothing is sent until the member chooses. |

Everything else needs the kitchen and says so: cooking (its progress is shared with whoever else is at the stove, and a timer's deadline is set when the kitchen hears of it, so a timer started offline would ring late), planning, new recipes and versions, imports, the household.

A change made out of reach shows at once where it was made, marked **Waiting to send**, and the bar counts what waits and links to **Waiting to send** (`#/waiting`), which lists each change in the order it will go, when it was made, and a **Discard** button with Undo. Changes wait in the app's web storage (`kooks.outbox`), and go to the kitchen in the order they were made as soon as it answers.

Each change is a call to one of the kitchen's tools with a request id fixed when it was made. The kitchen makes a request id's change once and answers it again with what it did, and it checks the request id before anything else, so:

- a change whose answer was lost, because the connection dropped after the kitchen made it, is asked again exactly as it was and the kitchen says it is done; nothing is made twice;
- a change the kitchen refused as stale was not made, so it goes again with the same request id against the version the kitchen has now;
- a change the kitchen will not take at all (the last portion was eaten by someone else, the list is gone) is never dropped: the bar says **The kitchen didn’t take a change made here**, and Waiting to send shows why, with **Try again** and **Discard**.

A recipe edit keeps the recipe as it was when the edit started. When it goes, each part (the name, servings, ingredients, method, notes and so on) is compared three ways: what it was, what the phone made of it, and what the kitchen has now. The parts nobody else changed take the phone's change, the parts only someone else changed keep theirs, and a part both changed to the same thing is agreed. A part both changed differently stops the edit before anything is sent: the bar says **An edit made here met a change in the kitchen**, the recipe says so too, and **Choose what to keep** (`#/waiting/<id>`) lists which changes are kept from each side and, for each part both changed, the phone's version beside the kitchen's, to pick one. Saving there makes an edit of the kitchen's version as it is then, so a change made after it is met the same way. If the recipe left the cookbook meanwhile, the page offers **Save yours as a new recipe** or **Discard your edit**. A second edit of the same recipe made while the first waits joins it, so the kitchen gets one.

Signing out removes the copy and anything waiting, and asks first when something waits. Moving to another household asks the same. When the kitchen ends the sign-in itself, the sign-in page says how many changes made on the phone were not sent. Photos are not kept, so they stay blank until the kitchen answers.

A browser keeps no copy, since its page comes from the kitchen, and of these changes keeps only grocery ticks while a tab is open without the kitchen; the rest fail with **Could not reach the kitchen** as before.

## Recipes from the previous phone app

The phone app before this one kept a cookbook of its own in `kooks/cookbook.json` in the app's private data folder. When that file is there, Recipes offers **Recipes on this phone**: **Bring them in** saves each recipe written on the phone as a new recipe in the kitchen, with its ingredients, steps, equipment, links, labels and notes, and then renames the file `kooks/cookbook.imported.json`, so nothing is lost and nothing is offered twice. Its six sample recipes, its plans, meals and settings stay behind. **Not now** hides the offer until the app starts again. Each recipe is saved under its own key, so a bring-in that stopped half way carries on without saving any recipe twice.

Android's backup and new-phone transfer rules (`backup_rules.xml`, `data_extraction_rules.xml`) carry that `kooks` folder and nothing else, so the device token and the copy of the kitchen, which live in the app's web storage, never enter Google's backup. On iOS the app's web storage is part of the device backup, like the rest of its data.

## Page policy

The built page carries a content security policy in a meta tag (`client/page-policy.js`), because on a phone no server sends one: script, styles, fonts and images only from the app, requests to the app and to https addresses, and video players only from the embed origins in `shared/links.js`. In a browser the server's stricter policy applies as well.

The iOS privacy manifest is included in the Xcode Resources build phase and declares the file-timestamp and UserDefaults access the plugins use, following the [Filesystem](https://capacitorjs.com/docs/apis/filesystem) and [Preferences privacy guidance](https://capacitorjs.com/docs/apis/preferences). No analytics are configured.

## Development and verification

```sh
npm test                    # Unit tests, including the phone's notification, address and import logic
npm run test:e2e            # Playwright, including the phone's sign-in in a browser
npm run native:assets       # Regenerate checked-in icons/splashes from resources/logo.svg
```

Playwright uses its managed Chromium by default (run `npx playwright install chromium` once). Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome, or `PLAYWRIGHT_EXECUTABLE_PATH` to point at a specific browser binary.

The phone's screens are checked in Chromium, not in a native WebView. The [native builds workflow](../.github/workflows/native.yml) compiles both apps whenever the phone app or the native projects change: the Android debug APK on Ubuntu with JDK 21 and SDK Platform 36 (kept as a seven-day artifact), and the iOS simulator app on macOS with Xcode 26. It also fails when `cap sync` would change a tracked file in `android/` or `ios/`, so commit the result of `npm run cap:sync`. Nothing runs either app, so no simulator run, signing or physical-device notification delivery has been verified. Before distribution, run both native builds and exercise cold launch, sign-in against a real kitchen, safe areas and the keyboard, back navigation, sharing a book and a backup, timer permission and delivery, and bringing in recipes from the previous app, on actual iOS and Android devices.

`npm audit` reports no vulnerabilities. The Capacitor CLI's build-only `xcode → uuid` advisory is gone from CLI 8.6.0, whose `xcode` 4 no longer depends on `uuid`; the CLI was never part of the app bundle.
