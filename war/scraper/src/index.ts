import * as XLSX from "xlsx";
import { mkdirSync, readFileSync } from "node:fs";
import { scrapeTwitch } from "./sources/twitch.js";
import { scrapeTikTok, scrapeTikTokLive } from "./sources/tiktok.js";
import { scrapeInstagram } from "./sources/instagram.js";
import { loadKnown, rememberScraped } from "./known.js";
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

function writeSheet(file: string, prospects: Prospect[]) {
  const rows = prospects.map((p) => ({
    Username: p.username,
    Platform: p.platform,
    "Display Name": p.displayName,
    Followers: p.followers,
    Notes: p.notes,
    Email: p.email,
    URL: p.url,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Prospects");
  XLSX.writeFile(wb, file);
  console.log(`Wrote ${rows.length} prospects to ${file}`);
}

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
mkdirSync("output", { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const combined = new Map<string, Prospect>();

for (const s of toRun) {
  const run = sources[s.source];
  if (!run) {
    console.error(`Unknown source "${s.source}" in "${s.name}". Available: ${Object.keys(sources).join(", ")}`);
    continue;
  }
  console.log(`\n=== ${s.name} ===`);
  try {
    const prospects = await run({
      category: s.category ?? "",
      minFollowers: s.min ?? 20000,
      maxFollowers: s.max ?? 200000,
      limit: s.limit ?? 100,
      keywords: (s.keywords ?? []).map((k) => k.toLowerCase()),
      skip: known,
    });
    writeSheet(`output/${s.name}-${date}.xlsx`, prospects);
    rememberScraped(known, prospects);
    for (const p of prospects) combined.set(`${p.platform}:${p.username}`, p);
  } catch (err) {
    console.error(`${s.name} failed:`, err instanceof Error ? err.message : err);
  }
}

if (toRun.length > 1) writeSheet(`output/combined-${date}.xlsx`, [...combined.values()]);
