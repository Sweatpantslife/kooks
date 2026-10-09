import sharp from "sharp";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const svg = await readFile(resolve(root, "resources/logo.svg"), "utf8");
const logo = Buffer.from(svg);
await sharp(logo)
  .resize(1024, 1024)
  .png()
  .toFile(
    resolve(
      root,
      "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
    ),
  );
for (const [density, iconSize, foregroundSize] of [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
]) {
  const folder = resolve(root, `android/app/src/main/res/mipmap-${density}`);
  await sharp(logo)
    .resize(iconSize)
    .png()
    .toFile(resolve(folder, "ic_launcher.png"));
  const round = Buffer.from(
    svg.replace(
      '<rect width="64" height="64" fill="#385740"/>',
      '<circle cx="32" cy="32" r="32" fill="#385740"/>',
    ),
  );
  await sharp(round)
    .resize(iconSize)
    .png()
    .toFile(resolve(folder, "ic_launcher_round.png"));
  const foreground = Buffer.from(
    svg
      .replace('viewBox="0 0 64 64"', 'viewBox="-18 -18 100 100"')
      .replace('<rect width="64" height="64" fill="#385740"/>', ""),
  );
  await sharp(foreground)
    .resize(foregroundSize)
    .png()
    .toFile(resolve(folder, "ic_launcher_foreground.png"));
}
async function renderSplash(path) {
  const { width, height } = await sharp(path).metadata();
  const size = Math.round(Math.min(width, height) * 0.24);
  const mark = await sharp(logo).resize(size).png().toBuffer();
  const output = await sharp({
    create: { width, height, channels: 3, background: "#f6f5ef" },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toBuffer();
  await writeFile(path, output);
}
const iosSplash = resolve(root, "ios/App/App/Assets.xcassets/Splash.imageset");
for (const file of await readdir(iosSplash))
  if (file.endsWith(".png")) await renderSplash(resolve(iosSplash, file));
const androidRes = resolve(root, "android/app/src/main/res");
for (const folder of await readdir(androidRes)) {
  if (!folder.startsWith("drawable")) continue;
  for (const file of await readdir(resolve(androidRes, folder)))
    if (file === "splash.png")
      await renderSplash(resolve(androidRes, folder, file));
}
console.log("Generated Kooks icons and launch screens for iOS and Android.");
