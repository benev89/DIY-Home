// Small helpers for maintenance intervals and due dates.
import { DAY } from "./db";
import type { Dict } from "./i18n";

export const INTERVAL_CHOICES = [7, 14, 30, 60, 90, 180, 365];

const fill = (s: string, n: number) => s.replace("{n}", String(n));

export function intervalLabel(days: number, t: Dict): string {
  const d = Math.round(days);
  if (d >= 365 && d % 365 === 0) return d === 365 ? t.yearly : fill(t.everyYears, d / 365);
  if (d >= 28 && Math.abs(d / 30 - Math.round(d / 30)) < 0.1) {
    const m = Math.round(d / 30);
    return m === 1 ? t.monthly : fill(t.everyMonths, m);
  }
  if (d % 7 === 0) return d === 7 ? t.weekly : fill(t.everyWeeks, d / 7);
  return d === 1 ? t.daily : fill(t.everyDays, d);
}

/** Whole days from today (midnight) to the due date; negative = overdue. */
export function daysUntil(due: number, now = Date.now()): number {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfDue = new Date(due).setHours(0, 0, 0, 0);
  return Math.round((startOfDue - startOfToday) / DAY);
}

export function dueLabel(due: number, t: Dict, now = Date.now()): string {
  const n = daysUntil(due, now);
  if (n < 0) return fill(t.overdueDays, -n);
  if (n === 0) return t.dueToday;
  if (n === 1) return t.dueTomorrow;
  return fill(t.dueInDays, n);
}

export type DueBucket = "overdue" | "soon" | "later";
export function bucket(due: number, now = Date.now()): DueBucket {
  const n = daysUntil(due, now);
  return n < 0 ? "overdue" : n <= 14 ? "soon" : "later";
}
