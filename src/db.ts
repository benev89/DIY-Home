// Local database (IndexedDB via Dexie). Everything lives on this device only.
import Dexie, { type EntityTable } from "dexie";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Diagnosis } from "./ai";

export interface Area {
  id?: number;
  name: string;
  icon: string;
  order: number;
}

export interface Item {
  id?: number;
  areaId: number;
  name: string;
  brand?: string;
  model?: string;
  serial?: string;
  purchased?: string; // free text, e.g. "2021" or "2021-05"
  specs?: string; // parts it uses: "Filter: XY-123, bulb: E27 LED"
  notes?: string;
  manualUrl?: string;
  manualFileId?: number; // a PDF stored in `files`
  photoIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface Tool {
  id?: number;
  name: string;
  kind: "tool" | "supply";
  notes?: string;
}

export interface StoredFile {
  id?: number;
  blob: Blob;
  name: string;
  type: string;
  createdAt: number;
}

export type RepairStatus = "open" | "fixed" | "not_fixed" | "pro";

export interface Repair {
  id?: number;
  itemId?: number;
  title: string;
  problem: string;
  photoIds: number[];
  includeManual: boolean;
  /** Exact text of the first message sent to the AI, frozen so follow-ups replay the same history. */
  contextSnapshot: string;
  /** Everything after the first user message: assistant replies (raw content blocks) and follow-up questions. */
  history: MessageParam[];
  /** Readable view of the conversation for the UI. */
  chat: { role: "user" | "assistant"; text: string; model?: string }[];
  diagnosis?: Diagnosis;
  stepsDone: number[];
  status: RepairStatus;
  outcome?: string;
  costUsd: number;
  createdAt: number;
  updatedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface UsageEntry {
  id?: number;
  at: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const db = new Dexie("diy-home") as Dexie & {
  areas: EntityTable<Area, "id">;
  items: EntityTable<Item, "id">;
  tools: EntityTable<Tool, "id">;
  files: EntityTable<StoredFile, "id">;
  repairs: EntityTable<Repair, "id">;
  settings: EntityTable<Setting, "key">;
  usage: EntityTable<UsageEntry, "id">;
};

db.version(1).stores({
  areas: "++id, order",
  items: "++id, areaId, name, updatedAt",
  tools: "++id, kind, name",
  files: "++id",
  repairs: "++id, itemId, status, createdAt",
  settings: "key",
  usage: "++id, at",
});

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function saveFile(blob: Blob, name: string): Promise<number> {
  return (await db.files.add({ blob, name, type: blob.type, createdAt: Date.now() })) as number;
}

/** Delete an item together with its photos and manual. Repairs are kept (history), just unlinked. */
export async function deleteItem(id: number): Promise<void> {
  await db.transaction("rw", db.items, db.files, db.repairs, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    await db.files.bulkDelete([...item.photoIds, ...(item.manualFileId ? [item.manualFileId] : [])]);
    await db.repairs.where("itemId").equals(id).modify({ itemId: undefined });
    await db.items.delete(id);
  });
}

export const DEFAULT_AREAS: Record<"en" | "de", [string, string][]> = {
  en: [
    ["🛁", "Bathroom"],
    ["🍳", "Kitchen"],
    ["🛋️", "Living room"],
    ["🛏️", "Bedroom"],
    ["🧺", "Utility & laundry"],
    ["🚲", "Bike"],
    ["🌱", "Balcony & garden"],
  ],
  de: [
    ["🛁", "Bad"],
    ["🍳", "Küche"],
    ["🛋️", "Wohnzimmer"],
    ["🛏️", "Schlafzimmer"],
    ["🧺", "Hauswirtschaft & Wäsche"],
    ["🚲", "Fahrrad"],
    ["🌱", "Balkon & Garten"],
  ],
};

/** On first launch, create a sensible set of areas so the app isn't empty. */
export async function seedIfEmpty(lang: "en" | "de"): Promise<void> {
  const seeded = await getSetting("seeded", false);
  if (seeded) return;
  await db.areas.bulkAdd(DEFAULT_AREAS[lang].map(([icon, name], order) => ({ icon, name, order })));
  await setSetting("seeded", true);
}
