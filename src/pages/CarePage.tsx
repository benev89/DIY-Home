import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "react-router-dom";
import { addTask, db } from "../db";
import { useI18n } from "../i18n";
import { bucket, INTERVAL_CHOICES, intervalLabel, type DueBucket } from "../care";
import { Header } from "../components/ui";
import { TaskRow } from "../components/TaskRow";
import { exportToCalendar } from "../calendar";
import { hasServer } from "../server";
import { CalendarHorizon, CalendarSubscribe, useCalendarYears } from "../components/CalendarSubscribe";
import { loadMissingCareSuggestions } from "../careAi";
import { Link } from "react-router-dom";

export default function CarePage() {
  const { t } = useI18n();
  const [search] = useSearchParams();
  const tasks = useLiveQuery(() => db.tasks.orderBy("nextDue").toArray(), []);
  const items = useLiveQuery(() => db.items.orderBy("name").toArray(), []);
  const [adding, setAdding] = useState(search.get("new") === "1");
  const [title, setTitle] = useState("");
  const [itemId, setItemId] = useState<number | undefined>(Number(search.get("item")) || undefined);
  const [intervalDays, setIntervalDays] = useState(90);
  const [loadingLeft, setLoadingLeft] = useState(0);
  const years = useCalendarYears();
  const apiKey = useLiveQuery(async () => (await db.settings.get("apiKey"))?.value as string | undefined, []);

  // Every item in your list gets maintenance ideas automatically (fetched once per item).
  useEffect(() => {
    if (apiKey) void loadMissingCareSuggestions(setLoadingLeft);
  }, [apiKey, items?.length]);

  const suggestionsByItem = (items ?? [])
    .map((it) => ({
      it,
      open: (it.careSuggestions ?? []).filter((sg) => !tasks?.some((tk) => tk.itemId === it.id && tk.title === sg.title)),
    }))
    .filter((x) => x.open.length > 0);

  const nameOf = (id?: number) => items?.find((i) => i.id === id)?.name;
  const groups: [DueBucket, string][] = [
    ["overdue", t.careOverdue],
    ["soon", t.careSoon],
    ["later", t.careLater],
  ];

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await addTask({ itemId, title: title.trim(), intervalDays });
    setTitle("");
    setAdding(false);
  };

  return (
    <>
      <Header title={t.care} />
      <p className="muted">{t.careHint}</p>

      {tasks?.length === 0 && !adding && <div className="callout">{t.careEmpty}</div>}

      {groups.map(([b, label]) => {
        const list = tasks?.filter((x) => bucket(x.nextDue) === b) ?? [];
        if (!list.length) return null;
        return (
          <section key={b}>
            <h2>{label}</h2>
            <ul className="list">
              {list.map((task) => (
                <TaskRow key={task.id} task={task} itemName={nameOf(task.itemId)} />
              ))}
            </ul>
          </section>
        );
      })}

      {!!tasks?.length &&
        (hasServer() ? (
          <CalendarSubscribe />
        ) : (
          <>
            <button className="btn block" onClick={() => exportToCalendar(tasks.map((x) => ({ ...x, itemName: nameOf(x.itemId) })), undefined, years)}>
              📅 {t.allToCalendar}
            </button>
            <CalendarHorizon />
          </>
        ))}

      {(suggestionsByItem.length > 0 || loadingLeft > 0) && (
        <section>
          <h2>✨ {t.careSuggestionsForItems}</h2>
          <p className="muted small">{t.careSuggestionsHint}</p>
          {loadingLeft > 0 && <p className="spinner muted">{t.loadingCareFor.replace("{n}", String(loadingLeft))}</p>}
          {suggestionsByItem.map(({ it, open }) => (
            <div key={it.id} className="sugg-group">
              <Link to={`/item/${it.id}`} className="small">
                {it.name} ›
              </Link>
              <div className="chip-grid">
                {open.map((sg) => (
                  <button key={sg.title} className="pick" title={sg.how} onClick={() => addTask({ itemId: it.id, title: sg.title, how: sg.how, intervalDays: sg.intervalDays })}>
                    <span className="pick-mark">＋</span>
                    {sg.title} · {intervalLabel(sg.intervalDays, t)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {adding ? (
        <form onSubmit={add} className="form card-form">
          <label>
            {t.taskTitle}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.taskPlaceholder} autoFocus />
          </label>
          <label>
            {t.whatItem}
            <select value={itemId ?? ""} onChange={(e) => setItemId(Number(e.target.value) || undefined)}>
              <option value="">–</option>
              {items?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.interval}
            <select value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))}>
              {INTERVAL_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {intervalLabel(d, t)}
                </option>
              ))}
            </select>
          </label>
          <div className="row-wrap">
            <button className="btn primary" type="submit">
              {t.save}
            </button>
            <button className="btn ghost" type="button" onClick={() => setAdding(false)}>
              {t.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setAdding(true)}>
          ＋ {t.addTask}
        </button>
      )}
    </>
  );
}
