import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The phone apps take their version from package.json: Android's versionName
// and versionCode, and iOS's MARKETING_VERSION and CURRENT_PROJECT_VERSION.
// `npm version` runs this, so a new version reaches both native projects.
// The build number grows with the version (1.2.3 is 10203), so every release
// installs over the one before it and the same version always gets the same
// number.

const root = new URL("../", import.meta.url);
export const nativeFiles = {
  android: "android/app/build.gradle",
  ios: "ios/App/App.xcodeproj/project.pbxproj",
};

export function buildNumber(version) {
  // Plain versions only: the App Store takes three numbers, and a
  // 1.2.3-beta.1 would share 1.2.3's build number.
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) throw new Error(`"${version}" is not a version like 1.2.3.`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99)
    throw new Error(
      `${version}: minor and patch must stay below 100 for the build number.`,
    );
  // Android refuses a versionCode above 2100000000.
  if (major > 20999)
    throw new Error(`${version}: the major version is too big.`);
  return major * 10000 + minor * 100 + patch;
}

// What each native file says, so a test can hold them to package.json.
export function nativeVersions(files) {
  const all = (text, pattern) =>
    [...text.matchAll(pattern)].map((match) => match[1]);
  return {
    android: {
      name: all(files.android, /^\s*versionName\s+"([^"]*)"/gm),
      code: all(files.android, /^\s*versionCode\s+(\S+)/gm).map(Number),
    },
    ios: {
      name: all(files.ios, /^\s*MARKETING_VERSION = ([^;]+);/gm),
      code: all(files.ios, /^\s*CURRENT_PROJECT_VERSION = ([^;]+);/gm).map(
        Number,
      ),
    },
  };
}

export function withVersion(files, version) {
  const code = buildNumber(version);
  const replace = (text, pattern, value, name) => {
    let count = 0;
    const next = text.replace(pattern, (...match) => {
      count += 1;
      return `${match[1]}${value}${match[2] ?? ""}`;
    });
    if (!count) throw new Error(`No ${name} found to update.`);
    return next;
  };
  let android = replace(
    files.android,
    /^(\s*versionName\s+)"[^"]*"()/gm,
    JSON.stringify(String(version)),
    "versionName in build.gradle",
  );
  android = replace(
    android,
    /^(\s*versionCode\s+)\S+()/gm,
    code,
    "versionCode in build.gradle",
  );
  let ios = replace(
    files.ios,
    /^(\s*MARKETING_VERSION = )[^;]+(;)/gm,
    version,
    "MARKETING_VERSION in project.pbxproj",
  );
  ios = replace(
    ios,
    /^(\s*CURRENT_PROJECT_VERSION = )[^;]+(;)/gm,
    code,
    "CURRENT_PROJECT_VERSION in project.pbxproj",
  );
  return { android, ios };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (path) => readFileSync(new URL(path, root), "utf8");
  const { version } = JSON.parse(read("package.json"));
  try {
    const before = {
      android: read(nativeFiles.android),
      ios: read(nativeFiles.ios),
    };
    const after = withVersion(before, version);
    for (const key of /** @type {const} */ (["android", "ios"]))
      if (after[key] !== before[key])
        writeFileSync(new URL(nativeFiles[key], root), after[key]);
    console.log(
      `Phone apps: version ${version}, build ${buildNumber(version)}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
