import { mkdirSync, readFileSync } from "node:fs";
import { scrapeTwitch } from "./sources/twitch.js";
import { scrapeTikTok, scrapeTikTokLive } from "./sources/tiktok.js";
import { scrapeInstagram } from "./sources/instagram.js";
import { loadKnown, rememberScraped } from "./known.js";
import { saveOnInterrupt } from "./gracefulExit.js";
import { writeSheet } from "./sheet.js";
import type { Prospect, SourceOptions } from "./types.js";

interface Search extends Partial<Omit<SourceOptions, "minFollowers" | "maxFollowers">> {
  name: string;
  source: string;
  min?: number;
  max?: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const sources: Record<string, (o: SourceOptions) => Promise<Prospect[]>> = {
  twitch: scrapeTwitch,
  instagram: scrapeInstagram,
  tiktok: scrapeTikTok,
  "tiktok-live": scrapeTikTokLive,
};

const listed: Search[] = JSON.parse(readFileSync("searches.json", "utf8"));

// Which searches to run: --list, --search <name>, --all, or an ad-hoc one from flags.
if (process.argv.includes("--list")) {
  for (const s of listed) console.log(`${s.name}  [${s.source}] "${s.category}"`);
  process.exit(0);
}

let toRun: Search[];
if (process.argv.includes("--all")) {
  toRun = listed;
} else if (arg("search")) {
  const names = arg("search")!.split(",");
  toRun = names.map((n) => {
    const s = listed.find((x) => x.name === n.trim());
    if (!s) {
      console.error(`No search named "${n}". Run with --list to see them.`);
      process.exit(1);
    }
    return s;
  });
} else {
  toRun = [
    {
      name: "adhoc",
      source: arg("source") ?? "twitch",
      category: arg("category") ?? "Music",
      min: Number(arg("min") ?? 20000),
      max: Number(arg("max") ?? 200000),
      limit: Number(arg("limit") ?? 100),
      keywords: (arg("keywords") ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    },
  ];
}

const known = process.argv.includes("--no-dedupe") ? new Set<string>() : await loadKnown();
// Search sheets land in war/recruits/leads (open-web finds, already with
// profile stats); override with OUTPUT_DIR. See war/recruits layout in
// war/fuckem/HOWTOUSE.md.
const outDir = process.env.OUTPUT_DIR ?? "../recruits/leads";
mkdirSync(outDir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const combined = new Map<string, Prospect>();

for (const s of toRun) {
  const run = sources[s.source];
  if (!run) {
    console.error(`Unknown source "${s.source}" in "${s.name}". Available: ${Object.keys(sources).join(", ")}`);
    continue;
  }
  console.log(`\n=== ${s.name} ===`);

  // Everything accepted so far this search. If the run is interrupted
  // (Ctrl-C, terminal closed) or crashes (rate limit, captcha), these still
  // get written — to a "-partial" file so it's obvious the search didn't
  // finish — and remembered, so the next run doesn't redo them.
  const collected: Prospect[] = [];
  const savePartial = () => {
    if (collected.length === 0) {
      console.log(`${s.name}: nothing collected yet, no file written.`);
      return;
    }
    writeSheet(`${outDir}/${s.name}-${date}-partial.xlsx`, collected);
    rememberScraped(known, collected);
  };
  const release = saveOnInterrupt(savePartial);

  try {
    const prospects = await run({
      category: s.category ?? "",
      minFollowers: s.min ?? 20000,
      maxFollowers: s.max ?? 200000,
      limit: s.limit ?? 100,
      keywords: (s.keywords ?? []).map((k) => k.toLowerCase()),
      skip: known,
      onProspect: (p) => collected.push(p),
    });
    writeSheet(`${outDir}/${s.name}-${date}.xlsx`, prospects);
    rememberScraped(known, prospects);
    for (const p of prospects) combined.set(`${p.platform}:${p.username}`, p);
  } catch (err) {
    console.error(`${s.name} failed:`, err instanceof Error ? err.message : err);
    savePartial();
    for (const p of collected) combined.set(`${p.platform}:${p.username}`, p);
  } finally {
    release();
  }
}

if (toRun.length > 1) writeSheet(`${outDir}/combined-${date}.xlsx`, [...combined.values()]);
