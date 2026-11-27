import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { db, deleteItem, getSetting, saveFile, type Item } from "../db";
import { useI18n, type Lang } from "../i18n";
import { describeError, identifyItem, RefusalError } from "../ai";
import { Header, PhotoPicker } from "../components/ui";
import { DictationTextarea } from "../components/Dictation";

type Draft = Omit<Item, "id" | "createdAt" | "updatedAt">;
type TextField = "name" | "brand" | "model" | "serial" | "purchased" | "specs";

const MAX_PHOTOS_TO_READ = 3;

export function manualSearchUrl(brand: string | undefined, model: string | undefined, lang: Lang, query?: string) {
  const q = query?.trim() || [brand, model, lang === "de" ? "Bedienungsanleitung" : "manual", "pdf"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export default function ItemForm() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const [search] = useSearchParams();
  const editId = params.id ? Number(params.id) : undefined;
  const areaFromUrl = Number(search.get("area")) || 0;
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const apiKey = useLiveQuery(async () => (await db.settings.get("apiKey"))?.value as string | undefined, []);
  const pdfInput = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft>({ areaId: areaFromUrl, name: "", photoIds: [] });
  const [manualName, setManualName] = useState<string>();
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState<{ filled: string[]; comment: string; query: string }>();
  const [readError, setReadError] = useState<string>();
  const areaTouched = useRef(!!areaFromUrl || !!editId);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!editId) return;
    db.items.get(editId).then(async (item) => {
      if (!item) return;
      setDraft(item);
      if (item.manualFileId) setManualName((await db.files.get(item.manualFileId))?.name);
    });
  }, [editId]);

  useEffect(() => {
    if (!draft.areaId && areas?.length) setDraft((d) => ({ ...d, areaId: areas[0].id! }));
  }, [areas, draft.areaId]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  /** Ask the AI to read the photos; fill only fields that are still empty. */
  const readPhotos = async (photoIds: number[]) => {
    if (!apiKey || !photoIds.length) return;
    setReading(true);
    setReadError(undefined);
    try {
      const files = await db.files.bulkGet(photoIds.slice(-MAX_PHOTOS_TO_READ));
      const res = await identifyItem({
        apiKey,
        lang: await getSetting<Lang>("lang", lang),
        photos: files.filter((f) => !!f).map((f) => f!.blob),
        areaNames: (areas ?? []).map((a) => a.name),
      });
      await db.usage.add({ at: Date.now(), model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd });
      const v = res.value;
      const found: Partial<Record<TextField, string>> = {
        name: v.name,
        brand: v.brand,
        model: v.model,
        serial: v.serial,
        purchased: v.year,
        specs: v.specs,
      };
      const labels: Record<TextField, string> = { name: t.name, brand: t.brand, model: t.model, serial: t.serial, purchased: t.purchased, specs: t.specs };
      const filled: string[] = [];
      const d = draftRef.current; // latest form state, including anything typed while reading
      const next = { ...d };
      for (const k of Object.keys(found) as TextField[]) {
        const val = found[k]?.trim();
        if (val && !d[k]?.trim()) {
          next[k] = val;
          filled.push(labels[k]);
        }
      }
      const area = areas?.find((a) => a.name.toLowerCase() === v.area.trim().toLowerCase());
      if (area && !areaTouched.current && area.id !== d.areaId) {
        next.areaId = area.id!;
        filled.push(t.area);
      }
      setDraft(next);
      setReadResult({ filled, comment: v.comment, query: v.manual_query });
    } catch (err) {
      setReadError(err instanceof RefusalError ? t.refused : `${t.errorPrefix} ${describeError(err)}`);
    } finally {
      setReading(false);
    }
  };

  const onPhotos = (ids: number[]) => {
    const added = ids.length > draft.photoIds.length;
    set("photoIds", ids);
    if (added) void readPhotos(ids);
  };

  const attachPdf = async (f?: File) => {
    if (!f) return;
    if (draft.manualFileId) await db.files.where("id").equals(draft.manualFileId).delete();
    set("manualFileId", await saveFile(f, f.name));
    setManualName(f.name);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const now = Date.now();
    const clean = { ...draft, name: draft.name.trim() };
    if (editId) {
      await db.items.update(editId, { ...clean, updatedAt: now });
      navigate(-1);
    } else {
      const id = await db.items.add({ ...clean, createdAt: now, updatedAt: now });
      navigate(`/item/${id}`, { replace: true });
    }
  };

  const remove = async () => {
    if (!editId || !confirm(t.confirmDelete)) return;
    await deleteItem(editId);
    navigate(`/area/${draft.areaId}`, { replace: true });
  };

  const field = (k: "brand" | "model" | "serial" | "purchased" | "manualUrl", label: string) => (
    <label>
      {label}
      <input value={draft[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <>
      <Header back title={editId ? t.editItem : t.addItem} />
      <form onSubmit={save} className="form">
        <div className="photo-first">
          <span className="label">📷 {t.photos}</span>
          <small className="muted">{apiKey ? t.photoFirstHint : t.modelHint}</small>
          <PhotoPicker ids={draft.photoIds} onChange={onPhotos} />
          {reading && <span className="spinner muted">{t.readingPhoto}</span>}
          {!reading && apiKey && draft.photoIds.length > 0 && (
            <button type="button" className="link" onClick={() => readPhotos(draft.photoIds)}>
              ✨ {t.readPhotosAgain}
            </button>
          )}
          {readResult && !reading && (
            <div className="callout">
              {readResult.filled.length > 0 && (
                <>
                  ✨ {t.filledFromPhoto} <strong>{readResult.filled.join(", ")}</strong>
                  <br />
                </>
              )}
              <small className="muted">{readResult.comment}</small>
            </div>
          )}
          {readError && <div className="callout error">{readError}</div>}
        </div>

        <label>
          {t.name} *
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={t.namePlaceholder} required />
        </label>
        <label>
          {t.area}
          <select
            value={draft.areaId}
            onChange={(e) => {
              areaTouched.current = true;
              set("areaId", Number(e.target.value));
            }}
          >
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </label>
        {field("brand", t.brand)}
        {field("model", t.model)}
        {field("serial", t.serial)}
        {field("purchased", t.purchased)}
        <label>
          {t.specs}
          <DictationTextarea rows={2} value={draft.specs ?? ""} onChange={(v) => set("specs", v)} placeholder={t.specsPlaceholder} />
        </label>
        <label>
          {t.notes}
          <DictationTextarea rows={2} value={draft.notes ?? ""} onChange={(v) => set("notes", v)} />
        </label>

        <div>
          <span className="label">{t.manual}</span>
          <div className="row-wrap">
            {(draft.brand || draft.model) && (
              <a className="btn" href={manualSearchUrl(draft.brand, draft.model, lang, readResult?.query)} target="_blank" rel="noreferrer">
                🔎 {t.findManual}
              </a>
            )}
            <button type="button" className="btn" onClick={() => pdfInput.current?.click()}>
              📄 {manualName ?? t.manualPdf}
            </button>
          </div>
          <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => attachPdf(e.target.files?.[0])} />
        </div>
        {field("manualUrl", t.manualUrl)}

        <button className="btn primary block" type="submit">
          {t.save}
        </button>
        {editId && (
          <button type="button" className="btn ghost block danger" onClick={remove}>
            {t.delete}
          </button>
        )}
      </form>
    </>
  );
}
