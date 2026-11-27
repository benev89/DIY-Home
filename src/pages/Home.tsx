import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { Header, StatusBadge } from "../components/ui";

export default function Home() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const items = useLiveQuery(() => db.items.toArray(), []);
  const open = useLiveQuery(() => db.repairs.where("status").equals("open").reverse().sortBy("updatedAt"), []);

  const addArea = async () => {
    const name = prompt(t.areaName);
    if (!name?.trim()) return;
    const id = await db.areas.add({ name: name.trim(), icon: "📦", order: areas?.length ?? 0 });
    navigate(`/area/${id}`);
  };

  return (
    <>
      <Header title={t.appName} />
      <Link to="/fix" className="hero">
        <span className="hero-icon">🔧</span>
        <span>
          <strong>{t.fixSomething}</strong>
          <small>{t.fixSomethingHint}</small>
        </span>
      </Link>

      {!!open?.length && (
        <section>
          <h2>{t.openRepairs}</h2>
          <ul className="list">
            {open.map((r) => (
              <li key={r.id}>
                <Link to={`/repair/${r.id}`} className="row">
                  <span className="grow">{r.title}</span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>{t.areas}</h2>
        <div className="grid">
          {areas?.map((a) => (
            <Link key={a.id} to={`/area/${a.id}`} className="tile">
              <span className="tile-icon">{a.icon}</span>
              <span>{a.name}</span>
              <small>
                {items?.filter((i) => i.areaId === a.id).length ?? 0} {t.items}
              </small>
            </Link>
          ))}
          <button className="tile tile-add" onClick={addArea}>
            <span className="tile-icon">＋</span>
            <span>{t.addArea}</span>
          </button>
        </div>
      </section>
    </>
  );
}
