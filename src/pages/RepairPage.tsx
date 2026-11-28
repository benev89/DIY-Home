import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { addTask, db, deleteRepair, type RepairStatus } from "../db";
import { useI18n } from "../i18n";
import { describeError, MODELS, preventionTips, RefusalError } from "../ai";
import { askFollowUp, thinkHarder } from "../repairs";
import { formatUsd, Header, PhotoPicker, Thumb } from "../components/ui";
import { DictationTextarea } from "../components/Dictation";
import { useDraft } from "../persist";
import { formatDate, underWarranty } from "../warranty";
import { NeedsList } from "../components/NeedsList";
import { intervalLabel } from "../care";

const STATUSES: RepairStatus[] = ["open", "fixed", "not_fixed", "pro"];

export default function RepairPage() {
  const { t } = useI18n();
  const id = Number(useParams().id);
  const repair = useLiveQuery(() => db.repairs.get(id), [id]);
  const item = useLiveQuery(() => (repair?.itemId ? db.items.get(repair.itemId) : undefined), [repair?.itemId]);
  const navigate = useNavigate();
  // Follow-up text and photos are drafts: they survive closing the app.
  const [fu, setFu, , clearFu] = useDraft<{ q: string; photos: number[] }>(`followup:${id}`, { q: "", photos: [] });
  const question = fu.q;
  const questionPhotos = fu.photos;
  const setQuestion = (q: string) => setFu((d) => ({ ...d, q }));
  const setQuestionPhotos = (photos: number[]) => setFu((d) => ({ ...d, photos }));
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const [outcome, setOutcome] = useState<string>();
  const [strong, setStrong] = useState(false);
  const [busy, setBusy] = useState<"followup" | "harder" | null>(null);
  const [error, setError] = useState<string>();

  // "#status" / "#ask" in the address (e.g. after finishing workshop mode): jump there.
  const location = useLocation();
  useEffect(() => {
    if (!repair || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    setTimeout(() => el?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }, [location.hash, !!repair]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!repair) return null;
  const d = repair.diagnosis;

  const run = async (kind: "followup" | "harder", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof RefusalError ? t.refused : `${t.errorPrefix} ${describeError(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleStep = (i: number) => {
    const done = repair.stepsDone.includes(i) ? repair.stepsDone.filter((x) => x !== i) : [...repair.stepsDone, i];
    void db.repairs.update(id, { stepsDone: done, updatedAt: Date.now() });
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    void run("followup", async () => {
      await askFollowUp(id, q, strong ? MODELS.strong : MODELS.fast, questionPhotos);
      clearFu();
    });
  };

  return (
    <>
      <Header back title={repair.title} />
      {underWarranty(item) && (
        <div className="callout warn">
          🛡 <strong>
            {t.warrantyValidUntil} {formatDate(item!.warrantyUntil!)}
          </strong>
          <br />
          {t.warrantyWarning} {item!.receiptPhotoIds?.length ? t.receiptSaved : t.receiptMissing}
        </div>
      )}
      {item && (
        <p className="muted">
          {t.forItem} <Link to={`/item/${item.id}`}>{item.name}</Link>
        </p>
      )}
      <details className="problem">
        <summary>{t.whatsWrong}</summary>
        <p className="pre">{repair.problem}</p>
        <div className="photos">
          {repair.photoIds.map((p) => (
            <Thumb key={p} id={p} />
          ))}
        </div>
      </details>

      {d && (
        <>
          {d.safety.level !== "ok" && (
            <div className={`callout ${d.safety.level === "stop" ? "error" : "warn"}`}>
              <strong>{d.safety.level === "stop" ? `⛔ ${t.safetyStop}` : `⚠️ ${t.safetyCaution}`}</strong>
              <ul>
                {d.safety.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {d.safety.level === "ok" && d.safety.notes.length > 0 && (
            <div className="callout">
              <strong>{t.safety}</strong>
              <ul>
                {d.safety.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <p>{d.summary}</p>
          {repair.research && (
            <details className="research">
              <summary>
                🔎 {t.researchFound} ({repair.research.sources.length} {t.sources})
              </summary>
              <p className="pre">{repair.research.summary}</p>
              {repair.research.suggestionsHtml && (
                // Google requires showing its search suggestions next to answers grounded with Google Search.
                <iframe
                  className="google-suggestions"
                  title="Google Search Suggestions"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={`<base target="_blank">${repair.research.suggestionsHtml}`}
                />
              )}
              <small className="muted">{repair.research.provider === "gemini" ? t.viaGemini : t.viaClaude}</small>
              <ul>
                {repair.research.sources.map((src) => (
                  <li key={src.url}>
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="chips">
            <span className="chip">
              {t.difficulty}: {t[`difficulty_${d.difficulty}`]}
            </span>
            <span className="chip">~{Math.round(d.minutes)} {t.minutes}</span>
          </p>

          {d.questions.length > 0 && (
            <section>
              <h2>{t.questionsForYou}</h2>
              <ul>
                {d.questions.map((q, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => setQuestion(q + "\n→ ")}>
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {d.checks_first.length > 0 && (
            <section>
              <h2>{t.quickChecks}</h2>
              <ul>
                {d.checks_first.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2>{t.likelyCauses}</h2>
            <ul className="causes">
              {d.causes.map((c, i) => (
                <li key={i}>
                  <span className={`badge like-${c.likelihood}`}>{t[`likelihood_${c.likelihood}`]}</span> <strong>{c.cause}</strong>
                  <small>
                    {t.howToCheck}: {c.how_to_check}
                  </small>
                </li>
              ))}
            </ul>
          </section>

          {(d.tools.length > 0 || d.parts.length > 0) && (
            <section>
              <h2>{t.youNeed}</h2>
              <p className="muted small">{t.needsHint}</p>
              <NeedsList kind="tool" needs={d.tools.map((x) => ({ name: x.name, ownedAs: x.owned_as ?? (x.owned ? undefined : ""), catalogKey: x.catalog_key }))} />
              {d.parts.length > 0 && (
                <>
                  <h3>{t.parts}</h3>
                  <NeedsList
                    kind="supply"
                    needs={d.parts.map((p) => ({ name: p.name, detail: [p.spec, p.price_estimate].filter(Boolean).join(" · "), ownedAs: "", catalogKey: p.catalog_key }))}
                  />
                </>
              )}
            </section>
          )}

          {d.steps.length > 0 && (
            <Link to={`/repair/${id}/work`} className="btn primary block big">
              ▶︎ {repair.stepsDone.length ? t.continueWork : t.startWorkshop}
            </Link>
          )}

          {d.steps.length > 0 && (
            <section>
              <h2>
                {t.steps} ({repair.stepsDone.length}/{d.steps.length})
              </h2>
              <ol className="steps">
                {d.steps.map((s, i) => (
                  <li key={i} className={repair.stepsDone.includes(i) ? "done" : ""}>
                    <label>
                      <input type="checkbox" checked={repair.stepsDone.includes(i)} onChange={() => toggleStep(i)} />
                      <span>
                        <strong>{s.title}</strong>
                        <span className="pre">{s.detail}</span>
                        {s.warning && <span className="warn-text">⚠️ {s.warning}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {d.stop_and_call_pro_if && (
            <div className="callout warn">
              <strong>{t.stopIf}:</strong> {d.stop_and_call_pro_if}
            </div>
          )}

          {preventionTips(d).length > 0 && (
            <section className={`prevention ${repair.status === "fixed" ? "highlight" : ""}`}>
              <h2>🛡️ {t.prevention}</h2>
              <ul className="tips">
                {preventionTips(d).map((p, i) => {
                  const added = tasks?.some((tk) => tk.title === p.tip && tk.itemId === repair.itemId);
                  return (
                    <li key={i}>
                      <span>{p.tip}</span>
                      {p.interval_days > 0 && (
                        <button
                          className={`pick small-pick ${added ? "on" : ""}`}
                          disabled={added}
                          onClick={() => addTask({ itemId: repair.itemId, title: p.tip, intervalDays: Math.round(p.interval_days) })}
                        >
                          <span className="pick-mark">{added ? "✓" : "＋"}</span>
                          {added ? t.reminderAdded : `${t.addReminder} · ${intervalLabel(p.interval_days, t)}`}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <button className="btn block" disabled={!!busy} onClick={() => run("harder", () => thinkHarder(id))}>
            {busy === "harder" ? <span className="spinner">{t.diagnosing}</span> : `🧠 ${t.thinkHarder}`}
          </button>
          <small className="muted center">{t.thinkHarderHint}</small>
        </>
      )}

      <section id="ask">
        <h2>{t.followUp}</h2>
        <div className="chat">
          {repair.chat.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {!!m.photoIds?.length && (
                <div className="photos">
                  {m.photoIds.map((p) => (
                    <Thumb key={p} id={p} />
                  ))}
                </div>
              )}
              <span className="pre">{m.text}</span>
              {m.model === MODELS.strong && <small className="muted"> 🧠</small>}
            </div>
          ))}
        </div>
        <form onSubmit={send} className="form">
          <DictationTextarea rows={3} value={question} onChange={setQuestion} placeholder={t.followUpPlaceholder} />
          <PhotoPicker ids={questionPhotos} onChange={setQuestionPhotos} />
          <label className="check">
            <input type="checkbox" checked={strong} onChange={(e) => setStrong(e.target.checked)} />
            🧠 {t.thinkHarder}
          </label>
          <button className="btn primary block" type="submit" disabled={!!busy || !question.trim()}>
            {busy === "followup" ? <span className="spinner">{t.diagnosing}</span> : t.send}
          </button>
        </form>
      </section>

      {error && <div className="callout error">{error}</div>}

      <section id="status">
        <h2>{t.status}</h2>
        <div className="segmented">
          {STATUSES.map((s) => (
            <button key={s} className={repair.status === s ? "active" : ""} onClick={() => db.repairs.update(id, { status: s, updatedAt: Date.now() })}>
              {t[`status_${s}`]}
            </button>
          ))}
        </div>
        <label className="form">
          {t.outcome}
          <DictationTextarea
            rows={2}
            value={outcome ?? repair.outcome ?? ""}
            placeholder={t.outcomePlaceholder}
            onChange={(v) => {
              setOutcome(v);
              void db.repairs.update(id, { outcome: v, updatedAt: Date.now() }); // saved on every keystroke
            }}
          />
        </label>
        <p className="muted small">
          {t.cost}: {formatUsd(repair.costUsd)}
        </p>
      </section>
      <button
        className="btn ghost block danger"
        onClick={async () => {
          if (!confirm(t.confirmDelete)) return;
          await deleteRepair(id);
          clearFu();
          navigate(-1);
        }}
      >
        🗑 {t.delete}
      </button>
    </>
  );
}
