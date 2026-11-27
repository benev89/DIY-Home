// The repair workflow: start a repair, ask follow-ups, "think harder".
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import {
  blobToBase64,
  buildContext,
  buildFirstMessage,
  diagnose,
  followUp,
  MODELS,
  errorCodes,
  researchProblem,
  type Research,
  type AiResult,
  type ModelId,
} from "./ai";
import { db, getSetting, setSetting, type Repair } from "./db";
import { norm } from "./toolMatch";
import { underWarranty } from "./warranty";

const RESEARCH_CACHE_MS = 180 * 24 * 60 * 60 * 1000;
import type { Lang } from "./i18n";

// Photos in follow-up questions are saved as a reference ("file:12") instead of the image
// data itself, so the database stays small. hydrate() swaps in the real image before sending.
const FILE_REF = "file:";
const MAX_ITEM_PHOTOS = 3;

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

async function blobs(ids: number[]): Promise<Blob[]> {
  return (await db.files.bulkGet(ids)).filter((f) => !!f).map((f) => f!.blob);
}

async function firstMessage(repair: Repair): Promise<MessageParam> {
  let manual: Blob | undefined;
  if (repair.includeManual && repair.itemId) {
    const item = await db.items.get(repair.itemId);
    if (item?.manualFileId) manual = (await db.files.get(item.manualFileId))?.blob;
  }
  const itemPhotos = repair.itemPhotoIds === undefined ? undefined : await blobs(repair.itemPhotoIds);
  return buildFirstMessage(repair.contextSnapshot, await blobs(repair.photoIds), manual, itemPhotos);
}

export async function hydrate(messages: MessageParam[]): Promise<MessageParam[]> {
  return Promise.all(
    messages.map(async (m) => {
      if (typeof m.content === "string") return m;
      const content = await Promise.all(
        m.content.map(async (b): Promise<ContentBlockParam> => {
          if (b.type === "image" && b.source.type === "base64" && b.source.data.startsWith(FILE_REF)) {
            const file = await db.files.get(Number(b.source.data.slice(FILE_REF.length)));
            if (!file) return { type: "text", text: "[photo was deleted]" };
            return { ...b, source: { ...b.source, data: await blobToBase64(file.blob) } };
          }
          return b;
        }),
      );
      return { ...m, content } as MessageParam;
    }),
  );
}

/** Create a repair from the form, ask the AI for a diagnosis, save everything. Returns the repair id. */
export async function startRepair(input: {
  itemId?: number;
  problem: string;
  photoIds: number[];
  includeManual: boolean;
  /** Look the problem up on the web first (error codes, model-specific fixes). */
  research?: boolean;
  onStage?: (stage: "research" | "diagnose") => void;
}): Promise<number> {
  const s = await aiSettings();
  const item = input.itemId ? await db.items.get(input.itemId) : undefined;
  const area = item ? await db.areas.get(item.areaId) : undefined;
  const past = item ? await db.repairs.where("itemId").equals(item.id!).toArray() : [];
  const tools = await db.tools.toArray();

  let research: Research | undefined;
  let researchCost = 0;
  if (input.research) {
    input.onStage?.("research");
    // Same model + same error code = same answer: reuse an earlier lookup for free.
    const codes = errorCodes(input.problem);
    const cacheKey = item?.model && codes.length ? `research:${norm(`${item.brand ?? ""} ${item.model}`)}|${codes.join(",")}|${s.lang}` : undefined;
    const cached = cacheKey ? await getSetting<{ value: Research; at: number } | null>(cacheKey, null) : null;
    if (cached && Date.now() - cached.at < RESEARCH_CACHE_MS) {
      research = cached.value;
    } else {
      const r = await researchProblem({
        ...s,
        item: item && { name: item.name, brand: item.brand, model: item.model },
        problem: input.problem,
      });
      await recordUsage(r);
      research = r.value;
      researchCost = r.costUsd;
      if (cacheKey) await setSetting(cacheKey, { value: research, at: Date.now() });
    }
  }
  input.onStage?.("diagnose");

  const contextSnapshot = buildContext({
    item: item && {
      name: item.name,
      area: area?.name,
      brand: item.brand,
      model: item.model,
      purchased: item.purchased,
      specs: item.specs,
      notes: item.notes,
      warrantyUntil: item.warrantyUntil,
      underWarranty: underWarranty(item),
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
    research: research && `${research.summary}\n${research.sources.map((x) => `- Source: ${x.title} (${x.url})`).join("\n")}`,
  });

  const now = Date.now();
  const repair: Repair = {
    itemId: input.itemId,
    title: input.problem.slice(0, 60),
    problem: input.problem,
    photoIds: input.photoIds,
    itemPhotoIds: (item?.photoIds ?? []).slice(0, MAX_ITEM_PHOTOS),
    includeManual: input.includeManual,
    research,
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
  repair.costUsd = researchCost + res.costUsd;
  return (await db.repairs.add(repair)) as number;
}

export async function askFollowUp(
  repairId: number,
  question: string,
  model: ModelId = MODELS.fast,
  photoIds: number[] = [],
): Promise<void> {
  const s = await aiSettings();
  const repair = (await db.repairs.get(repairId))!;
  const userTurn: MessageParam = photoIds.length
    ? {
        role: "user",
        content: [
          ...photoIds.map(
            (id): ContentBlockParam => ({
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: `${FILE_REF}${id}` },
            }),
          ),
          { type: "text", text: question },
        ],
      }
    : { role: "user", content: question };
  const messages = [await firstMessage(repair), ...(await hydrate([...repair.history, userTurn]))];
  const res = await followUp({ ...s, model, messages });
  await recordUsage(res);
  await db.repairs.update(repairId, {
    history: [...repair.history, userTurn, res.assistantTurn],
    chat: [...repair.chat, { role: "user", text: question, photoIds }, { role: "assistant", text: res.value, model }],
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
      ? "Bitte analysiere das Problem noch einmal gründlich, mit allem, was oben steht (auch allen Fotos), und gib einen neuen, vollständigen Plan."
      : "Please re-analyse this problem thoroughly, using everything above (including all photos), and give a new complete plan.";
  const userTurn: MessageParam = { role: "user", content: prompt };
  const res = await diagnose({
    ...s,
    model: MODELS.strong,
    messages: [await firstMessage(repair), ...(await hydrate([...repair.history, userTurn]))],
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
