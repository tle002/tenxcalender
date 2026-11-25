# tenxcalender: reimagining the calendar for business users

**Prompt:** Reimagine the calendar experience for business users. Build an AI-native app that manages the user's Google Calendar.

## 1. The problem

For a manager, a calendar is a defence problem, not a storage problem. The week fills up through other people's invites, and the manager ends up doing three jobs by hand:

- **Scheduling:** compare availability, find a slot, write an invite.
- **Triage:** spot double-bookings, back-to-back days and heavy days, then work out what to move or decline.
- **Protection:** keep any focus time at all.

Existing calendars show events well but do none of this work. The "AI" features I have seen are chat panels bolted onto the side. The user still has to describe the work, read a wall of text and copy the result back into the calendar.

## 2. The idea

**State an intent, review a plan drawn on the calendar, approve it.**

- The calendar is the main screen. There is one command bar, not a chat thread: "Find 45 min with Priya and Sam this week, not mornings."
- The AI never writes directly. It returns a *plan*: a list of changes drawn on the calendar as **ghost events**. New events are dashed, moved events show the faded original plus a dashed ghost, declined events are struck through, and shortened events show the trimmed tail.
- Nothing touches the calendar until the user presses **Apply N changes**. Each change can be unticked first, and alternative slots can be swapped in.
- The AI is also **proactive**. A Briefing tab reads the week and offers one-click fixes, which load as the same ghost preview and still need Apply.

The design principle is **preview, then approve**. A calendar change sends invites to other people, so trust matters more than speed. A user who sees exactly what will happen, and can undo it, will delegate more.

## 3. What is built (MVP)

| Feature | What the user gets |
|---|---|
| Intent-based scheduling | Natural-language request, checked against everyone's free/busy, proposed as ghost events with 1-2 alternative slots. Optional Google Meet link. Follow-ups refine the current plan ("make it Thursday"). |
| Focus-time defender | Protects N hours per day. When an invite lands on a focus block, the briefing flags it and offers "decline the invite" or "move the focus block". |
| Daily briefing and conflict fixer | Meeting load per day, double-bookings, back-to-back runs, heavy days and focus collisions, each with ready-made fixes (move, shorten for a break, decline). |
| History and Undo | Every applied plan is recorded. The newest change can be undone, then the one before it, like a stack. |
| Rules | Working hours, lunch, default meeting length, focus hours, heavy-day limit and free-text notes. The planner follows them and the briefing uses them. |
| "How I got this" | Each plan lists the steps behind it and which of the user's rules shaped it. |
| Views | Day, week and month. |

The app has two modes: a seeded **demo calendar** (runs with no Google account) and **real Google Calendar** through OAuth.

## 4. Architecture

```
frontend (Next.js + FullCalendar)  <-->  backend (Express + TypeScript)  <-->  Google Calendar API
                                                |
                                                +--> Claude (tool use) for intent only
```

- **Provider pattern.** A `CalendarProvider` interface has two implementations: `MockProvider` (seeded, in memory) and `GoogleProvider`. Everything above it, including the planner, validator and detectors, is the same in both modes.
- **The LLM only proposes.** The model gets read-only tools (`get_events`, `get_freebusy`, `find_common_slots`, `plan_focus_blocks`) and must finish by calling `propose_plan`. It has no write tool. Only `POST /api/apply`, after user approval, writes.
- **Code does the maths.** Finding a common slot is interval arithmetic, and models make mistakes at it. Slot search (`slots.ts`), focus placement (`focus.ts`) and week analysis (`insights.ts`) are deterministic code. The model decides *what to look for*, and code decides *where it fits*. The briefing and its fixes use no LLM at all, so they are fast and repeatable. The LLM only writes the short narrative sentence, with a template fallback.
- **The model is never trusted.** `validateChanges` runs on every plan, and again on apply. Event details come from the calendar, not from the model. It rejects past times and unknown event ids, warns on overlaps and busy attendees, and drops a move or shorten the user cannot make (on Google, only the organiser can change an event).
- **No database.** The calendar is the system of record. App-owned state (rules, history) is small JSON under `backend/data/`. History is memory-only in demo mode.
- **Observability.** Every request, model turn, tool result and apply is logged to `backend/logs/`, so a failed request can be debugged from one file.
- **Tests.** 30 backend tests (slot search, API flow, Google provider against a fake client, OAuth, briefing, focus planner, history/undo, rules), plus browser end-to-end runs.

## 5. Decisions and trade-offs

- **Preview-and-approve over autonomy.** Slower than letting the AI act, but a wrong invite sent to a client costs more than one extra click.
- **Command bar over chat.** Calendar work is a task with a visible result, not a conversation. A single input keeps the calendar on screen.
- **Deterministic detection over LLM judgement.** A model asked "any conflicts?" will sometimes miss one. Code won't. This also makes the briefing testable.
- **Undo as a stack.** Only the newest change can be undone. Undoing an older one while newer changes sit on top can leave the calendar half-reverted. If an event was edited by someone else since, undo skips it instead of overwriting.
- **Single-user prototype.** Tokens are stored in one local file. This is the right scope for a case study, and not for production (see section 7).
- **Server clock and timezone.** The server is assumed to run in the user's timezone. Times travel as ISO strings with offsets.

## 6. Out of scope (deliberately)

Outlook and multi-calendar support, mobile, team-wide scheduling across an organisation, voice input, and learning preferences from behaviour over time. The Rules tab is the explicit, editable version of the last one: a user can see and correct what the planner assumes.

## 7. Path to production

1. **OAuth verification.** The app is in Google's test mode (100 test users, 7-day refresh tokens). Calendar scopes are "sensitive", so a public launch needs a verified consent screen, a privacy policy, a domain and a demo video.
2. **Multi-user.** Per-user sessions, encrypted token storage in a database, and per-user rules and history.
3. **Hosting.** An HTTPS domain and a redirect URI registered with Google. Secrets stay on the backend.
4. **Cost and abuse controls.** Rate limits per user, and a spending cap on model calls.
5. **Trust features.** An audit log visible to the user, "undo" for the last N actions, and per-action confirmation settings for risky changes such as declining a meeting you organised.
6. **Quality.** An evaluation set of real scheduling requests to measure plan accuracy across model versions.

## 8. What I would do next

Meeting prep (a summary of attendees and past threads before each meeting), push-style briefings (a morning message rather than a tab), and team scheduling that respects other people's rules.
