import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildNumber,
  nativeFiles,
  nativeVersions,
  withVersion,
} from "../scripts/native-version.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const res = "android/app/src/main/res/xml";
const elements = (xml, name) =>
  [...xml.matchAll(new RegExp(`<${name}\\b([^>]*)/?>`, "g"))].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
    ),
  );

// The device token lives in the app's web storage, which the rules leave out,
// so a restored backup never signs another phone in.
test("Android shares only exported files and backs up only the old cookbook", () => {
  // The FileProvider used to expose the whole external storage root.
  const paths = read(`${res}/file_paths.xml`).replace(/<!--[\s\S]*?-->/g, "");
  assert.deepEqual(
    [...paths.matchAll(/<([\w-]+-path)\b/g)].map((match) => match[1]),
    ["cache-path"],
  );
  assert.deepEqual(elements(paths, "cache-path"), [
    { name: "exports", path: "exports/" },
  ]);
  assert.match(
    read("client/src/lib/native.js"),
    /path: `exports\/\$\{filename\}`/,
  );

  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const [application] = elements(manifest, "application");
  assert.equal(application["android:allowBackup"], "true");
  assert.equal(application["android:fullBackupContent"], "@xml/backup_rules");
  assert.equal(
    application["android:dataExtractionRules"],
    "@xml/data_extraction_rules",
  );
  // The rules name the folder the phone app before this one kept its
  // cookbook in, which this app reads its recipes from once.
  assert.match(
    read("client/src/lib/native.js"),
    /path: "kooks\/cookbook\.json"/,
  );
  const cookbook = [{ domain: "file", path: "kooks" }];
  const legacy = read(`${res}/backup_rules.xml`);
  assert.deepEqual(elements(legacy, "include"), cookbook);
  assert.deepEqual(elements(legacy, "exclude"), []);
  const rules = read(`${res}/data_extraction_rules.xml`);
  for (const section of ["cloud-backup", "device-transfer"]) {
    const body = rules.match(
      new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`),
    )?.[1];
    assert.ok(body, section);
    assert.deepEqual(elements(body, "include"), cookbook, section);
  }
});

// A release installs over the one before only with a bigger build number,
// and both phones must say the version package.json says.
test("both phone apps carry package.json's version and build number", () => {
  const { version } = JSON.parse(read("package.json"));
  const files = {
    android: read(nativeFiles.android),
    ios: read(nativeFiles.ios),
  };
  const code = buildNumber(version);
  assert.deepEqual(
    nativeVersions(files),
    {
      android: { name: [version], code: [code] },
      ios: { name: [version, version], code: [code, code] },
    },
    "Run node scripts/native-version.mjs (npm version runs it) and commit the native projects.",
  );
});

test("build numbers grow with the version and refuse what they cannot hold", () => {
  assert.equal(buildNumber("0.2.0"), 200);
  assert.equal(buildNumber("0.3.0"), 300);
  assert.equal(buildNumber("1.0.0"), 10000);
  assert.equal(buildNumber("12.34.56"), 123456);
  const order = ["0.2.9", "0.3.0", "0.10.0", "0.99.99", "1.0.0", "1.0.1"];
  const codes = order.map(buildNumber);
  assert.deepEqual(
    [...codes].sort((a, b) => a - b),
    codes,
  );
  for (const bad of ["1.2", "1.2.3-beta.1", "v1.2.3", "1.100.0", "1.2.100"])
    assert.throws(() => buildNumber(bad), undefined, bad);

  const files = {
    android:
      'android {\n    defaultConfig {\n        versionCode 1\n        versionName "0.2.0"\n    }\n}\n',
    ios: "\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n\t\t\t\tMARKETING_VERSION = 0.2.0;\n\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n\t\t\t\tMARKETING_VERSION = 0.2.0;\n",
  };
  const next = withVersion(files, "1.4.2");
  assert.deepEqual(nativeVersions(next), {
    android: { name: ["1.4.2"], code: [10402] },
    ios: { name: ["1.4.2", "1.4.2"], code: [10402, 10402] },
  });
  assert.equal(
    next.android,
    'android {\n    defaultConfig {\n        versionCode 10402\n        versionName "1.4.2"\n    }\n}\n',
  );
  assert.throws(
    () => withVersion({ ...files, ios: "" }, "1.4.2"),
    /MARKETING_VERSION/,
  );
});

// The app has a dark look that follows the phone's setting. A native project
// that pins the light look keeps prefers-color-scheme light in the web view:
// iOS through UIUserInterfaceStyle, Android through a theme whose
// isLightTheme is true (Theme.AppCompat.Light).
test("neither phone project pins the light look", () => {
  const plist = read("ios/App/App/Info.plist");
  assert.doesNotMatch(plist, /<key>UIUserInterfaceStyle<\/key>/);
  assert.doesNotMatch(plist, /<key>UIStatusBarStyle<\/key>/);
  const styles = read("android/app/src/main/res/values/styles.xml");
  const parents = [...styles.matchAll(/parent="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(parents, [
    "Theme.AppCompat.DayNight.DarkActionBar",
    "Theme.AppCompat.DayNight.NoActionBar",
    "Theme.SplashScreen",
  ]);
  assert.match(
    read("android/app/src/main/res/values-night/colors.xml"),
    /<color name="kooks_paper">#151412<\/color>/,
  );
});
