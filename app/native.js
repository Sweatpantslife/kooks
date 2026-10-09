import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";
import { notificationChanges } from "./timers.js";
import { clone as structuredClone } from "./compat.js";

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

export async function exportCookbook(backup) {
  const filename = `kooks-${new Date().toISOString().slice(0, 10)}.json`;
  const data = JSON.stringify(backup, null, 2);
  if (!isNative)
    return download(new Blob([data], { type: "application/json" }), filename);
  const result = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({
    title: "Kooks cookbook backup",
    files: [result.uri],
    dialogTitle: "Save your cookbook backup",
  });
}
