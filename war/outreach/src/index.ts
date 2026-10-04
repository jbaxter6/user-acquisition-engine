import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { openBrowser } from "./browser.js";
import { noteYouTube, sendInstagram, sendTikTok } from "./compose.js";
import { parseConfig, type Config, type Platform } from "./config.js";
import {
  chooseTemplate,
  findCard,
  loggedInHandle,
  openOutreachTab,
  openProspecting,
  readCards,
  signIn,
} from "./crm.js";
import { SkipPerson, StopRun, assertHandleAllowed } from "./guard.js";
import { cardKey, pickBatch } from "./pick.js";
import { loadSent, saveSent, type SentLog, type SentOutcome } from "./sent.js";

const sentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sent.json");

let stopRequested = false;

function onSigint() {
  if (stopRequested) process.exit(130);
  stopRequested = true;
  console.log("\nStopping after the current person. sent.json already has everyone who was reached.");
}

async function pause(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (stopRequested) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function checkSender(context: BrowserContext, config: Config): Promise<void> {
  if (config.platform === "youtube") {
    console.log("YouTube opens the About tab. This run does not send a DM.");
    return;
  }
  const handle = await loggedInHandle(context, config.platform);
  assertHandleAllowed(handle, config.blockedHandles);
  console.log(`Sending as @${handle}.`);
}

function record(
  log: SentLog,
  platform: Platform,
  username: string,
  template: string,
  outcome: SentOutcome,
  email?: string,
): void {
  log[cardKey(platform, username)] = {
    platform,
    username,
    template,
    at: new Date().toISOString(),
    outcome,
    ...(email ? { email } : {}),
  };
  saveSent(sentPath, log);
}

async function reach(page: Page, platform: Platform, text: string): Promise<{ outcome: SentOutcome; email?: string }> {
  if (platform === "instagram") return { outcome: await sendInstagram(page, text) };
  if (platform === "tiktok") return { outcome: await sendTikTok(page, text) };
  const emails = await noteYouTube(page);
  return { outcome: "noted", email: emails[0] };
}

export async function run(page: Page, config: Config): Promise<void> {
  const log = loadSent(sentPath);
  await signIn(page, config);
  await checkSender(page.context(), config);
  await openProspecting(page, config);

  const batch = pickBatch(await readCards(page), new Set(Object.keys(log)), config.platform, config.batchSize);
  if (batch.length === 0) {
    console.log("No one to message on the first page. Sync Instagram if this batch was already sent, or the filter is empty.");
    return;
  }
  console.log(
    `${config.dryRun ? "Dry run. " : ""}Messaging ${batch.length}: ${batch.map((c) => "@" + c.username).join(", ")}`,
  );

  let reached = 0;
  for (let i = 0; i < batch.length; i++) {
    if (stopRequested) break;
    const person = batch[i];
    const card = await findCard(page, person.username);
    const text = await chooseTemplate(card, config.templateName);
    if (config.dryRun) {
      console.log(`Would message @${person.username} (${text.length} chars).`);
      continue;
    }
    const tab = await openOutreachTab(page, card);
    try {
      const result = await reach(tab, config.platform, text);
      record(log, config.platform, person.username, config.templateName, result.outcome, result.email);
      reached++;
      if (result.outcome === "unconfirmed") {
        throw new StopRun(
          `Send was clicked for @${person.username}, but the page did not confirm it. They are in sent.json so the next run will skip them. Check that thread before running again.`,
        );
      }
      const detail =
        result.outcome === "noted"
          ? result.email
            ? ` — ${result.email}`
            : " — no email on the About tab"
          : "";
      console.log(`${result.outcome} @${person.username}${detail}`);
    } catch (err) {
      if (err instanceof SkipPerson) {
        console.log(`Skipped @${person.username}: ${err.message}`);
      } else {
        throw err;
      }
    } finally {
      await tab.close().catch(() => {});
    }
    if (i < batch.length - 1 && !stopRequested && !config.dryRun) await pause(config.minDelayMs, config.maxDelayMs);
  }

  console.log(`Done. Reached ${reached} of ${batch.length}.`);
  if (config.platform === "instagram" && reached > 0) {
    console.log("Sync that Instagram account in the CRM before the next batch, so Not Contacted drops the people just messaged.");
  }
}

async function main() {
  process.on("SIGINT", onSigint);
  const config = parseConfig(process.env);
  mkdirSync(path.dirname(sentPath), { recursive: true });
  let code = 0;
  const { page, close } = await openBrowser();
  try {
    await run(page, config);
  } catch (err) {
    if (err instanceof StopRun) {
      console.error(err.message);
      code = 2;
    } else {
      console.error(err instanceof Error ? err.message : err);
      code = 1;
    }
  } finally {
    await close();
  }
  process.exitCode = code;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) void main();
