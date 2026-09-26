// Runs before every test file (vitest.config.ts). Each file runs in its own
// process, so each gets a fresh, empty database.
//
// Everything app.ts could pick up from server/.env via dotenv is pinned
// here first: dotenv never overrides a variable that's already set, so tests
// never see the real site password, Meta secrets or database.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "outreach-test-"));
process.env.SITE_PASSWORD = "";
process.env.INSTAGRAM_APP_ID = "test-app-id";
process.env.INSTAGRAM_APP_SECRET = "test-app-secret";
process.env.INSTAGRAM_VERIFY_TOKEN = "test-verify-token";
process.env.OAUTH_REDIRECT_URI = "http://localhost/auth/instagram/callback";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.PORT = "0";
