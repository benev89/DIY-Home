import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiSearch, parseGemini, urlMatchesSources } from "../src/gemini";
import { findManualUrl, researchProblem } from "../src/ai";
import { buildIcs, reminderEnd, rrule } from "../src/calendar";
import { db, setSetting, type Task } from "../src/db";
import { exportAll, importAll } from "../src/backup";

const grounded = (text: string, sites: string[]) => ({
  candidates: [{
    content: { parts: [{ text }] },
    groundingMetadata: {
      groundingChunks: sites.map((s) => ({ web: { uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${s}`, title: s } })),
      searchEntryPoint: { renderedContent: "<div class='chip'>bosch e011</div>" },
    },
  }],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("Gemini", () => {
  it("reads text, sources and Google's search suggestions", () => {
    const g = parseGemini(grounded("E011 = Taste klemmt", ["bosch-home.com", "bosch-home.com"]), "gemini-flash-latest");
    expect(g.text).toBe("E011 = Taste klemmt");
    expect(g.sources).toHaveLength(1);
    expect(g.suggestionsHtml).toContain("chip");
  });
  it("tries the next model when one refuses, and stops on a bad key", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url.split("/models/")[1]);
      return calls.length === 1 ? json({ error: { code: 400, message: "Search grounding is not supported" } }, 400) : json(grounded("ok", ["a.de"]));
    });
    expect((await geminiSearch("k", "q")).model).toBe("gemini-2.5-flash");
    expect(calls).toEqual(["gemini-flash-latest:generateContent", "gemini-2.5-flash:generateContent"]);

    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return json({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }, 400);
    });
    await expect(geminiSearch("bad", "q")).rejects.toThrow(/API key not valid/);
    expect(calls).toHaveLength(1);
  });
  it("only trusts links on websites Google actually returned", () => {
    const sources = [{ title: "bosch-home.com", url: "x" }, { title: "manualslib.de", url: "y" }];
    expect(urlMatchesSources("https://media3.bosch-home.com/Documents/x.pdf", sources)).toBe(true);
    expect(urlMatchesSources("https://www.manualslib.de/manual/1.html", sources)).toBe(true);
    expect(urlMatchesSources("https://made-up-manuals.example/x.pdf", sources)).toBe(false);
  });
  it("research uses Gemini (free) and never calls Claude when it works", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      hosts.push(new URL(url).host);
      return json(grounded("E011: Taste zu lange gedrückt.", ["bosch-home.com"]));
    });
    const r = await researchProblem({ apiKey: "sk-ant-x", geminiKey: "g", lang: "de", region: "", problem: "E011", item: { name: "Backofen", brand: "Bosch" } });
    expect(r.value.provider).toBe("gemini");
    expect(r.costUsd).toBe(0);
    expect(hosts.every((h) => h === "generativelanguage.googleapis.com")).toBe(true);
  });
  it("manual: a link on a website Google didn't return is rejected (falls back to Claude)", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      hosts.push(new URL(url).host);
      if (url.includes("googleapis")) return json(grounded("URL: https://invented.example/m.pdf\nTITLE: x", ["bosch-home.com"]));
      throw new TypeError("network off in test"); // Claude call
    });
    await expect(findManualUrl({ apiKey: "sk-ant-x", geminiKey: "g", lang: "de", name: "Ofen", brand: "Bosch", model: "HBG" })).rejects.toThrow();
    expect(hosts.some((h) => h === "api.anthropic.com")).toBe(true);
  });
});

describe("calendar end dates", () => {
  const now = new Date(2026, 10, 28).getTime();
  const task: Task = { id: 1, title: "Entkalken", intervalDays: 90, nextDue: new Date(2026, 11, 3).getTime(), doneLog: [], createdAt: 1 };
  it("ends at the horizon or the task's own date, whichever is earlier", () => {
    expect(new Date(reminderEnd(task, now, 2)!).getFullYear()).toBe(2028);
    expect(reminderEnd({ remindUntil: "2027-06-30" }, now, 2)).toBe(new Date("2027-06-30T12:00:00").getTime());
    expect(reminderEnd({}, now, 0)).toBeUndefined();
  });
  it("writes UNTIL into the repeat rule and skips tasks whose reminders already ended", () => {
    expect(rrule(90, new Date(2028, 10, 28).getTime())).toBe("FREQ=MONTHLY;INTERVAL=3;UNTIL=20281128");
    const ics = buildIcs([task, { ...task, id: 2, title: "Alt", remindUntil: "2026-01-01" }], now, { horizonYears: 2 });
    expect(ics).toMatch(/RRULE:FREQ=MONTHLY;INTERVAL=3;UNTIL=2028\d{4}/);
    expect(ics).not.toContain("Alt");
    expect(buildIcs([task], now, { horizonYears: 0 })).toContain("RRULE:FREQ=MONTHLY;INTERVAL=3\r\n");
  });
});

describe("backup privacy", () => {
  it("never exports API keys or this phone's push address, but keeps the calendar identity", async () => {
    await setSetting("apiKey", "sk-ant-secret");
    await setSetting("geminiKey", "AIza-secret");
    await setSetting("pushSub", { endpoint: "https://web.push.apple.com/x" });
    await setSetting("serverId", "feed-id-123");
    const out = await exportAll();
    expect(out).not.toContain("sk-ant-secret");
    expect(out).not.toContain("AIza-secret");
    expect(out).not.toContain("web.push.apple.com");
    expect(out).toContain("feed-id-123");
    await setSetting("geminiKey", "AIza-this-phone");
    await importAll(out);
    expect((await db.settings.get("geminiKey"))?.value).toBe("AIza-this-phone");
  });
});

describe("Gemini busy", () => {
  it("retries once when Google is overloaded, then succeeds", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (++n === 1 ? json({ error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } }, 503) : json(grounded("ok", ["a.de"]))));
    const r = await geminiSearch("k", "q", 1);
    expect(r.model).toBe("gemini-flash-latest");
    expect(n).toBe(2);
  });
});

describe("calendar alarm time", () => {
  const task: Task = { id: 1, title: "Entkalken", intervalDays: 90, nextDue: new Date(2026, 11, 3).getTime(), doneLog: [], createdAt: 1 };
  it("rings at the chosen time on the due day", () => {
    const now = new Date(2026, 10, 28).getTime();
    expect(buildIcs([task], now, { alarmTime: "07:30" })).toContain("TRIGGER:PT7H30M");
    expect(buildIcs([task], now, { alarmTime: "18:00" })).toContain("TRIGGER:PT18H\r\n");
    expect(buildIcs([task], now, {})).toContain("TRIGGER:PT9H\r\n");
  });
});
