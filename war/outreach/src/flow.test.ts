import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { findEmails, noteYouTube, sendInstagram, sendTikTok } from "./compose.js";
import { chooseTemplate, findCard, openOutreachTab, readCards } from "./crm.js";
import { SkipPerson, StopRun } from "./guard.js";
import { pickBatch } from "./pick.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function serve(): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = path.join(fixtures, name === "/" ? "crm.html" : path.basename(name));
    try {
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end("missing");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

describe("findEmails", () => {
  it("pulls addresses out of an About page", () => {
    expect(findEmails("Business inquiries: Biz@Example.com and biz@example.com")).toEqual([
      "biz@example.com",
    ]);
  });
});

describe("the prospect page and the send tabs", () => {
  let browser: Browser;
  let page: Page;
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    const served = await serve();
    base = served.url;
    close = served.close;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
    close?.();
  });

  it("reads the first page, skips anyone already in a thread, and sends the template", async () => {
    await page.goto(`${base}/crm.html`);
    const cards = await readCards(page);
    expect(cards).toEqual([
      { username: "alpha", openLabel: "Copy & open in Instagram" },
      { username: "beta", openLabel: null },
    ]);
    const [first] = pickBatch(cards, new Set(), "instagram", 10);
    const card = await findCard(page, first.username);
    const text = await chooseTemplate(card, "Intro");
    expect(text).toBe("hey alpha");

    const tab = await openOutreachTab(page, card);
    await expect(sendInstagram(tab, text)).resolves.toBe("sent");
    expect(await tab.locator("body").getAttribute("data-sent")).toBe("hey alpha");
    await tab.close();
  });

  it("stops when the opened tab is a rate-limit page", async () => {
    await page.goto(`${base}/blocked.html`);
    await expect(sendInstagram(page, "hey")).rejects.toBeInstanceOf(StopRun);
  });

  it("skips a TikTok profile with no Message button, and sends when there is one", async () => {
    await page.goto(`${base}/tiktok-none.html`);
    await expect(sendTikTok(page, "hey")).rejects.toBeInstanceOf(SkipPerson);
    await page.goto(`${base}/tiktok.html`);
    await expect(sendTikTok(page, "hey")).resolves.toBe("sent");
    expect(await page.locator("body").getAttribute("data-sent")).toBe("hey");
  });

  it("reads a YouTube business email after View email address", async () => {
    await page.goto(`${base}/youtube.html`);
    await expect(noteYouTube(page)).resolves.toEqual(["biz@example.com"]);
  });
});
