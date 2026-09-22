import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { instagramAccountCount } from "./adapters/index.js";
import { conversationsRouter } from "./routes/conversations.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { authRouter } from "./routes/auth.js";
import "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  const connectedInstagramAccounts = instagramAccountCount();
  res.json({
    ok: true,
    adapters: {
      instagram: { canSend: connectedInstagramAccounts > 0, connectedAccounts: connectedInstagramAccounts },
      tiktok: { canSend: false },
      twitch: { canSend: false },
    },
  });
});

app.use("/api/conversations", conversationsRouter());
app.use("/webhooks", webhooksRouter());
app.use("/auth", authRouter());

// In production, serve the built React app from the same origin/process —
// avoids a separate static host, CORS, and a second URL to keep in sync
// with Meta's redirect/webhook config. Expects `client/dist` to exist,
// built by the root "build" script before this runs.
const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/(api|webhooks|auth)\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`Outreach engine server listening on http://localhost:${port}`);
});
