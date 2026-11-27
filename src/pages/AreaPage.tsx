import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { Header, Thumb } from "../components/ui";

export default function AreaPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const id = Number(useParams().id);
  const area = useLiveQuery(() => db.areas.get(id), [id]);
  const items = useLiveQuery(() => db.items.where("areaId").equals(id).sortBy("name"), [id]);

  if (!area) return null;

  const rename = async () => {
    const name = prompt(t.areaName, area.name);
    if (name?.trim()) await db.areas.update(id, { name: name.trim() });
    const icon = prompt(t.icon, area.icon);
    if (icon?.trim()) await db.areas.update(id, { icon: icon.trim() });
  };
  const remove = async () => {
    // Only offered when the area is empty, so no items get orphaned.
    if (items?.length || !confirm(t.confirmDelete)) return;
    await db.areas.where("id").equals(id).delete();
    navigate("/");
  };

  return (
    <>
      <Header
        back
        title={`${area.icon} ${area.name}`}
        action={
          <button className="icon-btn" onClick={rename} aria-label={t.rename}>
            ✏️
          </button>
        }
      />
      {items?.length === 0 && <p className="muted">{t.noItems}</p>}
      <ul className="list">
        {items?.map((i) => (
          <li key={i.id}>
            <Link to={`/item/${i.id}`} className="row">
              {i.photoIds[0] ? <Thumb id={i.photoIds[0]} /> : <div className="thumb placeholder">{area.icon}</div>}
              <span className="grow">
                <strong>{i.name}</strong>
                <small>{[i.brand, i.model].filter(Boolean).join(" · ")}</small>
              </span>
              ›
            </Link>
          </li>
        ))}
      </ul>
      <Link to={`/item/new?area=${id}`} className="btn primary block">
        ＋ {t.addItem}
      </Link>
      {items?.length === 0 && (
        <button className="btn ghost block danger" onClick={remove}>
          {t.delete}
        </button>
      )}
    </>
  );
}
