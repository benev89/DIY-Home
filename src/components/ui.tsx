import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db, saveFile } from "../db";
import { resizePhoto } from "../images";
import { useI18n } from "../i18n";

/** Turn a stored file id into a URL an <img> or link can use. */
export function useFileUrl(fileId?: number): string | undefined {
  const file = useLiveQuery(() => (fileId ? db.files.get(fileId) : undefined), [fileId]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

export function Thumb({ id, onRemove }: { id: number; onRemove?: () => void }) {
  const url = useFileUrl(id);
  return (
    <div className="thumb">
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="" />
        </a>
      )}
      {onRemove && (
        <button type="button" className="thumb-x" onClick={onRemove} aria-label="Remove">
          ×
        </button>
      )}
    </div>
  );
}

/** Photo strip with an "add photo" button that opens the camera on phones. */
export function PhotoPicker({ ids, onChange }: { ids: number[]; onChange: (ids: number[]) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const newIds: number[] = [];
      for (const f of Array.from(files)) newIds.push(await saveFile(await resizePhoto(f), f.name));
      onChange([...ids, ...newIds]);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = (id: number) => {
    void db.files.where("id").equals(id).delete();
    onChange(ids.filter((x) => x !== id));
  };
  return (
    <div className="photos">
      {ids.map((id) => (
        <Thumb key={id} id={id} onRemove={() => remove(id)} />
      ))}
      <button type="button" className="thumb add" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "…" : "📷"}
        <small>{t.addPhoto}</small>
      </button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
    </div>
  );
}

export function Header({ title, back, action }: { title: ReactNode; back?: boolean; action?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <header className="header">
      {back && (
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t.back}>
          ‹
        </button>
      )}
      <h1>{title}</h1>
      {action}
    </header>
  );
}

export function formatUsd(v: number): string {
  if (v < 0.01) return `${(v * 100).toFixed(2)} ¢`;
  return `$${v.toFixed(2)}`;
}

export function StatusBadge({ status }: { status: "open" | "fixed" | "not_fixed" | "pro" }) {
  const { t } = useI18n();
  return <span className={`badge badge-${status}`}>{t[`status_${status}`]}</span>;
}
