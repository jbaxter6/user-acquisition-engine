import { chromium, type Page } from "playwright";

// Preferred: attach to a Chrome you launched yourself (`npm run chrome`) and
// logged into the social sites. Fallback: a Playwright-managed Chrome profile.
export async function openBrowser(): Promise<{ page: Page; close: () => Promise<void> }> {
  const cdp = process.env.CHROME_CDP ?? "http://localhost:9222";
  try {
    const browser = await chromium.connectOverCDP(cdp);
    const page = await browser.contexts()[0].newPage();
    console.log(`Attached to your Chrome at ${cdp}`);
    return { page, close: () => page.close() };
  } catch {
    console.log("No Chrome found on port 9222 (run `npm run chrome` first to reuse a logged-in session). Launching a separate browser...");
    const context = await chromium.launchPersistentContext(".browser-profile", {
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 900 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return { page, close: () => context.close() };
  }
}
