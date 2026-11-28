// Export / import all data as one JSON file. Photos and PDFs are embedded as base64.
import { db } from "./db";

const FORMAT = "diy-home-backup";
const VERSION = 1;
// Never put API keys into a backup file. The push address belongs to this phone only.
// (The server id + secret do go into the backup, so a restored phone keeps the same calendar feed.)
const PRIVATE_SETTINGS = new Set(["apiKey", "geminiKey", "pushSub", "pushEnabled"]);

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function dataUrlToBlob(url: string): Blob {
  const [head, data] = url.split(",", 2);
  const type = head.slice(5).replace(";base64", "");
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportAll(): Promise<string> {
  const files = await db.files.toArray();
  const backup = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    areas: await db.areas.toArray(),
    items: await db.items.toArray(),
    tools: await db.tools.toArray(),
    repairs: await db.repairs.toArray(),
    usage: await db.usage.toArray(),
    tasks: await db.tasks.toArray(),
    settings: (await db.settings.toArray()).filter((s) => !PRIVATE_SETTINGS.has(s.key)),
    files: await Promise.all(
      files.map(async (f) => ({ id: f.id, name: f.name, type: f.type, createdAt: f.createdAt, data: await blobToDataUrl(f.blob) })),
    ),
  };
  return JSON.stringify(backup);
}

export async function importAll(json: string): Promise<void> {
  const b = JSON.parse(json);
  if (b?.format !== FORMAT) throw new Error("This is not a DIY Home backup file.");
  if (b.version > VERSION) throw new Error("This backup is from a newer version of the app.");
  const tables = [db.areas, db.items, db.tools, db.repairs, db.usage, db.settings, db.files, db.tasks];
  await db.transaction("rw", tables, async () => {
    const keep = (await db.settings.toArray()).filter((x) => PRIVATE_SETTINGS.has(x.key)); // this device's keys
    await Promise.all(tables.map((t) => t.clear()));
    await db.areas.bulkAdd(b.areas);
    await db.items.bulkAdd(b.items);
    await db.tools.bulkAdd(b.tools);
    await db.repairs.bulkAdd(b.repairs);
    await db.usage.bulkAdd(b.usage ?? []);
    await db.tasks.bulkAdd(b.tasks ?? []);
    await db.settings.bulkPut(b.settings);
    await db.settings.bulkPut(keep);
    await db.files.bulkAdd(
      b.files.map((f: { id: number; name: string; type: string; createdAt: number; data: string }) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        createdAt: f.createdAt,
        blob: dataUrlToBlob(f.data),
      })),
    );
  });
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
