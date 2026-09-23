// Server timestamps come from SQLite's datetime('now') as "YYYY-MM-DD
// HH:MM:SS" in UTC, with no timezone marker — `new Date(...)` on that
// exact string is interpreted as local time in some browsers (Safari)
// rather than UTC, silently producing a wrong offset. Normalize to ISO
// 8601 with an explicit Z first.
export function parseServerDate(value: string): Date {
  const iso = value.includes("T") || value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(iso);
}

export function formatRelativeTime(value: string): string {
  const date = parseServerDate(value);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.round(days / 7);
  if (days < 30) return `${weeks}w ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.round(days / 365);
  return `${years}y ago`;
}
