// Talks to the small DIY Home server (Cloudflare Worker) for push notifications and the
// calendar subscription. The server address is built into the app at deploy time; if there is
// none, everything here quietly does nothing and the app works without these features.
import { db, getSetting, setSetting } from "./db";
import { buildIcs } from "./calendar";
import type { Lang } from "./i18n";

export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const hasServer = () => !!SERVER_URL;

const rand = (n: number) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** This phone's identity on the server: a random id (also the calendar URL) and a secret for writes. */
async function identity(): Promise<{ id: string; secret: string }> {
  let id = await getSetting<string>("serverId", "");
  let secret = await getSetting<string>("serverSecret", "");
  if (!id || !secret) {
    id = rand(24);
    secret = rand(32);
    await setSetting("serverId", id);
    await setSetting("serverSecret", secret);
  }
  return { id, secret };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const { id, secret } = await identity();
  return fetch(`${SERVER_URL}/u/${id}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---------- push notifications ----------
export function pushSupported(): boolean {
  return hasServer() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

const toUint8 = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Ask for permission and register this phone for notifications. Must be called from a tap. */
export async function enablePush(): Promise<"ok" | "denied" | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch(`${SERVER_URL}/vapid`)).json();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(publicKey) }));
  await setSetting("pushSub", sub.toJSON());
  await setSetting("pushEnabled", true);
  await syncNow();
  return "ok";
}

export async function disablePush(): Promise<void> {
  await setSetting("pushEnabled", false);
  const reg = await navigator.serviceWorker?.ready;
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  await setSetting("pushSub", null);
  await syncNow();
}

export async function testPush(): Promise<string> {
  const res = await call("POST", "test-push");
  return (await res.json()).result;
}

// ---------- state sync (care tasks → calendar feed + daily reminder) ----------
export async function syncNow(): Promise<void> {
  if (!hasServer()) return;
  const tasks = await db.tasks.toArray();
  const items = await db.items.toArray();
  const nameOf = (id?: number) => items.find((i) => i.id === id)?.name;
  const withNames = tasks.map((t) => ({ ...t, itemName: nameOf(t.itemId) }));
  const pushOn = await getSetting("pushEnabled", false);
  const horizonYears = await getSetting("calendarYears", 2);
  const today = new Date().toISOString().slice(0, 10);
  const active = withNames.filter((t) => !t.remindUntil || t.remindUntil >= today);
  const res = await call("PUT", "state", {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: await getSetting<Lang>("lang", "en"),
    // No alarms in the subscribed calendar: the 09:00 push already reminds you, once.
    ics: buildIcs(withNames, Date.now(), { alarms: !pushOn, name: "DIY Home", horizonYears }),
    tasks: active.map((t) => ({ title: t.title, item: t.itemName, nextDue: t.nextDue })),
    reminders: pushOn && (await getSetting("careReminders", true)),
    sub: pushOn ? ((await getSetting("pushSub", null)) ?? undefined) : undefined,
  });
  if (res.ok) await setSetting("lastSync", Date.now());
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Sync a moment after the last change (many quick changes → one request). */
export function syncSoon(): void {
  if (!hasServer()) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow().catch(() => {}), 1500);
}

// ---------- workshop timers ----------
export async function scheduleTimerPush(id: string, at: number, title: string, body: string, url: string): Promise<void> {
  if (!hasServer() || !(await getSetting("pushEnabled", false))) return;
  await call("PUT", `timers/${id}`, { at, title, body, url }).catch(() => {});
}

export async function cancelTimerPush(id: string): Promise<void> {
  if (!hasServer()) return;
  await call("DELETE", `timers/${id}`).catch(() => {});
}

// ---------- calendar subscription links ----------
export async function calendarLinks(): Promise<{ webcal: string; https: string; google: string } | null> {
  if (!hasServer()) return null;
  const { id } = await identity();
  const https = `${SERVER_URL}/u/${id}/cal.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return { https, webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` };
}
