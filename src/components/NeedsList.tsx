import { useLiveQuery } from "dexie-react-hooks";
import { db, type Tool } from "../db";
import { useI18n } from "../i18n";
import { catalogKeyFor, coveringTools } from "../toolMatch";

export type Need = { name: string; detail?: string; ownedAs?: string; aiOwned?: boolean };

/**
 * Tools or parts needed for a repair. Tap a line to say "I have this" / "I don't": it is added to
 * or removed from your Tools page, and the next repair plans with it.
 */
export function NeedsList({ needs, kind }: { needs: Need[]; kind: Tool["kind"] }) {
  const { t } = useI18n();
  const tools = useLiveQuery(() => db.tools.toArray(), []);
  if (!tools) return null;

  const toggle = async (need: Need, covering: Tool[]) => {
    if (covering.length) {
      if (!confirm(`${covering.map((c) => c.name).join(", ")}\n\n${t.removeFromTools}`)) return;
      await db.tools.bulkDelete(covering.map((c) => c.id!));
    } else {
      await db.tools.add({ name: need.name, kind, key: catalogKeyFor(need.name) });
    }
  };

  return (
    <ul className="needs">
      {needs.map((need, i) => {
        // Older repairs: trust the AI's original answer unless the tools list says otherwise.
        const covering = coveringTools(tools, need.name, need.ownedAs);
        const have = covering.length > 0;
        return (
          <li key={i}>
            <button className={`need ${have ? "have" : "missing"}`} onClick={() => toggle(need, covering)} aria-pressed={have}>
              <span className="need-mark">{have ? "✓" : "＋"}</span>
              <span className="grow">
                <strong>{need.name}</strong>
                {need.detail && <small className="muted">{need.detail}</small>}
                <small>{have ? `${t.youHave}${covering[0].name !== need.name ? ` (${covering[0].name})` : ""}` : t.tapIfYouHave}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
