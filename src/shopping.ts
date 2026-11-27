// The shopping list is not stored separately: it is everything an open repair needs that you
// don't have (and haven't bought yet). Buy it → it moves to your tools → it disappears here.
import type { Repair, Tool } from "./db";
import { coveringTools } from "./toolMatch";

export interface ShoppingEntry {
  repairId: number;
  repairTitle: string;
  kind: "tool" | "part";
  name: string;
  detail?: string;
  catalogKey?: string;
}

export function shoppingList(repairs: Repair[], tools: Tool[]): ShoppingEntry[] {
  const out: ShoppingEntry[] = [];
  for (const r of repairs) {
    if (r.status !== "open" || !r.diagnosis) continue;
    for (const x of r.diagnosis.tools) {
      const ownedAs = x.owned_as ?? (x.owned ? undefined : "");
      if (!coveringTools(tools, x.name, ownedAs, x.catalog_key).length)
        out.push({ repairId: r.id!, repairTitle: r.title, kind: "tool", name: x.name, catalogKey: x.catalog_key });
    }
    for (const p of r.diagnosis.parts) {
      if (r.boughtParts?.includes(p.name)) continue;
      if (coveringTools(tools, p.name, "", p.catalog_key).length) continue;
      out.push({ repairId: r.id!, repairTitle: r.title, kind: "part", name: p.name, detail: [p.spec, p.price_estimate].filter(Boolean).join(" · "), catalogKey: p.catalog_key });
    }
  }
  return out;
}

export function shoppingText(entries: ShoppingEntry[], title: string): string {
  return [title, ...entries.map((e) => `☐ ${e.name}${e.detail ? ` (${e.detail})` : ""}`)].join("\n");
}
