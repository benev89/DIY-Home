import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { Header, StatusBadge, Thumb, useFileUrl } from "../components/ui";
import { manualSearchUrl } from "./ItemForm";

export default function ItemPage() {
  const { t, lang } = useI18n();
  const id = Number(useParams().id);
  const item = useLiveQuery(() => db.items.get(id), [id]);
  const area = useLiveQuery(() => (item ? db.areas.get(item.areaId) : undefined), [item?.areaId]);
  const repairs = useLiveQuery(() => db.repairs.where("itemId").equals(id).reverse().sortBy("createdAt"), [id]);
  const manualUrl = useFileUrl(item?.manualFileId);

  if (!item) return null;
  const facts: [string, string | undefined][] = [
    [t.area, area && `${area.icon} ${area.name}`],
    [t.brand, item.brand],
    [t.model, item.model],
    [t.serial, item.serial],
    [t.purchased, item.purchased],
    [t.specs, item.specs],
    [t.notes, item.notes],
  ];

  return (
    <>
      <Header
        back
        title={item.name}
        action={
          <Link to={`/item/${id}/edit`} className="icon-btn" aria-label={t.edit}>
            ✏️
          </Link>
        }
      />
      {item.photoIds.length > 0 && (
        <div className="photos">
          {item.photoIds.map((p) => (
            <Thumb key={p} id={p} />
          ))}
        </div>
      )}
      <Link to={`/fix?item=${id}`} className="btn primary block">
        🔧 {t.fixThis}
      </Link>
      <dl className="facts">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {(manualUrl || item.manualUrl || item.brand || item.model) && (
        <section>
          <h2>{t.manual}</h2>
          <div className="row-wrap">
            {manualUrl && (
              <a className="btn" href={manualUrl} target="_blank" rel="noreferrer">
                📄 {t.manualPdf}
              </a>
            )}
            {item.manualUrl && (
              <a className="btn" href={item.manualUrl} target="_blank" rel="noreferrer">
                🔗 {t.manualUrl}
              </a>
            )}
            {!manualUrl && !item.manualUrl && (
              <a className="btn" href={manualSearchUrl(item.brand, item.model, lang)} target="_blank" rel="noreferrer">
                🔎 {t.findManual}
              </a>
            )}
          </div>
        </section>
      )}
      <section>
        <h2>{t.repairHistory}</h2>
        {repairs?.length === 0 && <p className="muted">{t.noRepairs}</p>}
        <ul className="list">
          {repairs?.map((r) => (
            <li key={r.id}>
              <Link to={`/repair/${r.id}`} className="row">
                <span className="grow">
                  <strong>{r.title}</strong>
                  <small>
                    {new Date(r.createdAt).toLocaleDateString()}
                    {r.outcome ? ` · ${r.outcome}` : ""}
                  </small>
                </span>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
