// The repair workflow: start a repair, ask follow-ups, "think harder".
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { buildContext, buildFirstMessage, diagnose, followUp, MODELS, type AiResult, type ModelId } from "./ai";
import { db, getSetting, type Repair } from "./db";
import type { Lang } from "./i18n";

async function aiSettings() {
  return {
    apiKey: await getSetting("apiKey", ""),
    lang: await getSetting<Lang>("lang", "en"),
    region: await getSetting("region", ""),
  };
}

async function recordUsage(r: AiResult<unknown>) {
  await db.usage.add({
    at: Date.now(),
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
  });
}

async function firstMessage(repair: Repair): Promise<MessageParam> {
  const photos = (await db.files.bulkGet(repair.photoIds)).filter((f) => !!f).map((f) => f!.blob);
  let manual: Blob | undefined;
  if (repair.includeManual && repair.itemId) {
    const item = await db.items.get(repair.itemId);
    if (item?.manualFileId) manual = (await db.files.get(item.manualFileId))?.blob;
  }
  return buildFirstMessage(repair.contextSnapshot, photos, manual);
}

/** Create a repair from the form, ask the AI for a diagnosis, save everything. Returns the repair id. */
export async function startRepair(input: {
  itemId?: number;
  problem: string;
  photoIds: number[];
  includeManual: boolean;
}): Promise<number> {
  const s = await aiSettings();
  const item = input.itemId ? await db.items.get(input.itemId) : undefined;
  const area = item ? await db.areas.get(item.areaId) : undefined;
  const past = item ? await db.repairs.where("itemId").equals(item.id!).toArray() : [];
  const tools = await db.tools.toArray();

  const contextSnapshot = buildContext({
    item: item && {
      name: item.name,
      area: area?.name,
      brand: item.brand,
      model: item.model,
      purchased: item.purchased,
      specs: item.specs,
      notes: item.notes,
    },
    pastRepairs: past.map((r) => ({
      title: r.title,
      status: r.status,
      outcome: r.outcome,
      date: new Date(r.createdAt).toISOString().slice(0, 10),
    })),
    tools: tools.filter((t) => t.kind === "tool").map((t) => t.name + (t.notes ? ` (${t.notes})` : "")),
    supplies: tools.filter((t) => t.kind === "supply").map((t) => t.name + (t.notes ? ` (${t.notes})` : "")),
    problem: input.problem,
  });

  const now = Date.now();
  const repair: Repair = {
    itemId: input.itemId,
    title: input.problem.slice(0, 60),
    problem: input.problem,
    photoIds: input.photoIds,
    includeManual: input.includeManual,
    contextSnapshot,
    history: [],
    chat: [],
    stepsDone: [],
    status: "open",
    costUsd: 0,
    createdAt: now,
    updatedAt: now,
  };
  // Ask the AI before saving, so a failed call (no key, offline) doesn't leave an empty repair behind.
  const res = await diagnose({ ...s, model: MODELS.fast, messages: [await firstMessage(repair)] });
  await recordUsage(res);
  repair.diagnosis = res.value;
  repair.title = res.value.title;
  repair.history = [res.assistantTurn];
  repair.costUsd = res.costUsd;
  return (await db.repairs.add(repair)) as number;
}

export async function askFollowUp(repairId: number, question: string, model: ModelId = MODELS.fast): Promise<void> {
  const s = await aiSettings();
  const repair = (await db.repairs.get(repairId))!;
  const userTurn: MessageParam = { role: "user", content: question };
  const res = await followUp({ ...s, model, messages: [await firstMessage(repair), ...repair.history, userTurn] });
  await recordUsage(res);
  await db.repairs.update(repairId, {
    history: [...repair.history, userTurn, res.assistantTurn],
    chat: [...repair.chat, { role: "user", text: question }, { role: "assistant", text: res.value, model }],
    costUsd: repair.costUsd + res.costUsd,
    updatedAt: Date.now(),
  });
}

/** Re-run the diagnosis with the stronger model, taking the whole conversation into account. */
export async function thinkHarder(repairId: number): Promise<void> {
  const s = await aiSettings();
  const repair = (await db.repairs.get(repairId))!;
  const prompt =
    s.lang === "de"
      ? "Bitte analysiere das Problem noch einmal gründlich, mit allem, was oben steht, und gib einen neuen, vollständigen Plan."
      : "Please re-analyse this problem thoroughly, using everything above, and give a new complete plan.";
  const userTurn: MessageParam = { role: "user", content: prompt };
  const res = await diagnose({
    ...s,
    model: MODELS.strong,
    messages: [await firstMessage(repair), ...repair.history, userTurn],
  });
  await recordUsage(res);
  await db.repairs.update(repairId, {
    diagnosis: res.value,
    history: [...repair.history, userTurn, res.assistantTurn],
    stepsDone: [],
    costUsd: repair.costUsd + res.costUsd,
    updatedAt: Date.now(),
  });
}
