import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { db, deleteItem, getSetting, saveFile, type Item } from "../db";
import { useI18n, type Lang } from "../i18n";
import { describeError, identifyItem, RefusalError } from "../ai";
import { autoFindManual } from "../manual";
import { Header, PhotoPicker } from "../components/ui";
import { DictationTextarea } from "../components/Dictation";

type Draft = Omit<Item, "id" | "createdAt" | "updatedAt">;
type TextField = "name" | "brand" | "model" | "serial" | "purchased" | "specs";

const MAX_PHOTOS_TO_READ = 3;

export function manualSearchUrl(brand: string | undefined, model: string | undefined, lang: Lang, query?: string) {
  const q = query?.trim() || [brand, model, lang === "de" ? "Bedienungsanleitung" : "manual", "pdf"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

const hasContent = (d: Draft) => !!(d.name.trim() || d.photoIds.length || d.brand || d.model || d.notes || d.specs);

/**
 * Add/edit an item. There is no "save" step: every change is written to the database right
 * away, so nothing is lost if the app is closed. A new item is created as soon as it has a
 * photo or any text.
 */
export default function ItemForm() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const [search] = useSearchParams();
  const areaFromUrl = Number(search.get("area")) || 0;
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const apiKey = useLiveQuery(async () => (await db.settings.get("apiKey"))?.value as string | undefined, []);
  const pdfInput = useRef<HTMLInputElement>(null);

  const [itemId, setItemId] = useState<number | undefined>(params.id ? Number(params.id) : undefined);
  const itemIdRef = useRef(itemId);
  const creating = useRef<Promise<number> | null>(null);
  const [draft, setDraft] = useState<Draft>({ areaId: areaFromUrl, name: "", photoIds: [] });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [loaded, setLoaded] = useState(!params.id);
  const [manualName, setManualName] = useState<string>();
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState<{ filled: string[]; comment: string; query: string }>();
  const [readError, setReadError] = useState<string>();
  const [manualState, setManualState] = useState<"searching" | "found" | "none" | "error">();
  const areaTouched = useRef(!!areaFromUrl || !!params.id);
  const isNew = !params.id;

  useEffect(() => {
    if (!params.id) return;
    db.items.get(Number(params.id)).then(async (item) => {
      if (!item) return;
      setDraft(item);
      setLoaded(true);
      if (item.manualFileId) setManualName((await db.files.get(item.manualFileId))?.name);
    });
  }, [params.id]);

  useEffect(() => {
    if (!draft.areaId && areas?.length) setDraft((d) => ({ ...d, areaId: areas[0].id! }));
  }, [areas, draft.areaId]);

  /** Write the draft to the database (create the item the first time). Returns the item id. */
  const persist = async (next: Draft): Promise<number | undefined> => {
    const record = { ...next, name: next.name.trim() || t.newItem, updatedAt: Date.now() };
    if (itemIdRef.current) {
      await db.items.update(itemIdRef.current, record);
      return itemIdRef.current;
    }
    if (!hasContent(next) || !next.areaId) return undefined;
    if (!creating.current) {
      creating.current = db.items.add({ ...record, createdAt: Date.now() }).then((id) => {
        itemIdRef.current = id as number;
        setItemId(id as number);
        return id as number;
      });
      return creating.current;
    }
    const id = await creating.current; // a create is in flight: wait for it, then update
    await db.items.update(id, record);
    return id;
  };

  const apply = (next: Draft) => {
    setDraft(next);
    draftRef.current = next;
    return persist(next);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => void apply({ ...draftRef.current, [k]: v });

  const searchManual = async (id: number) => {
    setManualState("searching");
    try {
      const found = await autoFindManual(id);
      if (found) setDraft((d) => (d.manualUrl ? d : { ...d, manualUrl: found.url }));
      setManualState(found ? "found" : "none");
    } catch {
      setManualState("error");
    }
  };

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
      const found: Record<TextField, string> = { name: v.name, brand: v.brand, model: v.model, serial: v.serial, purchased: v.year, specs: v.specs };
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
      const id = await apply(next);
      setReadResult({ filled, comment: v.comment, query: v.manual_query });
      // Brand/model known and no manual yet: look for it straight away.
      const item = id ? await db.items.get(id) : undefined;
      if (id && item && (item.brand || item.model) && !item.manualUrl && !item.manualFileId && !item.manualSearchedAt) {
        void searchManual(id);
      }
    } catch (err) {
      setReadError(err instanceof RefusalError ? t.refused : `${t.errorPrefix} ${describeError(err)}`);
    } finally {
      setReading(false);
    }
  };

  const onPhotos = (ids: number[]) => {
    const added = ids.length > draftRef.current.photoIds.length;
    void apply({ ...draftRef.current, photoIds: ids });
    if (added) void readPhotos(ids);
  };

  const attachPdf = async (f?: File) => {
    if (!f) return;
    if (draft.manualFileId) await db.files.where("id").equals(draft.manualFileId).delete();
    set("manualFileId", await saveFile(f, f.name));
    setManualName(f.name);
  };

  const done = () => {
    if (itemId) navigate(`/item/${itemId}`, { replace: true });
    else navigate(-1);
  };

  const remove = async () => {
    if (!itemId || !confirm(t.confirmDelete)) return;
    await deleteItem(itemId);
    navigate(`/area/${draft.areaId}`, { replace: true });
  };

  const field = (k: "brand" | "model" | "serial" | "purchased" | "manualUrl", label: string) => (
    <label>
      {label}
      <input value={draft[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  if (!loaded) return null;
  return (
    <>
      <Header back title={isNew ? t.addItem : t.editItem} />
      <form onSubmit={(e) => (e.preventDefault(), done())} className="form">
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
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={t.namePlaceholder} />
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
          {manualState === "searching" && <p className="spinner muted">{t.searchingManual}</p>}
          {manualState === "found" && <p className="ok-text">✓ {t.manualFound}</p>}
          {(manualState === "none" || manualState === "error") && <p className="muted">{t.manualNotFound}</p>}
          <div className="row-wrap">
            {draft.manualUrl && (
              <a className="btn" href={draft.manualUrl} target="_blank" rel="noreferrer">
                🔗 {t.openManual}
              </a>
            )}
            {!draft.manualUrl && (draft.brand || draft.model) && (
              <>
                {apiKey && itemId && manualState !== "searching" && (
                  <button type="button" className="btn" onClick={() => searchManual(itemId)}>
                    ✨ {t.searchManualAuto}
                  </button>
                )}
                <a className="btn" href={manualSearchUrl(draft.brand, draft.model, lang, readResult?.query)} target="_blank" rel="noreferrer">
                  🔎 {t.findManual}
                </a>
              </>
            )}
            <button type="button" className="btn" onClick={() => pdfInput.current?.click()}>
              📄 {manualName ?? t.manualPdf}
            </button>
          </div>
          <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => attachPdf(e.target.files?.[0])} />
        </div>
        {field("manualUrl", t.manualUrl)}

        <p className="muted small center">{itemId ? `✓ ${t.autoSaved}` : t.autoSaveHint}</p>
        <button className="btn primary block" type="submit">
          {t.done}
        </button>
        {itemId && (
          <button type="button" className="btn ghost block danger" onClick={remove}>
            {t.delete}
          </button>
        )}
      </form>
    </>
  );
}
