import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, setSetting } from "../db";
import { useI18n } from "../i18n";
import { calendarLinks, syncNow } from "../server";

/** One tap to subscribe in Apple or Google Calendar. The calendar then updates itself. */
export function CalendarSubscribe() {
  const { t } = useI18n();
  const [links, setLinks] = useState<Awaited<ReturnType<typeof calendarLinks>>>(null);
  useEffect(() => {
    void calendarLinks().then(setLinks);
  }, []);
  if (!links) return null;
  // Make sure the feed has the latest tasks before the calendar app fetches it.
  const before = () => void syncNow().catch(() => {});
  return (
    <div className="calendar-sub">
      <div className="row-wrap">
        <a className="btn" href={links.webcal} onClick={before}>
          📅 {t.subscribeApple}
        </a>
        <a className="btn" href={links.google} target="_blank" rel="noreferrer" onClick={before}>
          📅 {t.subscribeGoogle}
        </a>
      </div>
      <CalendarHorizon />
      <small className="muted">{t.subscribeHint}</small>
    </div>
  );
}

export const HORIZON_CHOICES = [1, 2, 3, 5, 0]; // years; 0 = no end
export function useCalendarYears(): number {
  return useLiveQuery(async () => ((await db.settings.get("calendarYears"))?.value as number | undefined) ?? 2, []) ?? 2;
}

/** How far ahead calendar entries are planned, so nothing repeats forever. */
export function CalendarHorizon() {
  const { t } = useI18n();
  const years = useCalendarYears();
  return (
    <label className="inline-label">
      {t.calendarPlanAhead}
      <select value={years} onChange={(e) => setSetting("calendarYears", Number(e.target.value))}>
        {HORIZON_CHOICES.map((y) => (
          <option key={y} value={y}>
            {y === 0 ? t.noEnd : `${y} ${y === 1 ? t.year : t.years}`}
          </option>
        ))}
      </select>
    </label>
  );
}
