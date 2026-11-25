// Shared domain types. The Plan is the single object that the LLM, the
// rule-based detectors, the ghost-event renderer and /apply all speak.

export interface CalEvent {
  id: string;
  title: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  attendees: string[]; // emails
  organizer?: string;
  kind?: "meeting" | "focus" | "personal";
  status?: "accepted" | "needsAction" | "declined";
  meetLink?: string; // video-call link, when one exists
}

export interface BusyBlock {
  start: string;
  end: string;
}

export type ChangeType = "create" | "move" | "decline" | "shorten";

export interface TimeRange {
  start: string;
  end: string;
}

export interface Change {
  id: string; // unique within a plan
  type: ChangeType;
  reason: string;
  eventId?: string; // existing event (move/decline/shorten)
  title?: string; // create
  attendees?: string[]; // create
  kind?: CalEvent["kind"];
  from?: TimeRange; // move/shorten (always filled in by the server from the real event)
  to?: TimeRange; // create/move/shorten
  alternatives?: TimeRange[]; // other good slots the user can swap in (create)
  eventTitle?: string; // title of the existing event (server-filled)
  warning?: string; // server-detected problem, e.g. overlap or attendee busy
  addMeetLink?: boolean; // create: attach a video-call link
}

export interface Plan {
  summary: string;
  changes: Change[];
  warnings?: string[]; // things the server dropped or could not honour
}

export interface CreateInput {
  title: string;
  start: string;
  end: string;
  attendees?: string[];
  kind?: CalEvent["kind"];
  addMeetLink?: boolean;
}

export interface Person {
  name: string;
  email: string;
}

export interface FreeBusyResult {
  busy: Record<string, BusyBlock[]>;
  unavailable: string[]; // people whose calendar we cannot see (availability unknown)
}

// Every calendar backend (mock or Google) implements this.
export interface CalendarProvider {
  readonly selfEmail: string; // the signed-in user
  readonly strictPermissions: boolean; // true = real calendar rules (organiser-only edits)
  people(): Promise<Person[]>; // name -> email directory the planner can use
  listEvents(rangeStart: string, rangeEnd: string): Promise<CalEvent[]>;
  getEvent(eventId: string): Promise<CalEvent | null>;
  freeBusy(emails: string[], rangeStart: string, rangeEnd: string): Promise<FreeBusyResult>;
  create(input: CreateInput): Promise<CalEvent>;
  move(eventId: string, start: string, end: string): Promise<CalEvent>;
  decline(eventId: string): Promise<void>;
}
