import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { Header } from "../components/ui";

/** All your things, by area. */
export default function ThingsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const items = useLiveQuery(() => db.items.toArray(), []);

  const addArea = async () => {
    const name = prompt(t.areaName);
    if (!name?.trim()) return;
    const id = await db.areas.add({ name: name.trim(), icon: "📦", order: areas?.length ?? 0 });
    navigate(`/area/${id}`);
  };

  return (
    <>
      <Header
        title={t.things}
        action={
          <Link to="/item/new" className="icon-btn" aria-label={t.addItem}>
            ＋
          </Link>
        }
      />
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
    </>
  );
}
