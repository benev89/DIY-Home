// Optional: Google Gemini with "Grounding with Google Search" for web lookups (error codes,
// manuals). Free with a Google AI Studio key where Google offers free grounding; in the EU/CH/UK
// Google applies its paid-tier data terms to the free quota (prompts are not used to improve
// its products). If Gemini refuses (no free grounding for the model, quota used up, key wrong),
// the caller falls back to Claude.

export interface GeminiSource {
  title: string; // usually the website's domain, e.g. "bosch-home.com"
  url: string; // a Google redirect link to the page (can expire after a while)
}
export interface GeminiGrounded {
  text: string;
  sources: GeminiSource[];
  /** Google's "Search Suggestions" chip(s), HTML that Google requires apps to show with grounded answers. */
  suggestionsHtml?: string;
  model: string;
}

/** Tried in order: newest fast model first, then older ones that had free grounding. */
export const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
      searchEntryPoint?: { renderedContent?: string };
    };
  }[];
  error?: { code?: number; message?: string; status?: string };
}

export function parseGemini(json: GeminiResponse, model: string): GeminiGrounded {
  const c = json.candidates?.[0];
  const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  const sources: GeminiSource[] = [];
  for (const ch of c?.groundingMetadata?.groundingChunks ?? []) {
    if (ch.web?.uri && !sources.some((s) => s.url === ch.web!.uri)) sources.push({ title: ch.web.title ?? ch.web.uri, url: ch.web.uri });
  }
  return { text, sources, suggestionsHtml: c?.groundingMetadata?.searchEntryPoint?.renderedContent, model };
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call(apiKey: string, model: string, prompt: string, grounded: boolean): Promise<GeminiGrounded> {
  const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(grounded ? { tools: [{ google_search: {} }] } : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok || json.error) throw new GeminiError(json.error?.message ?? `HTTP ${res.status}`, json.error?.code ?? res.status);
  const out = parseGemini(json, model);
  if (!out.text) throw new GeminiError("Empty answer", 500);
  return out;
}

/** A grounded answer from the first model that works; throws the last error if none does. */
export async function geminiSearch(apiKey: string, prompt: string): Promise<GeminiGrounded> {
  let last: unknown;
  for (const model of GEMINI_MODELS) {
    try {
      return await call(apiKey, model, prompt, true);
    } catch (e) {
      last = e;
      // A wrong key won't work with any model: stop early.
      if (e instanceof GeminiError && (e.status === 401 || /API key not valid/i.test(e.message))) break;
    }
  }
  throw last;
}

/** Quick check for Settings: is the key valid, and does Google search work with it for free? */
export async function testGemini(apiKey: string): Promise<{ keyOk: boolean; grounding: boolean; model?: string; error?: string }> {
  try {
    const r = await geminiSearch(apiKey, "What is today's date? Answer in one short sentence.");
    return { keyOk: true, grounding: r.sources.length > 0 || !!r.suggestionsHtml, model: r.model };
  } catch (e) {
    try {
      await call(apiKey, GEMINI_MODELS[0], "Reply with OK.", false);
      return { keyOk: true, grounding: false, error: e instanceof Error ? e.message : String(e) };
    } catch (e2) {
      return { keyOk: false, grounding: false, error: e2 instanceof Error ? e2.message : String(e2) };
    }
  }
}

/** Only trust a link if its website is one Google actually returned as a source. */
export function urlMatchesSources(url: string, sources: GeminiSource[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
  return sources.some((s) => {
    const t = s.title.toLowerCase().replace(/^www\./, "");
    return host === t || host.endsWith(`.${t}`) || t.endsWith(`.${host}`);
  });
}
