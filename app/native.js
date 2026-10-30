import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";
import { notificationChanges } from "./timers.js";
import { clone as structuredClone } from "./compat.js";
import { backupFilename } from "./model.js";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();
export function tap() {
  if (isNative)
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export async function enableTimerAlerts() {
  if (!isNative) return false;
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display === "granted") return true;
  return (await LocalNotifications.requestPermissions()).display === "granted";
}

let notificationQueue = Promise.resolve();
export function syncTimerAlerts(timers) {
  if (!isNative) return Promise.resolve();
  const savedTimers = structuredClone(timers);
  notificationQueue = notificationQueue
    .catch(() => {})
    .then(async () => {
      const { notifications } = await LocalNotifications.getPending();
      const change = notificationChanges(savedTimers, notifications);
      if (change.cancel.length)
        await LocalNotifications.cancel({ notifications: change.cancel });
      if (
        change.schedule.length &&
        (await LocalNotifications.checkPermissions()).display === "granted"
      ) {
        await LocalNotifications.schedule({ notifications: change.schedule });
      }
    });
  return notificationQueue;
}

export async function initializeNative({ back, resume, openTimers }) {
  if (!isNative) return;
  await SystemBars.setStyle({ style: SystemBarsStyle.Dark });
  if (platform === "android") {
    await LocalNotifications.createChannel({
      id: "kooks-timers",
      name: "Cooking timers",
      description: "Reminders for your cooking timers",
      importance: 5,
      visibility: 1,
      vibration: true,
    });
    await App.addListener("backButton", () => {
      if (!back()) void App.minimizeApp();
    });
  }
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) resume();
  });
  await LocalNotifications.addListener(
    "localNotificationActionPerformed",
    ({ notification }) => {
      if (notification.extra?.kooksTimer) openTimers();
    },
  );
}

export async function shareRecipe(title, text) {
  if (isNative || navigator.share) {
    if (isNative)
      await Share.share({ title, text, dialogTitle: "Share recipe" });
    else await navigator.share({ title, text });
    return;
  }
  download(new Blob([text], { type: "text/plain" }), "kooks-recipe.txt");
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A native export is written to its own cache folder, the only one Android's
// FileProvider shares (res/xml/file_paths.xml), and replaces the last one: the
// app that receives it may read the file after the share sheet closes, so it
// cannot be removed right away.
export async function exportCookbook(backup) {
  const filename = backupFilename();
  const data = JSON.stringify(backup, null, 2);
  if (!isNative)
    return download(new Blob([data], { type: "application/json" }), filename);
  await Filesystem.rmdir({
    path: "exports",
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => {});
  const result = await Filesystem.writeFile({
    path: `exports/${filename}`,
    data,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  await Share.share({
    title: "Kooks cookbook backup",
    files: [result.uri],
    dialogTitle: "Save your cookbook backup",
  });
}
