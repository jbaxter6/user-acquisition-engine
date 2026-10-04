import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSent, saveSent } from "./sent.js";

describe("sent log", () => {
  it("starts empty and round-trips a send", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "outreach-")), "sent.json");
    expect(loadSent(file)).toEqual({});
    saveSent(file, {
      "instagram:alpha": {
        platform: "instagram",
        username: "alpha",
        template: "Intro",
        at: "2026-10-03T00:00:00.000Z",
        outcome: "sent",
      },
    });
    expect(loadSent(file)["instagram:alpha"].outcome).toBe("sent");
  });
});
