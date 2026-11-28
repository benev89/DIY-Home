import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { DAY, db, saveFile } from "../db";
import { useI18n } from "../i18n";
import { bucket } from "../care";
import { resizePhoto } from "../images";
import { shoppingList } from "../shopping";
import { Header, StatusBadge } from "../components/ui";
import { CalendarIcon, CameraIcon, CartIcon, ChevronIcon, WrenchIcon } from "../components/Icons";

/** iPhone/iPad web page opened in Safari instead of from the home-screen icon. */
export function isIosSafariTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

const BACKUP_EVERY = 30 * DAY;

/** Start screen: the three things you come here for, then what's in progress. Nothing else. */
export default function Home() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const items = useLiveQuery(() => db.items.toArray(), []);
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const repairs = useLiveQuery(() => db.repairs.toArray(), []);
  const tools = useLiveQuery(() => db.tools.toArray(), []);
  const due = useLiveQuery(async () => (await db.tasks.toArray()).filter((x) => bucket(x.nextDue) === "overdue" || bucket(x.nextDue) === "soon"), []);
  const dueNow = due?.filter((x) => bucket(x.nextDue) === "overdue" || x.nextDue - Date.now() < 7 * DAY) ?? [];
  const lastBackup = useLiveQuery(async () => ((await db.settings.get("lastBackup"))?.value as number | undefined) ?? 0, []);
  const needsBackup = lastBackup !== undefined && (items?.length ?? 0) >= 3 && Date.now() - lastBackup > BACKUP_EVERY;
  const open = (repairs ?? []).filter((r) => r.status === "open").sort((a, b) => b.updatedAt - a.updatedAt);
  const shopping = repairs && tools ? shoppingList(repairs, tools).length : 0;

  // "Scan a device": the camera opens straight away; the label is read on the next screen.
  const scan = async (file?: File) => {
    if (!file || !areas?.length) return;
    setScanning(true);
    try {
      const photoId = await saveFile(await resizePhoto(file), file.name);
      const now = Date.now();
      const id = await db.items.add({ areaId: areas[0].id!, name: t.newItem, photoIds: [photoId], createdAt: now, updatedAt: now });
      navigate(`/item/${id}/edit?read=1`);
    } finally {
      setScanning(false);
    }
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

      <div className="actions">
        <Link to="/fix" className="action primary">
          <span className="action-icon">
            <WrenchIcon />
          </span>
          <span className="action-text">
            <strong>{t.fixSomething}</strong>
            <small>{t.fixSomethingHint}</small>
          </span>
        </Link>
        <div className="action-row">
          <button className="action" onClick={() => camera.current?.click()} disabled={scanning}>
            <span className="action-icon">
              <CameraIcon />
            </span>
            <span className="action-text">
              <strong>{scanning ? "…" : t.scanDevice}</strong>
              <small>{t.scanDeviceHint}</small>
            </span>
          </button>
          <Link to="/care" className={`action ${dueNow.length ? "attention" : ""}`}>
            <span className="action-icon">
              <CalendarIcon />
              {dueNow.length > 0 && <span className="badge-count">{dueNow.length}</span>}
            </span>
            <span className="action-text">
              <strong>{t.care}</strong>
              <small>{dueNow.length ? `${dueNow.length} ${t.dueSoonShort}` : t.allDone}</small>
            </span>
          </Link>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => scan(e.target.files?.[0])} />
      </div>

      {open.length > 0 && (
        <section>
          <h2>{t.inProgress}</h2>
          <ul className="list grouped">
            {open.map((r) => (
              <li key={r.id}>
                <Link to={r.diagnosis?.steps.length ? `/repair/${r.id}/work` : `/repair/${r.id}`} className="row">
                  <span className="grow">
                    <strong>{r.title}</strong>
                    {!!r.diagnosis?.steps.length && (
                      <small>
                        {t.step} {Math.min((r.currentStep ?? 0) + 1, r.diagnosis.steps.length)} / {r.diagnosis.steps.length} · {t.continueWork}
                      </small>
                    )}
                  </span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="list grouped" style={{ marginTop: 24 }}>
        {shopping > 0 && (
          <li>
            <Link to="/shopping" className="row">
              <CartIcon />
              <span className="grow">{t.shopping}</span>
              <span className="badge-count inline">{shopping}</span>
              <ChevronIcon />
            </Link>
          </li>
        )}
        <li>
          <Link to="/history" className="row">
            <span className="row-icon">📋</span>
            <span className="grow">{t.allRepairs}</span>
            <ChevronIcon />
          </Link>
        </li>
      </ul>
    </>
  );
}
