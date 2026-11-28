# DIY Home

A personal phone app that **remembers your home** (appliances, model numbers, manuals, tools, past repairs) and **helps you fix things** with an AI that knows all of that.

- 📱 Installable web app (PWA): works on iPhone and Android, no app store
- 🔒 Your data stays on your phone (IndexedDB). Back it up with *Settings → Export backup*
- 🤖 AI help via Claude Haiku 5.5 (~0.1 cent per question), with a "Think harder" button that uses Claude Sonnet 5.5 (~1–2 cents)
- 🇬🇧 / 🇩🇪 English and German

## Using it

1. **Settings**: paste your Anthropic API key (create one at <https://console.anthropic.com> → API keys) and **set a monthly spend limit there**. Enter your country.
2. **Tools**: tap "Add common tools", then adjust the list. The AI plans around what you own.
3. **Home → an area → Add item**: name, brand, model number (photograph the type label), parts and sizes, manual PDF.
4. **Fix**: pick the item, describe the problem, add a photo, then tap *Get help*. Work through the checklist, ask follow-ups, and at the end set the status and note *what worked*. That note is shown to the AI next time something breaks on the same item.

> ⚠️ The AI refuses to walk you through gas, fixed electrical wiring, structural work and similar jobs, and tells you to call a professional. That's on purpose.

## Developing

Requires Node 20+.

```bash
npm install
npm run dev        # start at http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
npm test           # unit tests
npm run build      # type-check + production build into dist/
```

### How the code is organised

| File | What it does |
|---|---|
| `src/db.ts` | The local database: areas, items, tools, files (photos/PDFs), repairs, settings, usage |
| `src/ai.ts` | Everything that talks to Claude: system prompt (incl. safety rules), the diagnosis JSON schema, cost calculation |
| `src/repairs.ts` | The repair workflow: start → follow-up → think harder |
| `src/i18n.tsx` | All UI text in English and German |
| `src/images.ts` | Shrinks phone photos to 1568 px before saving (less storage, fewer tokens) |
| `src/backup.ts` | Export/import of everything as one JSON file (the API key is never exported) |
| `src/pages/*` | One file per screen (`WorkshopPage` = step-by-step mode with timers) |
| `src/server.ts` | Talks to the notification/calendar server |
| `src/timers.ts` | Workshop timers (stored as end times, so they survive closing the app) |
| `src/shopping.ts` | Shopping list = what open repairs need that you don't own |
| `server/` | Cloudflare Worker: Web Push (RFC 8291/8292, no libraries) + calendar feed |
| `src/styles.css` | All styling, mobile-first, light/dark mode |

**Key design decisions**

- **Local-first.** Devices, photos and repairs live only on the phone (back them up). The optional server only knows care-task titles, due dates and timers – for notifications and the calendar feed.
- **The API key lives on the device**, entered in Settings. It is never in the code or the repo.
- **Structured diagnosis.** The first AI answer is JSON validated by a Zod schema, so the app can render a checklist with tools you have and don't have, parts to buy, and safety warnings.
- **Frozen context.** The text sent with the first question is stored with the repair, so follow-ups replay exactly the same conversation.

## Notifications & calendar server (optional, free)

Push notifications (timer done, care due at a time you choose) and the self-updating calendar subscription need
a tiny server, because an iPhone web app can't notify you or keep time once it's closed. It runs on
Cloudflare's free plan (`server/`). Only care-task titles, due dates, timer labels and the push address
are stored there – no photos, devices or keys.

**One-time setup (about 10 minutes, works on the phone):**

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. In the dashboard open **Workers & Pages** once. If it asks for a `workers.dev` subdomain, pick any name.
3. Copy your **Account ID** (shown on the right of the Workers & Pages overview).
4. **My Profile → API Tokens → Create Token →** template **"Edit Cloudflare Workers"** → Continue → Create. Copy the token.
5. On GitHub: this repo → **Settings → Secrets and variables → Actions → New repository secret**, twice:
   - `CLOUDFLARE_API_TOKEN` = the token
   - `CLOUDFLARE_ACCOUNT_ID` = the account ID
6. **Actions → Deploy to GitHub Pages → Run workflow** (or merge any change). The workflow deploys the
   server and builds the app with its address.
7. In the app (opened from the home-screen icon): **⚙️ → Turn on notifications**, pick the reminder time, then
   **Care → Apple Calendar / Google Calendar** to subscribe.

Without these secrets everything else works; the app just offers per-task calendar links instead.

Server tests run locally: `cd server && npx wrangler dev`.

## Deploying

Every push to `main` builds, tests and publishes the app to GitHub Pages (`.github/workflows/deploy.yml`):

**https://benev89.github.io/DIY-Home/**

One-time setup: repo *Settings → Pages → Build and deployment → Source: GitHub Actions*.

### Installing on iPhone

1. Open the link above **in Safari** (other browsers can't install web apps on iOS).
2. Tap the Share button (square with arrow) → *Add to Home Screen* → *Add*.
3. Always start it from the home-screen icon. That copy keeps its data. A Safari tab may delete it after a few weeks without use.

Updates install themselves: after we push a change, close and reopen the app (sometimes twice).
