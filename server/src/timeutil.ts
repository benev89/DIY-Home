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
function utcFor(y: number, m: number, d: number, h: number, tz: string): number {
  let guess = Date.UTC(y, m - 1, d, h, 0);
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += Date.UTC(y, m - 1, d, h, 0) - shown;
  }
  return guess;
}
/** The next 09:00 in the user's time zone. */
export function nextNineAm(now: number, tz: string): number {
  const p = localParts(now, tz);
  const today = utcFor(p.y, p.m, p.d, 9, tz);
  return today > now ? today : utcFor(p.y, p.m, p.d + 1, 9, tz);
}

