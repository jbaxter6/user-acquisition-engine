import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { runAndSave } from '../../lib/gracefulExit.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const KEYWORDS_FILE = path.join(DIR, 'keywords.txt');
const STATE_FILE = path.join(DIR, '.state.json');

// The search bar returns at most 50 users per query and ignores queries
// shorter than 3 characters. A query that comes back full is "saturated", so
// we split it into query+a, query+b, ... to reach the users it cut off.
const RESULT_CAP = 50;
const MIN_QUERY_LEN = 3;
const CHILD_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789_.'.split('');

const MAX_PROFILES = Number(process.env.STRAT2_MAX_PROFILES || 200);
const MAX_QUERIES = Number(process.env.STRAT2_MAX_QUERIES || 300);
const MAX_QUERY_LEN = Number(process.env.STRAT2_MAX_QUERY_LEN || 6);
const RERUN = process.env.STRAT2_RERUN === '1';
const TRIGRAMS = process.env.STRAT2_TRIGRAMS === '1';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => sleep(min + Math.random() * (max - min));

function assertTargetUrl() {
  const value = (process.env.OPP1_URL || '').trim();
  if (!value) throw new Error('Missing OPP1_URL env var.');
  return value;
}

// Local memory, so reruns skip queries and profiles already done and never
// lose profiles that were read but not exported (e.g. after a crash).
//   queries: { "<query>": <number of results it returned> }
//   users:   { "<username>": { record, exported } }
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { queries: {}, users: {} };
  }
}
const saveState = (state) => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));

function loadKeywords() {
  const seeds = fs
    .readFileSync(KEYWORDS_FILE, 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim().toLowerCase())
    .filter((q) => q.length >= MIN_QUERY_LEN);
  if (TRIGRAMS) {
    const az = 'abcdefghijklmnopqrstuvwxyz'.split('');
    for (const a of az) for (const b of az) for (const c of az) seeds.push(a + b + c);
  }
  return [...new Set(seeds)];
}

const children = (q) => (q.length >= MAX_QUERY_LEN ? [] : CHILD_CHARS.map((c) => q + c));

async function runQuery(page, query) {
  const input = page.locator('input[placeholder="Search users..."]');
  if (!(await input.isVisible())) {
    await page.locator('button[aria-label="Search users"]').first().click();
  }
  const items = page.locator('div.max-h-64.overflow-y-auto button span.truncate');
  await input.fill('');
  await sleep(300);
  await input.pressSequentially(query, { delay: 60 });

  // Wait for the suggestions to settle (same count on two checks in a row).
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 20 && stable < 2; i++) {
    await sleep(500);
    const n = await items.count();
    stable = n === last ? stable + 1 : 0;
    last = n;
  }
  return (await items.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

async function readProfile(page, origin, username) {
  const profileUrl = `${origin}/${encodeURIComponent(username)}`;
  // Load the profile by URL (same page the click goes to). Clicking inside
  // the app would carry other creators' links over from the previous page.
  await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 60000 });

  const data = await page.evaluate(() => {
    const socials = { instagram: '', tiktok: '', youtube: '', twitch: '' };
    for (const a of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(a.getAttribute('href') || '', window.location.href);
        const host = url.hostname.toLowerCase();
        if (host.includes('instagram.com')) socials.instagram = url.href;
        if (host.includes('tiktok.com')) socials.tiktok = url.href;
        if (host.includes('youtube.com')) socials.youtube = url.href;
        if (host.includes('twitch.tv')) socials.twitch = url.href;
      } catch {
        // skip malformed link
      }
    }
    const heading = [...document.querySelectorAll('h1')]
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .pop();
    return { socials, name: heading || '' };
  });

  if (/creator not found/i.test(data.name)) return null;
  return { username, name: data.name || username, profileUrl, ...data.socials };
}

// Everything read but not yet exported (includes leftovers from a crashed
// run). Marks them exported and persists that, so they're not re-exported.
function takePending(state) {
  const pending = Object.values(state.users).filter((u) => u.record && !u.exported);
  pending.forEach((u) => (u.exported = true));
  saveState(state);
  return pending.map((u) => u.record);
}

export async function runStrategy({ onPartial } = {}) {
  const targetUrl = assertTargetUrl();
  const origin = new URL(targetUrl).origin;
  const state = loadState();
  // If interrupted, export from the in-memory state — includes profiles read
  // since the last saveState.
  onPartial?.(() => takePending(state));

  // Build the query queue: fresh keywords, plus unfinished splits of any
  // saturated queries from earlier runs.
  const queue = [];
  const queued = new Set();
  const enqueue = (q) => {
    if (queued.has(q) || (!RERUN && q in state.queries)) return;
    queued.add(q);
    queue.push(q);
  };
  loadKeywords().forEach(enqueue);
  for (const [q, n] of Object.entries(state.queries)) {
    if (n >= RESULT_CAP) children(q).forEach(enqueue);
  }
  console.log(`${queue.length} queries queued (up to ${MAX_QUERIES} this run, ${MAX_PROFILES} new profiles).`);

  const browser = await chromium.launch({ headless: true });
  try {
    const searchPage = await browser.newPage({ userAgent: USER_AGENT });
    await searchPage.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await searchPage.locator('button[aria-label="Search users"]').first().click();
    const profilePage = await browser.newPage({ userAgent: USER_AGENT });

    let profilesRead = 0;
    let queriesRun = 0;
    while (queue.length && queriesRun < MAX_QUERIES && profilesRead < MAX_PROFILES) {
      const query = queue.shift();
      const usernames = await runQuery(searchPage, query);
      queriesRun++;
      state.queries[query] = usernames.length;

      const fresh = usernames.filter((u) => !(u in state.users));
      console.log(`"${query}": ${usernames.length} users, ${fresh.length} new`);
      // Full list means there are more behind it: split the query.
      if (usernames.length >= RESULT_CAP) children(query).forEach(enqueue);

      for (const username of fresh) {
        if (profilesRead >= MAX_PROFILES) break;
        await jitter(600, 1200);
        try {
          const record = await readProfile(profilePage, origin, username);
          const hasSocial = record && (record.instagram || record.tiktok || record.youtube || record.twitch);
          // Remember every profile we looked at, but only export ones with a social.
          state.users[username] = { record: hasSocial ? { ...record, sourcePage: targetUrl } : null, exported: !hasSocial };
          profilesRead++;
        } catch (error) {
          console.log(`  ${username}: failed to load (${error instanceof Error ? error.message : error}), will retry next run`);
        }
      }
      saveState(state);
      await jitter(800, 1500);
    }
    console.log(`Done: ${queriesRun} queries, ${profilesRead} profiles read, ${queue.length} queries left for next run.`);
  } finally {
    await browser.close();
    saveState(state);
  }

  const prospects = takePending(state);
  return { source: targetUrl, count: prospects.length, prospects };
}

// `npm run opp1strat2` runs this file directly: scrape, then save to war/recruits.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAndSave('OPP1/strat-2', runStrategy).catch(() => process.exit(1));
}
