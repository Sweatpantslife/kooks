import { kitchen, phone } from "./device.js";

// The photos a phone has opened, kept so they show without the kitchen too:
// a recipe's photo of the original, an idea's or a technique's, a book's
// cover. A photo in the kitchen never changes (a new one gets a new id), so
// one kept is shown as it is, without asking the kitchen again. Books and
// other files are not kept: they are large, and opened rarely.
//
// They live in IndexedDB, under the kitchen and household they came from,
// up to CAP in all; the photos opened longest ago go first. They go at
// sign-out and when the phone moves to another household, with the copy of
// the kitchen.

export const CAP = 50 * 1024 * 1024;
const NAME = "kooks-photos";
// The bytes, and apart from them how big each is and when it was last
// opened, so making room never reads the photos themselves.
const PHOTOS = "photos";
const USED = "used";

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PHOTOS);
      request.result.createObjectStore(USED);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// `work` gets both stores and calls `done(value)` with the result; the
// promise settles once the transaction has.
async function run(mode, work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([PHOTOS, USED], mode);
      let result = null;
      work(
        { photos: tx.objectStore(PHOTOS), used: tx.objectStore(USED) },
        (value) => (result = value),
      );
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const key = (household, id) => `${kitchen.value}\n${household}\n${id}`;

// Which kept photos to let go, oldest opened first, so that what stays fits
// under `cap`. `kept` is [{ key, size, used }].
export function overCap(kept, cap = CAP) {
  let total = kept.reduce((sum, photo) => sum + photo.size, 0);
  const go = [];
  for (const photo of [...kept].sort((a, b) => a.used - b.used)) {
    if (total <= cap) break;
    go.push(photo.key);
    total -= photo.size;
  }
  return go;
}

// The photo as a Blob if this phone has kept it, or null. Opening it counts
// as using it.
export async function keptPhoto(household, id) {
  if (!phone || !kitchen.value || !household) return null;
  const at = key(household, id);
  try {
    const kept = await run("readwrite", ({ photos, used }, done) => {
      const request = photos.get(at);
      request.onsuccess = () => {
        const photo = request.result;
        if (!photo) return;
        done(photo);
        used.put({ size: photo.data.byteLength, used: Date.now() }, at);
      };
    });
    return kept ? new Blob([kept.data], { type: kept.type }) : null;
  } catch {
    return null;
  }
}

// Keep a photo the phone has opened, letting the oldest go past the cap.
// A phone that cannot keep it simply asks the kitchen next time.
export async function keepPhoto(household, id, blob) {
  if (!phone || !kitchen.value || !household || blob.size > CAP) return;
  const at = key(household, id);
  try {
    // Bytes rather than the Blob itself, which some WebViews cannot store.
    const data = await blob.arrayBuffer();
    await run("readwrite", ({ photos, used }) => {
      photos.put({ data, type: blob.type }, at);
      used.put({ size: data.byteLength, used: Date.now() }, at);
      const kept = [];
      const cursor = used.openCursor();
      cursor.onsuccess = () => {
        const next = cursor.result;
        if (next) {
          kept.push({ key: next.key, ...next.value });
          return next.continue();
        }
        for (const old of overCap(kept)) {
          photos.delete(old);
          used.delete(old);
        }
      };
    });
  } catch {
    // Not kept: the kitchen is asked next time.
  }
}

export async function dropPhotos() {
  if (!phone) return;
  try {
    await run("readwrite", ({ photos, used }) => {
      photos.clear();
      used.clear();
    });
  } catch {
    // Nothing kept, or nothing that can be removed.
  }
}
