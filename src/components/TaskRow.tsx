import { useState } from "react";
import { Link } from "react-router-dom";
import { db, markTaskDone, type Task } from "../db";
import { useI18n } from "../i18n";
import { bucket, dueLabel, INTERVAL_CHOICES, intervalLabel } from "../care";
import { exportToCalendar, googleEventUrl } from "../calendar";
import { hasServer } from "../server";
import { useCalendarYears } from "./CalendarSubscribe";

/** One maintenance task: tap ✓ when done; tap the text for details. */
export function TaskRow({ task, itemName }: { task: Task; itemName?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const years = useCalendarYears();
  const b = bucket(task.nextDue);
  const doneToday = !!task.lastDone && new Date(task.lastDone).toDateString() === new Date().toDateString();
  return (
    <li className={`task task-${b}`}>
      <div className="task-main">
        <button className="task-text" onClick={() => setOpen(!open)} aria-expanded={open}>
          <strong>{task.title}</strong>
          <small>
            {itemName ? `${itemName} · ` : ""}
            {intervalLabel(task.intervalDays, t)} · <span className={`due due-${b}`}>{dueLabel(task.nextDue, t)}</span>
            {task.remindUntil && ` · ${t.until} ${new Date(`${task.remindUntil}T12:00:00`).toLocaleDateString()}`}
          </small>
        </button>
        <button className={`done-btn ${doneToday ? "on" : ""}`} onClick={() => markTaskDone(task.id!)} aria-label={t.markDone}>
          ✓
        </button>
      </div>
      {open && (
        <div className="task-more">
          {task.how && <p className="pre">{task.how}</p>}
          {task.itemId && itemName && <Link to={`/item/${task.itemId}`}>{itemName} ›</Link>}
          <label className="inline-label">
            {t.interval}
            <select
              value={INTERVAL_CHOICES.includes(task.intervalDays) ? task.intervalDays : ""}
              onChange={(e) => {
                const d = Number(e.target.value);
                void db.tasks.update(task.id!, { intervalDays: d, nextDue: (task.lastDone ?? task.createdAt) + d * 86400000 });
              }}
            >
              {!INTERVAL_CHOICES.includes(task.intervalDays) && <option value="">{intervalLabel(task.intervalDays, t)}</option>}
              {INTERVAL_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {intervalLabel(d, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-label">
            {t.remindUntil}
            <input
              type="date"
              value={task.remindUntil ?? ""}
              onChange={(e) => db.tasks.update(task.id!, { remindUntil: e.target.value || undefined })}
            />
          </label>
          {task.doneLog.length > 0 && (
            <small className="muted">
              {t.lastDone}: {task.doneLog.slice(-3).reverse().map((d) => new Date(d).toLocaleDateString()).join(", ")}
            </small>
          )}
          {!hasServer() && (
            <div className="row-wrap">
              <a className="btn" href={googleEventUrl({ ...task, itemName }, Date.now(), years)} target="_blank" rel="noreferrer">
                📅 Google
              </a>
              <button className="btn" onClick={() => exportToCalendar([{ ...task, itemName }], `${task.title}.ics`, years)}>
                📅 Apple / .ics
              </button>
            </div>
          )}
          <button
            className="link danger"
            onClick={() => {
              if (confirm(t.confirmDelete)) void db.tasks.where("id").equals(task.id!).delete();
            }}
          >
            🗑 {t.delete}
          </button>
        </div>
      )}
    </li>
  );
}
