import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting } from "../db";
import { useI18n, type Lang } from "../i18n";
import { describeError, testKey } from "../ai";
import { downloadText, exportAll, importAll } from "../backup";
import { formatUsd, Header } from "../components/ui";
import { testGemini } from "../gemini";
import { disablePush, enablePush, hasServer, pushSupported } from "../server";
import { CalendarSubscribe } from "../components/CalendarSubscribe";
import { isIosSafariTab } from "./Home";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [region, setRegion] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiStatus, setGeminiStatus] = useState<string>();
  const [keyStatus, setKeyStatus] = useState<string>();
  const [persisted, setPersisted] = useState<boolean>();
  const [lastBackup, setLastBackup] = useState<number>();
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSetting("apiKey", "").then(setApiKey);
    getSetting("region", "").then(setRegion);
    getSetting("geminiKey", "").then(setGeminiKey);
    navigator.storage?.persisted?.().then(setPersisted);
    getSetting<number | undefined>("lastBackup", undefined).then(setLastBackup);
  }, []);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const usage = useLiveQuery(() => db.usage.where("at").aboveOrEqual(monthStart).toArray(), [monthStart]);
  const monthCost = usage?.reduce((s, u) => s + u.costUsd, 0) ?? 0;

  const check = async () => {
    setKeyStatus("…");
    try {
      await testKey(apiKey.trim());
      setKeyStatus(t.keyOk);
    } catch (e) {
      setKeyStatus(describeError(e));
    }
  };

  const doExport = async () => {
    downloadText(await exportAll(), `diy-home-backup-${new Date().toISOString().slice(0, 10)}.json`);
    await setSetting("lastBackup", Date.now());
    setLastBackup(Date.now());
  };
  const doImport = async (f?: File) => {
    if (!f || !confirm(t.importConfirm)) return;
    try {
      await importAll(await f.text());
      alert(t.importDone);
      location.reload();
    } catch (e) {
      alert(`${t.errorPrefix} ${describeError(e)}`);
    }
  };

  return (
    <>
      <Header title={t.settings} />
      <div className="form">
        <label>
          {t.apiKey}
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder="sk-ant-…"
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => setSetting("apiKey", apiKey.trim())}
          />
          <small className="muted">{t.apiKeyHint}</small>
        </label>
        <button className="btn" onClick={check} disabled={!apiKey.trim()}>
          {t.testKey}
        </button>
        {keyStatus && <small>{keyStatus}</small>}

        <label>
          {t.geminiKey}
          <input
            type="password"
            autoComplete="off"
            value={geminiKey}
            placeholder="AIza…"
            onChange={(e) => setGeminiKey(e.target.value)}
            onBlur={() => setSetting("geminiKey", geminiKey.trim())}
          />
          <small className="muted">
            {t.geminiKeyHint}{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
          </small>
        </label>
        {geminiKey.trim() && (
          <button
            className="btn"
            onClick={async () => {
              setGeminiStatus("…");
              const r = await testGemini(geminiKey.trim());
              setGeminiStatus(
                r.busy ? t.geminiBusy : !r.keyOk ? `${t.geminiKeyBad} (${r.error})` : r.grounding ? `${t.geminiOk} (${r.model})` : t.geminiNoGrounding,
              );
            }}
          >
            {t.testGemini}
          </button>
        )}
        {geminiStatus && <small>{geminiStatus}</small>}

        <label>
          {t.language}
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </label>

        <label>
          {t.region}
          <input value={region} placeholder="Deutschland / Germany" onChange={(e) => setRegion(e.target.value)} onBlur={() => setSetting("region", region.trim())} />
          <small className="muted">{t.regionHint}</small>
        </label>
      </div>

      <NotificationsSection />

      <section>
        <h2>{t.usage}</h2>
        <p>
          <strong>{formatUsd(monthCost)}</strong> <span className="muted">· {usage?.length ?? 0} ×</span>
        </p>
      </section>

      <section>
        <h2>{t.backup}</h2>
        <p className="muted">{t.backupHint}</p>
        <p className="small">
          {t.lastBackup}: <strong>{lastBackup ? new Date(lastBackup).toLocaleDateString() : t.never}</strong>
        </p>
        <div className="row-wrap">
          <button className="btn primary" onClick={doExport}>
            ⬇️ {t.exportBackup}
          </button>
          <button className="btn" onClick={() => importInput.current?.click()}>
            ⬆️ {t.importBackup}
          </button>
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
        </div>
      </section>

      <section>
        <h2>{t.storage}</h2>
        <p className="muted">{persisted ? t.storagePersisted : t.storageNotPersisted}</p>
      </section>
    </>
  );
}

function NotificationsSection() {
  const { t } = useI18n();
  const enabled = useLiveQuery(async () => !!(await db.settings.get("pushEnabled"))?.value, []);
  const careReminders = useLiveQuery(async () => ((await db.settings.get("careReminders"))?.value as boolean | undefined) ?? true, []);
  const reminderTime = useLiveQuery(async () => ((await db.settings.get("reminderTime"))?.value as string | undefined) ?? "09:00", []);
  const [status, setStatus] = useState<string>();

  if (!hasServer()) {
    return (
      <section>
        <h2>🔔 {t.notifications}</h2>
        <p className="muted">{t.serverMissing}</p>
      </section>
    );
  }
  const turnOn = async () => {
    setStatus("…");
    try {
      const r = await enablePush();
      setStatus(r === "ok" ? undefined : r === "denied" ? t.pushDenied : t.pushUnsupported);
    } catch (e) {
      setStatus(`${t.errorPrefix} ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <section>
      <h2>🔔 {t.notifications}</h2>
      <p className="muted">{t.notificationsHint}</p>
      {isIosSafariTab() || !pushSupported() ? (
        <p className="callout warn">{t.pushNeedsHomeScreen}</p>
      ) : enabled ? (
        <div className="form">
          <p className="ok-text">✓ {t.pushOn}</p>
          <label className="check">
            <input type="checkbox" checked={careReminders} onChange={(e) => setSetting("careReminders", e.target.checked)} />
            {t.careReminderAt}
          </label>
          {careReminders && (
            <label className="inline-label">
              {t.reminderTimeLabel}
              <input
                type="time"
                value={reminderTime ?? "09:00"}
                onChange={(e) => e.target.value && setSetting("reminderTime", e.target.value)}
              />
            </label>
          )}
          <button className="btn ghost" onClick={() => disablePush()}>
            {t.turnOff}
          </button>
        </div>
      ) : (
        <button className="btn primary" onClick={turnOn}>
          🔔 {t.enablePush}
        </button>
      )}
      {status && <p className="small">{status}</p>}
      <h3>📅 {t.calendar}</h3>
      <CalendarSubscribe />
    </section>
  );
}
