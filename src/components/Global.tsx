// App-wide helpers that sit outside the pages: running timers, the "time's up" alert,
// background sync with the server, and opening the right screen from a notification.
import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { beep, formatCountdown, stopTimer, useNow } from "../timers";
import { syncSoon } from "../server";

/** Small pill above the tab bar while a timer runs; tap to jump to its step. */
export function TimerPill() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const timers = useLiveQuery(() => db.timers.orderBy("endsAt").toArray(), []);
  const now = useNow(!!timers?.length);
  const running = timers?.filter((x) => !x.finished) ?? [];
  if (!running.length || location.pathname.endsWith("/work")) return null;
  const next = running[0];
  return (
    <button className="timer-pill" onClick={() => next.repairId !== undefined && navigate(`/repair/${next.repairId}/work`)}>
      ⏱ {next.label} · <strong>{next.endsAt > now ? formatCountdown(next.endsAt - now) : t.timeUp}</strong>
      {running.length > 1 && <span className="muted"> +{running.length - 1}</span>}
    </button>
  );
}

/** When a timer ends while the app is open: sound + a big alert you can't miss. */
export function TimerAlert() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const timers = useLiveQuery(() => db.timers.toArray(), []);
  const now = useNow(!!timers?.length);
  const due = timers?.filter((x) => x.endsAt <= now) ?? [];
  const announced = useRef(new Set<number>());

  useEffect(() => {
    for (const x of due) {
      if (!x.finished && !announced.current.has(x.id!)) {
        announced.current.add(x.id!);
        beep();
        void db.timers.update(x.id!, { finished: true });
      }
    }
  }, [due]);

  if (!due.length) return null;
  const x = due[0];
  return (
    <div className="overlay" role="alertdialog" aria-live="assertive">
      <div className="alert-card">
        <div className="alert-icon">⏱</div>
        <h2>{t.timeUp}</h2>
        <p>{x.label}</p>
        {x.repairId !== undefined && (
          <button
            className="btn primary block big"
            onClick={async () => {
              await stopTimer(x.id!);
              navigate(`/repair/${x.repairId}/work`);
            }}
          >
            {t.continueWork}
          </button>
        )}
        <button className="btn ghost block" onClick={() => stopTimer(x.id!)}>
          {t.dismiss}
        </button>
      </div>
    </div>
  );
}

/** Keeps the server (calendar feed, 09:00 reminders) up to date, and follows taps on notifications. */
export function SyncAgent() {
  const navigate = useNavigate();
  const fingerprint = useLiveQuery(async () => {
    const tasks = await db.tasks.toArray();
    const items = await db.items.toArray();
    const settings = await db.settings.bulkGet(["lang", "pushEnabled", "careReminders"]);
    return JSON.stringify([tasks.map((x) => [x.id, x.title, x.nextDue, x.intervalDays, x.itemId]), items.map((i) => [i.id, i.name]), settings.map((s) => s?.value)]);
  }, []);
  useEffect(() => {
    if (fingerprint) syncSoon();
  }, [fingerprint]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "open") return;
      const hash = new URL(e.data.url).hash.replace(/^#/, "");
      if (hash) navigate(hash);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [navigate]);
  return null;
}
