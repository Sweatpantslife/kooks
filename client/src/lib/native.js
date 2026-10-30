import { effect } from "@preact/signals";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { native } from "./device.js";
import { records } from "./store.js";

// What only the phone app does: the back button, waking up, timers that
// ring with the phone locked, a light tap, and handing files and text to
// other apps. The plugins load only on a phone, so a browser never fetches
// them.
const plugins = native
  ? Promise.all([
      import("@capacitor/app"),
      import("@capacitor/local-notifications"),
    ])
  : null;

// A timer's notification id: a whole number the phone can hold, the same
// for the same timer every time.
export function notificationIdOf(timerId) {
  let n = 7;
  for (const char of String(timerId)) n = (n * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(n) % 2147483646) + 1;
}

// The notifications to cancel and to schedule so the phone rings for every
// timer still counting on the stove, and for nothing else.
export function notificationChanges(sessions, pending, now = Date.now()) {
  const wanted = sessions.flatMap((session) =>
    (session.data.timers ?? [])
      .filter((t) => !t.cancelled && Date.parse(t.deadline) > now)
      .map((t) => ({
        id: notificationIdOf(t.id),
        title: "Time’s up",
        body: `${t.label} · ${session.data.title}`,
        schedule: { at: new Date(t.deadline), allowWhileIdle: true },
        channelId: "kooks-timers",
        extra: { kooksTimer: true, deadline: t.deadline },
      })),
  );
  const ours = pending.filter((n) => n.extra?.kooksTimer);
  const same = (a, b) =>
    a.id === b.id && a.extra?.deadline === b.extra.deadline;
  return {
    cancel: ours
      .filter((n) => !wanted.some((w) => same(n, w)))
      .map((n) => ({ id: n.id })),
    schedule: wanted.filter((w) => !ours.some((n) => same(n, w))),
  };
}

let syncing = Promise.resolve();
function ringTimers(LocalNotifications, sessions) {
  syncing = syncing
    .catch(() => {})
    .then(async () => {
      const { notifications } = await LocalNotifications.getPending();
      const { cancel, schedule } = notificationChanges(sessions, notifications);
      if (cancel.length)
        await LocalNotifications.cancel({ notifications: cancel });
      if (
        schedule.length &&
        (await LocalNotifications.checkPermissions()).display === "granted"
      )
        await LocalNotifications.schedule({ notifications: schedule });
    });
}

// Asked when a timer starts, the first time only.
export async function allowTimerAlerts() {
  if (!plugins) return;
  const [, { LocalNotifications }] = await plugins;
  const { display } = await LocalNotifications.checkPermissions();
  if (display === "prompt" || display === "prompt-with-rationale")
    await LocalNotifications.requestPermissions();
}

export async function startNative({ back, resume }) {
  if (!plugins) return;
  const [{ App }, { LocalNotifications }] = await plugins;
  // The bars follow the phone's light or dark look, as the app does.
  void SystemBars.setStyle({ style: SystemBarsStyle.Default }).catch(() => {});
  await App.addListener("backButton", () => {
    if (!back()) void App.minimizeApp();
  });
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) resume();
  });
  await LocalNotifications.createChannel?.({
    id: "kooks-timers",
    name: "Cooking timers",
    description: "When a cooking timer runs out",
    importance: 5,
    visibility: 1,
    vibration: true,
  }).catch(() => {});
  effect(() => {
    ringTimers(
      LocalNotifications,
      records("session").filter((s) => s.data.status === "active"),
    );
  });
}

export async function tap() {
  if (!native) return;
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

const base64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// A file for another app on the phone, such as Books or Files: written to
// the app's cache under exports/, the only folder it shares, then offered.
export async function shareFile(blob, name) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const filename = name.replace(/[^\w .()-]+/g, "_").slice(0, 120) || "kooks";
  const { uri } = await Filesystem.writeFile({
    path: `exports/${filename}`,
    data: await base64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title: filename, files: [uri] });
}

// The cookbook the phone app before this one kept on the phone, if it is
// still there.
const oldCookbook = { path: "kooks/cookbook.json" };
export async function readOldCookbook() {
  if (!native) return null;
  const { Filesystem, Directory, Encoding } =
    await import("@capacitor/filesystem");
  try {
    const { data } = await Filesystem.readFile({
      ...oldCookbook,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}
// Once its recipes are in the kitchen, the file is kept under another name,
// so it is not offered again and nothing is lost.
export async function retireOldCookbook() {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  await Filesystem.rename({
    from: oldCookbook.path,
    to: "kooks/cookbook.imported.json",
    directory: Directory.Data,
  });
}
