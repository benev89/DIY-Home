import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { DAY, db } from "../db";
import { useI18n } from "../i18n";
import { bucket } from "../care";
import { Header, StatusBadge } from "../components/ui";
import { TaskRow } from "../components/TaskRow";

/** iPhone/iPad web page opened in Safari instead of from the home-screen icon. */
export function isIosSafariTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

const BACKUP_EVERY = 30 * DAY;

export default function Home() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const items = useLiveQuery(() => db.items.toArray(), []);
  const open = useLiveQuery(() => db.repairs.where("status").equals("open").reverse().sortBy("updatedAt"), []);
  const due = useLiveQuery(async () => (await db.tasks.orderBy("nextDue").toArray()).filter((x) => bucket(x.nextDue) !== "later"), []);
  const lastBackup = useLiveQuery(async () => ((await db.settings.get("lastBackup"))?.value as number | undefined) ?? 0, []);
  const needsBackup = lastBackup !== undefined && (items?.length ?? 0) >= 3 && Date.now() - lastBackup > BACKUP_EVERY;

  const addArea = async () => {
    const name = prompt(t.areaName);
    if (!name?.trim()) return;
    const id = await db.areas.add({ name: name.trim(), icon: "📦", order: areas?.length ?? 0 });
    navigate(`/area/${id}`);
  };

  return (
    <>
      <Header
        title={t.appName}
        action={
          <Link to="/settings" className="icon-btn" aria-label={t.settings}>
            ⚙️
          </Link>
        }
      />
      {isIosSafariTab() && <div className="callout warn">⚠️ {t.safariWarning}</div>}
      {needsBackup && (
        <Link to="/settings" className="callout block-link">
          💾 {t.backupReminder}
        </Link>
      )}

      <Link to="/fix" className="hero">
        <span className="hero-icon">🔧</span>
        <span>
          <strong>{t.fixSomething}</strong>
          <small>{t.fixSomethingHint}</small>
        </span>
      </Link>

      {!!due?.length && (
        <section>
          <h2>🗓 {t.careDue}</h2>
          <ul className="list">
            {due.slice(0, 5).map((task) => (
              <TaskRow key={task.id} task={task} itemName={items?.find((i) => i.id === task.itemId)?.name} />
            ))}
          </ul>
          {due.length > 5 && (
            <Link to="/care" className="small">
              {t.showAll} ›
            </Link>
          )}
        </section>
      )}

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
