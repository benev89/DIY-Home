import { describe, expect, it } from "vitest";
import { buildContext, mentionsErrorCode } from "../src/ai";
import { catalogKeyFor, coveringTools } from "../src/toolMatch";
import { buildIcs, rrule } from "../src/calendar";
import type { Task, Tool } from "../src/db";

describe("mentionsErrorCode", () => {
  it.each(["Backofen zeigt E011", "Fehler E:24 an der Spülmaschine", "error F21", "Fehlercode 5 blinkt", "zeigt E 15"])("detects %s", (t) =>
    expect(mentionsErrorCode(t)).toBe(true),
  );
  it.each(["Tür quietscht", "Lampe E14 flackert", "E27 Fassung locker", "Reifen 28 Zoll platt"])("ignores %s", (t) =>
    expect(mentionsErrorCode(t)).toBe(false),
  );
});

describe("research in context", () => {
  it("adds the web findings to what the AI sees", () => {
    const text = buildContext({ pastRepairs: [], tools: [], supplies: [], problem: "E011", research: "E011 = Taste klemmt" });
    expect(text).toContain("## Web research");
    expect(text).toContain("E011 = Taste klemmt");
  });
});

describe("coveringTools", () => {
  const tools: Tool[] = [
    { id: 1, name: "Inbus-Set", kind: "tool" },
    { id: 2, name: "Glaskeramik-Schaber", kind: "tool" },
    { id: 3, name: "Akkuschrauber", kind: "tool" },
  ];
  it("uses the exact entry the AI named (new repairs), and the same name", () => {
    expect(coveringTools(tools, "Inbusschlüssel 2,5 mm", "Inbus-Set").map((t) => t.id)).toEqual([1]);
    expect(coveringTools(tools, "glaskeramik schaber", "").map((t) => t.id)).toEqual([2]);
    expect(coveringTools(tools, "Torx T20", "")).toEqual([]);
  });
  it("updates live: removing the tool makes it missing again", () => {
    expect(coveringTools(tools.filter((t) => t.id !== 1), "Inbusschlüssel 2,5 mm", "Inbus-Set")).toEqual([]);
  });
  it("falls back to word stems for repairs saved before exact matching", () => {
    expect(coveringTools(tools, "Inbusschlüssel 2,5 mm", undefined).map((t) => t.id)).toEqual([1]);
  });
  it("maps names to catalog suggestions in both languages", () => {
    expect(catalogKeyFor("Glaskeramik-Schaber")).toBe("hob-scraper");
    expect(catalogKeyFor("ceramic hob scraper")).toBe("hob-scraper");
    expect(catalogKeyFor("Something else")).toBeUndefined();
  });
});

describe("calendar", () => {
  it("uses readable repeat rules", () => {
    expect(rrule(7)).toBe("FREQ=WEEKLY;INTERVAL=1");
    expect(rrule(90)).toBe("FREQ=MONTHLY;INTERVAL=3");
    expect(rrule(365)).toBe("FREQ=YEARLY;INTERVAL=1");
    expect(rrule(10)).toBe("FREQ=DAILY;INTERVAL=10");
  });
  it("builds a valid, folded .ics with an alarm", () => {
    const task: Task & { itemName: string } = {
      id: 4, title: "Entkalken; mit Zitronensäure, nicht Essig", how: "Zeile 1\nZeile 2 – ".repeat(10), intervalDays: 60,
      nextDue: new Date(2026, 11, 3).getTime(), doneLog: [], createdAt: 1, itemName: "Wasserkocher",
    };
    const ics = buildIcs([task], new Date(2026, 10, 27).getTime());
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261203");
    expect(ics).toContain("RRULE:FREQ=MONTHLY;INTERVAL=2");
    expect(ics).toContain("SUMMARY:🔧 Entkalken\; mit Zitronensäure\\, nicht Essig – Wasserkocher");
    expect(ics).toContain("TRIGGER:PT9H");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
