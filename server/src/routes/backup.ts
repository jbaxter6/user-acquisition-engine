import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import { snapshotDatabase } from "../backup.js";

// GET /api/backup downloads a fresh copy of the whole database, so it can
// be kept somewhere other than the server's volume. Behind the site
// password like every /api route; the file holds every DM and prospect.
export function backupRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outreach-backup-"));
    const file = path.join(dir, `inbox-${stamp}.db`);
    try {
      await snapshotDatabase(file);
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      return next(err);
    }
    res.set("Cache-Control", "no-store");
    res.download(file, path.basename(file), () => fs.rmSync(dir, { recursive: true, force: true }));
  });

  return router;
}
