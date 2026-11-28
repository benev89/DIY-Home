// Everything that talks to Claude lives here.
//
// How it works:
// 1. We build a "context" text from what the app knows: the item (brand, model, parts),
//    its past repairs, and the tools you own.
// 2. We send that + your problem description + photos (+ optional manual PDF) to Claude.
// 3. The first answer comes back as structured JSON (a Diagnosis), so the app can render
//    a checklist instead of a wall of text. Follow-up questions get plain text answers.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ContentBlockParam, Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import type { Lang } from "./i18n";
import { CATALOG } from "./toolCatalog";
import { geminiSearch, urlMatchesSources, type GeminiGrounded } from "./gemini";

// Cheap default model, plus a stronger one for the "Think harder" button.
export const MODELS = {
  fast: "claude-haiku-5-5",
  strong: "claude-sonnet-5-5",
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];

// USD per million tokens (input, output). Used to show you what each question cost.
// Haiku 5.5's price applies to prompts up to 100K tokens; above that it is $0.50 / $2.50.
const PRICES: Record<ModelId, { input: number; output: number; longInput?: number; longOutput?: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export function costUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  const long = inputTokens > 100_000 && p.longInput !== undefined;
  const inPrice = long ? p.longInput! : p.input;
  const outPrice = long ? p.longOutput! : p.output;
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}

export const DiagnosisSchema = z.object({
  title: z.string().describe("Short name for this repair, max 6 words, e.g. 'Dripping kitchen tap'"),
  summary: z.string().describe("2-3 sentences: what is most likely going on and the plan."),
  safety: z.object({
    level: z
      .enum(["ok", "caution", "stop"])
      .describe("stop = the user must not do this themselves; caution = doable with care"),
    notes: z.array(z.string()).describe("Concrete safety instructions, e.g. 'Switch off the circuit breaker'"),
  }),
  questions: z
    .array(z.string())
    .describe("Up to 3 questions whose answers would change the diagnosis. Empty if none."),
  checks_first: z
    .array(z.string())
    .describe("Quick, zero-cost things to check before any repair (e.g. is the filter clogged?)"),
  causes: z.array(
    z.object({
      cause: z.string(),
      likelihood: z.enum(["high", "medium", "low"]),
      how_to_check: z.string(),
    }),
  ),
  steps: z.array(
    z.object({
      title: z.string().describe("Short imperative, e.g. 'Turn off the water under the sink'"),
      detail: z.string().describe("Exactly how to do it, including what it should look like"),
      warning: z.string().describe("A specific risk in this step, or empty string"),
      wait_minutes: z
        .number()
        .describe("If this step means waiting (soaking, drying, curing, cooling down, letting descaler work): minutes to wait. Else 0"),
    }),
  ),
  tools: z.array(
    z.object({
      name: z.string(),
      owned: z.boolean().describe("true only if it is in the user's tool list"),
      owned_as: z
        .string()
        .describe("If owned: the exact entry from the user's tool or supply list that covers it, copied verbatim. Else empty."),
      catalog_key: z.string().describe("Key of the matching entry in the tool catalog (same kind of tool), or empty"),
    }),
  ),
  parts: z.array(
    z.object({
      name: z.string(),
      spec: z.string().describe("Exact size/type/part number if known, else what to measure or look for"),
      price_estimate: z.string().describe("Rough price range in local currency, e.g. '5-15 €'"),
      catalog_key: z.string().describe("Key of the matching entry in the tool catalog if this is a common supply (e.g. descaler), else empty"),
    }),
  ),
  difficulty: z.enum(["easy", "medium", "hard"]),
  minutes: z.number().describe("Estimated working time in minutes"),
  stop_and_call_pro_if: z.string().describe("The specific signs that mean: stop and call a professional"),
  prevention: z
    .array(
      z.object({
        tip: z.string().describe("Concrete habit or maintenance step, e.g. 'Descale the aerator'"),
        interval_days: z
          .number()
          .describe("If this should be repeated: how often, in days (e.g. 90). 0 for a one-off or a habit"),
      }),
    )
    .describe("How to keep this from happening again"),
});
/** Repairs saved before v0.3 have prevention as plain strings. */
export type PreventionTip = { tip: string; interval_days: number };
export function preventionTips(d: { prevention?: unknown }): PreventionTip[] {
  if (!Array.isArray(d.prevention)) return [];
  return d.prevention.map((p) => (typeof p === "string" ? { tip: p, interval_days: 0 } : (p as PreventionTip)));
}
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export function systemPrompt(lang: Lang, region: string): string {
  const language = lang === "de" ? "German" : "English";
  return `You are an experienced, practical home-repair helper (plumbing, appliances, furniture, bikes, walls, doors, windows, small electrics). You help one person fix things in their own home.

How to help:
- Use what you know about their item (brand, model, parts, past repairs) and their tools. Prefer a plan that uses tools they already have; if a tool is missing, say so and suggest a cheap alternative if one is safe.
- Rank causes from most to least likely. Always start with the quick, free checks.
- Steps must be concrete enough to follow with one hand while holding a phone: one action per step, say what to look for, mention the typical screw/fitting type and size when you know it.
- Photos come first: study every photo carefully before anything else and use what it shows (brand, model, label data, part types, damage, limescale, wear). Never ask a question a photo already answers. If something is not visible, say exactly what to photograph next (e.g. "a close-up of the label inside the door").
- If key information is still missing, give the best plan you can and ask up to 3 specific questions.
- Always end with prevention: how to keep this from happening again (habits, cleaning, maintenance intervals).
- Be honest about uncertainty. Do not invent part numbers; if unsure, say what to measure or which label to read.
- Error/fault codes differ between manufacturers and even models. Only state a code's meaning if web research below confirms it or you are certain for this exact model; otherwise say clearly that you are not sure and tell the user to check the manual's error-code table.
- If the item is STILL UNDER WARRANTY: make contacting the seller/manufacturer the first step, and do not suggest opening the device or anything that could void the warranty; only safe outside checks (settings, cleaning filters, resetting).
- If a "Web research" section is given, prefer it over your own memory, and mention when your plan relies on it.

Safety rules (these override everything):
- Set safety.level to "stop" and give no hands-on repair steps beyond making things safe (e.g. close the gas valve, switch off the breaker, open windows, leave the building) for: anything on gas appliances or gas lines; work on the fixed electrical installation (wiring in walls, fuse box, sockets/switches wiring) where local law requires an electrician; load-bearing structures; suspected asbestos; refrigerant circuits; anything at dangerous height without proper equipment.
- For mains-powered appliances, always tell them to unplug or switch off and secure the breaker first. For water, say where to shut it off first.
- For safety-critical bike or vehicle parts (brakes, steering, tyres, quick releases), set level to at least "caution" and include a test before use.
${region ? `- The user lives in: ${region}. Apply that country's rules (e.g. in Germany, work on the fixed electrical installation is for a registered electrician) and use its currency, units and typical shops.` : ""}

Write everything in ${language}. Be concise and friendly; no filler.

Tool catalog (for catalog_key; key = English / German name):
${CATALOG_TEXT}`;
}

const CATALOG_TEXT = CATALOG.flatMap((g) => g.entries.map((e) => `${e.key} = ${e.en} / ${e.de}`)).join("\n");

export interface ContextInput {
  item?: {
    name: string;
    area?: string;
    brand?: string;
    model?: string;
    purchased?: string;
    specs?: string;
    notes?: string;
    warrantyUntil?: string;
    underWarranty?: boolean;
  };
  pastRepairs: { title: string; status: string; outcome?: string; date: string }[];
  tools: string[];
  supplies: string[];
  problem: string;
  research?: string;
}

/** The text part of the first message. Frozen into the repair so follow-ups replay identical history. */
export function buildContext(c: ContextInput): string {
  const lines: string[] = [];
  if (c.item) {
    const i = c.item;
    lines.push("## The item");
    lines.push(`- Name: ${i.name}`);
    if (i.area) lines.push(`- Where: ${i.area}`);
    if (i.brand) lines.push(`- Brand: ${i.brand}`);
    if (i.model) lines.push(`- Model/type: ${i.model}`);
    if (i.purchased) lines.push(`- Bought: ${i.purchased}`);
    if (i.specs) lines.push(`- Parts & sizes: ${i.specs}`);
    if (i.notes) lines.push(`- Notes: ${i.notes}`);
    if (i.warrantyUntil) lines.push(`- Warranty until: ${i.warrantyUntil}${i.underWarranty ? " (STILL UNDER WARRANTY)" : " (expired)"}`);
    if (c.pastRepairs.length) {
      lines.push("", "## Past repairs on this item");
      for (const r of c.pastRepairs) {
        lines.push(`- ${r.date}: ${r.title} (${r.status})${r.outcome ? ` – ${r.outcome}` : ""}`);
      }
    }
  } else {
    lines.push("## The item", "- Not in the user's inventory; infer from the description and photos.");
  }
  lines.push("", "## Tools the user owns", c.tools.length ? c.tools.map((t) => `- ${t}`).join("\n") : "- (none listed)");
  if (c.supplies.length) lines.push("", "## Supplies at home", c.supplies.map((s) => `- ${s}`).join("\n"));
  lines.push("", "## The problem", c.problem.trim());
  if (c.research) lines.push("", "## Web research (done just now for this problem)", c.research.trim());
  return lines.join("\n");
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type ImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
function imageMedia(b: Blob): ImageMedia {
  return (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(b.type) ? b.type : "image/jpeg") as ImageMedia;
}

export async function imageBlock(b: Blob): Promise<ContentBlockParam> {
  return { type: "image", source: { type: "base64", media_type: imageMedia(b), data: await blobToBase64(b) } };
}

/**
 * Build the first user message: optional manual PDF, photos, then the context text.
 * `itemPhotos` is undefined for repairs made before item photos were sent; they keep the
 * old layout so their saved conversation replays byte-for-byte.
 */
export async function buildFirstMessage(
  contextText: string,
  photos: Blob[],
  manualPdf?: Blob,
  itemPhotos?: Blob[],
): Promise<MessageParam> {
  const content: ContentBlockParam[] = [];
  if (manualPdf) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: await blobToBase64(manualPdf) },
      title: "Manual for the item",
    });
  }
  if (itemPhotos === undefined) {
    for (const p of photos) content.push(await imageBlock(p));
  } else {
    if (itemPhotos.length) {
      content.push({ type: "text", text: "Photos of the item from the user's inventory (e.g. its type label):" });
      for (const p of itemPhotos) content.push(await imageBlock(p));
    }
    if (photos.length) {
      content.push({ type: "text", text: "Photos of the problem, taken now:" });
      for (const p of photos) content.push(await imageBlock(p));
    }
  }
  content.push({ type: "text", text: contextText });
  return { role: "user", content };
}

export class RefusalError extends Error {}

function client(apiKey: string) {
  // The key is entered by you and kept on your device. Calling the API straight from the
  // browser is fine for a personal app; never ship a key inside the code.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** Strip SDK-only fields so the assistant turn can be sent back to the API unchanged. */
function toReplayable(message: Message): ContentBlockParam[] {
  return message.content.map((block) => {
    const { parsed_output: _ignored, ...rest } = block as typeof block & { parsed_output?: unknown };
    return rest as ContentBlockParam;
  });
}

export interface AiResult<T> {
  value: T;
  assistantTurn: MessageParam;
  model: ModelId | string; // a Gemini model id when Gemini did the lookup
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function usageOf(model: ModelId, m: Message) {
  const inputTokens =
    m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0);
  const outputTokens = m.usage.output_tokens;
  return { inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) };
}

export async function diagnose(opts: {
  apiKey: string;
  lang: Lang;
  region: string;
  model: ModelId;
  messages: MessageParam[];
}): Promise<AiResult<Diagnosis>> {
  const res = await client(opts.apiKey).messages.parse({
    model: opts.model,
    max_tokens: 16000,
    system: systemPrompt(opts.lang, opts.region),
    output_config: {
      effort: opts.model === MODELS.strong ? "high" : "medium",
      format: zodOutputFormat(DiagnosisSchema),
    },
    messages: opts.messages,
  });
  if (res.stop_reason === "refusal") throw new RefusalError("refusal");
  if (res.stop_reason === "max_tokens") throw new Error("The answer was cut off (too long). Try again.");
  const value = res.parsed_output;
  if (!value) throw new Error("The AI returned an answer the app couldn't read. Try again.");
  return {
    value,
    assistantTurn: { role: "assistant", content: toReplayable(res) },
    model: opts.model,
    ...usageOf(opts.model, res),
  };
}

export async function followUp(opts: {
  apiKey: string;
  lang: Lang;
  region: string;
  model: ModelId;
  messages: MessageParam[];
}): Promise<AiResult<string>> {
  const res = await client(opts.apiKey).messages.create({
    model: opts.model,
    max_tokens: 16000,
    system:
      systemPrompt(opts.lang, opts.region) +
      "\n\nFor follow-up questions, answer in short plain text (no JSON): what to do next, step by step if needed. If the user attached new photos, first say in one sentence what you see in them, then use it.",
    output_config: { effort: opts.model === MODELS.strong ? "high" : "medium" },
    messages: opts.messages,
  });
  if (res.stop_reason === "refusal") throw new RefusalError("refusal");
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    value: text,
    assistantTurn: { role: "assistant", content: toReplayable(res) },
    model: opts.model,
    ...usageOf(opts.model, res),
  };
}

export const IdentifySchema = z.object({
  name: z.string().describe("Short generic name in the user's language, e.g. 'Dishwasher', 'City bike'. Empty if unclear."),
  area: z.string().describe("Exactly one of the given area names that fits best, or empty"),
  brand: z.string().describe("Manufacturer as printed, or empty"),
  model: z.string().describe("Model / type number exactly as printed (e.g. 'SMV4HTX31E'), or empty"),
  serial: z.string().describe("Serial number as printed, or empty"),
  year: z.string().describe("Production or purchase year if printed, or empty"),
  specs: z
    .string()
    .describe("Other useful data READ from the label or obvious from the photo (E-Nr, FD, voltage/power, tyre size, bulb type). Never guess. Empty if none."),
  manual_query: z.string().describe("Best web search query to find the official manual PDF, or empty"),
  comment: z.string().describe("One short sentence: what you could read, or what to photograph instead"),
});
export type Identified = z.infer<typeof IdentifySchema>;

/** Read brand, model etc. from photos of an item (ideally its type label). */
export async function identifyItem(opts: {
  apiKey: string;
  lang: Lang;
  photos: Blob[];
  areaNames: string[];
}): Promise<AiResult<Identified>> {
  const language = opts.lang === "de" ? "German" : "English";
  const content: ContentBlockParam[] = [];
  for (const p of opts.photos) content.push(await imageBlock(p));
  content.push({
    type: "text",
    text: `These photos show something in my home (often its type label). Fill in what you can READ or clearly see. Do not guess numbers. Areas to choose from: ${opts.areaNames.join(", ")}. Write name and comment in ${language}.`,
  });
  const model = MODELS.fast;
  const res = await client(opts.apiKey).messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(IdentifySchema) },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new RefusalError("refusal");
  if (!res.parsed_output) throw new Error("The AI returned an answer the app couldn't read. Try again.");
  return { value: res.parsed_output, assistantTurn: { role: "assistant", content: toReplayable(res) }, model, ...usageOf(model, res) };
}

export const CareSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string().describe("Short imperative, e.g. 'Descale', 'Clean the filter', 'Oil the tabletop'"),
      how: z.string().describe("2-4 short sentences: how to do it, with what (household products, amounts)"),
      interval_days: z.number().describe("How often, in days, for normal household use"),
    }),
  ),
});

/** Suggest a maintenance plan for one item (descaling, cleaning filters, oiling wood…). */
export async function suggestCare(opts: {
  apiKey: string;
  lang: Lang;
  region: string;
  itemText: string;
  photos: Blob[];
}): Promise<AiResult<z.infer<typeof CareSchema>>> {
  const language = opts.lang === "de" ? "German" : "English";
  const content: ContentBlockParam[] = [];
  for (const p of opts.photos) content.push(await imageBlock(p));
  content.push({
    type: "text",
    text: `${opts.itemText}

Suggest the regular maintenance and care this item needs in a normal household (2-6 tasks, most important first). Use the manufacturer's usual recommendations when you know the model; otherwise typical ones for this kind of item and material. Only tasks a non-professional can do safely. ${opts.region ? `The user lives in ${opts.region}.` : ""} Write in ${language}.`,
  });
  const model = MODELS.fast;
  const res = await client(opts.apiKey).messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(CareSchema) },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new RefusalError("refusal");
  if (!res.parsed_output) throw new Error("The AI returned an answer the app couldn't read. Try again.");
  return { value: res.parsed_output, assistantTurn: { role: "assistant", content: toReplayable(res) }, model, ...usageOf(model, res) };
}

type Source = { title: string; url: string };

/**
 * Run one request with the web search tool, continuing if the server pauses the turn.
 * Uses the cheap Haiku model: a lookup costs about 1 cent per search ($10 / 1,000) plus a
 * fraction of a cent for reading the results. Capped at `maxUses` searches.
 */
async function withWebSearch(apiKey: string, prompt: string, maxUses: number) {
  const model = MODELS.fast;
  const messages: MessageParam[] = [{ role: "user", content: prompt }];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  let res: Message | undefined;
  for (let round = 0; round < 3; round++) {
    res = await client(apiKey).messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
      messages,
    });
    const u = usageOf(model, res);
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: toReplayable(res) });
  }
  if (!res || res.stop_reason === "refusal") throw new RefusalError("refusal");
  const textBlocks = res.content.filter((b) => b.type === "text");
  const text = textBlocks.map((b) => b.text).join("");
  // Sources = pages the answer actually cites (they come from real search results).
  const sources: Source[] = [];
  for (const b of textBlocks) {
    for (const c of b.citations ?? []) {
      if (c.type === "web_search_result_location" && !sources.some((x) => x.url === c.url)) {
        sources.push({ title: c.title ?? c.url, url: c.url });
      }
    }
  }
  const cost = costUsd(model, inputTokens, outputTokens) + searches * 0.01; // $10 per 1,000 searches
  return { res, text, sources, model, inputTokens, outputTokens, costUsd: cost };
}

export interface Research {
  summary: string;
  sources: Source[];
  /** Which service searched: "gemini" (free) or "claude". */
  provider?: "gemini" | "claude";
  /** Google Search Suggestions HTML (Google requires showing it with Gemini-grounded answers). */
  suggestionsHtml?: string;
}

/** Ask Gemini first (free) if there is a key; on any refusal, fall back to Claude. */
async function viaGemini<T>(geminiKey: string | undefined, prompt: string, use: (g: GeminiGrounded) => T | null): Promise<AiResult<T> | null> {
  if (!geminiKey) return null;
  try {
    const g = await geminiSearch(geminiKey, prompt);
    const value = use(g);
    if (value === null) return null;
    return { value, assistantTurn: { role: "assistant", content: g.text }, model: g.model, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  } catch (e) {
    console.warn("Gemini lookup failed, using Claude instead:", e);
    return null;
  }
}

/** Look the problem up online first: error codes and model-specific fixes the model may not know. */
export async function researchProblem(opts: {
  apiKey: string;
  lang: Lang;
  region: string;
  item?: { name: string; brand?: string; model?: string };
  problem: string;
  geminiKey?: string;
}): Promise<AiResult<Research>> {
  const language = opts.lang === "de" ? "German" : "English";
  const what = opts.item ? [opts.item.name, opts.item.brand, opts.item.model].filter(Boolean).join(", ") : "(unknown item)";
  const prompt = `Research this home-repair problem online before anyone tries to fix it.
Item: ${what}
Problem: ${opts.problem}
${opts.region ? `Location: ${opts.region}` : ""}

Find what the manufacturer and reliable repair sources say: the exact meaning of any error code for this brand/model, the usual causes and the recommended fix or reset procedure. Prefer the manufacturer's own pages and manuals.
Search at most twice. Then write a factual summary of at most 150 words in ${language}. Say clearly if sources disagree or if nothing specific to this model was found. No advice beyond what the sources say.`;
  const free = await viaGemini(opts.geminiKey, prompt, (g) =>
    g.sources.length ? { summary: g.text, sources: g.sources.slice(0, 5), provider: "gemini" as const, suggestionsHtml: g.suggestionsHtml } : null,
  );
  if (free) return free;
  const r = await withWebSearch(opts.apiKey, prompt, 2);
  return {
    value: { summary: r.text.trim(), sources: r.sources.slice(0, 5), provider: "claude" },
    assistantTurn: { role: "assistant", content: toReplayable(r.res) },
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
  };
}

const ERROR_CODE = /\b(?:[EFHCU]\s?:?-?\s?\d{1,3}|(?:fehlercode|errorcode|error|fehler|code|err)\s*[A-Z]?\s?:?-?\s?\d{1,4})\b/gi;
const stripLampSockets = (text: string) => text.replace(/\bE\s?(14|27|40)\b/gi, ""); // lamp sockets, not error codes

/** Error codes in a text, normalised: "Fehler E:11" → ["E11"], "E011" → ["E011"]. */
export function errorCodes(text: string): string[] {
  const found = stripLampSockets(text).match(ERROR_CODE) ?? [];
  return [...new Set(found.map((c) => c.toUpperCase().replace(/FEHLERCODE|ERRORCODE|ERROR|FEHLER|CODE|ERR|[\s:-]/g, "")))].sort();
}

/** Does the description mention an error code like "E011", "F 21", "Fehler 5", "error E:24"? */
export function mentionsErrorCode(text: string): boolean {
  text = stripLampSockets(text);
  return /\b(?:[EFHCU]\s?:?-?\s?\d{1,3}|(?:fehlercode|errorcode|error|fehler|code|err)\s*[A-Z]?\s?:?-?\s?\d{1,4})\b/i.test(text);
}

/**
 * Search the web for the item's manual and return the best link, or null.
 * Uses the cheap Haiku model with Anthropic's web search tool (about 1-2 cents, once per item).
 */
export async function findManualUrl(opts: {
  apiKey: string;
  lang: Lang;
  name: string;
  brand?: string;
  model?: string;
  geminiKey?: string;
}): Promise<AiResult<{ url: string; title: string } | null>> {
  const what = [opts.brand, opts.model].filter(Boolean).join(" ");
  const prompt = `Find the official user manual or installation instructions for this item: ${opts.name}, ${what}.
Prefer a PDF from the manufacturer's own website, ${opts.lang === "de" ? "in German if available" : "in English if available"}. Next best: a reputable manual site (e.g. manualslib). The model number must match.
Only give a URL that appeared in your search results; never make one up.
Finish your answer with exactly two lines:
URL: <the link, or NONE>
TITLE: <short description, e.g. "Bosch user manual (PDF, German)">`;
  // Gemini's source links are redirects that expire, so we keep the link it names, but only if
  // that website really was among the pages Google returned.
  const free = await viaGemini(opts.geminiKey, prompt, (g) => {
    const url = g.text.match(/URL:\s*(https?:\/\/\S+)/i)?.[1]?.replace(/[)>.,*]+$/, "");
    return url && urlMatchesSources(url, g.sources) ? { url, title: g.text.match(/TITLE:\s*(.+)/i)?.[1]?.trim() ?? "" } : null;
  });
  if (free) return free;
  const r = await withWebSearch(opts.apiKey, prompt, 2);
  const url = r.text.match(/URL:\s*(https?:\/\/\S+)/i)?.[1]?.replace(/[)>.,]+$/, "");
  const title = r.text.match(/TITLE:\s*(.+)/i)?.[1]?.trim() ?? "";
  return {
    value: url ? { url, title } : null,
    assistantTurn: { role: "assistant", content: toReplayable(r.res) },
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
  };
}

/** Cheapest possible call, to check that a key works. */
export async function testKey(apiKey: string): Promise<void> {
  await client(apiKey).messages.create({
    model: MODELS.fast,
    max_tokens: 16,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with OK." }],
  });
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The API key is not valid (401). Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to do that (403).";
  if (e instanceof Anthropic.RateLimitError) return "Too many requests or spend limit reached (429). Wait a bit or check your limits.";
  if (e instanceof Anthropic.BadRequestError) return `The request was rejected (400): ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "No connection to the AI. Are you online?";
  if (e instanceof Anthropic.APIError) return `${e.status ?? ""} ${e.message}`.trim();
  return e instanceof Error ? e.message : String(e);
}
