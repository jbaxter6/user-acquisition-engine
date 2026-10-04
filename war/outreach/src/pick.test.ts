import { describe, expect, it } from "vitest";
import { pickBatch, type ProspectCard } from "./pick.js";

const cards: ProspectCard[] = [
  { username: "alpha", openLabel: "Copy & open in Instagram" },
  { username: "beta", openLabel: null },
  { username: "Alpha", openLabel: "Copy & open in Instagram" },
  { username: "gamma", openLabel: "Copy & open in Instagram" },
  { username: "delta", openLabel: "Copy & open in Instagram" },
];

describe("pickBatch", () => {
  it("skips people already sent, cards with no open button, and duplicate handles", () => {
    const batch = pickBatch(cards, new Set(["instagram:gamma"]), "instagram", 10);
    expect(batch.map((c) => c.username)).toEqual(["alpha", "delta"]);
  });

  it("stops at the batch size without looking past it for more", () => {
    const batch = pickBatch(cards, new Set(), "instagram", 1);
    expect(batch.map((c) => c.username)).toEqual(["alpha"]);
  });
});
