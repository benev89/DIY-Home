// Which of the user's tools/supplies covers something the AI says is needed?
// Used to keep the "You need" list of a repair in sync with the Tools page, live.
import type { Tool } from "./db";
import { CATALOG, type CatalogEntry } from "./toolCatalog";

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Loose match for repairs saved before the AI named the exact tool: shared word stem of 4+ letters. */
function fuzzy(toolName: string, need: string): boolean {
  const words = norm(toolName).split(" ").filter((w) => w.length >= 4);
  const needWords = norm(need).split(" ");
  return words.some((w) => needWords.some((n) => n.startsWith(w) || w.startsWith(n) && n.length >= 4));
}

/**
 * Tools in the user's list that cover `need`.
 * `ownedAs` is the exact list entry the AI said covers it (newer repairs); undefined for older repairs.
 */
export function coveringTools(tools: Tool[], need: string, ownedAs: string | undefined, catalogKey?: string): Tool[] {
  const n = norm(need);
  const a = ownedAs ? norm(ownedAs) : "";
  return tools.filter((t) => {
    const tn = norm(t.name);
    if (tn === n || (a && tn === a) || (catalogKey && t.key === catalogKey)) return true;
    return ownedAs === undefined && fuzzy(t.name, need);
  });
}

/** If the name matches a suggestion from the catalog, return its key, so both pages agree. */
export function catalogKeyFor(name: string): string | undefined {
  const n = norm(name);
  for (const g of CATALOG) for (const e of g.entries) if (norm(e.en) === n || norm(e.de) === n) return e.key;
  return undefined;
}

const stems = (s: string) => norm(s).split(" ").filter((w) => w.length >= 4);
const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
/** Two words are "the same thing" if one is a full prefix of the other, or they share 8+ letters (Mikrofasertuch ≈ Mikrofasertücher). */
function wordScore(a: string, b: string): number {
  const p = commonPrefix(a, b);
  const shorter = Math.min(a.length, b.length);
  return p === shorter || p >= 8 ? p : 0;
}

/** The catalog suggestion that best matches a free-text name, if any. */
export function bestCatalogEntry(name: string): CatalogEntry | undefined {
  const words = stems(name);
  let best: { e: CatalogEntry; score: number } | undefined;
  for (const g of CATALOG)
    for (const e of g.entries) {
      if (norm(e.en) === norm(name) || norm(e.de) === norm(name)) return e;
      let score = 0;
      // The first word usually names the thing ("Entkalker (Zitronensäure)"), so it counts more.
      words.forEach((w, i) => {
        for (const c of [...stems(e.en), ...stems(e.de)]) score = Math.max(score, wordScore(w, c) * (i === 0 ? 1.5 : 1));
      });
      if (score && (!best || score > best.score)) best = { e, score };
    }
  return best?.e;
}

export function catalogEntry(key: string | undefined): CatalogEntry | undefined {
  if (!key) return undefined;
  for (const g of CATALOG) for (const e of g.entries) if (e.key === key) return e;
  return undefined;
}
