import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Tool } from "../db";
import { useI18n } from "../i18n";
import { Header } from "../components/ui";

const STARTER: Record<"en" | "de", string[]> = {
  en: ["Screwdriver set (slotted, Phillips, Pozidriv)", "Torx/Allen key set", "Adjustable wrench", "Pliers", "Water pump pliers", "Cordless drill", "Utility knife", "Tape measure", "Spirit level", "Bucket and cloths", "Bike pump", "Tyre levers"],
  de: ["Schraubendreher-Set (Schlitz, Kreuz, PZ)", "Torx/Inbus-Set", "Rollgabelschlüssel", "Kombizange", "Wasserpumpenzange", "Akkuschrauber", "Cuttermesser", "Maßband", "Wasserwaage", "Eimer und Lappen", "Fahrradpumpe", "Reifenheber"],
};

function Section({ kind, title, placeholder, addLabel, tools }: { kind: Tool["kind"]; title: string; placeholder: string; addLabel: string; tools: Tool[] }) {
  const [name, setName] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await db.tools.add({ name: name.trim(), kind });
    setName("");
  };
  return (
    <section>
      <h2>{title}</h2>
      <ul className="list">
        {tools.map((tool) => (
          <li key={tool.id} className="row">
            <span className="grow">{tool.name}</span>
            <button className="icon-btn" aria-label="Remove" onClick={() => db.tools.where("id").equals(tool.id!).delete()}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} aria-label={addLabel} />
        <button className="btn primary" type="submit">
          ＋
        </button>
      </form>
    </section>
  );
}

export default function ToolsPage() {
  const { t, lang } = useI18n();
  const tools = useLiveQuery(() => db.tools.orderBy("name").toArray(), []) ?? [];
  const addStarter = async () => {
    const have = new Set(tools.map((x) => x.name));
    await db.tools.bulkAdd(STARTER[lang].filter((n) => !have.has(n)).map((name) => ({ name, kind: "tool" as const })));
  };
  return (
    <>
      <Header title={t.tools} />
      <p className="muted">{t.toolsHint}</p>
      {tools.length === 0 && (
        <button className="btn block" onClick={addStarter}>
          🧰 {t.starterTools}
        </button>
      )}
      <Section kind="tool" title={t.tools} placeholder={t.toolPlaceholder} addLabel={t.addTool} tools={tools.filter((x) => x.kind === "tool")} />
      <Section kind="supply" title={t.supplies} placeholder={t.supplyPlaceholder} addLabel={t.addSupply} tools={tools.filter((x) => x.kind === "supply")} />
    </>
  );
}
