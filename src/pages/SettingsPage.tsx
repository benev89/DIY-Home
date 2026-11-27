import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting } from "../db";
import { useI18n, type Lang } from "../i18n";
import { describeError, testKey } from "../ai";
import { downloadText, exportAll, importAll } from "../backup";
import { formatUsd, Header } from "../components/ui";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [region, setRegion] = useState("");
  const [keyStatus, setKeyStatus] = useState<string>();
  const [persisted, setPersisted] = useState<boolean>();
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSetting("apiKey", "").then(setApiKey);
    getSetting("region", "").then(setRegion);
    navigator.storage?.persisted?.().then(setPersisted);
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

      <section>
        <h2>{t.usage}</h2>
        <p>
          <strong>{formatUsd(monthCost)}</strong> <span className="muted">· {usage?.length ?? 0} ×</span>
        </p>
      </section>

      <section>
        <h2>{t.backup}</h2>
        <p className="muted">{t.backupHint}</p>
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
