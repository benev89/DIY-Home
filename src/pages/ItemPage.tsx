import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router-dom";
import { addTask, db, getSetting, type Item } from "../db";
import { useI18n, type Lang } from "../i18n";
import { buildContext, describeError, suggestCare } from "../ai";
import { autoFindManual } from "../manual";
import { intervalLabel } from "../care";
import { TaskRow } from "../components/TaskRow";
import { Header, StatusBadge, Thumb, useFileUrl } from "../components/ui";
import { manualSearchUrl } from "./ItemForm";

export default function ItemPage() {
  const { t, lang } = useI18n();
  const id = Number(useParams().id);
  const item = useLiveQuery(() => db.items.get(id), [id]);
  const area = useLiveQuery(() => (item ? db.areas.get(item.areaId) : undefined), [item?.areaId]);
  const repairs = useLiveQuery(() => db.repairs.where("itemId").equals(id).reverse().sortBy("createdAt"), [id]);
  const manualUrl = useFileUrl(item?.manualFileId);
  const tasks = useLiveQuery(() => db.tasks.where("itemId").equals(id).sortBy("nextDue"), [id]);
  const apiKey = useLiveQuery(async () => (await db.settings.get("apiKey"))?.value as string | undefined, []);
  const [careBusy, setCareBusy] = useState(false);
  const [careError, setCareError] = useState<string>();
  const [manualBusy, setManualBusy] = useState(false);
  const autoTried = useRef(false);

  const loadCare = async (it: Item) => {
    setCareBusy(true);
    setCareError(undefined);
    try {
      const area = await db.areas.get(it.areaId);
      const itemText = buildContext({
        item: { name: it.name, area: area?.name, brand: it.brand, model: it.model, purchased: it.purchased, specs: it.specs, notes: it.notes },
        pastRepairs: [],
        tools: [],
        supplies: [],
        problem: "(none – this is about regular maintenance)",
      });
      const photo = it.photoIds[0] ? (await db.files.get(it.photoIds[0]))?.blob : undefined;
      const res = await suggestCare({
        apiKey: apiKey!,
        lang: await getSetting<Lang>("lang", "en"),
        region: await getSetting("region", ""),
        itemText,
        photos: photo ? [photo] : [],
      });
      await db.usage.add({ at: Date.now(), model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd });
      await db.items.update(it.id!, {
        careSuggestions: res.value.tasks.map((x) => ({ title: x.title, how: x.how, intervalDays: Math.max(1, Math.round(x.interval_days)) })),
      });
    } catch (e) {
      setCareError(`${t.errorPrefix} ${describeError(e)}`);
    } finally {
      setCareBusy(false);
    }
  };

  // First visit: fetch maintenance ideas once, automatically (about 0.05 cents).
  useEffect(() => {
    if (!item || !apiKey || autoTried.current || item.careSuggestions || tasks === undefined || tasks.length) return;
    autoTried.current = true;
    void loadCare(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, apiKey, tasks]);

  if (!item) return null;
  const openSuggestions = (item.careSuggestions ?? []).filter((sg) => !tasks?.some((tk) => tk.title === sg.title));
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
                🔗 {t.openManual}
              </a>
            )}
            {!manualUrl && !item.manualUrl && apiKey && (
              <button
                className="btn"
                disabled={manualBusy}
                onClick={async () => {
                  setManualBusy(true);
                  try {
                    await autoFindManual(id);
                  } finally {
                    setManualBusy(false);
                  }
                }}
              >
                {manualBusy ? <span className="spinner">{t.searchingManual}</span> : `✨ ${t.searchManualAuto}`}
              </button>
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
        <h2>🗓 {t.care}</h2>
        {!!tasks?.length && (
          <ul className="list">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
        {careBusy && <p className="spinner muted">{t.loadingCare}</p>}
        {careError && <div className="callout error">{careError}</div>}
        {openSuggestions.length > 0 && (
          <>
            <p className="muted small">{t.careSuggestionsHint}</p>
            <div className="chip-grid">
              {openSuggestions.map((sg) => (
                <button
                  key={sg.title}
                  className="pick"
                  title={sg.how}
                  onClick={() => addTask({ itemId: id, title: sg.title, how: sg.how, intervalDays: sg.intervalDays })}
                >
                  <span className="pick-mark">＋</span>
                  {sg.title} · {intervalLabel(sg.intervalDays, t)}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="row-wrap" style={{ marginTop: 10 }}>
          {apiKey && !careBusy && (
            <button className="btn" onClick={() => loadCare(item)}>
              ✨ {t.careSuggest}
            </button>
          )}
          <Link className="btn" to={`/care?new=1&item=${id}`}>
            ＋ {t.addTask}
          </Link>
        </div>
      </section>

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
