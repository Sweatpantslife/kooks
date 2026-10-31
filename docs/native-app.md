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

The identifier is `app.kooks.household` on both platforms. No signing credentials are stored here: the Android release key lives in the repository's Actions secrets and with its owner, and an iPhone build signs with the developer's own Apple team. [Releases](#releases) describes how a version reaches the phones.

## Releases

Kooks is not listed in the App Store or Google Play. Android releases are published on the repository's [Releases page](https://github.com/Sweatpantslife/kooks/releases) as pre-releases, each with a signed APK to install on a phone; see [Install on Android](#install-on-android). The repository is public, so anyone can download that APK, but it only works with an account on a kitchen, and kitchens take members by invitation.

### Version and build numbers

Both apps take their version from `package.json`. `npm run native:version` (`scripts/native-version.mjs`) writes it into `android/app/build.gradle` (`versionName`, `versionCode`) and the Xcode project (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`), and `npm version` runs it. The build number grows with the version, major × 10000 + minor × 100 + patch (0.3.0 is build 300), so every release installs over the one before and a version always has the same build number. Versions are three plain numbers, with minor and patch below 100. `npm test` fails when the native projects say anything else.

### The Android release key

Android installs a newer version over an older one only when both are signed with the same key. The key is made once, on the owner's computer, with `scripts/android-release-key.sh`:

```sh
sh scripts/android-release-key.sh            # or: sh scripts/android-release-key.sh ~/somewhere-safe
```

Without a copy of the repository, download the script on its own and run it:

```sh
curl -fsSLO https://raw.githubusercontent.com/Sweatpantslife/kooks/main/scripts/android-release-key.sh
sh android-release-key.sh
```

It needs `openssl` (macOS and Linux have it; on Windows use Git Bash) and refuses to run where a key already exists. It makes a 4096-bit RSA key valid for 30 years in a PKCS #12 file with the alias `kooks`, in a folder only its owner can read (`~/kooks-android-release` by default), with the password, the key as base64 text, the public certificate and a `README.txt` beside it. It prints the certificate's SHA-256 fingerprint, which every release page also shows. With the GitHub CLI signed in, it offers to store the two secrets itself; otherwise it says what to paste where:

| Actions secret                    | Value                                 |
| --------------------------------- | ------------------------------------- |
| `KOOKS_ANDROID_KEYSTORE`          | the contents of `keystore.base64.txt` |
| `KOOKS_ANDROID_KEYSTORE_PASSWORD` | the line in `password.txt`            |

Keep the folder, or at least `kooks-release.p12` and its password, in a password manager or another safe place: GitHub never shows a secret again. If the key is lost, a release signed with a new one installs only after the app is uninstalled, and the phone then signs in again; the recipes live in the kitchen, so nothing else is lost.

### Making a release

1. On a branch, raise the version: `npm version minor --no-git-tag-version` (or `patch`). This changes `package.json`, `package-lock.json` and both native projects. In `CHANGELOG.md`, turn **Unreleased** into a heading with the version and date and start a new, empty **Unreleased** above it. Merge the pull request.
2. In the repository's **Actions** tab, open **Phone release** and choose **Run workflow** on `main`. The workflow (`.github/workflows/phone-release.yml`) builds the app, signs the APK with the release key, checks the signature, the version and build number and that the APK is not debuggable, and publishes the pre-release `v<version>` with `kooks-<version>.apk`, its SHA-256 and the signing certificate's fingerprint. It refuses a version that is already released and runs only on `main`.
3. Install it on each phone and go through the [device check](#device-check) for what the release changed.

A pull request that changes the Android build or the workflow runs the same build, signed with a throwaway key made for that run, and publishes nothing; the release key never reaches a pull request. `npm run build:android` still makes the debug APK, which installs beside nothing: a debug build and a release build of the same app are signed differently, so one must be uninstalled before the other goes on.

### Install on Android

Kooks runs on Android 7 or newer.

1. On the phone, open the repository's [Releases page](https://github.com/Sweatpantslife/kooks/releases) and the newest **Kooks** release.
2. Under **Assets**, tap `kooks-<version>.apk`. If the browser warns that the file might be harmful, choose **Download anyway**.
3. Open the download. The first time, Android asks whether the browser may install unknown apps: tap **Settings**, turn on **Allow from this source**, and go back.
4. Tap **Install**. If Google Play Protect says it doesn't recognise the developer, tap **More details**, then **Install anyway**.
5. Open Kooks, type the kitchen's address and your email, and open the link the kitchen emails you, on the phone or anywhere else. It asks before it signs the app in.

A later release installs the same way, over the one on the phone, which stays signed in. If Android says the app conflicts with one already installed, a Kooks signed with another key is on the phone, such as a debug build from Android Studio. Uninstalling it removes what it kept, so if it is the earlier phone app with recipes of its own, bring those recipes somewhere safe first. [Obtainium](https://github.com/ImranR98/Obtainium) can watch the Releases page and offer each new version: add the repository's address and turn on **Include prereleases**.

Google is moving Android towards installing only apps from registered developers. As of October 2026 this applies to apps from participating stores in Brazil, Indonesia, Singapore and Thailand, and Google plans to roll it out globally in 2027. Once it reaches a phone, an unregistered APK installs only through Developer options' **Allow apps from unverified developers** (a one-time 24-hour wait), or with `adb install` from a computer. The other way is registering `app.kooks.household` and the release certificate in the free limited-distribution tier of the [Android Developer Console](https://developer.android.com/developer-verification). The key script's `kooks-release-certificate.pem` is what that asks for.

### iPhone

An iPhone runs only apps signed by an Apple developer team. There are two routes:

- **TestFlight**, with the Apple Developer Program ($99 a year). Each release is uploaded to App Store Connect and the iPhone installs and updates it from the TestFlight app. A build lasts 90 days. This route is not set up yet.
- **Xcode on a Mac**, free with an Apple ID. On a Mac with Xcode 26: `npm ci`, then `npm run cap:ios`. In Xcode, select the **App** target, then **Signing & Capabilities**, and choose your Apple ID's personal team as **Team**. If Xcode says the identifier is taken, change the bundle identifier for your build only. Connect the iPhone and turn on **Settings › Privacy & Security › Developer Mode**. Choose the iPhone as the run destination and press **Run**, then trust the developer in **Settings › General › VPN & Device Management**. An app signed by a personal team stops opening after 7 days, until it is run from Xcode again.

## Signing in

The first screen asks where the kitchen is: the address the household opens Kooks at, such as `kooks.example.com`. The app checks that it answers like a Kooks kitchen with sign-in on, then asks for the member's email address and emails a sign-in link. The member opens it on the phone or any other device and confirms that the app may sign in; the app, asking every few seconds, then signs in by itself. The app keeps the kitchen's address and a device token in its web storage and sends the token with every request; [the hosting guide](hosting.md) describes the server's side. The kitchen must be reachable over https: Android refuses plain-http traffic, and so does the page's own policy. **Household › Sign-in** has **This phone**, which signs out, or signs out and forgets the kitchen to use another one.

Passkeys stay browser-only, since a passkey belongs to the kitchen's own web address, and so does opening a link: it opens in the browser, which signs the app in rather than itself.

## What the phone adds

- The Android back button goes back through the app's pages, and leaves the app from Week.
- Cooking timers ring as notifications with the phone locked or the app closed. Kooks asks for permission when the first timer starts. Every timer still counting in an active cooking session is scheduled, and a timer that is cancelled, changed or done is taken off again, whichever device did it, the next time the app is open. Android uses ordinary notifications without special exact-alarm access, so alerts can be late; Focus, Do Not Disturb and battery settings affect them too. See the [Local Notifications plugin](https://capacitorjs.com/docs/apis/local-notifications).
- A light tap when a cooking step is done.
- Photos and books come with the device token, so they load into memory rather than by address. **Download** and **Open** on a book, the backup and the bookmarks file hand the file to the phone's share sheet (Books, Files, Mail). The file is written to an `exports` folder in the app's cache first, the only folder Android's file provider shares (`android/app/src/main/res/xml/file_paths.xml`).
- The app follows the phone's light or dark mode, as in a browser, unless a look is chosen in **Household › Look and units**, and the status and navigation bars follow the app's look so their text stays readable. The layout keeps to the safe areas. (Until October 31, 2026 both native projects pinned the light look: iOS through `UIUserInterfaceStyle` in `Info.plist`, Android through a `Theme.AppCompat.Light` theme, which keeps the web view's `prefers-color-scheme` light. Both now follow the phone, and `test/native-config.test.js` keeps it so.)
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

Signing out removes the copy and anything waiting, and asks first when something waits. Moving to another household asks the same. When the kitchen ends the sign-in itself, the sign-in page says how many changes made on the phone were not sent. Photos the phone has opened (an idea’s, a technique’s, a book’s cover, the photo of a recipe’s original) are kept beside the copy, in their own IndexedDB store, so they show without the kitchen too. A photo in the kitchen never changes, so a kept one is shown as it is and not fetched again. Up to 50 MB are kept; past that, the ones opened longest ago go first. A photo never opened on the phone stays blank until the kitchen answers, and books and other files are not kept. Kept photos go with the copy at sign-out and when the phone moves to another household.

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

The phone's screens are checked in Chromium, not in a native WebView. The [native builds workflow](../.github/workflows/native.yml) compiles both apps whenever the phone app or the native projects change: the Android debug APK on Ubuntu with JDK 21 and SDK Platform 36 (kept as a seven-day artifact), and the iOS simulator app on macOS with Xcode 26. It also fails when `cap sync` would change a tracked file in `android/` or `ios/`, so commit the result of `npm run cap:sync`. [Phone release](#making-a-release) builds and signs the release APK. Nothing in CI runs either app: behaviour on a phone is checked by hand, with the device check below, on each release.

### Device check

About 20 minutes per phone, on the release about to be used. Use the household's real kitchen, but only test records you then delete, such as a recipe called "Test toast".

1. **Install and first launch.** Install the release ([Android](#install-on-android)); the icon and name read Kooks. A cold launch shows the splash, then the kitchen screen, in the phone's light or dark mode.
2. **Sign in.** Type the kitchen's address without `https://`, then your email. Open the emailed link on another device, then on the phone itself the next time: either one asks before it signs the app in, and the app signs in within a few seconds. Week opens with the household's food.
3. **Safe areas and the keyboard.** Nothing hides under the notch, the status bar or the gesture bar, in portrait and landscape. Add a grocery and write a recipe: the field being typed in stays above the keyboard, and the tab bar doesn't ride up over the form.
4. **Moving around.** Open a recipe from Recipes, then a meal from it. Android's back gesture or button goes back page by page and leaves the app from Week. The iPhone has no back button of its own: note whether going back by the tabs is enough.
5. **Dark mode.** Switch the phone between light and dark: the app follows. Choose Dark, then Light, in **Household › Look and units**: the status bar's text stays readable on each.
6. **Without a connection.** Open Groceries, then turn on flight mode. Every page says **Can't reach the kitchen**, recipes and the week still open, and ticking two groceries works. Turn flight mode off: the ticks reach the kitchen (check in a browser).
7. **Timers with the phone locked.** Cook a recipe and start a 1-minute timer. Allow notifications when asked. Lock the phone: the notification arrives at about one minute, with sound. Start another, cancel it from a browser, then open the app: no notification arrives. Note how late Android's alert was (it uses ordinary notifications, not exact alarms), and check with Do Not Disturb or battery saving on too.
8. **The share sheet.** **Household › Backup**, **Download a backup**: the share sheet opens with the backup file, which can go to Files or Drive. If the shelf has a book, open it from Recipes (the **Books** chip) and tap **Open the book** or **Download**: it goes to the share sheet too.
9. **Coming back.** Leave the app for a minute, change something in a browser, and come back: the change shows within a few seconds.
10. **Recipes from the previous phone app.** Only on a phone that had the earlier Kooks app with recipes of its own: Recipes offers **Recipes on this phone**, and **Bring them in** adds them once.
11. **Sign out.** **Household › Sign-in**, then **Sign out** under This phone, returns to the sign-in screen, and the phone disappears from the signed-in devices that **Household › Sign-in** lists in a browser.

Note the phone, its OS version and the Kooks version with anything that went wrong.

`npm audit` reports no vulnerabilities. The Capacitor CLI's build-only `xcode → uuid` advisory is gone from CLI 8.6.0, whose `xcode` 4 no longer depends on `uuid`; the CLI was never part of the app bundle.
