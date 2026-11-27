import { describe, expect, it } from "vitest";
import { buildContext, costUsd, systemPrompt } from "../src/ai";

describe("costUsd", () => {
  it("prices a typical Haiku question at about a tenth of a cent", () => {
    // ~3k tokens in (photo + context), ~1.5k out (thinking + answer)
    const c = costUsd("claude-haiku-5-5", 3000, 1500);
    expect(c).toBeCloseTo(0.00105, 6);
  });
  it("uses Haiku's long-prompt price above 100K input tokens", () => {
    expect(costUsd("claude-haiku-5-5", 200_000, 0)).toBeCloseTo(0.1, 6);
  });
  it("prices Sonnet", () => {
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 100_000)).toBeCloseTo(3, 6);
  });
});

describe("buildContext", () => {
  it("includes item, past repairs, tools and the problem", () => {
    const text = buildContext({
      item: { name: "Dishwasher", area: "Kitchen", brand: "Bosch", model: "SMV4HTX31E", specs: "Filter 10002494" },
      pastRepairs: [{ title: "Not draining", status: "fixed", outcome: "Cleaned the filter", date: "2026-03-01" }],
      tools: ["Torx set"],
      supplies: ["Descaler"],
      problem: "  Shows error E24  ",
    });
    expect(text).toContain("- Brand: Bosch");
    expect(text).toContain("- Model/type: SMV4HTX31E");
    expect(text).toContain("2026-03-01: Not draining (fixed) – Cleaned the filter");
    expect(text).toContain("- Torx set");
    expect(text).toContain("- Descaler");
    expect(text.endsWith("Shows error E24")).toBe(true);
  });
  it("handles a problem without an item", () => {
    const text = buildContext({ pastRepairs: [], tools: [], supplies: [], problem: "Door squeaks" });
    expect(text).toContain("Not in the user's inventory");
    expect(text).toContain("(none listed)");
  });
});

describe("systemPrompt", () => {
  it("switches answer language and adds the region rule", () => {
    expect(systemPrompt("de", "Germany")).toContain("Write everything in German");
    expect(systemPrompt("de", "Germany")).toContain("The user lives in: Germany");
    expect(systemPrompt("en", "")).not.toContain("The user lives in");
  });
});
