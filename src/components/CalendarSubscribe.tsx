import { useEffect, useState } from "react";
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
      <small className="muted">{t.subscribeHint}</small>
    </div>
  );
}
