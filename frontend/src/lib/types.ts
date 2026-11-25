// Mirrors backend/src/types.ts (kept as a copy so the two apps stay independent).
export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  organizer?: string;
  kind?: "meeting" | "focus" | "personal";
  status?: "accepted" | "needsAction" | "declined";
  meetLink?: string;
}

export type ChangeType = "create" | "move" | "decline" | "shorten";

export interface TimeRange {
  start: string;
  end: string;
}

export interface Change {
  id: string;
  type: ChangeType;
  reason: string;
  eventId?: string;
  title?: string;
  attendees?: string[];
  kind?: CalEvent["kind"];
  from?: TimeRange;
  to?: TimeRange;
  alternatives?: TimeRange[];
  eventTitle?: string;
  warning?: string;
  addMeetLink?: boolean;
}

export interface Plan {
  summary: string;
  changes: Change[];
  warnings?: string[];
}
