import type { BusyBlock, CalEvent, CalendarProvider, CreateInput, FreeBusyResult, Person } from "../types.js";
import { ME, PEOPLE, seedBusy, seedEvents } from "./seed.js";

// Looks like a Google Meet code (abc-defg-hij). The real provider asks Google to create one.
function fakeMeetLink(): string {
  const part = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
  return `https://meet.google.com/${part(3)}-${part(4)}-${part(3)}`;
}

// In-memory calendar behind the same interface as Google. Resets on restart
// (or POST /api/reset) so the demo is repeatable.
export class MockProvider implements CalendarProvider {
  readonly selfEmail = ME;
  readonly strictPermissions = false;

  private events: CalEvent[] = seedEvents();
  private busy = seedBusy();
  private nextId = 1000;

  reset() {
    this.events = seedEvents();
    this.busy = seedBusy();
  }

  async listEvents(rangeStart: string, rangeEnd: string): Promise<CalEvent[]> {
    const s = Date.parse(rangeStart);
    const e = Date.parse(rangeEnd);
    return this.events
      .filter((ev) => Date.parse(ev.end) > s && Date.parse(ev.start) < e)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }

  async getEvent(eventId: string): Promise<CalEvent | null> {
    return this.events.find((e) => e.id === eventId && e.status !== "declined") ?? null;
  }

  async people(): Promise<Person[]> {
    return Object.entries(PEOPLE).map(([email, name]) => ({ name, email }));
  }

  async freeBusy(emails: string[], rangeStart: string, rangeEnd: string): Promise<FreeBusyResult> {
    const s = Date.parse(rangeStart);
    const e = Date.parse(rangeEnd);
    const out: Record<string, BusyBlock[]> = {};
    const unavailable = emails.filter((e) => e !== ME && !(e in PEOPLE));
    for (const email of emails) {
      const blocks: BusyBlock[] = [];
      // Events this person attends (declined ones are free time).
      for (const ev of this.events) {
        if (ev.status === "declined") continue;
        if (ev.attendees.includes(email)) blocks.push({ start: ev.start, end: ev.end });
      }
      if (email !== ME) blocks.push(...(this.busy[email] ?? []));
      out[email] = blocks
        .filter((x) => Date.parse(x.end) > s && Date.parse(x.start) < e)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    }
    return { busy: out, unavailable };
  }

  async create(input: CreateInput): Promise<CalEvent> {
    const ev: CalEvent = {
      id: `evt_${++this.nextId}`,
      title: input.title,
      start: input.start,
      end: input.end,
      attendees: Array.from(new Set([ME, ...(input.attendees ?? [])])),
      organizer: ME,
      kind: input.kind ?? "meeting",
      status: "accepted",
      ...(input.addMeetLink ? { meetLink: fakeMeetLink() } : {}),
    };
    this.events.push(ev);
    return ev;
  }

  async move(eventId: string, start: string, end: string): Promise<CalEvent> {
    const ev = this.events.find((x) => x.id === eventId);
    if (!ev) throw new Error(`Event not found: ${eventId}`);
    ev.start = start;
    ev.end = end;
    return ev;
  }

  async decline(eventId: string): Promise<void> {
    const ev = this.events.find((x) => x.id === eventId);
    if (!ev) throw new Error(`Event not found: ${eventId}`);
    ev.status = "declined";
  }
}
