import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { Header, StatusBadge } from "../components/ui";

export default function HistoryPage() {
  const { t } = useI18n();
  const repairs = useLiveQuery(() => db.repairs.orderBy("createdAt").reverse().toArray(), []);
  const items = useLiveQuery(() => db.items.toArray(), []);
  const nameOf = (id?: number) => items?.find((i) => i.id === id)?.name;

  return (
    <>
      <Header title={t.allRepairs} />
      {repairs?.length === 0 && <p className="muted">{t.noRepairs}</p>}
      <ul className="list">
        {repairs?.map((r) => (
          <li key={r.id}>
            <Link to={`/repair/${r.id}`} className="row">
              <span className="grow">
                <strong>{r.title}</strong>
                <small>
                  {new Date(r.createdAt).toLocaleDateString()}
                  {nameOf(r.itemId) ? ` · ${nameOf(r.itemId)}` : ""}
                </small>
              </span>
              <StatusBadge status={r.status} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
