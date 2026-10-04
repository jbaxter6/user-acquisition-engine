import type { Locator, Page } from "playwright";
import { StopRun, SkipPerson, blockReason } from "./guard.js";

export function findEmails(text: string): string[] {
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((email) => email.toLowerCase()))];
}

async function assertClear(page: Page): Promise<void> {
  const headings = await page
    .locator("h1, h2, [role='alert']")
    .allInnerTexts()
    .catch(() => [] as string[]);
  const reason = blockReason(page.url(), headings.join("\n"));
  if (reason) throw new StopRun(`${reason} Left the rest of the batch unsent.`);
}

async function confirmDelivered(box: Locator): Promise<boolean> {
  const handle = await box.elementHandle();
  if (!handle) return false;
  try {
    // The typed text is already on the page, so a body-text check would pass
    // before Send. An empty composer is the signal the send went through.
    await box.page().waitForFunction(
      (el) => {
        const node = el as HTMLElement;
        return !(node.innerText || node.textContent || "").trim();
      },
      handle,
      { timeout: 15_000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function typeAndSend(page: Page, box: Locator, text: string): Promise<"sent" | "unconfirmed"> {
  await box.click();
  await page.keyboard.insertText(text);
  const send = page
    .getByRole("button", { name: /^send$/i })
    .or(page.locator('[aria-label="Send" i]'))
    .first();
  const ready = await send.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!ready) throw new StopRun("The message was typed, but there is no Send button. Stopping the batch.");
  await send.click();
  const confirmed = await confirmDelivered(box);
  return confirmed ? "sent" : "unconfirmed";
}

export async function sendInstagram(page: Page, text: string): Promise<"sent" | "unconfirmed"> {
  await assertClear(page);
  const box = page
    .locator(
      '[contenteditable="true"][role="textbox"], [aria-label="Message" i], textarea[placeholder*="Message" i]',
    )
    .first();
  const ready = await box.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  if (!ready) {
    const interstitial = page
      .getByRole("button", { name: /send message/i })
      .or(page.getByRole("link", { name: /send message/i }));
    if (await interstitial.first().isVisible().catch(() => false)) {
      await interstitial.first().click();
      await assertClear(page);
    }
    const appeared = await box.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);
    if (!appeared) throw new StopRun("No Instagram message box opened. Stopping the batch.");
  }
  await assertClear(page);
  return typeAndSend(page, box, text);
}

export async function sendTikTok(page: Page, text: string): Promise<"sent" | "unconfirmed"> {
  await assertClear(page);
  const message = page.locator('[data-e2e="message-button"]').or(page.getByRole("button", { name: /^message$/i }));
  if (!(await message.first().isVisible().catch(() => false))) {
    throw new SkipPerson("No Message button on this profile.");
  }
  await message.first().click();
  await assertClear(page);
  const box = page
    .locator('[data-e2e="dm-input"] [contenteditable="true"], [role="dialog"] [contenteditable="true"]')
    .last();
  const ready = await box.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);
  if (!ready) throw new StopRun("TikTok Message opened, but there is no message box. Stopping the batch.");
  return typeAndSend(page, box, text);
}

export async function noteYouTube(page: Page): Promise<string[]> {
  await assertClear(page);
  let emails = findEmails(await page.locator("body").innerText());
  const view = page.getByRole("button", { name: /view email address/i });
  if (emails.length === 0 && (await view.isVisible().catch(() => false))) {
    await view.click();
    await page
      .waitForFunction(() => /@/.test(document.body?.innerText || ""), { timeout: 8_000 })
      .catch(() => {});
    await assertClear(page);
    emails = findEmails(await page.locator("body").innerText());
  }
  return emails;
}
