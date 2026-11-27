import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Tool } from "../db";
import { useI18n } from "../i18n";
import { Header } from "../components/ui";
import { CATALOG, orderedGroups, type CatalogEntry } from "../toolCatalog";

const FIRST_GROUPS = 3;
const MORE_GROUPS = 2;

/** A tool counts as "picked" if it has the suggestion's key, or (older data) the same name. */
const matches = (tool: Tool, e: CatalogEntry) => tool.key === e.key || tool.name === e.en || tool.name === e.de;

export default function ToolsPage() {
  const { t, lang } = useI18n();
  const tools = useLiveQuery(() => db.tools.toArray(), []);
  const homeWords = useLiveQuery(async () => {
    const items = await db.items.toArray();
    const areaIds = new Set(items.map((i) => i.areaId));
    const areas = (await db.areas.toArray()).filter((a) => areaIds.has(a.id!));
    return [...items.map((i) => i.name), ...areas.map((a) => a.name)];
  }, []);
  const groups = useMemo(() => orderedGroups(homeWords ?? []), [homeWords]);
  const [shown, setShown] = useState(FIRST_GROUPS);
  const sentinel = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  const [customKind, setCustomKind] = useState<Tool["kind"]>("tool");

  // Endless suggestions: when the bottom comes into view, reveal the next groups.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => Math.min(n + MORE_GROUPS, CATALOG.length));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [tools, shown]); // re-observe after each reveal, in case the bottom is still visible

  if (!tools) return null;
  const catalogEntries = CATALOG.flatMap((g) => g.entries);
  const own = tools.filter((tool) => !catalogEntries.some((e) => matches(tool, e)));

  const toggle = async (e: CatalogEntry) => {
    const existing = tools.filter((tool) => matches(tool, e));
    if (existing.length) await db.tools.bulkDelete(existing.map((x) => x.id!));
    else await db.tools.add({ key: e.key, name: e[lang], kind: e.kind });
  };

  const addCustom = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!custom.trim()) return;
    await db.tools.add({ name: custom.trim(), kind: customKind });
    setCustom("");
  };

  return (
    <>
      <Header title={t.tools} />
      <p className="muted">
        {t.toolsPickHint} <strong>{tools.length} {t.selected}</strong>
      </p>

      {own.length > 0 && (
        <section>
          <h2>✍️ {t.myExtras}</h2>
          <div className="chip-grid">
            {own.map((tool) => (
              <button key={tool.id} className="pick on" onClick={() => db.tools.where("id").equals(tool.id!).delete()}>
                <span className="pick-mark">×</span>
                {tool.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {groups.slice(0, shown).map((g) => {
        const picked = g.entries.filter((e) => tools.some((tool) => matches(tool, e))).length;
        return (
          <section key={g.id}>
            <h2>
              {g.icon} {g[lang]} <small className="muted inline">{picked > 0 ? `· ${picked}` : ""}</small>
            </h2>
            <div className="chip-grid">
              {g.entries.map((e) => {
                const on = tools.some((tool) => matches(tool, e));
                return (
                  // The mark always takes the same space (＋ or ✓), so selecting never changes
                  // the chip's width and nothing jumps to another row.
                  <button key={e.key} className={`pick ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(e)}>
                    <span className="pick-mark">{on ? "✓" : "＋"}</span>
                    {e[lang]}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {shown < groups.length ? (
        <div ref={sentinel} className="muted center loading-more">
          {t.loadingMore}
        </div>
      ) : (
        <section>
          <h2>{t.somethingMissing}</h2>
          <form onSubmit={addCustom} className="inline-form">
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t.toolPlaceholder} aria-label={t.addTool} />
            <select value={customKind} onChange={(e) => setCustomKind(e.target.value as Tool["kind"])} className="kind-select" aria-label={t.tools}>
              <option value="tool">{t.tools}</option>
              <option value="supply">{t.supplies}</option>
            </select>
            <button className="btn primary" type="submit">
              ＋
            </button>
          </form>
        </section>
      )}
    </>
  );
}
