import { chromium, type Page } from "playwright";

// Same window as the scraper: `npm run chrome` here or in war/scraper.
export async function openBrowser(): Promise<{ page: Page; close: () => Promise<void> }> {
  console.log("REMINDER: this browser must NOT be logged into any Smooth social account. Use a throwaway (see war/IMPORTANT.md).");
  const cdp = process.env.CHROME_CDP ?? "http://127.0.0.1:9222";
  try {
    const browser = await chromium.connectOverCDP(cdp);
    const page = await browser.contexts()[0].newPage();
    console.log(`Attached to your Chrome at ${cdp}`);
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
