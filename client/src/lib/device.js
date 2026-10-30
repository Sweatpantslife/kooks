import { signal } from "@preact/signals";
import { Capacitor } from "@capacitor/core";

// In the phone app this app comes from the phone, and the kitchen is
// wherever the household runs Kooks: the app keeps the kitchen's address and
// the device token it signed in with, and sends that token with every
// request. In a browser the page comes from the kitchen itself, which knows
// the browser by its cookie.
//
// `kooks.phone` set to "1" in a browser's storage shows the phone's sign-in
// there too, to try its screens without a phone.
export const native = Capacitor.isNativePlatform();
const remembered = (key) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const remember = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // A phone that cannot keep it asks again next time.
  }
};
export const phone = native || remembered("kooks.phone") === "1";

export const kitchen = signal(phone ? remembered("kooks.kitchen") : "");
let token = phone ? remembered("kooks.device") : "";

// Where requests go: the kitchen's address on a phone, this page's own
// server in a browser.
export const base = () => (phone ? kitchen.value : "");
export const deviceToken = () => token;

export function setKitchen(address) {
  kitchen.value = address;
  remember("kooks.kitchen", address);
}
export function keepToken(value) {
  token = value;
  remember("kooks.device", value);
}

// What someone types as the kitchen's address, as an origin: the scheme is
// https unless they wrote one, and any path is dropped. A phone reaches the
// kitchen only over https; a browser trying the phone's screens may use
// plain http, as a kitchen on this computer does.
export function kitchenAddress(text, { plain = !native } = {}) {
  const typed = String(text ?? "").trim();
  if (!typed) return null;
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`,
    );
    return url.protocol === "https:" || (plain && url.protocol === "http:")
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
