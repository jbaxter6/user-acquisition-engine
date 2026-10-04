import type { BrowserContext, Locator, Page } from "playwright";
import type { Config } from "./config.js";
import { StopRun } from "./guard.js";
import type { ProspectCard } from "./pick.js";

function prospectsResponse(platform: string) {
  return (res: { url: () => string; ok: () => boolean; request: () => { method: () => string } }) => {
    const url = res.url();
    return (
      res.request().method() === "GET" &&
      res.ok() &&
      url.includes("/api/prospects?") &&
      url.includes("status=new") &&
      url.includes(`platform=${platform}`)
    );
  };
}

export async function signIn(page: Page, config: Config): Promise<void> {
  await page.goto(config.crmUrl, { waitUntil: "domcontentloaded" });
  const password = page.getByLabel("Password");
  const loginVisible = await password.isVisible().catch(() => false);
  if (!loginVisible) return;
  if (!config.crmPassword) {
    throw new StopRun("The CRM is asking for a password. Set CRM_PASSWORD in .env.");
  }
  await password.fill(config.crmPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  const error = page.locator(".login__error");
  const nav = page.getByRole("link", { name: "Prospecting" });
  await nav.or(error).waitFor({ timeout: 20_000 });
  if (await error.isVisible()) {
    throw new StopRun(`CRM login failed: ${(await error.innerText()).trim()}`);
  }
}

export async function openProspecting(page: Page, config: Config): Promise<void> {
  await page.goto(`${config.crmUrl}/prospecting`, { waitUntil: "domcontentloaded" });
  const notContacted = page.getByRole("button", { name: /Not Contacted/ });
  await notContacted.waitFor({ timeout: 20_000 });
  const platformSelect = page.locator("select").filter({ hasText: "All platforms" });
  const statusIsNew = (await notContacted.getAttribute("class"))?.includes("filter-pill--active") ?? false;
  const platformMatches = (await platformSelect.inputValue()) === config.platform;
  const search = page.getByPlaceholder("Search handle, name, brand");
  const searchDirty = (await search.inputValue().catch(() => "")) !== "";

  if (!statusIsNew || !platformMatches || searchDirty) {
    const listed = page.waitForResponse(prospectsResponse(config.platform), { timeout: 20_000 });
    if (searchDirty) await search.fill("");
    if (!statusIsNew) await notContacted.click();
    if (!platformMatches) await platformSelect.selectOption(config.platform);
    await listed;
  } else {
    // Already on Not Contacted for this platform. Click anyway so a stale
    // pill state can't be skipped, then keep the list that's on screen.
    await notContacted.click();
  }
  await page.locator(".prospect-card, .empty-state").first().waitFor({ timeout: 20_000 });
}

export async function readCards(page: Page): Promise<ProspectCard[]> {
  const cards = page.locator(".prospect-card");
  const count = await cards.count();
  const out: ProspectCard[] = [];
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const handle = card.locator(".prospect-card__handle");
    if ((await handle.count()) === 0) continue;
    const username = (await handle.first().innerText()).trim().replace(/^@/, "");
    const open = card.getByRole("button", { name: /Copy & open in/ });
    const openLabel = (await open.count()) > 0 ? (await open.first().innerText()).trim() : null;
    out.push({ username, openLabel });
  }
  return out;
}

export async function findCard(page: Page, username: string): Promise<Locator> {
  const want = username.trim().replace(/^@/, "").toLowerCase();
  const cards = page.locator(".prospect-card");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const text = (await card.locator(".prospect-card__handle").innerText().catch(() => ""))
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (text === want) return card;
  }
  throw new StopRun(`@${username} is no longer on the first page. Stopping the batch.`);
}

export async function chooseTemplate(card: Locator, templateName: string): Promise<string> {
  const select = card.locator("select");
  if ((await select.count()) === 0) {
    throw new StopRun(`@${await handleOf(card)} has no template picker. Stopping so the batch doesn't drift.`);
  }
  const labels = await select.locator("option").allInnerTexts();
  if (!labels.some((label) => label.trim() === templateName)) {
    throw new StopRun(
      `Template "${templateName}" isn't on this card. The list has: ${labels.filter((l) => l.trim() && !l.startsWith("Select")).join(", ") || "(none)"}.`,
    );
  }
  await select.selectOption({ label: templateName });
  const text = (await card.locator("textarea").inputValue()).trim();
  if (!text) throw new StopRun(`Template "${templateName}" did not fill the message.`);
  return text;
}

async function handleOf(card: Locator): Promise<string> {
  return (await card.locator(".prospect-card__handle").innerText()).trim();
}

// Returns the tab Copy & open just opened.
export async function openOutreachTab(page: Page, card: Locator): Promise<Page> {
  const context = page.context();
  const opened = context.waitForEvent("page", { timeout: 15_000 });
  await card.getByRole("button", { name: /Copy & open in/ }).click();
  try {
    const popup = await opened;
    await popup.waitForLoadState("domcontentloaded");
    return popup;
  } catch {
    throw new StopRun("Copy & open did not open a tab. Stopping the batch.");
  }
}

export async function loggedInHandle(context: BrowserContext, platform: "instagram" | "tiktok"): Promise<string> {
  const page = await context.newPage();
  try {
    if (platform === "instagram") return await instagramHandle(page);
    return await tiktokHandle(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function instagramHandle(page: Page): Promise<string> {
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  if (/accounts\/login|\/challenge|checkpoint/.test(page.url())) {
    throw new StopRun("Not logged into Instagram in this Chrome window. Log into the throwaway and run again.");
  }
  const fromNav = await page
    .locator('a:has(svg[aria-label="Profile"])')
    .first()
    .getAttribute("href")
    .catch(() => null);
  const navHandle = fromNav?.split("/").filter(Boolean)[0]?.trim() ?? "";
  if (navHandle && !["explore", "reels", "direct", "accounts"].includes(navHandle)) return navHandle;

  await page.goto("https://www.instagram.com/accounts/edit/", { waitUntil: "domcontentloaded" });
  if (/accounts\/login|\/challenge|checkpoint/.test(page.url())) {
    throw new StopRun("Not logged into Instagram in this Chrome window. Log into the throwaway and run again.");
  }
  const input = page.locator('input[name="username"], input#pepUsername').first();
  const visible = await input.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);
  const handle = visible ? (await input.inputValue()).trim() : "";
  if (!handle) {
    throw new StopRun("Couldn't tell which Instagram account is logged in. Not sending.");
  }
  return handle;
}

async function tiktokHandle(page: Page): Promise<string> {
  await page.goto("https://www.tiktok.com/", { waitUntil: "domcontentloaded" });
  if (/\/login|captcha/.test(page.url())) {
    throw new StopRun("Not logged into TikTok in this Chrome window. Log into the throwaway and run again.");
  }
  const href = await page
    .locator('[data-e2e="nav-profile"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  const handle = href?.match(/@([^/?#]+)/)?.[1]?.trim() ?? "";
  if (!handle) {
    throw new StopRun("Couldn't tell which TikTok account is logged in. Not sending.");
  }
  return handle;
}
