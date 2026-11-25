# tenxcalender: an AI-native calendar manager

The calendar is the main screen. You state an intent, the AI plans the changes,
they appear on the calendar as ghost events, and nothing is written until you apply.

> Status: **Steps 1-2 done** (mock calendar, week view, command bar, AI planning, ghost events, apply/discard). Focus time and briefing next.

## Features

- Command bar: state an intent, review ghost events, then Apply.
- Briefing tab: conflicts, back-to-backs, heavy days, focus collisions, each with one-click fixes.
- Focus-time defender, History with Undo (newest change first), Rules tab.
- Day, week and month views.

See [docs/WRITEUP.md](docs/WRITEUP.md) for the thinking behind it and [docs/DEMO.md](docs/DEMO.md) for the demo script.

## Structure
```
backend/    Express + TypeScript API (port 4000): providers, AI, detectors, routes
frontend/   Next.js + FullCalendar UI (port 3000)
docs/       write-up and demo script
```

## Run it (two terminals)
Requires Node 20+.

```bash
# terminal 1
cd backend
npm install
npm run dev        # http://localhost:4000/api/health

# terminal 2
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Config lives in `backend/.env` (see `backend/.env.example`). By default `USE_MOCK=true`
uses a seeded demo calendar, so no Google setup is needed. The seed is generated
relative to the current week (Mon-Fri) and includes back-to-back meetings on Monday,
a double-booking on Tuesday and a heavy Wednesday. Use **Reset demo** to restore it.

## Using the AI planner
1. `copy backend\.env.example backend\.env` (macOS/Linux: `cp`), then set `ANTHROPIC_API_KEY=` in `backend/.env`. Restart the backend.
2. In the command bar try: `Find 45 min with Priya and Sam this week, not mornings`.
3. The plan shows as dashed ghost events and in the right panel. Click another slot under "Other options" to swap, untick a change to exclude it, or type a follow-up like `make it Thursday` to refine.
4. **Apply** writes to the calendar. Nothing is written before that.

The model name is `ANTHROPIC_MODEL` in `backend/.env`.

## How it works
- The LLM gets read-only tools (`get_events`, `get_freebusy`, `find_common_slots`) and must finish by calling `propose_plan`. It has no write tools.
- `find_common_slots` does the free/busy interval maths in code, so the model never double-books by an arithmetic slip.
- Server validation re-checks every proposed change against the real calendar (event exists, times valid, not in the past, overlaps and busy attendees flagged). Event titles and times come from the calendar, never from the model.
- `POST /api/plan` never writes. `POST /api/apply` is the only write path and re-validates the approved changes.

## Tests
```bash
cd backend && npm test      # slot maths, planner tool loop (fake LLM), plan/apply API, validation
```

## Logs and debugging
Every backend run writes `backend/logs/run-<timestamp>.log` (last 20 kept), and `backend/logs/latest.log` is always the most recent run.
It records startup config (never the API key), each request, the user's intent, every model turn and tool call, the validated plan,
each calendar write, and browser-side actions and errors. If something looks wrong, open `latest.log` first.

## Connect your real Google Calendar
1. Google Cloud: enable the Google Calendar API, create an OAuth consent screen (External, Testing) with your Gmail as a test user and scopes
   `calendar.events` + `calendar.readonly`, then create an OAuth client (Web application) with
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
2. In `backend/.env` set `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=` and `USE_MOCK=false`, then restart the backend.
3. Open http://localhost:3000, click **Connect Google Calendar**, and approve. (Test mode shows an "unverified app" warning: Advanced, then Go to tenxcalender.)
4. Your session is stored in `backend/.google-tokens.json` (git-ignored). **Disconnect** deletes it. In Google's test mode, sign-ins expire after about 7 days.

With the real calendar, **Apply** creates events and Google emails invitations to attendees; Meet links are real.
Real-calendar rules are enforced: you can only move or shorten meetings you organise (otherwise decline), declining a meeting you organise cancels it for its attendees (the panel warns you), and free/busy is only visible for people in your Google Workspace or who share their calendar (others are flagged as "availability unknown").

## Demo mode vs Google Calendar
With `USE_MOCK=true` (default) changes live only in the app's memory: nothing is sent to Google Calendar, no invites or emails go out,
and meeting links are placeholders. Switch to the real calendar by completing the Google OAuth step and setting `USE_MOCK=false`.

## Quick checks
```bash
curl http://localhost:4000/api/health
curl "http://localhost:4000/api/events?start=2026-11-23T00:00:00Z&end=2026-11-30T00:00:00Z"
```
