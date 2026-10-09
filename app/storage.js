import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { createRepository } from "./repository.js";
import { parseBackup } from "./model.js";

const options = { directory: Directory.Data, encoding: Encoding.UTF8 };
const path = (name) => `kooks/${name}`;
const nativeAdapter = {
  async read(name) {
    try {
      return (await Filesystem.readFile({ ...options, path: path(name) })).data;
    } catch (error) {
      if (error.code === "OS-PLUG-FILE-0008") return null;
      throw error;
    }
  },
  async write(name, data) {
    await Filesystem.writeFile({
      ...options,
      path: path(name),
      data,
      recursive: true,
    });
  },
  async writeAtomic(name, data) {
    await this.write(`${name}.tmp`, data);
    await Filesystem.rename({
      directory: Directory.Data,
      from: path(`${name}.tmp`),
      to: path(name),
    });
  },
};

let database;
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("kooks-cookbook", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Close other Kooks tabs and try again."));
  });
  return database;
}
const browserAdapter = {
  async read(name) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents");
      const request = transaction.objectStore("documents").get(name);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  },
  async write(name, data) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      transaction.objectStore("documents").put(data, name);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error("Storage write was interrupted."),
        );
    });
  },
  async writeAtomic(name, data) {
    await this.write(name, data);
  },
};

export const createCookbookStorage = (onStatus) =>
  createRepository(
    Capacitor.isNativePlatform() ? nativeAdapter : browserAdapter,
    parseBackup,
    onStatus,
  );
