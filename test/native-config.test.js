import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
