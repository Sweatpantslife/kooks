import { parentPort, workerData } from "node:worker_threads";
import { BackupError, takeCopy } from "./backups.js";

// One automatic backup, off the server's main thread: SQLite's calls hold
// the thread they run on, and a large cookbook takes a few seconds to copy.
try {
  parentPort.postMessage({ ok: true, copy: await takeCopy(workerData) });
} catch (error) {
  if (!(error instanceof BackupError)) console.error(error);
  parentPort.postMessage({ ok: false, error: error.message });
}
