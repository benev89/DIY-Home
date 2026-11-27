import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { buildFirstMessage } from "../src/ai";
import { CATALOG, orderedGroups } from "../src/toolCatalog";
import { db } from "../src/db";
import { hydrate } from "../src/repairs";

const jpeg = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });

describe("tool catalog", () => {
  it("has unique keys and both languages for every entry", () => {
    const keys = CATALOG.flatMap((g) => g.entries.map((e) => e.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of CATALOG.flatMap((g) => g.entries)) {
      expect(e.en.trim()).not.toBe("");
      expect(e.de.trim()).not.toBe("");
    }
  });
  it("shows basics first, then groups matching your home", () => {
    expect(orderedGroups([]).map((g) => g.id).slice(0, 2)).toEqual(["basics", "power"]);
    expect(orderedGroups(["Fahrrad", "Stadtrad"]).map((g) => g.id).slice(0, 2)).toEqual(["basics", "bike"]);
  });
});

describe("buildFirstMessage", () => {
  it("keeps the old layout for repairs saved before item photos existed", async () => {
    const m = await buildFirstMessage("ctx", [jpeg([1])]);
    expect((m.content as { type: string }[]).map((b) => b.type)).toEqual(["image", "text"]);
  });
  it("labels item photos and problem photos for new repairs", async () => {
    const m = await buildFirstMessage("ctx", [jpeg([1])], undefined, [jpeg([2]), jpeg([3])]);
    const blocks = m.content as { type: string; text?: string }[];
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "image", "text", "image", "text"]);
    expect(blocks[0].text).toMatch(/inventory/);
    expect(blocks[3].text).toMatch(/problem/);
  });
  it("omits labels when there are no photos at all", async () => {
    const m = await buildFirstMessage("ctx", [], undefined, []);
    expect(m.content).toEqual([{ type: "text", text: "ctx" }]);
  });
});

describe("hydrate", () => {
  it("swaps photo references for image data, and survives deleted photos", async () => {
    const id = (await db.files.add({ blob: jpeg([7, 8, 9]), name: "q.jpg", type: "image/jpeg", createdAt: 1 })) as number;
    const [m] = await hydrate([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: `file:${id}` } },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "file:99999" } },
          { type: "text", text: "Is this the cartridge?" },
        ],
      },
    ]);
    const blocks = m.content as { type: string; source?: { data: string }; text?: string }[];
    expect(blocks[0].source!.data).toBe(btoa(String.fromCharCode(7, 8, 9)));
    expect(blocks[1]).toEqual({ type: "text", text: "[photo was deleted]" });
    expect(blocks[2].text).toBe("Is this the cartridge?");
  });
});
