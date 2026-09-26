import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { BACKUP_DIR, runNightlyBackup } from "./backup.js";
import { upsertAccount } from "./db.js";
import { useTestServer } from "./test/harness.js";

const { api } = useTestServer({ SITE_PASSWORD: "hunter2" });

describe("nightly backup", () => {
  it("writes today's snapshot once, with the data in it", async () => {
    upsertAccount({ igUserId: "ig-1", username: "smooth_test", accessToken: "t" });
    const file = await runNightlyBackup();
    expect(file).toMatch(/inbox-\d{4}-\d{2}-\d{2}\.db$/);

    const copy = new Database(file!, { readonly: true });
    expect(copy.prepare("SELECT username FROM accounts").all()).toEqual([{ username: "smooth_test" }]);
    copy.close();

    // Already backed up today: nothing new written.
    expect(await runNightlyBackup()).toBeNull();
  });

  it("keeps only the newest 7", async () => {
    for (let day = 1; day <= 9; day++) {
      fs.writeFileSync(path.join(BACKUP_DIR, `inbox-2020-01-0${day}.db`), "");
    }
    await runNightlyBackup();
    const kept = fs.readdirSync(BACKUP_DIR).sort();
    expect(kept).toHaveLength(7);
    expect(kept).not.toContain("inbox-2020-01-01.db");
  });
});

describe("GET /api/backup", () => {
  it("needs a session: the file holds every DM", async () => {
    expect((await api("/api/backup")).status).toBe(401);
  });

  it("downloads a working copy of the database", async () => {
    await api("/api/session/login", { method: "POST", json: { password: "hunter2" } });
    const res = await api("/api/backup");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="inbox-.+\.db"/);

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dl-")), "copy.db");
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("SELECT username FROM accounts").all()).toEqual([{ username: "smooth_test" }]);
    copy.close();
  });
});
