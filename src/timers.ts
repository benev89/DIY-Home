// Workshop timers. A timer is just an end time in the database, so it keeps "running" while the
// app is closed: the countdown is recalculated whenever you look, and the server sends a push
// notification when it ends (if notifications are on).
import { useEffect, useState } from "react";
import { db, getSetting, type Timer } from "./db";
import { cancelTimerPush, scheduleTimerPush } from "./server";
import type { Lang } from "./i18n";

let audio: AudioContext | undefined;
/** Browsers only allow sound after a tap: call this from the tap that starts a timer. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    /* no audio: the visual alert still shows */
  }
}

/** Three short beeps. */
export function beep(): void {
  try {
    if (!audio) return;
    const t0 = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.25);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + i * 0.35);
      osc.stop(t0 + i * 0.35 + 0.3);
    }
    navigator.vibrate?.([200, 100, 200, 100, 200]);
  } catch {
    /* ignore */
  }
}

export async function startTimer(opts: { repairId?: number; step?: number; label: string; minutes: number; nextStepTitle?: string }) {
  unlockAudio();
  const durationMs = Math.round(opts.minutes * 60_000);
  const endsAt = Date.now() + durationMs;
  const id = (await db.timers.add({ repairId: opts.repairId, step: opts.step, label: opts.label, endsAt, durationMs })) as number;
  const de = (await getSetting<Lang>("lang", "en")) === "de";
  const body = opts.nextStepTitle
    ? de
      ? `Zeit ist um – weiter mit: ${opts.nextStepTitle}`
      : `Time's up – next: ${opts.nextStepTitle}`
    : de
      ? "Zeit ist um."
      : "Time's up.";
  const url = opts.repairId !== undefined ? `#/repair/${opts.repairId}/work` : "#/";
  void scheduleTimerPush(String(id), endsAt, `⏱ ${opts.label}`, body, url);
  return id;
}

export async function stopTimer(id: number): Promise<void> {
  await db.timers.where("id").equals(id).delete();
  void cancelTimerPush(String(id));
}

export async function addMinutes(t: Timer, minutes: number): Promise<void> {
  const endsAt = Math.max(Date.now(), t.endsAt) + minutes * 60_000;
  await db.timers.update(t.id!, { endsAt, durationMs: t.durationMs + minutes * 60_000, finished: false });
  void scheduleTimerPush(String(t.id), endsAt, `⏱ ${t.label}`, "", t.repairId !== undefined ? `#/repair/${t.repairId}/work` : "#/");
}

/** Current time, updated every second while the screen shows a countdown. */
export function useNow(active = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now()); // don't show a stale time from before the countdown appeared
    const i = setInterval(() => setNow(Date.now()), 1000);
    const onShow = () => setNow(Date.now()); // jump to the right time when coming back to the app
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [active]);
  return now;
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Keep the screen on while working (where the browser supports it). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    const request = () =>
      navigator.wakeLock
        .request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    void request();
    const onVis = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, [active]);
}
