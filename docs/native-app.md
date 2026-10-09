# Kooks for iOS and Android

Kooks now has a Capacitor 8 application in `app/`, with Xcode and Android Studio projects in `ios/` and `android/`. The bundled app works without a running desktop server or internet connection. The existing MCP server and desktop web app keep their own data and commands.

## Run and build

Use Node.js 22.13 or newer. From this project directory:

```sh
npm ci
npm run dev:mobile
```

Open `http://127.0.0.1:5173` to preview the mobile interface in a browser. This uses IndexedDB for browser data. The packaged native apps use Capacitor Filesystem in the app's private data directory.

```sh
npm run cap:sync       # Build the bundled interface and sync both native projects
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

## Included experience

- The same navigation as the browser app: Today, Recipes, Plan (Week and Meals), Shop and Cook, with backup, preferences, timer alerts and the assistant preview under the Settings gear. See [the IA and UX guide](ia-ux.md).
- Recipe library, ingredient search, favorites, manual/paste entry, editing, original recipe text, serving adjustments, required equipment, cooking notes, and links and videos: YouTube, Vimeo, Facebook, Instagram and TikTok players load from the provider only when play is pressed; other links open in the browser.
- Composed meals with independent dish portions and combined equipment. Reviewed shopping contributions combine matching ingredients, avoid duplicate additions, and clear checkmarks when amounts change.
- A simple Monday–Sunday plan with saved dish portions.
- Cooking sessions with independent dish progress and timers that retain their deadlines after navigation and app restarts.
- Native timer notifications, share sheet, haptics, Android back navigation, safe-area spacing, app icons, and launch screens.
- Course, cuisine, diet labels and tags on every recipe, with library filters built from the cookbook's own values and matching shared with the browser app (`shared/taxonomy.js`). The editor offers existing cuisines and tags; a filter never matches an unrecorded course or cuisine.
- Settings with theme (system, light or dark), palette, layout and spacing choices, measurement display, and mobile backup export/restore. Restores validate the whole backup and ask explicitly before replacing the current device's cookbook.

Six labeled example recipes and one example meal help with first launch. English and metric remain the initial defaults. The inherited kitchen-volume convention is stated in the editor: cup = 240 mL, tablespoon = 15 mL, teaspoon = 5 mL. Mass-to-volume conversions are not inferred.

## Storage and scope

The native app keeps `kooks/cookbook.json` and the last validated snapshot `kooks/cookbook.previous.json` in `Directory.Data`. Writes are serialized; a temporary file is written before replacing the primary file. If a saved file is corrupt, the previous valid snapshot is recovered. Unrecoverable/read-permission errors stop loading without resetting data. Storage failures remain visible and allow an export of the in-memory cookbook.

Use **Settings › Backup › Export backup** to save or share a `kooks-mobile` JSON file. Restore is supported across the iOS, Android, and browser versions of this interface. Backups written before recipe facets still restore: their single recipe label becomes a tag, and course, cuisine and diet labels start unset. Device OS backup services may also include app data according to the user's system settings. Uninstalling removes local app data; keep exported copies.

The mobile cookbook is separate from `.data/kooks.sqlite`, the MCP tools, and the desktop server. It does not yet synchronize household members or import the MCP backup format. Settings › Assistant shows explicitly labeled sample actions; AI account login and live AI inference have not been connected. Incoming share-menu imports, website/photo extraction, multi-day batch planning, and production household authentication are outside this native implementation.

Notifications are requested when the user starts a timer or enables alerts in Settings › Timers. Pausing, removing, or completing timers cancels their pending notifications; resuming schedules the new deadline. Android uses ordinary notifications without requesting special exact-alarm access, so alerts can be delayed. Permission, Focus/Do Not Disturb, and battery settings affect delivery. These are reminders, not a guarantee of exact or audible locked-screen alarms. See the [Local Notifications plugin](https://capacitorjs.com/docs/apis/local-notifications).

The iOS privacy manifest is included in the Xcode Resources build phase and declares file-timestamp and UserDefaults access used by storage/plugins, following the [Filesystem](https://capacitorjs.com/docs/apis/filesystem) and [Preferences privacy guidance](https://capacitorjs.com/docs/apis/preferences). No analytics, account credentials, or remote server URL are configured in the native app.

## Development and verification

```sh
npm test                    # Existing MCP workflows plus mobile storage/timer/logic tests
npm run test:mobile          # Just mobile unit tests
npm run test:e2e             # Playwright suites for this interface and the browser app
npm run test:mobile:e2e      # Only the mobile project
npm run native:assets       # Regenerate checked-in icons/splashes from resources/logo.svg
```

Playwright uses its managed Chromium by default (run `npx playwright install chromium` once). Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome, or `PLAYWRIGHT_EXECUTABLE_PATH` to point at a specific browser binary.

The mobile build and `cap sync` succeed. Browser verification covers adding/editing/scaling recipes, persistence after reload, meal shopping and changed quantities, cooking progress, paused timers, backup restore, early-iOS API fallbacks, and 320/390/768/1280-pixel layouts. Unit tests exercise failed/interrupted storage, recovery, invalid backups, and timer notification reconciliation. The browser checks do not validate native plugin execution.

On the implementation machine, Xcode, Java, and the Android SDK are missing. Consequently no native binary, simulator run, signing, or physical-device notification delivery has been verified. Before distribution, run both native builds and exercise cold launch, safe areas/keyboard, back navigation, share/export/restore, offline editing, app termination/relaunch, and timer permissions/delivery on actual iOS and Android devices. Also confirm that embedded players load inside the native WebView and that recipe links open in the system browser; both were checked in Chromium only.

The app's production dependencies have no reported advisories in the implementation audit. The Capacitor CLI's build-only `xcode → uuid` dependency reports a moderate advisory; it is not included in the app bundle. Keep the CLI updated as upstream releases fixes.
