import type { Prospect, SourceOptions } from "../types.js";

const API = "https://api.twitch.tv/helix";
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

async function getToken(id: string, secret: string): Promise<string> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Twitch auth failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function scrapeTwitch(opts: SourceOptions): Promise<Prospect[]> {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in scraper/.env");
  const token = await getToken(id, secret);
  const headers = { "Client-Id": id, Authorization: `Bearer ${token}` };

  const get = async <T>(path: string, params: Record<string, string>): Promise<T> => {
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { headers });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Twitch ${path} failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    }
    throw new Error(`Twitch ${path}: rate limited`);
  };

  const games = await get<{ data: { id: string; name: string }[] }>("/games", { name: opts.category });
  if (!games.data[0]) throw new Error(`Twitch category not found: "${opts.category}"`);
  const game = games.data[0];
  console.log(`Twitch category: ${game.name}`);

  // Live streams in the category are the pool of currently-active creators.
  const seen = new Map<string, { login: string; userId: string; name: string; title: string }>();
  let cursor = "";
  for (let page = 0; page < 30 && seen.size < opts.limit * 4; page++) {
    const params: Record<string, string> = { game_id: game.id, first: "100" };
    if (cursor) params.after = cursor;
    const res = await get<{
      data: { user_id: string; user_login: string; user_name: string; title: string }[];
      pagination: { cursor?: string };
    }>("/streams", params);
    for (const s of res.data) {
      if (opts.keywords.length && !opts.keywords.some((k) => s.title.toLowerCase().includes(k))) continue;
      seen.set(s.user_id, { login: s.user_login, userId: s.user_id, name: s.user_name, title: s.title });
    }
    cursor = res.pagination.cursor ?? "";
    if (!cursor) break;
  }
  console.log(`Found ${seen.size} matching live streamers, checking follower counts...`);

  const out: Prospect[] = [];
  for (const s of seen.values()) {
    if (out.length >= opts.limit) break;
    if (opts.skip?.has(`twitch:${s.login.toLowerCase()}`)) continue;
    const f = await get<{ total: number }>("/channels/followers", { broadcaster_id: s.userId, first: "1" });
    if (f.total < opts.minFollowers || f.total > opts.maxFollowers) continue;
    const u = await get<{ data: { description: string }[] }>("/users", { id: s.userId });
    const bio = u.data[0]?.description ?? "";
    out.push({
      username: s.login,
      platform: "twitch",
      displayName: s.name,
      followers: f.total,
      notes: `${s.title}${bio ? ` | ${bio}` : ""}`.slice(0, 500),
      email: bio.match(EMAIL_RE)?.[0] ?? "",
      url: `https://twitch.tv/${s.login}`,
    });
    opts.onProspect?.(out[out.length - 1]);
  }
  return out;
}
