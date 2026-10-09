import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] || "doctor";
const command = (name, args) =>
  spawnSync(name, args, { encoding: "utf8", timeout: 15000 });

function iosProblems() {
  if (process.platform !== "darwin")
    return ["iOS builds require macOS and Xcode 26 or newer."];
  const result = command("xcodebuild", ["-version"]);
  const version = Number(result.stdout?.match(/Xcode (\d+)/)?.[1]);
  return result.status !== 0 || version < 26 || !version
    ? [
        "Install Xcode 26 or newer, open it to finish setup, and select its Command Line Tools in Xcode → Settings → Locations.",
      ]
    : [];
}

function androidProblems() {
  const problems = [];
  const java = command(
    process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, "bin/java") : "java",
    ["-version"],
  );
  const version = Number(
    `${java.stdout || ""}${java.stderr || ""}`.match(/version "(\d+)/)?.[1],
  );
  if (java.status !== 0 || !version || version < 21)
    problems.push(
      "Install JDK 21 or newer (included with Android Studio) and set JAVA_HOME.",
    );
  let localSdk;
  if (existsSync(resolve(root, "android/local.properties"))) {
    localSdk = readFileSync(resolve(root, "android/local.properties"), "utf8")
      .match(/^sdk.dir=(.+)$/m)?.[1]
      ?.replace(/\\:/g, ":")
      .replace(/\\\\/g, "\\");
  }
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    localSdk ||
    resolve(
      homedir(),
      process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk",
    );
  if (!existsSync(resolve(sdk, "platforms/android-36/android.jar")))
    problems.push(
      "Install Android SDK Platform 36 and Build Tools through Android Studio’s SDK Manager; set ANDROID_HOME to the SDK directory.",
    );
  return problems;
}

if (!["doctor", "ios", "android"].includes(mode)) {
  console.error("Usage: node scripts/native-build.mjs [doctor|ios|android]");
  process.exit(2);
}

const checks =
  mode === "doctor"
    ? [
        ["iOS", iosProblems()],
        ["Android", androidProblems()],
      ]
    : [[mode, mode === "ios" ? iosProblems() : androidProblems()]];
let missing = false;
for (const [platform, problems] of checks) {
  console.log(
    `${platform}: ${problems.length ? "setup required" : "build tools detected"}`,
  );
  for (const problem of problems) console.log(`  ${problem}`);
  missing ||= problems.length > 0;
}
if (missing) process.exit(1);
if (mode === "doctor") process.exit(0);

const build =
  mode === "ios"
    ? spawnSync(
        "xcodebuild",
        [
          "-project",
          "ios/App/App.xcodeproj",
          "-scheme",
          "App",
          "-configuration",
          "Debug",
          "-sdk",
          "iphonesimulator",
          "-destination",
          "generic/platform=iOS Simulator",
          "-derivedDataPath",
          "build/ios",
          "CODE_SIGNING_ALLOWED=NO",
          "build",
        ],
        { cwd: root, stdio: "inherit" },
      )
    : spawnSync(
        process.platform === "win32" ? "gradlew.bat" : "./gradlew",
        [":app:assembleDebug"],
        {
          cwd: resolve(root, "android"),
          stdio: "inherit",
          shell: process.platform === "win32",
        },
      );
process.exit(build.status ?? 1);
