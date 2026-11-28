// ---------- time zone helpers (no libraries: Intl does the work) ----------
export function localParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}
export function localDay(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
function utcFor(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += Date.UTC(y, m - 1, d, h, mi) - shown;
  }
  return guess;
}

/** "HH:MM" → [hours, minutes]; anything invalid → 09:00. */
export function parseTime(t: string | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  const h = m ? Number(m[1]) : 9;
  const mi = m ? Number(m[2]) : 0;
  return h < 24 && mi < 60 ? [h, mi] : [9, 0];
}

/** The next time the clock shows `time` ("HH:MM") in the user's time zone. */
export function nextLocalTime(now: number, tz: string, time = "09:00"): number {
  const [h, mi] = parseTime(time);
  const p = localParts(now, tz);
  const today = utcFor(p.y, p.m, p.d, h, mi, tz);
  return today > now ? today : utcFor(p.y, p.m, p.d + 1, h, mi, tz);
}

/** Has the local clock reached `time` today? */
export function reachedLocalTime(now: number, tz: string, time = "09:00"): boolean {
  const [h, mi] = parseTime(time);
  const p = localParts(now, tz);
  return p.h * 60 + p.mi >= h * 60 + mi;
}

