import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { Header } from "../components/ui";
import { addNeedToTools } from "../components/NeedsList";
import { catalogEntry } from "../toolMatch";
import { shoppingList, shoppingText, type ShoppingEntry } from "../shopping";

export default function ShoppingPage() {
  const { t, lang } = useI18n();
  const repairs = useLiveQuery(() => db.repairs.toArray(), []);
  const tools = useLiveQuery(() => db.tools.toArray(), []);
  if (!repairs || !tools) return null;
  const list = shoppingList(repairs, tools);
  const byRepair = new Map<number, ShoppingEntry[]>();
  for (const e of list) byRepair.set(e.repairId, [...(byRepair.get(e.repairId) ?? []), e]);

  const bought = async (e: ShoppingEntry) => {
    // Tools and common supplies become yours; a one-off spare part is just ticked off for that repair.
    if (e.kind === "tool" || catalogEntry(e.catalogKey)) {
      await addNeedToTools({ name: e.name, catalogKey: e.catalogKey }, e.kind === "tool" ? "tool" : "supply", lang, tools);
    } else {
      const r = repairs.find((x) => x.id === e.repairId)!;
      await db.repairs.update(e.repairId, { boughtParts: [...(r.boughtParts ?? []), e.name] });
    }
  };
  const share = async () => {
    const text = shoppingText(list, `🛒 ${t.shopping}`);
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else await navigator.clipboard?.writeText(text);
  };

  return (
    <>
      <Header
        title={t.shopping}
        action={
          list.length > 0 && (
            <button className="icon-btn" onClick={share} aria-label={t.share}>
              ⤴︎
            </button>
          )
        }
      />
      <p className="muted">{t.shoppingHint}</p>
      {list.length === 0 && <div className="empty">🎉 {t.shoppingEmpty}</div>}
      {[...byRepair.entries()].map(([rid, entries]) => (
        <section key={rid}>
          <h2>
            <Link to={`/repair/${rid}`}>{entries[0].repairTitle} ›</Link>
          </h2>
          <ul className="needs">
            {entries.map((e) => (
              <li key={e.kind + e.name} className="shop-row">
                <button className="need missing" onClick={() => bought(e)}>
                  <span className="need-mark" />
                  <span className="grow">
                    <strong>{e.name}</strong>
                    {e.detail && <small className="muted">{e.detail}</small>}
                    <small>{t.tapWhenBought}</small>
                  </span>
                </button>
                <a
                  className="icon-btn"
                  href={`https://www.google.com/search?tbm=shop&q=${encodeURIComponent([e.name, e.detail?.split(" · ")[0]].filter(Boolean).join(" "))}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t.searchShop}
                >
                  🔎
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
