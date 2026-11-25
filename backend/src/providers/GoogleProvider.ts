import { randomUUID } from "node:crypto";
import type { calendar_v3 } from "googleapis";
import type { BusyBlock, CalEvent, CalendarProvider, CreateInput, FreeBusyResult, Person } from "../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (e: unknown) => (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;

// Real Google Calendar behind the same interface as the mock. The calendar client
// is injected so it can be tested without network access.
export class GoogleProvider implements CalendarProvider {
  readonly strictPermissions = true;

  constructor(
    private readonly cal: calendar_v3.Calendar,
    readonly selfEmail: string,
    private readonly pollMs = 700,
  ) {}

  private map(e: calendar_v3.Schema$Event): CalEvent | null {
    if (!e.id || e.status === "cancelled") return null;
    if (!e.start?.dateTime || !e.end?.dateTime) return null; // skip all-day events
    const me = e.attendees?.find((a) => a.self);
    const attendees = (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x));
    if (!attendees.includes(this.selfEmail)) attendees.unshift(this.selfEmail);
    return {
      id: e.id,
      title: e.summary || "(no title)",
      start: e.start.dateTime,
      end: e.end.dateTime,
      attendees,
      organizer: e.organizer?.email ?? undefined,
      kind: e.eventType === "focusTime" ? "focus" : e.eventType === "outOfOffice" ? "personal" : "meeting",
      status: me?.responseStatus === "declined" ? "declined" : me?.responseStatus === "needsAction" ? "needsAction" : "accepted",
      meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? undefined,
    };
  }

  async listEvents(rangeStart: string, rangeEnd: string): Promise<CalEvent[]> {
    const res = await this.cal.events.list({
      calendarId: "primary",
      timeMin: rangeStart,
      timeMax: rangeEnd,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });
    return (res.data.items ?? []).map((e) => this.map(e)).filter((e): e is CalEvent => e !== null);
  }

  async getEvent(eventId: string): Promise<CalEvent | null> {
    try {
      const res = await this.cal.events.get({ calendarId: "primary", eventId });
      const ev = this.map(res.data);
      return ev && ev.status !== "declined" ? ev : null;
    } catch (err) {
      if (status(err) === 404 || status(err) === 410) return null;
      throw err;
    }
  }

  async freeBusy(emails: string[], rangeStart: string, rangeEnd: string): Promise<FreeBusyResult> {
    const res = await this.cal.freebusy.query({
      requestBody: { timeMin: rangeStart, timeMax: rangeEnd, items: emails.map((id) => ({ id })) },
    });
    const busy: Record<string, BusyBlock[]> = {};
    const unavailable: string[] = [];
    for (const email of emails) {
      const c = res.data.calendars?.[email];
      if (!c || (c.errors && c.errors.length)) {
        unavailable.push(email); // not in the user's org, or calendar not shared
        continue;
      }
      busy[email] = (c.busy ?? []).filter((b) => b.start && b.end).map((b) => ({ start: b.start!, end: b.end! }));
    }
    return { busy, unavailable };
  }

  async create(input: CreateInput): Promise<CalEvent> {
    const res = await this.cal.events.insert({
      calendarId: "primary",
      sendUpdates: "all", // email invitations to attendees
      conferenceDataVersion: input.addMeetLink ? 1 : 0,
      requestBody: {
        summary: input.title,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        attendees: (input.attendees ?? []).filter((a) => a !== this.selfEmail).map((email) => ({ email })),
        ...(input.addMeetLink
          ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
          : {}),
      },
    });
    let data = res.data;
    // Google creates the Meet room asynchronously; poll briefly for the link.
    for (let i = 0; input.addMeetLink && !data.hangoutLink && data.id && i < 5; i++) {
      await sleep(this.pollMs);
      data = (await this.cal.events.get({ calendarId: "primary", eventId: data.id })).data;
    }
    const ev = this.map(data);
    if (!ev) throw new Error("Google created the event but returned an unreadable response.");
    return ev;
  }

  async move(eventId: string, start: string, end: string): Promise<CalEvent> {
    const res = await this.cal.events.patch({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
      requestBody: { start: { dateTime: start }, end: { dateTime: end } },
    });
    const ev = this.map(res.data);
    if (!ev) throw new Error("Google updated the event but returned an unreadable response.");
    return ev;
  }

  // Attendee: respond "declined". Organiser: there is nobody to decline to, so the event is cancelled.
  async decline(eventId: string): Promise<void> {
    const { data: e } = await this.cal.events.get({ calendarId: "primary", eventId });
    const iOrganise = e.organizer?.self || e.organizer?.email === this.selfEmail || !e.attendees?.length;
    if (iOrganise) {
      await this.cal.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" });
      return;
    }
    const attendees = (e.attendees ?? []).map((a) => (a.self || a.email === this.selfEmail ? { ...a, responseStatus: "declined" } : a));
    await this.cal.events.patch({ calendarId: "primary", eventId, sendUpdates: "all", requestBody: { attendees } });
  }

  // Name -> email directory built from people on recent and upcoming events.
  async people(): Promise<Person[]> {
    const now = Date.now();
    const res = await this.cal.events.list({
      calendarId: "primary",
      timeMin: new Date(now - 45 * 86_400_000).toISOString(),
      timeMax: new Date(now + 30 * 86_400_000).toISOString(),
      singleEvents: true,
      maxResults: 250,
    });
    const seen = new Map<string, { name: string; n: number }>();
    for (const e of res.data.items ?? []) {
      for (const a of e.attendees ?? []) {
        if (!a.email || a.self || a.resource || a.email === this.selfEmail) continue;
        const cur = seen.get(a.email) ?? { name: a.displayName || a.email.split("@")[0], n: 0 };
        if (a.displayName) cur.name = a.displayName;
        cur.n++;
        seen.set(a.email, cur);
      }
    }
    return [...seen.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 60).map(([email, v]) => ({ name: v.name, email }));
  }
}
