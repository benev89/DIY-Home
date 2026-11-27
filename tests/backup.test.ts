import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { db, setSetting } from "../src/db";
import { exportAll, importAll } from "../src/backup";

describe("backup", () => {
  it("round-trips data and files, and never exports the API key", async () => {
    const areaId = await db.areas.add({ name: "Bike", icon: "🚲", order: 0 });
    const fileId = await db.files.add({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), name: "a.jpg", type: "image/jpeg", createdAt: 1 });
    await db.items.add({ areaId, name: "City bike", photoIds: [fileId], createdAt: 1, updatedAt: 1 });
    await setSetting("apiKey", "sk-ant-secret");
    await setSetting("region", "Germany");

    const json = await exportAll();
    expect(json).not.toContain("sk-ant-secret");

    await db.items.clear();
    await db.files.clear();
    await importAll(json);

    const items = await db.items.toArray();
    expect(items.map((i) => i.name)).toEqual(["City bike"]);
    const file = await db.files.get(fileId);
    expect(new Uint8Array(await file!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await db.settings.get("apiKey"))?.value).toBe("sk-ant-secret"); // this device keeps its key
    expect((await db.settings.get("region"))?.value).toBe("Germany");
  });

  it("rejects files that are not backups", async () => {
    await expect(importAll('{"hello":1}')).rejects.toThrow(/not a DIY Home backup/);
  });
});
