// Find an item's manual automatically and save the link on the item.
import { findManualUrl } from "./ai";
import { db, getSetting } from "./db";
import type { Lang } from "./i18n";

export async function autoFindManual(itemId: number): Promise<{ url: string; title: string } | null> {
  const item = await db.items.get(itemId);
  const apiKey = await getSetting("apiKey", "");
  if (!item || !apiKey || !(item.brand || item.model)) return null;
  const res = await findManualUrl({
    apiKey,
    lang: await getSetting<Lang>("lang", "en"),
    name: item.name,
    brand: item.brand,
    model: item.model,
  });
  await db.usage.add({ at: Date.now(), model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd });
  const fresh = await db.items.get(itemId);
  await db.items.update(itemId, {
    manualSearchedAt: Date.now(),
    // Never overwrite a link the user entered while we were searching.
    ...(res.value && !fresh?.manualUrl ? { manualUrl: res.value.url } : {}),
  });
  return res.value;
}
