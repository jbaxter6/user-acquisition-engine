import { chromium, type Page } from "playwright";

// Preferred: attach to a Chrome you launched yourself (`npm run chrome`) and
// logged into the social sites. Fallback: a Playwright-managed Chrome profile.
export async function openBrowser(): Promise<{ page: Page; close: () => Promise<void> }> {
  console.log("REMINDER: this browser must NOT be logged into any Smooth social account. Use a throwaway (see war/IMPORTANT.md).");
  // 127.0.0.1, not "localhost": Node resolves localhost to IPv6 (::1) first,
  // but Chrome's debugging port only listens on IPv4, so "localhost" was
  // refused and every run silently fell back to the separate browser below.
  const cdp = process.env.CHROME_CDP ?? "http://127.0.0.1:9222";
  try {
    const browser = await chromium.connectOverCDP(cdp);
    const page = await browser.contexts()[0].newPage();
    console.log(`Attached to your Chrome at ${cdp}`);
    // Close our tab, then disconnect. browser.close() on a CDP connection
    // only detaches, so your Chrome stays open, but without it the open
    // connection keeps Node running after the scrape finishes.
    return {
      page,
      close: async () => {
        await page.close().catch(() => {});
        await browser.close();
      },
    };
  } catch {
    console.log(`No Chrome found at ${cdp} (run \`npm run chrome\` first to reuse a logged-in session). Launching a separate browser...`);
    const context = await chromium.launchPersistentContext(".browser-profile", {
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 900 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return { page, close: () => context.close() };
  }
}
