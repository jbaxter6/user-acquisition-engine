import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterAll, describe, expect, it } from "vitest";
import { alreadyEnriched, handleFromUrl, readAccounts } from "./readSheet.js";

const dir = mkdtempSync(path.join(tmpdir(), "readsheet-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function sheet(name: string, rows: Record<string, unknown>[]): string {
  const file = path.join(dir, name);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Prospects");
  XLSX.writeFile(wb, file);
  return file;
}

describe("handleFromUrl", () => {
  it.each([
    ["https://www.instagram.com/localsonle/?hl=en", "localsonle"],
    ["https://instagram.com/vokuL__", "vokuL__"],
    ["https://www.tiktok.com/@khaby.lame", "khaby.lame"],
    ["https://youtube.com/@Stomprrr", "Stomprrr"],
    ["https://www.youtube.com/channel/UC123", "UC123"],
    ["@someone", "someone"],
    ["https://instagram.com/p/Cabc123/", ""],
    ["https://linktr.ee/someone", ""],
    ["", ""],
  ])("%s -> %s", (raw, handle) => expect(handleFromUrl(raw)).toBe(handle));
});

describe("readAccounts", () => {
  it("reads fuckem's one-row-per-creator sheets, one account per link", () => {
    const file = sheet("fuckem.xlsx", [
      {
        Instagram: "https://www.instagram.com/localsonle/?hl=en",
        TikTok: "",
        YouTube: "",
        Twitch: "",
        "Instagram Username": "localsonle",
      },
      {
        Instagram: "https://instagram.com/vokuL__",
        TikTok: "https://www.tiktok.com/@vokul",
        YouTube: "https://youtube.com/@Stomprrr",
        Twitch: "",
      },
    ]);
    expect(readAccounts(file)).toEqual([
      { platform: "instagram", handle: "localsonle" },
      { platform: "instagram", handle: "vokuL__" },
      { platform: "tiktok", handle: "vokul" },
      { platform: "youtube", handle: "Stomprrr" },
    ]);
  });

  it("falls back to '<Platform> Username' columns when there's no link", () => {
    const file = sheet("usernames.xlsx", [{ Instagram: "", "Instagram Username": "only_name" }]);
    expect(readAccounts(file)).toEqual([{ platform: "instagram", handle: "only_name" }]);
  });

  it("reads the scraper's one-row-per-account sheets", () => {
    const file = sheet("scraper.xlsx", [
      { Username: "a", Platform: "instagram", Followers: 10 },
      { Username: "b", Platform: "TikTok" },
      { Username: "c", Platform: "myspace" },
    ]);
    expect(readAccounts(file)).toEqual([
      { platform: "instagram", handle: "a" },
      { platform: "tiktok", handle: "b" },
    ]);
  });

  it("dedupes the same account across rows, ignoring case", () => {
    const file = sheet("dupes.xlsx", [
      { Instagram: "https://instagram.com/Same" },
      { Instagram: "https://instagram.com/same/" },
    ]);
    expect(readAccounts(file)).toHaveLength(1);
  });

  it("explains what it expected when the sheet has neither layout", () => {
    const file = sheet("junk.xlsx", [{ Foo: "bar" }]);
    expect(() => readAccounts(file)).toThrow(/Username \+ Platform/);
  });
});

describe("alreadyEnriched", () => {
  it("collects accounts with a follower count from earlier -enriched outputs of the same input", () => {
    sheet("run1-enriched-partial.xlsx", [
      { Username: "done1", Platform: "instagram", Followers: 1200 },
      { Username: "failed", Platform: "instagram" }, // no stats: retry it
    ]);
    sheet("run1-enriched-partial-2.xlsx", [{ Username: "Done2", Platform: "tiktok", Followers: 0 }]);
    sheet("other-enriched.xlsx", [{ Username: "notmine", Platform: "instagram", Followers: 5 }]);
    expect([...alreadyEnriched(dir, "run1")].sort()).toEqual(["instagram:done1", "tiktok:done2"]);
  });
});
