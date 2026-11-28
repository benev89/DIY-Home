import { describe, expect, it } from "vitest";
import { buildContext, errorCodes, systemPrompt } from "../src/ai";
import { bestCatalogEntry } from "../src/toolMatch";
import { shoppingList } from "../src/shopping";
import { underWarranty } from "../src/warranty";
import { buildIcs, googleEventUrl } from "../src/calendar";
import type { Repair, Task, Tool } from "../src/db";

describe("errorCodes (research cache key)", () => {
  it("normalises codes", () => {
    expect(errorCodes("Backofen zeigt E011")).toEqual(["E011"]);
    expect(errorCodes("Fehler E:24, danach F 21")).toEqual(["E24", "F21"]);
    expect(errorCodes("Lampe E14 kaputt")).toEqual([]);
  });
});

describe("bestCatalogEntry", () => {
  it.each([
    ["Mikrofasertuch", "microfibre"],
    ["Torx T20", "torx"],
    ["Inbusschlüssel 2,5 mm", "allen"],
    ["Entkalker (Zitronensäure)", "descaler"],
    ["Glaskeramikschaber", "hob-scraper"],
    ["Schleifpapier 120", "sandpaper"],
  ])("%s → %s", (name, key) => expect(bestCatalogEntry(name)?.key).toBe(key));
  it("returns nothing for unrelated things", () => {
    expect(bestCatalogEntry("Glasreiniger")).toBeUndefined();
    expect(bestCatalogEntry("Wasserpumpenzange")?.key).toBe("water-pliers"); // not "Wasserwaage"
  });
  it("gives the AI the catalog to pick keys from", () => {
    expect(systemPrompt("de", "")).toContain("hob-scraper = Ceramic hob scraper / Glaskeramik-Schaber");
  });
});

describe("shoppingList", () => {
  const repair = (over: Partial<Repair>): Repair => ({
    id: 1, title: "Hahn", problem: "", photoIds: [], includeManual: false, contextSnapshot: "", history: [], chat: [],
    stepsDone: [], status: "open", costUsd: 0, createdAt: 0, updatedAt: 0,
    diagnosis: {
      title: "Hahn", summary: "", safety: { level: "ok", notes: [] }, questions: [], checks_first: [], causes: [], steps: [],
      tools: [
        { name: "Inbusschlüssel 2,5 mm", owned: true, owned_as: "Inbus-Set", catalog_key: "allen" },
        { name: "Wasserpumpenzange", owned: false, owned_as: "", catalog_key: "water-pliers" },
      ],
      parts: [
        { name: "Kartusche 35 mm", spec: "Hansgrohe 92730000", price_estimate: "30 €", catalog_key: "" },
        { name: "Teflonband", spec: "", price_estimate: "2 €", catalog_key: "ptfe" },
      ],
      difficulty: "easy", minutes: 30, stop_and_call_pro_if: "", prevention: [],
    },
    ...over,
  });
  const tools: Tool[] = [{ id: 1, name: "Inbus-Set", kind: "tool", key: "allen" }, { id: 2, name: "Teflonband", kind: "supply", key: "ptfe" }];
  it("lists only what an open repair needs and you don't have", () => {
    expect(shoppingList([repair({})], tools).map((e) => e.name)).toEqual(["Wasserpumpenzange", "Kartusche 35 mm"]);
  });
  it("drops bought parts and repairs that are done", () => {
    expect(shoppingList([repair({ boughtParts: ["Kartusche 35 mm"] })], tools).map((e) => e.name)).toEqual(["Wasserpumpenzange"]);
    expect(shoppingList([repair({ status: "fixed" })], tools)).toEqual([]);
  });
});

describe("warranty", () => {
  it("is valid up to and including the end date", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(underWarranty({ warrantyUntil: "2026-11-27" }, now)).toBe(true);
    expect(underWarranty({ warrantyUntil: "2026-11-26" }, now)).toBe(false);
    expect(underWarranty({}, now)).toBe(false);
  });
  it("tells the AI not to open devices under warranty", () => {
    const text = buildContext({ item: { name: "Spülmaschine", warrantyUntil: "2027-05-01", underWarranty: true }, pastRepairs: [], tools: [], supplies: [], problem: "x" });
    expect(text).toContain("STILL UNDER WARRANTY");
    expect(systemPrompt("en", "")).toContain("do not suggest opening the device");
  });
});

describe("calendar links", () => {
  const task: Task = { id: 1, title: "Entkalken", intervalDays: 90, nextDue: new Date(2026, 11, 3).getTime(), doneLog: [], createdAt: 1 };
  it("pre-fills a repeating Google Calendar event", () => {
    const u = new URL(googleEventUrl({ ...task, itemName: "Wasserkocher" }, new Date(2026, 10, 27).getTime()));
    expect(u.searchParams.get("text")).toBe("🔧 Entkalken – Wasserkocher");
    expect(u.searchParams.get("dates")).toBe("20261203/20261204");
    expect(u.searchParams.get("recur")).toBe("RRULE:FREQ=MONTHLY;INTERVAL=3;UNTIL=20281127"); // 2 years ahead by default
  });
  it("leaves out alarms in the subscribed feed when push reminds instead", () => {
    expect(buildIcs([task], 0, { alarms: false, name: "DIY Home" })).not.toContain("VALARM");
    expect(buildIcs([task], 0, { alarms: false, name: "DIY Home" })).toContain("X-WR-CALNAME:DIY Home");
  });
});
