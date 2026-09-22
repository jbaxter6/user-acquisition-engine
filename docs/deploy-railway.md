# Deploying to Railway

One Railway service runs both the API and the built React app (see
`server/src/index.ts` — it serves `client/dist` as static files and falls
back to `index.html` for any non-`/api`/`/webhooks`/`/auth` route). This
avoids a second host, CORS, and a second URL to keep in sync with Meta.

## Steps

1. Push this repo to GitHub if it isn't already (Railway deploys from a repo).
2. In Railway: **New Project → Deploy from GitHub repo** → select this repo.
   Railway auto-detects `railway.json` at the repo root, which sets the
   build command (`npm run build`, builds both `client` and `server`) and
   start command (`npm run start`, runs the built server).
3. **Add a persistent volume** (Settings → Volumes → New Volume) mounted at
   `/data`. Without this, the SQLite database resets on every deploy.
4. **Set environment variables** (Settings → Variables):
   ```
   DATA_DIR=/data
   INSTAGRAM_APP_ID=<from Meta's Instagram product page>
   INSTAGRAM_APP_SECRET=<from Meta's Instagram product page>
   INSTAGRAM_VERIFY_TOKEN=<pick any string, must match Meta's webhook config>
   OAUTH_REDIRECT_URI=https://www.movewithsmooth.com/auth/instagram/callback
   CLIENT_URL=https://www.movewithsmooth.com
   SITE_PASSWORD=<pick a password to gate the whole site>
   ```
   Do **not** set `PORT` — Railway injects it automatically.

   `SITE_PASSWORD` gates the page and every API/auth route behind a single
   shared password via HTTP Basic Auth (browser handles it with a native
   prompt — no login page needed, and it stays authenticated for the
   whole session since browsers cache Basic Auth credentials per-origin).
   `/webhooks/*` is deliberately excluded, since Meta's servers can't
   provide it — see `server/src/siteAuth.ts`.
5. **Add the custom domain**: Settings → Networking → Custom Domain → enter
   `www.movewithsmooth.com` (not the bare domain — GoDaddy, like most
   registrars, can't point a CNAME at an apex/root domain, only at a
   subdomain). Railway gives you two DNS records to add at the registrar:
   - `CNAME  www  <railway-target>.up.railway.app`
   - `TXT  _railway-verify.www  railway-verify=<...>` (domain-ownership
     verification — cert issuance and routing silently stall until this
     one is added too, not just the CNAME)

   For the bare `movewithsmooth.com` to also work, set up **Domain
   Forwarding** at the registrar (a separate feature from DNS records) to
   301-redirect `movewithsmooth.com` → `https://www.movewithsmooth.com`,
   "Forward Only" (not masked — masking breaks OAuth redirects).

   DNS/TXT propagation is usually done within minutes but can take longer;
   Railway's domain status in the dialog shows pending vs. verified.
6. Once the domain resolves, update Meta's dashboard to match:
   - Instagram product → "API setup with Instagram login" → OAuth redirect
     URI → add `https://www.movewithsmooth.com/auth/instagram/callback`
   - Instagram product → Configure webhooks → Callback URL →
     `https://www.movewithsmooth.com/webhooks/instagram`, same verify token
     as `INSTAGRAM_VERIFY_TOKEN` above → Verify and save.
   - You can remove the old ngrok URLs from both fields once the new ones
     are verified — no more ngrok needed for this going forward.
7. Existing local-only accounts connected via ngrok (in `server/data/inbox.db`)
   won't carry over to the new deploy's volume — reconnect Instagram
   account(s) once live.

**Status: done as of 2026-09-22** — `www.movewithsmooth.com` is live and
serving both the app and `/api/health` correctly; bare-domain forwarding
confirmed working too.

## Local dev is unaffected

`server/.env` (used only for local `npm run dev`) keeps pointing at
`localhost`/ngrok as before — the env vars above are set in Railway's
dashboard only, not in this repo.
