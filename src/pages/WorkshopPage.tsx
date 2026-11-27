import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router-dom";
import { db } from "../db";
import { useI18n } from "../i18n";
import { addMinutes, formatCountdown, startTimer, stopTimer, useNow, useWakeLock } from "../timers";

const QUICK_MINUTES = [5, 10, 15, 30, 60];

/**
 * Workshop mode: one step per screen, big text and buttons for dirty hands, the screen stays on,
 * and timers keep running (with a push notification) when you leave the app.
 */
export default function WorkshopPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const id = Number(useParams().id);
  const repair = useLiveQuery(() => db.repairs.get(id), [id]);
  const timers = useLiveQuery(() => db.timers.where("repairId").equals(id).toArray(), [id]);
  const [picking, setPicking] = useState(false);
  const now = useNow();
  useWakeLock(true);

  const steps = repair?.diagnosis?.steps ?? [];
  if (!repair || !steps.length) return null;
  const i = Math.min(repair.currentStep ?? firstOpen(repair.stepsDone, steps.length), steps.length - 1);
  const step = steps[i];
  const wait = Math.round(step.wait_minutes ?? 0);
  const stepTimer = timers?.find((x) => x.step === i);
  const isLast = i === steps.length - 1;

  const go = (n: number) => db.repairs.update(id, { currentStep: n, updatedAt: Date.now() });
  const done = async () => {
    const stepsDone = repair.stepsDone.includes(i) ? repair.stepsDone : [...repair.stepsDone, i];
    if (isLast) {
      await db.repairs.update(id, { stepsDone, currentStep: i, updatedAt: Date.now() });
      navigate(`/repair/${id}#status`, { replace: true });
    } else {
      await db.repairs.update(id, { stepsDone, currentStep: i + 1, updatedAt: Date.now() });
    }
  };
  const start = (minutes: number) => {
    setPicking(false);
    void startTimer({ repairId: id, step: i, label: step.title, minutes, nextStepTitle: steps[i + 1]?.title });
  };

  return (
    <div className="workshop">
      <div className="ws-top">
        <Link to={`/repair/${id}`} replace className="icon-btn" aria-label={t.close}>
          ✕
        </Link>
        <div className="ws-progress">
          <span>
            {t.step} {i + 1} / {steps.length}
          </span>
          <div className="bar">
            <div style={{ width: `${((i + (repair.stepsDone.includes(i) ? 1 : 0)) / steps.length) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="ws-body">
        <h1 className="ws-title">{step.title}</h1>
        <p className="ws-detail pre">{step.detail}</p>
        {step.warning && <div className="callout warn">⚠️ {step.warning}</div>}

        {stepTimer ? (
          <TimerCard timer={stepTimer} now={now} />
        ) : wait > 0 ? (
          <button className="btn primary block big" onClick={() => start(wait)}>
            ⏱ {t.startTimer} · {wait} {t.minutes}
          </button>
        ) : null}

        {!stepTimer &&
          (picking ? (
            <div className="chip-grid">
              {QUICK_MINUTES.map((m) => (
                <button key={m} className="pick" onClick={() => start(m)}>
                  <span className="pick-mark">⏱</span>
                  {m} {t.minutes}
                </button>
              ))}
            </div>
          ) : (
            <button className="link" onClick={() => setPicking(true)}>
              ＋ {t.ownTimer}
            </button>
          ))}

        {/* Other timers from this repair keep running in the background */}
        {timers
          ?.filter((x) => x.step !== i)
          .map((x) => (
            <button key={x.id} className="mini-timer" onClick={() => x.step !== undefined && go(x.step)}>
              ⏱ {x.label} · {x.endsAt > now ? formatCountdown(x.endsAt - now) : t.timeUp}
            </button>
          ))}

        <Link to={`/repair/${id}#ask`} className="link ask-link">
          ❓ {t.askAboutStep}
        </Link>
      </div>

      <div className="ws-nav">
        <button className="btn big" disabled={i === 0} onClick={() => go(i - 1)}>
          ‹ {t.back}
        </button>
        <button className="btn primary big grow" onClick={done}>
          {isLast ? `🎉 ${t.finish}` : `✓ ${t.doneNext}`}
        </button>
      </div>
    </div>
  );
}

function firstOpen(done: number[], n: number): number {
  for (let k = 0; k < n; k++) if (!done.includes(k)) return k;
  return 0;
}

function TimerCard({ timer, now }: { timer: import("../db").Timer; now: number }) {
  const { t } = useI18n();
  const left = timer.endsAt - now;
  const pct = Math.min(100, Math.max(0, 100 - (left / timer.durationMs) * 100));
  return (
    <div className={`timer-card ${left <= 0 ? "up" : ""}`}>
      <div className="timer-ring" style={{ ["--pct" as string]: `${pct}%` }}>
        <span>{left > 0 ? formatCountdown(left) : t.timeUp}</span>
      </div>
      <div className="row-wrap center-row">
        <button className="btn" onClick={() => addMinutes(timer, 5)}>
          +5 {t.minutes}
        </button>
        <button className="btn" onClick={() => stopTimer(timer.id!)}>
          {left > 0 ? t.stopTimer : t.dismiss}
        </button>
      </div>
      {left > 0 && <small className="muted center">{t.timerRunsInBackground}</small>}
    </div>
  );
}
