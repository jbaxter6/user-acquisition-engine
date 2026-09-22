import "dotenv/config";
import express from "express";
import cors from "cors";
import { instagramAccountCount } from "./adapters/index.js";
import { conversationsRouter } from "./routes/conversations.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { authRouter } from "./routes/auth.js";
import "./db.js";

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

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`Outreach engine server listening on http://localhost:${port}`);
});
