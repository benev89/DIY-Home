import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { describeError, RefusalError } from "../ai";
import { startRepair } from "../repairs";
import { Header, PhotoPicker } from "../components/ui";

export default function FixPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [itemId, setItemId] = useState<number | undefined>(Number(search.get("item")) || undefined);
  const [problem, setProblem] = useState("");
  const [photoIds, setPhotoIds] = useState<number[]>([]);
  const [includeManual, setIncludeManual] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const apiKey = useLiveQuery(async () => (await db.settings.get("apiKey"))?.value as string | undefined, []);
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const items = useLiveQuery(() => db.items.orderBy("name").toArray(), []);
  const item = items?.find((i) => i.id === itemId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problem.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const id = await startRepair({ itemId, problem, photoIds, includeManual: includeManual && !!item?.manualFileId });
      navigate(`/repair/${id}`, { replace: true });
    } catch (err) {
      setError(err instanceof RefusalError ? t.refused : `${t.errorPrefix} ${describeError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title={t.fixSomething} />
      {apiKey === "" || apiKey === undefined ? (
        <div className="callout">
          {t.needKey} <Link to="/settings">{t.goSettings} ›</Link>
        </div>
      ) : null}
      <form onSubmit={submit} className="form">
        <label>
          {t.whatItem}
          <select value={itemId ?? ""} onChange={(e) => setItemId(Number(e.target.value) || undefined)}>
            <option value="">{t.noItem}</option>
            {areas?.map((a) => (
              <optgroup key={a.id} label={`${a.icon} ${a.name}`}>
                {items
                  ?.filter((i) => i.areaId === a.id)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.model ? ` (${i.model})` : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          {t.whatsWrong} *
          <textarea rows={5} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder={t.whatsWrongPlaceholder} required />
        </label>
        <div>
          <span className="label">{t.photos}</span>
          <PhotoPicker ids={photoIds} onChange={setPhotoIds} />
        </div>
        {item?.manualFileId && (
          <label className="check">
            <input type="checkbox" checked={includeManual} onChange={(e) => setIncludeManual(e.target.checked)} />
            {t.includeManual}
          </label>
        )}
        {error && <div className="callout error">{error}</div>}
        <button className="btn primary block" type="submit" disabled={busy || !apiKey}>
          {busy ? <span className="spinner">{t.diagnosing}</span> : `🔧 ${t.diagnose}`}
        </button>
      </form>
    </>
  );
}
