import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { addTask, DAY, db, deleteRepair, markTaskDone } from "../src/db";
import { bucket, daysUntil, dueLabel, intervalLabel } from "../src/care";
import { preventionTips } from "../src/ai";
import { dictionaries } from "../src/i18n";
import { exportAll, importAll } from "../src/backup";

const de = dictionaries.de;
const en = dictionaries.en;

describe("intervals and due dates", () => {
  it("labels intervals in words", () => {
    expect(intervalLabel(7, de)).toBe("wöchentlich");
    expect(intervalLabel(30, de)).toBe("monatlich");
    expect(intervalLabel(90, de)).toBe("alle 3 Monate");
    expect(intervalLabel(91, en)).toBe("every 3 months");
    expect(intervalLabel(365, en)).toBe("yearly");
    expect(intervalLabel(14, en)).toBe("every 2 weeks");
    expect(intervalLabel(10, en)).toBe("every 10 days");
  });
  it("counts calendar days, not 24-hour blocks", () => {
    const now = new Date(2026, 10, 27, 23, 0).getTime();
    expect(daysUntil(new Date(2026, 10, 28, 1, 0).getTime(), now)).toBe(1);
    expect(dueLabel(new Date(2026, 10, 27, 8, 0).getTime(), de, now)).toBe("heute fällig");
    expect(dueLabel(new Date(2026, 10, 24).getTime(), de, now)).toBe("seit 3 Tagen fällig");
    expect(bucket(now - DAY, now)).toBe("overdue");
    expect(bucket(now + 10 * DAY, now)).toBe("soon");
    expect(bucket(now + 30 * DAY, now)).toBe("later");
  });
});

describe("tasks", () => {
  it("moves the next due date when marked done and keeps a log", async () => {
    const id = await addTask({ title: "Entkalken", intervalDays: 90 });
    const before = Date.now();
    await markTaskDone(id);
    const t = (await db.tasks.get(id))!;
    expect(t.doneLog).toHaveLength(1);
    expect(t.nextDue).toBeGreaterThanOrEqual(before + 90 * DAY);
  });
  it("are included in backups", async () => {
    await db.tasks.clear();
    await addTask({ title: "Tisch ölen", intervalDays: 180 });
    const json = await exportAll();
    await db.tasks.clear();
    await importAll(json);
    expect((await db.tasks.toArray()).map((t) => t.title)).toEqual(["Tisch ölen"]);
  });
});

describe("deleteRepair", () => {
  it("removes the repair and its own photos, but not the item's photos", async () => {
    const f = (n: number) => db.files.add({ blob: new Blob([String(n)]), name: `${n}`, type: "image/jpeg", createdAt: 1 }) as Promise<number>;
    const itemPhoto = await f(1);
    const problemPhoto = await f(2);
    const chatPhoto = await f(3);
    const id = (await db.repairs.add({
      title: "x", problem: "x", photoIds: [problemPhoto], itemPhotoIds: [itemPhoto], includeManual: false,
      contextSnapshot: "", history: [], chat: [{ role: "user", text: "?", photoIds: [chatPhoto] }],
      stepsDone: [], status: "open", costUsd: 0, createdAt: 1, updatedAt: 1,
    })) as number;
    await deleteRepair(id);
    expect(await db.repairs.get(id)).toBeUndefined();
    expect(await db.files.get(problemPhoto)).toBeUndefined();
    expect(await db.files.get(chatPhoto)).toBeUndefined();
    expect(await db.files.get(itemPhoto)).toBeDefined();
  });
});

describe("preventionTips", () => {
  it("reads both the old (text) and new (with interval) format", () => {
    expect(preventionTips({ prevention: ["Entkalken"] })).toEqual([{ tip: "Entkalken", interval_days: 0 }]);
    expect(preventionTips({ prevention: [{ tip: "Entkalken", interval_days: 90 }] })).toEqual([{ tip: "Entkalken", interval_days: 90 }]);
    expect(preventionTips({})).toEqual([]);
  });
});

describe("translations", () => {
  it("German has every English key", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });
});
