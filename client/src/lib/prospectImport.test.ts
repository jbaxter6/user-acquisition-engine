import { describe, expect, it } from "vitest";
import {
  applyMapping,
  autoMapColumns,
  detectWideLayout,
  expandWideRows,
  handleFromUrl,
  normalizePlatform,
} from "./prospectImport";

describe("handleFromUrl", () => {
  it.each([
    ["https://www.instagram.com/beatmaker9/", "beatmaker9"],
    ["instagram.com/beatmaker9?igsh=abc", "beatmaker9"],
    ["https://www.tiktok.com/@ratemytrack_dj?lang=en", "ratemytrack_dj"],
    ["https://www.youtube.com/@producerchannel", "producerchannel"],
    ["https://youtube.com/channel/UC123abc", "UC123abc"],
    ["https://twitch.tv/livebeats", "livebeats"],
    ["@beatmaker9", "beatmaker9"],
    ["beatmaker9", "beatmaker9"],
  ])("%s → %s", (input, handle) => {
    expect(handleFromUrl(input)).toBe(handle);
  });

  it.each([
    ["a post, not a profile", "https://www.instagram.com/p/Cxyz123/"],
    ["a reel", "https://www.instagram.com/reels/abc/"],
    ["a non-social URL", "https://linktr.ee/beatmaker9"],
    ["an empty cell", ""],
    ["a missing cell", undefined],
  ])("returns nothing for %s", (_label, input) => {
    expect(handleFromUrl(input)).toBe("");
  });
});

describe("normalizePlatform", () => {
  it("understands common shorthand, case-insensitively", () => {
    expect(normalizePlatform("IG", "tiktok")).toBe("instagram");
    expect(normalizePlatform(" TT ", "instagram")).toBe("tiktok");
    expect(normalizePlatform("yt", "instagram")).toBe("youtube");
  });

  it("falls back for anything unknown", () => {
    expect(normalizePlatform("myspace", "twitch")).toBe("twitch");
    expect(normalizePlatform(undefined, "instagram")).toBe("instagram");
  });
});

describe("autoMapColumns", () => {
  it("maps the scraper's sheet columns", () => {
    // The exact headers war/scraper writes (src/sheet.ts).
    const headers = ["Username", "Platform", "Display Name", "Followers", "Following", "Posts", "Likes",
      "Verified", "Private", "Category", "Pronouns", "Bio", "Mentions", "Links", "Highlights", "Email", "URL"];
    expect(autoMapColumns(headers)).toMatchObject({
      username: "Username",
      platform: "Platform",
      displayName: "Display Name",
      followers: "Followers",
      notes: "Bio",
      email: "Email",
      following: "Following",
      posts: "Posts",
      likes: "Likes",
      verified: "Verified",
      private: "Private",
      category: "Category",
      mentions: "Mentions",
      links: "Links",
      highlights: "Highlights",
    });
  });

  it("leaves unrecognized columns unmapped", () => {
    expect(autoMapColumns(["Foo", "Bar"])).toEqual({});
  });
});

describe("applyMapping", () => {
  const mapping = autoMapColumns(["Username", "Platform", "Followers", "Verified", "Mentions", "Following", "Bio"]);

  it("turns sheet rows into prospects", () => {
    const [p] = applyMapping(
      [{ Username: "https://instagram.com/beatmaker9", Platform: "ig", Followers: 12500, Bio: "  beats  " }],
      mapping,
      "tiktok",
    );
    expect(p).toMatchObject({ username: "beatmaker9", platform: "instagram", followers: 12500, notes: "beats" });
  });

  it("uses the default platform when the sheet has no platform column", () => {
    const [p] = applyMapping([{ Username: "x" }], { username: "Username" }, "twitch");
    expect(p.platform).toBe("twitch");
  });

  it("skips rows without a usable username", () => {
    expect(applyMapping([{ Username: "" }, { Username: "https://instagram.com/p/abc" }], mapping, "instagram")).toEqual([]);
    expect(applyMapping([{ Username: "a" }], {}, "instagram")).toEqual([]);
  });

  it("reads follower counts the way people type them", () => {
    const rows = [
      { Username: "a", Followers: "12,500" },
      { Username: "b", Followers: "1.2M" },
      { Username: "c", Followers: "10k" },
      { Username: "d", Followers: "" },
      { Username: "e", Followers: "lots" },
    ];
    expect(applyMapping(rows, mapping, "instagram").map((p) => p.followers)).toEqual([12500, 1200000, 10000, undefined, undefined]);
  });

  it("reads profile attributes, leaving blanks unknown rather than 0/false", () => {
    const [full, blank] = applyMapping(
      [
        { Username: "a", Verified: "Yes", Mentions: "@label, @manager", Following: "1.5k" },
        { Username: "b", Verified: "", Mentions: "", Following: "" },
      ],
      mapping,
      "instagram",
    );
    expect(full.attributes).toEqual({ verified: true, mentions: ["label", "manager"], following: 1500 });
    expect(blank.attributes).toBeUndefined();
  });
});

describe("one-row-per-creator sheets (fuckem's layout)", () => {
  const headers = ["Instagram", "TikTok", "YouTube", "Twitch", "Email"];

  it("is detected by its per-platform link columns", () => {
    expect(detectWideLayout(headers)).toEqual({
      instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", twitch: "Twitch", email: "Email",
    });
    expect(detectWideLayout(["Username", "Platform"])).toBeNull();
  });

  it("expands each creator into one prospect per linked platform", () => {
    const result = expandWideRows(
      [
        { Instagram: "https://instagram.com/dj_one", TikTok: "https://tiktok.com/@dj_one", Email: "dj@example.com" },
        { YouTube: "https://youtube.com/@two" },
        { Instagram: "", TikTok: "" },
      ],
      detectWideLayout(headers)!,
    );
    expect(result.creators).toBe(2);
    expect(result.byPlatform).toEqual({ instagram: 1, tiktok: 1, twitch: 0, youtube: 1 });
    expect(result.prospects).toEqual([
      { username: "dj_one", platform: "instagram", email: "dj@example.com" },
      { username: "dj_one", platform: "tiktok", email: "dj@example.com" },
      { username: "two", platform: "youtube", email: undefined },
    ]);
  });
});
