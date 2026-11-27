// Maintenance suggestions from the AI, stored on each item.
import { buildContext, suggestCare } from "./ai";
import { db, getSetting } from "./db";
import type { Lang } from "./i18n";

const running = new Map<number, Promise<void>>();

/** Fetch care suggestions for one item (once; about 0.05 cents). Safe to call repeatedly. */
export function loadCareSuggestions(itemId: number, force = false): Promise<void> {
  const existing = running.get(itemId);
  if (existing) return existing;
  const job = (async () => {
    const it = await db.items.get(itemId);
    const apiKey = await getSetting("apiKey", "");
    if (!it || !apiKey || (it.careSuggestions && !force)) return;
    const area = await db.areas.get(it.areaId);
    const itemText = buildContext({
      item: { name: it.name, area: area?.name, brand: it.brand, model: it.model, purchased: it.purchased, specs: it.specs, notes: it.notes },
      pastRepairs: [],
      tools: [],
      supplies: [],
      problem: "(none – this is about regular maintenance)",
    });
    const photo = it.photoIds[0] ? (await db.files.get(it.photoIds[0]))?.blob : undefined;
    const res = await suggestCare({
      apiKey,
      lang: await getSetting<Lang>("lang", "en"),
      region: await getSetting("region", ""),
      itemText,
      photos: photo ? [photo] : [],
    });
    await db.usage.add({ at: Date.now(), model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd });
    await db.items.update(itemId, {
      careSuggestions: res.value.tasks.map((x) => ({ title: x.title, how: x.how, intervalDays: Math.max(1, Math.round(x.interval_days)) })),
    });
  })().finally(() => running.delete(itemId));
  running.set(itemId, job);
  return job;
}

/** Make sure every item has suggestions, one after another. Returns how many failed. */
export async function loadMissingCareSuggestions(onProgress?: (left: number) => void): Promise<number> {
  const missing = (await db.items.toArray()).filter((i) => !i.careSuggestions && i.name);
  let failed = 0;
  for (let i = 0; i < missing.length; i++) {
    onProgress?.(missing.length - i);
    try {
      await loadCareSuggestions(missing[i].id!);
    } catch {
      failed++;
    }
  }
  onProgress?.(0);
  return failed;
}
