// DIY Home server (Cloudflare Worker, free plan).
//
// What it does, and nothing more:
//  1. Calendar feed: serves your care tasks as a calendar you subscribe to once (Apple/Google).
//  2. Push notifications: "timer done" in workshop mode, and "care task due" at 09:00 your time.
//
// Data per phone: care task titles + due dates, the calendar text, active timers, the push address.
// No photos, no items, no API keys. Each phone has a random id (the feed URL) and a secret for writes.
import { DurableObject } from "cloudflare:workers";
import { generateVapidKeys, sendPush, type PushSubscriptionJSON, type VapidKeys } from "./webpush";
import { localDay, localParts, nextNineAm } from "./timeutil";

export interface Env {
  USERS: DurableObjectNamespace<UserStore>;
  ALLOWED_ORIGINS: string;
  APP_URL: string;
}

interface TaskSummary {
  title: string;
  item?: string;
  nextDue: number;
}
interface State {
  tz: string;
  lang: "en" | "de";
  ics: string;
  tasks: TaskSummary[];
  reminders: boolean;
  sub?: PushSubscriptionJSON;
  lastReminderDay?: string;
}
interface Timer {
  at: number;
  title: string;
  body: string;
  url: string;
}

const ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_BODY = 256 * 1024;

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- one Durable Object per phone (plus one "config" object for the VAPID keys) ----------
export class UserStore extends DurableObject<Env> {
  /** Config object only: the server's push keys, created on first use. */
  async vapid(): Promise<VapidKeys> {
    let keys = await this.ctx.storage.get<VapidKeys>("vapid");
    if (!keys) {
      keys = await generateVapidKeys();
      await this.ctx.storage.put("vapid", keys);
    }
    return keys;
  }

  /** First write sets the secret; later writes must present the same one. */
  async authorize(secret: string): Promise<boolean> {
    if (!secret || secret.length < 20) return false;
    const hash = await sha256(secret);
    const stored = await this.ctx.storage.get<string>("auth");
    if (!stored) {
      await this.ctx.storage.put("auth", hash);
      return true;
    }
    return stored === hash;
  }

  async getIcs(): Promise<string | undefined> {
    return (await this.ctx.storage.get<State>("state"))?.ics;
  }

  async setState(next: Omit<State, "lastReminderDay">): Promise<void> {
    const prev = await this.ctx.storage.get<State>("state");
    await this.ctx.storage.put("state", { ...next, lastReminderDay: prev?.lastReminderDay });
    await this.reschedule();
  }

  async setTimer(id: string, t: Timer): Promise<void> {
    const timers = (await this.ctx.storage.get<Record<string, Timer>>("timers")) ?? {};
    timers[id] = t;
    await this.ctx.storage.put("timers", timers);
    await this.reschedule();
  }

  async deleteTimer(id: string): Promise<void> {
    const timers = (await this.ctx.storage.get<Record<string, Timer>>("timers")) ?? {};
    delete timers[id];
    await this.ctx.storage.put("timers", timers);
    await this.reschedule();
  }

  async testPush(): Promise<string> {
    const state = await this.ctx.storage.get<State>("state");
    if (!state?.sub) return "no-subscription";
    return this.push(state, {
      title: "DIY Home",
      body: state.lang === "de" ? "Benachrichtigungen funktionieren ✓" : "Notifications work ✓",
      url: "#/settings",
      tag: "test",
    });
  }

  private async push(state: State, message: { title: string; body: string; url: string; tag: string }): Promise<string> {
    if (!state.sub) return "no-subscription";
    const keys = await this.env.USERS.get(this.env.USERS.idFromName("__config__")).vapid();
    const result = await sendPush(state.sub, message, keys, this.env.APP_URL);
    if (result === "gone") {
      // The phone unsubscribed (or reinstalled): forget the address.
      await this.ctx.storage.put("state", { ...state, sub: undefined });
    }
    return result;
  }

  private async reschedule(): Promise<void> {
    const state = await this.ctx.storage.get<State>("state");
    const timers = (await this.ctx.storage.get<Record<string, Timer>>("timers")) ?? {};
    const times = Object.values(timers).map((t) => t.at);
    if (state?.sub && state.reminders && state.tasks.length) times.push(nextNineAm(Date.now(), state.tz));
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let state = await this.ctx.storage.get<State>("state");
    const timers = (await this.ctx.storage.get<Record<string, Timer>>("timers")) ?? {};

    // 1. Timers that are due
    for (const [id, t] of Object.entries(timers)) {
      if (t.at > now + 5000) continue;
      if (state) await this.push(state, { title: t.title, body: t.body, url: t.url, tag: `timer-${id}` });
      delete timers[id];
      state = await this.ctx.storage.get<State>("state"); // push() may have cleared the subscription
    }
    await this.ctx.storage.put("timers", timers);

    // 2. Daily care reminder (once per local day, after 09:00)
    if (state?.reminders && state.sub && state.tasks.length) {
      const today = localDay(now, state.tz);
      const p = localParts(now, state.tz);
      const due = state.tasks.filter((t) => localDay(t.nextDue, state!.tz) <= today);
      if (p.h >= 9 && state.lastReminderDay !== today && due.length) {
        const de = state.lang === "de";
        await this.push(state, {
          title: de ? `🗓 Pflege fällig (${due.length})` : `🗓 Care due (${due.length})`,
          body: due
            .slice(0, 4)
            .map((t) => (t.item ? `${t.title} – ${t.item}` : t.title))
            .join(", "),
          url: "#/care",
          tag: "care",
        });
        const latest = (await this.ctx.storage.get<State>("state")) ?? state;
        await this.ctx.storage.put("state", { ...latest, lastReminderDay: today });
      }
    }
    await this.reschedule();
  }
}

// ---------- HTTP API ----------
function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return allowed.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : {};
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(req, env);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...h, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "diy-home" });
    if (url.pathname === "/vapid") {
      const keys = await env.USERS.get(env.USERS.idFromName("__config__")).vapid();
      return json({ publicKey: keys.publicKey });
    }

    // /u/:id/...
    if (parts[0] !== "u" || !parts[1] || !ID_RE.test(parts[1])) return json({ error: "not found" }, 404);
    const store = env.USERS.get(env.USERS.idFromName(`user:${parts[1]}`));

    // Calendar feed: public by unguessable id (calendar apps can't send a password).
    if (req.method === "GET" && parts[2] === "cal.ics") {
      const ics = await store.getIcs();
      return new Response(ics ?? "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//DIY Home//EN\r\nEND:VCALENDAR\r\n", {
        headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    // Everything else changes data: needs the phone's secret.
    const secret = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!(await store.authorize(secret))) return json({ error: "unauthorized" }, 401);
    const body = async <T>() => {
      const text = await req.text();
      if (text.length > MAX_BODY) throw new Error("too large");
      return JSON.parse(text) as T;
    };

    try {
      if (req.method === "PUT" && parts[2] === "state") {
        const s = await body<Omit<State, "lastReminderDay">>();
        await store.setState({
          tz: typeof s.tz === "string" ? s.tz : "UTC",
          lang: s.lang === "de" ? "de" : "en",
          ics: String(s.ics ?? ""),
          tasks: Array.isArray(s.tasks) ? s.tasks.slice(0, 500) : [],
          reminders: !!s.reminders,
          sub: s.sub,
        });
        return json({ ok: true });
      }
      if (parts[2] === "timers" && parts[3]) {
        if (req.method === "PUT") {
          const t = await body<Timer>();
          await store.setTimer(parts[3], { at: Number(t.at), title: String(t.title), body: String(t.body), url: String(t.url) });
          return json({ ok: true });
        }
        if (req.method === "DELETE") {
          await store.deleteTimer(parts[3]);
          return json({ ok: true });
        }
      }
      if (req.method === "POST" && parts[2] === "test-push") return json({ result: await store.testPush() });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "bad request" }, 400);
    }
    return json({ error: "not found" }, 404);
  },
};
