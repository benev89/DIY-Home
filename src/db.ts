// Local database (IndexedDB via Dexie). Everything lives on this device only.
import Dexie, { type EntityTable } from "dexie";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Diagnosis, Research } from "./ai";

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
  /** When the AI last searched the web for the manual (so it doesn't search again and again). */
  manualSearchedAt?: number;
  /** Maintenance ideas from the AI, shown as tap-to-add suggestions. */
  careSuggestions?: CareSuggestion[];
  /** Warranty end date, "YYYY-MM-DD". */
  warrantyUntil?: string;
  /** Photos of the receipt (needed for warranty claims). */
  receiptPhotoIds?: number[];
  photoIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface CareSuggestion {
  title: string;
  how: string;
  intervalDays: number;
}

/** A recurring maintenance job, e.g. "Descale the kettle every 90 days". */
export interface Task {
  id?: number;
  itemId?: number;
  title: string;
  how?: string;
  intervalDays: number;
  nextDue: number;
  lastDone?: number;
  doneLog: number[];
  /** Stop calendar entries and push reminders after this date ("YYYY-MM-DD"), e.g. when you plan to replace the device. */
  remindUntil?: string;
  createdAt: number;
}

export const DAY = 24 * 60 * 60 * 1000;

export interface Tool {
  id?: number;
  /** Id of the suggestion in toolCatalog.ts, if picked from the suggestions. */
  key?: string;
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
  /** Item photos sent with the first message (snapshot). Undefined for repairs from v0.1. */
  itemPhotoIds?: number[];
  includeManual: boolean;
  /** Exact text of the first message sent to the AI, frozen so follow-ups replay the same history. */
  contextSnapshot: string;
  /** Everything after the first user message: assistant replies (raw content blocks) and follow-up questions. */
  history: MessageParam[];
  /** Readable view of the conversation for the UI. */
  chat: { role: "user" | "assistant"; text: string; model?: string; photoIds?: number[] }[];
  diagnosis?: Diagnosis;
  /** What a web search found before the diagnosis (error codes, model-specific fixes). */
  research?: Research;
  stepsDone: number[];
  /** Where you are in workshop mode. */
  currentStep?: number;
  /** Parts from the shopping list marked as bought. */
  boughtParts?: string[];
  status: RepairStatus;
  outcome?: string;
  costUsd: number;
  createdAt: number;
  updatedAt: number;
}

/** A running countdown in workshop mode ("let the silicone dry 30 min"). */
export interface Timer {
  id?: number;
  repairId?: number;
  step?: number;
  label: string;
  endsAt: number;
  durationMs: number;
  /** Set when the time is up and you've seen it. */
  finished?: boolean;
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
  tasks: EntityTable<Task, "id">;
  timers: EntityTable<Timer, "id">;
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
// v2: maintenance tasks. Dexie upgrades existing databases automatically; nothing is lost.
db.version(2).stores({
  tasks: "++id, itemId, nextDue",
});
// v3: workshop timers
db.version(3).stores({
  timers: "++id, repairId, endsAt",
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

/** Delete an item with its photos, manual and maintenance tasks. Repairs are kept (history), just unlinked. */
export async function deleteItem(id: number): Promise<void> {
  await db.transaction("rw", [db.items, db.files, db.repairs, db.tasks], async () => {
    const item = await db.items.get(id);
    if (!item) return;
    await db.files.bulkDelete([...item.photoIds, ...(item.manualFileId ? [item.manualFileId] : [])]);
    await db.repairs.where("itemId").equals(id).modify({ itemId: undefined });
    await db.tasks.where("itemId").equals(id).delete();
    await db.items.delete(id);
  });
}

/** Delete a repair and the photos that belong only to it (not the item's photos). */
export async function deleteRepair(id: number): Promise<void> {
  await db.transaction("rw", db.repairs, db.files, async () => {
    const r = await db.repairs.get(id);
    if (!r) return;
    await db.files.bulkDelete([...r.photoIds, ...r.chat.flatMap((m) => m.photoIds ?? [])]);
    await db.repairs.delete(id);
  });
}

export async function addTask(t: { itemId?: number; title: string; how?: string; intervalDays: number }): Promise<number> {
  const now = Date.now();
  return (await db.tasks.add({ ...t, nextDue: now + t.intervalDays * DAY, doneLog: [], createdAt: now })) as number;
}

export async function markTaskDone(id: number): Promise<void> {
  const t = await db.tasks.get(id);
  if (!t) return;
  const now = Date.now();
  await db.tasks.update(id, { lastDone: now, nextDue: now + t.intervalDays * DAY, doneLog: [...t.doneLog, now] });
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
