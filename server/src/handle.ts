const RESERVED_PATHS = new Set([
  "p", "reel", "reels", "explore", "stories", "accounts", "video", "channel", "tv", "share", "t", "user",
]);
const SOCIAL_HOST = /(instagram\.com|tiktok\.com|twitch\.tv|youtube\.com|youtu\.be)/i;

/**
 * Accepts a bare handle, an @handle, or a profile URL and returns just the
 * handle ("" if none can be found). Keeps stored usernames clean no matter
 * which spreadsheet layout (URL columns vs. username column) they came from.
 */
export function normalizeHandle(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (!SOCIAL_HOST.test(value)) {
    return /[/:]/.test(value) ? "" : value.replace(/^@/, "").split(/[?#\s]/)[0];
  }
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const isYouTube = /youtube\.com|youtu\.be/i.test(url.hostname);
    const first =
      (isYouTube && /^(channel|c|user)$/i.test(parts[0] ?? "") ? parts[1] : parts[0]) ?? "";
    const handle = decodeURIComponent(first).replace(/^@/, "");
    return handle && !RESERVED_PATHS.has(handle.toLowerCase()) ? handle : "";
  } catch {
    return "";
  }
}
