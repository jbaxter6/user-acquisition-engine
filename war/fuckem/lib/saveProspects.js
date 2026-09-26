import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// war/recruits/intercepts/opp<N>: links pulled from the opps, one folder per
// opp slot, not enriched yet (the scraper's `enrich` turns these into
// war/recruits/dossiers). Override the base with OUTPUT_DIR.
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.resolve(__dirname, '../../recruits/intercepts');


const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'video', 'channel', 'tv', 'share', 't', 'user']);

/** Profile URL -> bare handle ('' if it can't be found). */
export function handleFromUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const yt = /youtube\.com|youtu\.be/i.test(url.hostname);
    const first = (yt && /^(channel|c|user)$/i.test(parts[0] ?? '') ? parts[1] : parts[0]) ?? '';
    const handle = decodeURIComponent(first).replace(/^@/, '');
    return handle && !RESERVED.has(handle.toLowerCase()) ? handle : '';
  } catch {
    return '';
  }
}

/** `file`, or `file-2`, `file-3`… if it's taken — never overwrite an earlier run's sheet. */
function freePath(file) {
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  let candidate = file;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}-${n}${ext}`;
  return candidate;
}

/**
 * Writes one strategy's prospects to war/recruits/intercepts/opp<N> as an .xlsx.
 * File names are `opp<N>-strat-<M>-<YYYY-MM-DD_HHmm>.xlsx`, keyed by slot
 * number only. The scraper's files are `<search-name>-<YYYY-MM-DD>.xlsx`, so
 * the two can't collide, and the time suffix stops same-day reruns from
 * overwriting each other. `partial: true` (an interrupted or failed run)
 * adds a "-partial" suffix so it's obvious the run didn't finish.
 */
export function saveProspects(strategyId, prospects, { partial = false } = {}) {
  const slug = strategyId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  // Folder per opp slot, from the "OPP<N>/strat-<M>" id (slot number only,
  // never the opp's name; see AGENTS.md).
  const oppDir = path.join(OUTPUT_DIR, slug.split('-strat-')[0] || 'other');
  fs.mkdirSync(oppDir, { recursive: true });
  const file = freePath(path.join(oppDir, `${slug}-${stamp}${partial ? '-partial' : ''}.xlsx`));

  // URL columns first (what the Prospecting import keys off), then the bare
  // username for each so the sheet is readable/usable without the URLs.
  const rows = prospects.map((p) => ({
    Instagram: p.instagram ?? '',
    TikTok: p.tiktok ?? '',
    YouTube: p.youtube ?? '',
    Twitch: p.twitch ?? '',
    'Instagram Username': handleFromUrl(p.instagram),
    'TikTok Username': handleFromUrl(p.tiktok),
    'YouTube Username': handleFromUrl(p.youtube),
    'Twitch Username': handleFromUrl(p.twitch),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Prospects');
  XLSX.writeFile(wb, file);
  console.log(`Wrote ${rows.length} prospects to ${file}`);
  return file;
}
// hey
