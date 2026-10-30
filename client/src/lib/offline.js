import { kitchen, phone } from "./device.js";

// A phone can be out of the kitchen's reach: in a shop's basement, on a
// train. It keeps a copy of the kitchen as it last saw it, in its own
// storage, and shows that copy until the kitchen answers again. A browser
// keeps none: its page comes from the kitchen, so without the kitchen there
// is no page to show a copy on.
//
// The copy lives in IndexedDB, one per kitchen address, and goes at sign-out.

const NAME = "kooks";
const COPIES = "copies";

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(COPIES);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(COPIES, mode);
      const request = work(tx.objectStore(COPIES));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// The kitchen as this phone last saw it, or null.
export async function readCopy() {
  if (!phone || !kitchen.value) return null;
  try {
    return (await run("readonly", (s) => s.get(kitchen.value))) ?? null;
  } catch {
    return null;
  }
}

// Written a moment after the kitchen last changed, so a burst of changes
// is written once. A phone that cannot keep it simply has no copy.
let timer = null;
let latest = null;
export function keepCopy(copy) {
  if (!phone || !kitchen.value) return;
  latest = { ...copy, kitchen: kitchen.value, saved_at: Date.now() };
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { kitchen: address, ...value } = latest;
    run("readwrite", (s) => s.put(value, address)).catch(() => {});
  }, 1000);
}

export async function dropCopies() {
  clearTimeout(timer);
  if (!phone) return;
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    // Nothing kept, or nothing that can be removed.
  }
}
