// Which of the user's tools/supplies covers something the AI says is needed?
// Used to keep the "You need" list of a repair in sync with the Tools page, live.
import type { Tool } from "./db";
import { CATALOG } from "./toolCatalog";

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
export function coveringTools(tools: Tool[], need: string, ownedAs: string | undefined): Tool[] {
  const n = norm(need);
  const a = ownedAs ? norm(ownedAs) : "";
  return tools.filter((t) => {
    const tn = norm(t.name);
    if (tn === n || (a && tn === a)) return true;
    return ownedAs === undefined && fuzzy(t.name, need);
  });
}

/** If the name matches a suggestion from the catalog, return its key, so both pages agree. */
export function catalogKeyFor(name: string): string | undefined {
  const n = norm(name);
  for (const g of CATALOG) for (const e of g.entries) if (norm(e.en) === n || norm(e.de) === n) return e.key;
  return undefined;
}
