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
   OAUTH_REDIRECT_URI=https://movewithsmooth.com/auth/instagram/callback
   CLIENT_URL=https://movewithsmooth.com
   ```
   Do **not** set `PORT` — Railway injects it automatically.
5. **Add the custom domain**: Settings → Networking → Custom Domain → enter
   `movewithsmooth.com`. Railway gives you a CNAME (or A/ANAME depending on
   whether it's the apex domain) to add at your domain registrar's DNS
   settings. DNS propagation can take anywhere from a few minutes to a few
   hours.
6. Once the domain resolves, update Meta's dashboard to match:
   - Instagram product → "API setup with Instagram login" → OAuth redirect
     URI → add `https://movewithsmooth.com/auth/instagram/callback`
   - Instagram product → Configure webhooks → Callback URL →
     `https://movewithsmooth.com/webhooks/instagram`, same verify token as
     `INSTAGRAM_VERIFY_TOKEN` above → Verify and save.
   - You can remove the old ngrok URLs from both fields once the new ones
     are verified — no more ngrok needed for this going forward.
7. Existing local-only accounts connected via ngrok (in `server/data/inbox.db`)
   won't carry over to the new deploy's volume — reconnect Instagram
   account(s) once live.

## Local dev is unaffected

`server/.env` (used only for local `npm run dev`) keeps pointing at
`localhost`/ngrok as before — the env vars above are set in Railway's
dashboard only, not in this repo.
