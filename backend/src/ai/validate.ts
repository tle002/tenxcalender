import type { CalendarProvider, CalEvent, Change, ChangeType, TimeRange } from "../types.js";
import { describe } from "./time.js";

// The model's output is untrusted. Everything is re-checked here, and facts
// about existing events (title, current time) come from the calendar, never the model.

const TYPES: ChangeType[] = ["create", "move", "decline", "shorten"];

function range(x: any): TimeRange | null {
  if (!x || typeof x.start !== "string" || typeof x.end !== "string") return null;
  const s = Date.parse(x.start);
  const e = Date.parse(x.end);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  if (e - s > 8 * 3_600_000) return null;
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString() };
}

const overlaps = (a: TimeRange, b: { start: string; end: string }) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);

export interface ValidationResult {
  changes: Change[];
  errors: { id: string; error: string }[];
}

export async function validateChanges(provider: CalendarProvider, raw: unknown[], now = new Date()): Promise<ValidationResult> {
  const out: Change[] = [];
  const errors: { id: string; error: string }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, any>;
    let id = typeof r.id === "string" && r.id && !seen.has(r.id) ? r.id : `c${i + 1}`;
    while (seen.has(id)) id += "_";
    seen.add(id);
    const fail = (error: string) => errors.push({ id, error });

    if (!TYPES.includes(r.type)) { fail(`Unknown change type "${r.type}"`); continue; }
    const type = r.type as ChangeType;
    const change: Change = {
      id,
      type,
      reason: String(r.reason ?? "").slice(0, 300),
    };

    if (type === "create") {
      const to = range(r.to);
      const title = String(r.title ?? "").trim().slice(0, 200);
      if (!title) { fail("New event needs a title"); continue; }
      if (!to) { fail(`"${title}": invalid time range`); continue; }
      if (Date.parse(to.start) < now.getTime() - 60_000) { fail(`"${title}": that time is in the past`); continue; }
      change.title = title;
      change.to = to;
      change.kind = ["meeting", "focus", "personal"].includes(r.kind) ? r.kind : "meeting";
      change.attendees = Array.isArray(r.attendees)
        ? Array.from(new Set(r.attendees.filter((a: unknown): a is string => typeof a === "string" && a.includes("@"))))
        : [];
      change.addMeetLink = r.addMeetLink === true;
      change.alternatives = (Array.isArray(r.alternatives) ? r.alternatives : [])
        .map(range)
        .filter((x: TimeRange | null): x is TimeRange => x !== null && Date.parse(x.start) >= now.getTime())
        .slice(0, 3);
    } else {
      const eventId = String(r.eventId ?? "");
      const ev = eventId ? await provider.getEvent(eventId) : null;
      if (!ev) { fail(`Event ${eventId || "(none)"} was not found`); continue; }
      change.eventId = ev.id;
      change.eventTitle = ev.title;
      change.from = { start: ev.start, end: ev.end };
      const iOrganise = !ev.organizer || ev.organizer === provider.selfEmail;
      const guests = ev.attendees.filter((a) => a !== provider.selfEmail).length;
      if (provider.strictPermissions && !iOrganise && (type === "move" || type === "shorten")) {
        fail(`You are not the organiser of "${ev.title}", so you cannot ${type} it. Decline it instead, or ask ${ev.organizer} to change it.`);
        continue;
      }
      if (type === "decline" && provider.strictPermissions && iOrganise && guests > 0) {
        change.warning = `You organise this meeting, so this cancels it for ${guests} other attendee${guests === 1 ? "" : "s"}.`;
      }
      if (type !== "decline") {
        const to = range(r.to);
        if (!to) { fail(`"${ev.title}": invalid new time`); continue; }
        if (type === "shorten" && Date.parse(to.end) - Date.parse(to.start) >= Date.parse(ev.end) - Date.parse(ev.start)) {
          fail(`"${ev.title}": shortened event must be shorter than the original`); continue;
        }
        if (Date.parse(to.start) < now.getTime() - 60_000) { fail(`"${ev.title}": that time is in the past`); continue; }
        change.to = to;
      }
    }
    out.push(change);
  }

  await addWarnings(provider, out);
  return { changes: out, errors };
}

// Flag overlaps with existing events and busy attendees, so a bad plan is visible
// to the user even if the model got it wrong.
async function addWarnings(provider: CalendarProvider, changes: Change[]) {
  const targets = changes.filter((c) => c.to);
  if (!targets.length) return;
  const min = Math.min(...targets.map((c) => Date.parse(c.to!.start)));
  const max = Math.max(...targets.map((c) => Date.parse(c.to!.end)));
  const events = await provider.listEvents(new Date(min).toISOString(), new Date(max).toISOString());
  const leaving = new Set(changes.filter((c) => c.type !== "create" && c.eventId).map((c) => c.eventId));
  const staying: CalEvent[] = events.filter((e) => e.status !== "declined" && !leaving.has(e.id));

  for (const c of targets) {
    const notes: string[] = [];
    const clash = staying.find((e) => overlaps(c.to!, e));
    if (clash) notes.push(`Overlaps "${clash.title}" (${describe(new Date(clash.start))})`);
    if (c.type === "create" && c.attendees?.length) {
      const others = c.attendees.filter((a) => a !== provider.selfEmail);
      if (others.length) {
        const fb = await provider.freeBusy(others, c.to!.start, c.to!.end);
        const who = others.filter((a) => (fb.busy[a] ?? []).some((b) => overlaps(c.to!, b)));
        if (who.length) notes.push(`${who.join(", ")} appear busy at this time`);
        if (fb.unavailable.length) notes.push(`Could not check availability for ${fb.unavailable.join(", ")}`);
      }
    }
    if (notes.length) c.warning = notes.join(". ");
  }
}
