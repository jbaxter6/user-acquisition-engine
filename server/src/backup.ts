import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dataDir, db } from "./db.js";

// Nightly copies of the database, kept on the same volume. They protect
// against a bad migration, a buggy bulk delete or a corrupted file; they do
// NOT protect against losing the volume itself. For that, pull a copy off
// the server with GET /api/backup (or enable the host's volume backups).
export const BACKUP_DIR = path.join(dataDir, "backups");
const KEEP = 7;
const CHECK_EVERY_MS = 60 * 60 * 1000;

const today = () => new Date().toISOString().slice(0, 10);

/** Writes a consistent snapshot of the live database to `file`. Safe while the app is running. */
export async function snapshotDatabase(file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await db.backup(file);
  // The copy inherits the live database's WAL mode, which spawns -wal/-shm
  // side files whenever it's opened. Switch it to a single self-contained
  // file so it can be moved, downloaded or restored on its own.
  const copy = new Database(file);
  copy.pragma("journal_mode = DELETE");
  copy.close();
}

/** Today's snapshot, if there isn't one yet; then deletes all but the newest KEEP. */
export async function runNightlyBackup(): Promise<string | null> {
  const file = path.join(BACKUP_DIR, `inbox-${today()}.db`);
  let written: string | null = null;
  if (!fs.existsSync(file)) {
    await snapshotDatabase(file);
    written = file;
  }
  const old = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^inbox-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(path.join(BACKUP_DIR, f + suffix), { force: true });
  }
  return written;
}

/** Backs up on startup if today's copy is missing, then checks hourly. */
export function startBackupSchedule(): void {
  const run = () =>
    runNightlyBackup()
      .then((file) => file && console.log(`Database backed up to ${file}`))
      .catch((err) => console.error("Database backup failed:", err));
  void run();
  setInterval(run, CHECK_EVERY_MS).unref();
}
