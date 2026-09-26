import { createApp } from "./app.js";
import { startBackupSchedule } from "./backup.js";

const app = createApp();
// Only the real server backs up; tests build the app without this.
startBackupSchedule();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Outreach engine server listening on http://0.0.0.0:${port}`);
});
