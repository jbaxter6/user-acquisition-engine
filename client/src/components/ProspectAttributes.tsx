import type { Platform, Prospect } from "../types";
import { formatCount } from "../lib/formatCount";
import { formatRelativeTime } from "../lib/relativeTime";

// Scraped/imported profile data on a prospect card: counts, badges, links.
// Reads prospect.attributes (keyed by the attribute registry); anything not
// observed simply doesn't render.

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// Exact below 10k (people read "1,257" fine), compact above.
function count(n: number): string {
  return n < 10_000 ? n.toLocaleString() : formatCount(n);
}

function profileUrl(platform: Platform, handle: string): string {
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "twitch":
      return `https://www.twitch.tv/${handle}`;
    case "youtube":
      return `https://www.youtube.com/@${handle}`;
    default:
      return `https://www.instagram.com/${handle}/`;
  }
}

export function ProspectAttributes({ prospect }: { prospect: Prospect }) {
  const attrs = prospect.attributes ?? {};
  const val = (k: string) => attrs[k]?.value;

  const followers = prospect.followers;
  const following = num(val("following"));
  const posts = num(val("post_count"));
  const likes = num(val("likes_total"));
  const stats = [
    followers != null && `${count(followers)} followers`,
    following != null && `${count(following)} following`,
    posts != null && `${count(posts)} posts`,
    likes != null && `${count(likes)} likes`,
  ].filter(Boolean) as string[];

  const verified = val("verified") === true;
  const isPrivate = val("is_private") === true;
  // Stored lowercase (it's matched as a keyword); show it as Instagram does.
  const rawCategory = list(val("primary_category"))[0];
  const category = rawCategory && rawCategory[0].toUpperCase() + rawCategory.slice(1);
  const pronouns = typeof val("pronouns") === "string" ? (val("pronouns") as string) : "";
  const links = list(val("links"));
  const mentions = list(val("mentions"));
  const highlights = list(val("highlights"));

  // Newest observation across attributes, for the "as of" hint.
  const observed = Object.values(attrs).reduce<string | undefined>(
    (latest, a) => (!latest || a.observed_at > latest ? a.observed_at : latest),
    undefined,
  );
  const sources = Array.from(new Set(Object.values(attrs).map((a) => a.source)));

  const hasBadges = verified || isPrivate || category || pronouns;
  if (!stats.length && !hasBadges && !links.length && !mentions.length) return null;

  return (
    <div className="prospect-attrs">
      {stats.length > 0 && (
        <p
          className="prospect-attrs__stats"
          title={observed ? `As of ${formatRelativeTime(observed)} · from ${sources.join(", ")}` : undefined}
        >
          {stats.join(" · ")}
        </p>
      )}
      {hasBadges && (
        <div className="prospect-attrs__badges">
          {verified && <span className="prospect-attrs__badge prospect-attrs__badge--verified">✓ Verified</span>}
          {isPrivate && <span className="prospect-attrs__badge prospect-attrs__badge--private">Private</span>}
          {category && <span className="prospect-attrs__badge">{category}</span>}
          {pronouns && <span className="prospect-attrs__badge prospect-attrs__badge--dim">{pronouns}</span>}
        </div>
      )}
      {(links.length > 0 || mentions.length > 0) && (
        <p className="prospect-attrs__links">
          {links.map((l) => (
            <a
              key={l}
              href={/^https?:\/\//i.test(l) ? l : `https://${l}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              🔗 {l}
            </a>
          ))}
          {mentions.map((m) => (
            <a key={m} href={profileUrl(prospect.platform, m)} target="_blank" rel="noopener noreferrer">
              @{m}
            </a>
          ))}
        </p>
      )}
      {highlights.length > 0 && (
        <p className="prospect-attrs__highlights" title={highlights.join(", ")}>
          Highlights: {highlights.join(" · ")}
        </p>
      )}
    </div>
  );
}
