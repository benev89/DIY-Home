// Calendar reminders: turn care tasks into a standard .ics file (repeating events with an alert)
// that the iPhone Calendar (or Google/Outlook) can import. No server needed.
import type { Task } from "./db";

const pad = (n: number) => String(n).padStart(2, "0");
const dateOnly = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};
const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines in .ics files must be at most 75 bytes; longer ones continue on the next line after a space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Repeat rule: prefer weeks/months/years so the calendar shows "every 3 months" rather than "every 90 days". */
export function rrule(days: number): string {
  if (days % 365 === 0) return `FREQ=YEARLY;INTERVAL=${days / 365}`;
  if (days >= 28 && Math.abs(days / 30 - Math.round(days / 30)) < 0.1) return `FREQ=MONTHLY;INTERVAL=${Math.round(days / 30)}`;
  if (days % 7 === 0) return `FREQ=WEEKLY;INTERVAL=${days / 7}`;
  return `FREQ=DAILY;INTERVAL=${days}`;
}

export function buildIcs(
  tasks: (Task & { itemName?: string })[],
  now = Date.now(),
  opts: { alarms?: boolean; name?: string } = {},
): string {
  const alarms = opts.alarms ?? true;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DIY Home//Care reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (opts.name) lines.push(`X-WR-CALNAME:${escape(opts.name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H");
  for (const t of tasks) {
    const title = `🔧 ${t.title}${t.itemName ? ` – ${t.itemName}` : ""}`;
    const start = Math.max(t.nextDue, now);
    lines.push(
      "BEGIN:VEVENT",
      `UID:diy-home-task-${t.id}-${t.createdAt}@diy-home`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART;VALUE=DATE:${dateOnly(start)}`,
      `DTEND;VALUE=DATE:${dateOnly(start + 86_400_000)}`,
      `RRULE:${rrule(t.intervalDays)}`,
      `SUMMARY:${escape(title)}`,
      ...(t.how ? [`DESCRIPTION:${escape(t.how)}`] : []),
      "TRANSP:TRANSPARENT",
      ...(alarms ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escape(title)}`, "TRIGGER:PT9H", "END:VALARM"] : []), // 09:00 on the due day
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Hand the file to the phone. On iPhone the share sheet opens; choose "Calendar" (or "Save to Files",
 * then open the file and tap "Add All"). Elsewhere the file is downloaded and opens in the calendar app.
 */
export async function exportToCalendar(tasks: (Task & { itemName?: string })[], filename = "diy-home-pflege.ics") {
  const file = new File([buildIcs(tasks)], filename, { type: "text/calendar" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user closed the sheet
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Google Calendar "new event" page, pre-filled with one repeating all-day event. Works without a server. */
export function googleEventUrl(t: Task & { itemName?: string }, now = Date.now()): string {
  const start = Math.max(t.nextDue, now);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `🔧 ${t.title}${t.itemName ? ` – ${t.itemName}` : ""}`,
    dates: `${dateOnly(start)}/${dateOnly(start + 86_400_000)}`,
    details: t.how ?? "",
    recur: `RRULE:${rrule(t.intervalDays)}`,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
