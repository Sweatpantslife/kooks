import { useEffect, useState } from "preact/hooks";
import { change, record, records, refresh } from "./store.js";
import { toast } from "./toast.js";

// Sessions still on the stove, the one touched last first.
export const activeSessions = () =>
  records("session")
    .filter((s) => s.data.status === "active")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

// Cooking a recipe, meal or planned day that is already on the stove picks
// it up where it was; anything else starts fresh. Returns the session id.
export async function startCooking(source) {
  const going = activeSessions().find(
    (s) =>
      s.data.reference?.kind === source.kind &&
      s.data.reference?.id === source.id,
  );
  if (going) return going.id;
  const { record: made } = await change("cooking_start", { source });
  return made.id;
}

// Where cooking was started from, to go back to when the stove is left.
export function originOf(session) {
  const { kind, id } = session.data.reference ?? {};
  if (kind === "recipe" && record("recipe", id))
    return `recipes/${encodeURIComponent(id)}`;
  if (kind === "meal" && record("meal", id))
    return `recipes/meal/${encodeURIComponent(id)}`;
  return "week";
}

// Breakfast before eleven, lunch before four, then dinner.
export function slotNow() {
  const hour = new Date().getHours();
  return hour < 11 ? "Breakfast" : hour < 16 ? "Lunch" : "Dinner";
}

// One change to a session at a time, each against the version the last left;
// another cook's change in between costs one retry.
let queue = Promise.resolve();
export function onSession(id, work) {
  const run = async () => {
    try {
      return await work(record("session", id));
    } catch (error) {
      if (error.code !== "STALE_VERSION") throw error;
      await refresh({ fresh: true });
      return work(record("session", id));
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

export const edit = (session) => ({
  id: session.id,
  expected_version: session.version,
});

// The timers still counting or rung but not yet dismissed.
export const liveTimers = (session) =>
  (session?.data.timers ?? []).filter((t) => !t.cancelled);

export const secondsLeft = (timer, now = Date.now()) =>
  Math.max(0, Math.ceil((Date.parse(timer.deadline) - now) / 1000));

// 9:05, or 1:02:00 past an hour.
export function clock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const minutesLabel = (seconds) => {
  const m = Math.round(seconds / 60);
  return m >= 60 && m % 60 === 0
    ? `${m / 60} hr`
    : m >= 60
      ? `${Math.floor(m / 60)} hr ${m % 60} min`
      : `${Math.max(1, m)} min`;
};

// The time now, every second while a component that shows a countdown is on
// the page.
export function useNow(running = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

// A short chime. Browsers only play sound after the person has pressed
// something, so the sound is readied when a timer is started.
let audio = null;
export function readySound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}
function chime() {
  if (!audio) return;
  try {
    for (const [at, pitch] of [
      [0, 880],
      [0.25, 660],
      [0.5, 880],
    ]) {
      const tone = audio.createOscillator();
      const level = audio.createGain();
      tone.frequency.value = pitch;
      level.gain.setValueAtTime(0.0001, audio.currentTime + at);
      level.gain.exponentialRampToValueAtTime(
        0.3,
        audio.currentTime + at + 0.02,
      );
      level.gain.exponentialRampToValueAtTime(
        0.0001,
        audio.currentTime + at + 0.22,
      );
      tone.connect(level).connect(audio.destination);
      tone.start(audio.currentTime + at);
      tone.stop(audio.currentTime + at + 0.25);
    }
  } catch {
    // A missing sound never stops the cooking.
  }
}

// Watch every timer on the stove from any page: when one runs out, say so,
// chime and buzz. Timers that ran out before this tab opened stay quiet.
const rung = new Set();
let watching = false;
export function watchTimers() {
  if (watching) return;
  watching = true;
  let first = true;
  setInterval(() => {
    const now = Date.now();
    for (const session of activeSessions())
      for (const timer of liveTimers(session)) {
        if (rung.has(timer.id) || secondsLeft(timer, now) > 0) continue;
        rung.add(timer.id);
        if (first) continue;
        toast(`Time’s up: ${timer.label}.`);
        chime();
        navigator.vibrate?.([300, 150, 300]);
      }
    first = false;
  }, 1000);
}
