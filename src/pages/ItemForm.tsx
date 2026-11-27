import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { db, deleteItem, saveFile, type Item } from "../db";
import { useI18n } from "../i18n";
import { Header, PhotoPicker } from "../components/ui";

type Draft = Omit<Item, "id" | "createdAt" | "updatedAt">;

export default function ItemForm() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const [search] = useSearchParams();
  const editId = params.id ? Number(params.id) : undefined;
  const areas = useLiveQuery(() => db.areas.orderBy("order").toArray(), []);
  const pdfInput = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft>({
    areaId: Number(search.get("area")) || 0,
    name: "",
    photoIds: [],
  });
  const [manualName, setManualName] = useState<string>();

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
  const field = (k: "brand" | "model" | "serial" | "purchased" | "manualUrl", label: string, hint?: string) => (
    <label>
      {label}
      <input value={draft[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );

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

  return (
    <>
      <Header back title={editId ? t.editItem : t.addItem} />
      <form onSubmit={save} className="form">
        <label>
          {t.name} *
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={t.namePlaceholder} required autoFocus={!editId} />
        </label>
        <label>
          {t.area}
          <select value={draft.areaId} onChange={(e) => set("areaId", Number(e.target.value))}>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="label">{t.photos}</span>
          <PhotoPicker ids={draft.photoIds} onChange={(ids) => set("photoIds", ids)} />
          <small className="muted">{t.modelHint}</small>
        </div>
        {field("brand", t.brand)}
        {field("model", t.model)}
        {field("serial", t.serial)}
        {field("purchased", t.purchased)}
        <label>
          {t.specs}
          <textarea rows={2} value={draft.specs ?? ""} onChange={(e) => set("specs", e.target.value)} placeholder={t.specsPlaceholder} />
        </label>
        <label>
          {t.notes}
          <textarea rows={2} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </label>
        {field("manualUrl", t.manualUrl)}
        <div>
          <span className="label">{t.manualPdf}</span>
          <button type="button" className="btn" onClick={() => pdfInput.current?.click()}>
            📄 {manualName ?? "PDF…"}
          </button>
          <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => attachPdf(e.target.files?.[0])} />
        </div>
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
