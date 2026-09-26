# IMPORTANT: Never run WAR while logged into a Smooth account

Please make sure you are logged out of all Smooth social accounts when using "WAR". Use a throwaway account instead.

## Why

- **The scraper browses as whoever is logged in.** `npm run chrome` opens a real Chrome window, and the scraper attaches to it. Instagram won't search until someone is logged in. Every page and scroll counts as activity by that account.
- **That account takes the hit.** Instagram and TikTok watch for automated browsing. The results are captchas, "try again later", rate limits and lockouts. If a Smooth account gets locked, shadow-limited or banned, we lose the account we use for outreach.
- **Logins stick.** The scraper's browser profiles keep their cookies between runs:
  - `~/.outreach-chrome` (the `npm run chrome` window)
  - `war/scraper/.browser-profile` (the fallback browser)

  If you log into Smooth there once, every run after that uses Smooth until someone logs out.
- **It keeps scraping separate from the brand.** Outreach should come from an account that has never been tied to automated browsing.

## Before every run

1. Run `npm run chrome`, then open instagram.com and tiktok.com in that window.
2. Check which account is logged in. It must be the throwaway, **never Smooth**.
3. If it's a Smooth account, log out and log in with the throwaway.
4. Now start the scrape.

## Good to know

- **Your normal Chrome is fine.** The scraper uses its own separate profile, so being logged into Smooth in your everyday browser doesn't affect it.
- **The `fuckem` strategies don't log in.** They start a fresh headless browser each time. This rule is about `scraper/`.
- **Logging out isn't total protection.** Platforms can still link accounts by device and network. Keep the pace slow, and stop when you get blocked (see `fuckem/AGENTS.md`, "Well-Behaved Automation").
