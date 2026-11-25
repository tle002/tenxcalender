import type { BusyBlock, CalEvent } from "../types.js";

export const ME = "you@acme.com";
export const PEOPLE: Record<string, string> = {
  "priya@acme.com": "Priya Sharma",
  "sam@acme.com": "Sam Lee",
  "dev@acme.com": "Dev Patel",
  "mia@acme.com": "Mia Chen",
};

// Monday 00:00 (local) of the demo week. Weekends roll forward to next week
// so the demo always has upcoming days to work with.
export function demoWeekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  else d.setDate(d.getDate() - (dow - 1));
  return d;
}

function plusWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + 7);
  return x;
}

function at(weekStart: Date, dayOffset: number, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

let n = 0;
function ev(
  ws: Date,
  day: number,
  start: string,
  end: string,
  title: string,
  attendees: string[] = [],
  extra: Partial<CalEvent> = {},
): CalEvent {
  return {
    id: `evt_${++n}`,
    title,
    start: at(ws, day, start),
    end: at(ws, day, end),
    attendees: [ME, ...attendees],
    organizer: attendees[0] ?? ME,
    kind: "meeting",
    status: "accepted",
    ...extra,
  };
}

// A reactive manager's week: back-to-backs Monday, a hard conflict Tuesday,
// a brutally heavy Wednesday, lighter Thursday/Friday.
export function seedEvents(ws = demoWeekStart()): CalEvent[] {
  n = 0;
  // This week and next week, so there are always upcoming days to demo on.
  return [...seedWeek(ws), ...seedWeek(plusWeek(ws))];
}

function seedWeek(ws: Date): CalEvent[] {
  const P = "priya@acme.com", S = "sam@acme.com", D = "dev@acme.com", M = "mia@acme.com";
  return [
    // Monday: three back-to-backs in the morning
    ev(ws, 0, "09:30", "10:00", "Team standup", [D, M, P]),
    ev(ws, 0, "10:00", "11:00", "Roadmap review", [P, S]),
    ev(ws, 0, "11:00", "12:00", "1:1 with Priya", [P]),
    ev(ws, 0, "14:00", "15:00", "Vendor sync", [D]),
    ev(ws, 0, "15:00", "16:00", "Design review", [M, S]),
    ev(ws, 0, "16:00", "16:30", "Hiring debrief", [P]),

    // Tuesday: hard conflict 11:00-12:00 vs 11:30-12:30
    ev(ws, 1, "09:00", "10:30", "Weekly staff meeting", [P, S, D, M]),
    ev(ws, 1, "11:00", "12:00", "Customer call: Northwind", [S]),
    ev(ws, 1, "11:30", "12:30", "Budget check-in", [D]),
    ev(ws, 1, "14:00", "16:00", "Sprint planning", [P, S, D, M]),
    ev(ws, 1, "16:30", "17:30", "Interview: Staff engineer", [M]),

    // Wednesday: heavy day (~7h of meetings)
    ev(ws, 2, "09:00", "09:30", "Team standup", [D, M, P]),
    ev(ws, 2, "10:00", "11:00", "Product sync", [P, S]),
    ev(ws, 2, "11:00", "11:30", "1:1 with Sam", [S]),
    ev(ws, 2, "11:30", "12:30", "Launch readiness", [P, S, D]),
    ev(ws, 2, "13:00", "14:00", "Lunch & learn", [M]),
    ev(ws, 2, "14:00", "15:00", "Stakeholder update", [S, D]),
    ev(ws, 2, "15:00", "16:00", "Partner call: Contoso", [P]),
    ev(ws, 2, "16:00", "17:00", "Sprint retro", [P, S, D, M]),

    // Thursday: light
    ev(ws, 3, "10:00", "11:00", "Design crit", [M]),
    ev(ws, 3, "15:00", "15:30", "1:1 with Priya", [P]),

    // Friday
    ev(ws, 4, "09:30", "10:00", "Team standup", [D, M, P]),
    ev(ws, 4, "11:00", "11:45", "Skip-level with Dev", [D]),
    ev(ws, 4, "14:00", "15:00", "Weekly demo", [P, S, D, M]),

    // Protected focus time. Friday's block has a NEW invite landing on top of it.
    ev(ws, 3, "11:30", "13:30", "Focus time", [], { kind: "focus", organizer: ME }),
    ev(ws, 4, "15:00", "17:00", "Focus time", [], { kind: "focus", organizer: ME }),
    ev(ws, 4, "15:30", "16:00", "Partner check-in", [S], { status: "needsAction" }),
  ];
}

// Other people's calendars (busy time not already implied by shared events).
// Used by the scheduler to find mutual availability.
export function seedBusy(ws = demoWeekStart()): Record<string, BusyBlock[]> {
  const a = seedBusyWeek(ws);
  const b = seedBusyWeek(plusWeek(ws));
  return Object.fromEntries(Object.keys(a).map((k) => [k, [...a[k], ...b[k]]]));
}

function seedBusyWeek(ws: Date): Record<string, BusyBlock[]> {
  const b = (day: number, s: string, e: string): BusyBlock => ({ start: at(ws, day, s), end: at(ws, day, e) });
  return {
    "priya@acme.com": [b(0, "09:00", "09:30"), b(1, "10:30", "11:30"), b(2, "12:30", "13:30"), b(3, "09:00", "12:00"), b(4, "13:00", "14:00")],
    "sam@acme.com": [b(0, "13:00", "14:00"), b(2, "12:30", "13:00"), b(3, "13:00", "15:00"), b(4, "09:00", "10:30")],
    "dev@acme.com": [b(1, "13:00", "14:00")],
    "mia@acme.com": [b(3, "11:00", "12:00")],
  };
}
