import { readJson, writeJson } from "./data.js";

// The user's scheduling rules. Mocked "context": explicit, editable preferences that
// are fed to the planner and used by the deterministic detectors.
export interface Rules {
  workStart: number; // hour, e.g. 9
  workEnd: number; // hour, e.g. 18
  lunchStart: number;
  lunchEnd: number;
  protectLunch: boolean;
  defaultMeetingMinutes: number;
  focusHoursPerDay: number;
  focusPrefer: "morning" | "afternoon" | "any";
  heavyDayHours: number;
  notes: string; // free-text rules, e.g. "Fridays are light: no external calls"
}

export const DEFAULT_RULES: Rules = {
  workStart: 9,
  workEnd: 18,
  lunchStart: 13,
  lunchEnd: 14,
  protectLunch: true,
  defaultMeetingMinutes: 30,
  focusHoursPerDay: 2,
  focusPrefer: "morning",
  heavyDayHours: 6,
  notes: "",
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function sanitizeRules(input: Partial<Rules> | undefined, base: Rules = DEFAULT_RULES): Rules {
  const i = input ?? {};
  const workStart = num(i.workStart, 0, 22, base.workStart);
  const workEnd = Math.max(workStart + 1, num(i.workEnd, 1, 24, base.workEnd));
  const lunchStart = num(i.lunchStart, 0, 23, base.lunchStart);
  return {
    workStart,
    workEnd,
    lunchStart,
    lunchEnd: Math.max(lunchStart + 0.5, num(i.lunchEnd, 0.5, 24, base.lunchEnd)),
    protectLunch: typeof i.protectLunch === "boolean" ? i.protectLunch : base.protectLunch,
    defaultMeetingMinutes: Math.round(num(i.defaultMeetingMinutes, 5, 240, base.defaultMeetingMinutes)),
    focusHoursPerDay: num(i.focusHoursPerDay, 0, 8, base.focusHoursPerDay),
    focusPrefer: i.focusPrefer === "afternoon" || i.focusPrefer === "any" || i.focusPrefer === "morning" ? i.focusPrefer : base.focusPrefer,
    heavyDayHours: num(i.heavyDayHours, 1, 12, base.heavyDayHours),
    notes: typeof i.notes === "string" ? i.notes.slice(0, 500) : base.notes,
  };
}

export const loadRules = (): Rules => sanitizeRules(readJson<Partial<Rules>>("rules.json", {}));

export function saveRules(input: Partial<Rules>): Rules {
  const next = sanitizeRules(input, loadRules());
  writeJson("rules.json", next);
  return next;
}

const hh = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;

// Plain-language version for the model.
export function rulesToPrompt(r: Rules): string {
  return [
    `- Working hours: ${hh(r.workStart)}-${hh(r.workEnd)}, Mon-Fri.`,
    r.protectLunch ? `- Keep lunch free: ${hh(r.lunchStart)}-${hh(r.lunchEnd)}.` : "- Lunch is not protected.",
    `- Default meeting length: ${r.defaultMeetingMinutes} minutes.`,
    `- Protect ${r.focusHoursPerDay}h of focus time per day, preferably in the ${r.focusPrefer === "any" ? "best available slot" : r.focusPrefer}.`,
    `- A day with ${r.heavyDayHours}h or more of meetings is "heavy".`,
    ...(r.notes.trim() ? [`- The user's own notes: ${r.notes.trim()}`] : []),
  ].join("\n");
}
