import { tiktokCallback, tiktokLoginRouter } from "./routes/tiktok.js";
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
import { prospectsRouter } from "./routes/prospects.js";
import { templatesRouter } from "./routes/templates.js";
import { profilesRouter } from "./routes/profiles.js";
import { metaRouter } from "./routes/meta.js";
import { isSignedOutVisitor, sessionRouter, siteAuth } from "./siteAuth.js";
import "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Behind Railway's proxy: lets req.secure / req.ip reflect the real client.
app.set("trust proxy", 1);
// Credentials so the session cookie also works when the dev client (:5173)
// talks to the API on another port; production is same-origin.
app.use(
  cors({
    origin: process.env.CLIENT_URL ?? "http://localhost:5173",
    credentials: true,
  }),
);
// Bumped from Express's 100kb default — bulk prospect imports (parsed
// client-side from an Excel sheet, sent here as JSON) can reasonably run
// into the thousands of rows.
app.use(express.json({ limit: "10mb" }));

// Mounted before the password gate: Meta's webhook POSTs come from their
// servers, not a browser, and never carry the site password.
app.use("/webhooks", webhooksRouter());

// Also mounted before the gate: the privacy policy must be publicly
// reachable for Meta's App Review process — a reviewer can't provide the
// site password. `/privacy.html` is kept as an alias since it was the
// original URL used during initial setup.
const privacyHtmlPath = path.resolve(
  __dirname,
  "..",
  "..",
  "client",
  "public",
  "privacy.html",
);
app.get(["/privacy", "/privacy.html"], (_req, res) => {
  res.sendFile(privacyHtmlPath);
});

// Public company/product page. Platform reviewers (Meta, TikTok) need to see
// what the business does without logging in, so `/about` is always public and
// `/` shows it to anyone who isn't signed in. Team members with a session
// fall through to the app; the sign-in form lives at `/login`.
const aboutHtmlPath = path.resolve(
  __dirname,
  "..",
  "..",
  "client",
  "public",
  "about.html",
);
app.get(["/about", "/about.html"], (_req, res) => {
  res.sendFile(aboutHtmlPath);
});
app.get("/", (req, res, next) => {
  if (isSignedOutVisitor(req)) return res.sendFile(aboutHtmlPath);
  next();
});

// Also before the gate: TikTok redirects here after authorization. Inert
// without a state token issued by the (gated) /auth/tiktok/login route.
app.get("/auth/tiktok/callback", tiktokCallback);

app.use("/api/session", sessionRouter());
app.use(siteAuth());

app.get("/api/health", (_req, res) => {
  const connectedInstagramAccounts = instagramAccountCount();
  res.json({
    ok: true,
    adapters: {
      instagram: {
        canSend: connectedInstagramAccounts > 0,
        connectedAccounts: connectedInstagramAccounts,
      },
      tiktok: { canSend: false },
      twitch: { canSend: false },
      youtube: { canSend: false },
    },
  });
});

app.use("/api/conversations", conversationsRouter());
app.use("/api/prospects", prospectsRouter());
app.use("/api/templates", templatesRouter());
app.use("/api/profiles", profilesRouter());
app.use("/api/meta", metaRouter());
app.use("/auth", authRouter());
app.use("/auth/tiktok", tiktokLoginRouter());

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

// Catches anything a route didn't handle itself (e.g. a DB constraint
// error) and returns clean JSON instead of Express's default HTML error
// page, which includes the full server stack trace — a real information
// disclosure risk in production. Must be registered last, and needs all
// four params for Express to recognize it as an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Outreach engine server listening on http://0.0.0.0:${port}`);
});
