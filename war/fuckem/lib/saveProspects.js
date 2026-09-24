import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same folder the scraper writes to (war/recruits); override with OUTPUT_DIR.
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.resolve(__dirname, '../../recruits');

/**
 * Writes one strategy's prospects to war/recruits as an .xlsx.
 * File names are `opp<N>-strat-<M>-<YYYY-MM-DD_HHmm>.xlsx`, keyed by slot
 * number only. The scraper's files are `<search-name>-<YYYY-MM-DD>.xlsx`, so
 * the two can't collide, and the time suffix stops same-day reruns from
 * overwriting each other.
 */
export function saveProspects(strategyId, prospects) {
  const slug = strategyId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${slug}-${stamp}.xlsx`);

  const rows = prospects.map((p) => ({
    Username: p.username ?? '',
    Name: p.name ?? '',
    'Profile URL': p.profileUrl ?? '',
    Instagram: p.instagram ?? '',
    TikTok: p.tiktok ?? '',
    YouTube: p.youtube ?? '',
    Twitch: p.twitch ?? '',
    Source: p.sourcePage ?? '',
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Prospects');
  XLSX.writeFile(wb, file);
  console.log(`Wrote ${rows.length} prospects to ${file}`);
  return file;
}
