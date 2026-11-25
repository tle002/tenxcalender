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
  source?: "command" | "fix" | "focus";
  rulesApplied?: string[];
  trace?: string[];
  clarify?: { options: string[] };
  intent?: string;
}

export interface Fix {
  id: string;
  label: string;
  plan: Plan;
}

export interface Issue {
  id: string;
  type: "conflict" | "back_to_back" | "heavy_day" | "focus_collision" | "focus_gap";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  date: string;
  fixes: Fix[];
}

export interface DayStat {
  date: string;
  label: string;
  meetings: number;
  meetingMin: number;
  chains: number;
  conflicts: number;
  focusMin: number;
  heavy: boolean;
  isToday: boolean;
  isPast: boolean;
}

export interface Briefing {
  stats: { meetings: number; meetingHours: number; backToBacks: number; conflicts: number; heavyDays: number; focusHours: number; focusTargetHours: number };
  days: DayStat[];
  issues: Issue[];
  summary: string;
}

export interface HistoryEntry {
  id: string;
  at: string;
  intent: string;
  source: "command" | "fix" | "focus";
  summary: string;
  items: { changeId: string; type: ChangeType; title: string }[];
  undoneAt?: string;
  undoNotes?: string[];
}

export interface Rules {
  workStart: number;
  workEnd: number;
  lunchStart: number;
  lunchEnd: number;
  protectLunch: boolean;
  defaultMeetingMinutes: number;
  focusHoursPerDay: number;
  focusPrefer: "morning" | "afternoon" | "any";
  heavyDayHours: number;
  notes: string;
}
