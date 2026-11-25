import type { CalEvent, CalendarProvider, Change, Plan } from "../types.js";
import type { Rules } from "../rules.js";
import { dayKey, planFocusBlocks } from "./focus.js";
import { findCommonSlots } from "./slots.js";
import { addDays, dayName, describe, startOfDay, toLocalISO } from "./time.js";
import { validateChanges } from "./validate.js";

// Deterministic analysis of a week: load, back-to-backs, conflicts, heavy days,
// focus time and focus collisions, each with ready-made fix plans. No LLM is involved
// in detection or in building fixes, so results are fast and repeatable.

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
  range: { start: string; end: string };
  stats: { meetings: number; meetingHours: number; backToBacks: number; conflicts: number; heavyDays: number; focusHours: number; focusTargetHours: number };
  days: DayStat[];
  issues: Issue[];
  summary: string;
}

const t = (iso: string) => Date.parse(iso);
const mins = (e: CalEvent) => (t(e.end) - t(e.start)) / 60_000;
const hours = (m: number) => Math.round((m / 60) * 10) / 10;
const clock = (d: Date) => describe(d).split(", ")[1];

function unionMin(evs: CalEvent[]): number {
  const s = evs.map((e) => [t(e.start), t(e.end)] as [number, number]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const x of s) {
    if (!cur || x[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [x[0], x[1]];
    } else cur[1] = Math.max(cur[1], x[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total / 60_000;
}

// Runs of meetings with no gap (or overlapping). Only runs of 2+ are returned.
function chainsOf(evs: CalEvent[]): CalEvent[][] {
  const s = [...evs].sort((a, b) => t(a.start) - t(b.start));
  const out: CalEvent[][] = [];
  let cur: CalEvent[] = [];
  let curEnd = 0;
  for (const m of s) {
    if (cur.length && t(m.start) <= curEnd) {
      cur.push(m);
      curEnd = Math.max(curEnd, t(m.end));
    } else {
      if (cur.length > 1) out.push(cur);
      cur = [m];
      curEnd = t(m.end);
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function overlappingPairs(evs: CalEvent[]): [CalEvent, CalEvent][] {
  const s = [...evs].sort((a, b) => t(a.start) - t(b.start));
  const out: [CalEvent, CalEvent][] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length && t(s[j].start) < t(s[i].end); j++) out.push([s[i], s[j]]);
  return out;
}

export interface BriefingArgs {
  provider: CalendarProvider;
  rules: Rules;
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;
}

export async function buildBriefing({ provider, rules, rangeStart, rangeEnd, now = new Date() }: BriefingArgs): Promise<Briefing> {
  const self = provider.selfEmail;
  const searchEnd = addDays(rangeEnd, 7); // fixes may move things into the following week
  const all = (await provider.listEvents(rangeStart.toISOString(), searchEnd.toISOString())).filter((e) => e.status !== "declined");
  const inRange = all.filter((e) => t(e.start) < rangeEnd.getTime() && t(e.end) > rangeStart.getTime());
  const meetings = inRange.filter((e) => e.kind !== "focus");
  const focusEvents = inRange.filter((e) => e.kind === "focus");
  const lunch = rules.protectLunch ? { start: rules.lunchStart, end: rules.lunchEnd } : null;
  const importance = (e: CalEvent) => e.attendees.length + (e.organizer === self ? 2 : 0) + (mins(e) >= 60 ? 1 : 0) + (e.status === "needsAction" ? -1 : 0);
  const who = (e: CalEvent) => (e.organizer && e.organizer !== self ? e.organizer : "you");

  const slotFor = (durationMin: number, notBefore: Date, exclude: string[]) => {
    const live = all.filter((e) => !exclude.includes(e.id));
    return findCommonSlots({
      durationMin, rangeStart: startOfDay(notBefore), rangeEnd: searchEnd, earliestHour: rules.workStart, latestHour: rules.workEnd,
      busy: live.map((e) => ({ start: e.start, end: e.end })), myEvents: live, now, maxResults: 1, lunch,
    })[0] ?? null;
  };
  const toR = (s: { start: Date; end: Date }) => ({ start: toLocalISO(s.start), end: toLocalISO(s.end) });

  const issues: Issue[] = [];
  const addIssue = (i: Omit<Issue, "fixes">, fixes: { label: string; changes: Change[] }[]) =>
    issues.push({ ...i, fixes: fixes.map((f, n) => ({ id: `${i.id}:f${n + 1}`, label: f.label, plan: { summary: f.label, changes: f.changes, source: "fix" as const } })) });

  const days: DayStat[] = [];
  const heavyMin = rules.heavyDayHours * 60;
  for (let day = startOfDay(rangeStart); day < rangeEnd; day = addDays(day, 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const key = dayKey(day);
    const dayEnd = addDays(day, 1);
    const dm = meetings.filter((e) => dayKey(new Date(e.start)) === key);
    const isPast = dayEnd.getTime() <= now.getTime();
    const ch = chainsOf(dm);
    const pairs = overlappingPairs(dm);
    const meetingMin = unionMin(dm);
    const focusMin = unionMin(focusEvents.filter((e) => dayKey(new Date(e.start)) === key));
    const stat: DayStat = {
      date: key, label: dayName(day), meetings: dm.length, meetingMin: Math.round(meetingMin), chains: ch.reduce((n, c) => n + c.length - 1, 0),
      conflicts: pairs.length, focusMin: Math.round(focusMin), heavy: meetingMin >= heavyMin, isToday: now >= day && now < dayEnd, isPast,
    };
    days.push(stat);
    if (isPast) continue;
    const upcoming = dm.filter((e) => t(e.end) > now.getTime());

    // Double-bookings
    for (const [a, b] of overlappingPairs(upcoming)) {
      const less = importance(a) <= importance(b) ? a : b;
      const more = less === a ? b : a;
      const fixes: { label: string; changes: Change[] }[] = [];
      const slot = slotFor(mins(less), startOfDay(day), [less.id]);
      if (slot) fixes.push({ label: `Move "${less.title}" to ${describe(slot.start)}`, changes: [{ id: "c1", type: "move", eventId: less.id, reason: `Resolves the overlap with "${more.title}"`, to: toR(slot) }] });
      fixes.push({ label: `Decline "${less.title}"`, changes: [{ id: "c1", type: "decline", eventId: less.id, reason: `Overlaps "${more.title}"` }] });
      if (t(a.start) < t(b.start) && (t(b.start) - t(a.start)) / 60_000 >= 15) {
        fixes.push({ label: `Shorten "${a.title}" to end at ${clock(new Date(b.start))}`, changes: [{ id: "c1", type: "shorten", eventId: a.id, reason: `Ends when "${b.title}" starts`, to: { start: a.start, end: b.start } }] });
      }
      addIssue({ id: `conflict:${a.id}:${b.id}`, type: "conflict", severity: "high", date: key, title: `Double-booked on ${stat.label}`, detail: `"${a.title}" (${clock(new Date(a.start))}) overlaps "${b.title}" (${clock(new Date(b.start))}).` }, fixes);
    }

    // Back-to-back runs
    for (const run of chainsOf(upcoming)) {
      const span = (Math.max(...run.map((e) => t(e.end))) - t(run[0].start)) / 60_000;
      if (run.length < 3 && span < 180) continue;
      const breaks: Change[] = run.slice(0, -1).filter((e) => mins(e) >= 30).map((e, n) => {
        const cut = mins(e) >= 60 ? 10 : 5;
        return { id: `c${n + 1}`, type: "shorten" as const, eventId: e.id, reason: `Adds a ${cut}-minute break before the next meeting`, to: { start: e.start, end: toLocalISO(new Date(t(e.end) - cut * 60_000)) } };
      });
      const weakest = [...run].sort((x, y) => importance(x) - importance(y))[0];
      const fixes: { label: string; changes: Change[] }[] = [];
      if (breaks.length) fixes.push({ label: `Add breaks (shorten ${breaks.length} meeting${breaks.length === 1 ? "" : "s"})`, changes: breaks });
      fixes.push({ label: `Decline "${weakest.title}"`, changes: [{ id: "c1", type: "decline", eventId: weakest.id, reason: `Breaks up ${run.length} back-to-back meetings` }] });
      addIssue({ id: `b2b:${run[0].id}`, type: "back_to_back", severity: run.length >= 4 ? "high" : "medium", date: key, title: `${run.length} back-to-back meetings on ${stat.label}`, detail: `${clock(new Date(run[0].start))} to ${clock(new Date(Math.max(...run.map((e) => t(e.end)))))} with no break.` }, fixes);
    }

    // Heavy day
    if (stat.heavy) {
      const cand = [...upcoming].filter((e) => mins(e) <= 90 && e.organizer !== self).sort((x, y) => importance(x) - importance(y))[0];
      const fixes: { label: string; changes: Change[] }[] = [];
      if (cand) {
        const slot = slotFor(mins(cand), addDays(day, 1), [cand.id]);
        if (slot) fixes.push({ label: `Move "${cand.title}" to ${describe(slot.start)} (lighter day)`, changes: [{ id: "c1", type: "move", eventId: cand.id, reason: `${stat.label} has ${hours(meetingMin)}h of meetings`, to: toR(slot) }] });
        fixes.push({ label: `Decline "${cand.title}"`, changes: [{ id: "c1", type: "decline", eventId: cand.id, reason: `Lightens a ${hours(meetingMin)}h day` }] });
      }
      addIssue({ id: `heavy:${key}`, type: "heavy_day", severity: "medium", date: key, title: `${stat.label} is heavy: ${hours(meetingMin)}h of meetings`, detail: `${stat.meetings} meetings. Your limit for a heavy day is ${rules.heavyDayHours}h.` }, fixes);
    }
  }

  // Meetings landing on protected focus time
  for (const f of focusEvents.filter((e) => t(e.end) > now.getTime())) {
    for (const m of meetings.filter((e) => t(e.start) < t(f.end) && t(e.end) > t(f.start) && t(e.end) > now.getTime())) {
      const fresh = m.status === "needsAction";
      const fixes: { label: string; changes: Change[] }[] = [];
      fixes.push({ label: `Decline "${m.title}"`, changes: [{ id: "c1", type: "decline", eventId: m.id, reason: "Protects your focus time" }] });
      const slot = slotFor(mins(f), startOfDay(new Date(f.start)), [f.id]);
      if (slot) fixes.push({ label: `Move focus time to ${describe(slot.start)}`, changes: [{ id: "c1", type: "move", eventId: f.id, reason: `Makes room for "${m.title}"`, to: toR(slot) }] });
      addIssue({
        id: `focus:${f.id}:${m.id}`, type: "focus_collision", severity: fresh ? "high" : "medium", date: dayKey(new Date(f.start)),
        title: `"${m.title}" lands on your focus time`,
        detail: `${describe(new Date(m.start))}. ${fresh ? `New invite from ${who(m)}.` : `Scheduled by ${who(m)}.`}`,
      }, fixes);
    }
  }

  // Days without enough protected focus time
  let focusPlanDays: ReturnType<typeof planFocusBlocks> = [];
  if (rules.focusHoursPerDay > 0) {
    focusPlanDays = planFocusBlocks({
      events: inRange, rangeStart, rangeEnd, hoursPerDay: rules.focusHoursPerDay, earliestHour: rules.workStart, latestHour: rules.workEnd,
      prefer: rules.focusPrefer, now, lunch,
    });
    const gaps = focusPlanDays.filter((d) => d.neededMin > 0);
    if (gaps.length) {
      const creates: Change[] = gaps.flatMap((d) => d.blocks.map((b) => ({ id: "", type: "create" as const, title: "Focus time", kind: "focus" as const, reason: `Protects ${rules.focusHoursPerDay}h of deep work`, to: toR(b) })));
      creates.forEach((c, n) => (c.id = `c${n + 1}`));
      const names = gaps.map((d) => dayName(new Date(`${d.date}T12:00:00`))).join(", ");
      const total = hours(gaps.reduce((s, d) => s + d.plannedMin, 0));
      addIssue({
        id: `focusgap:${gaps[0].date}`, type: "focus_gap", severity: "low", date: gaps[0].date,
        title: `Focus time isn't protected on ${gaps.length} day${gaps.length === 1 ? "" : "s"}`,
        detail: `${names}. Target is ${rules.focusHoursPerDay}h per day.`,
      }, creates.length ? [{ label: `Protect ${total}h of focus time`, changes: creates }] : []);
    }
  }

  // Validate every fix against the real calendar rules; drop the ones that cannot be applied.
  for (const issue of issues) {
    const kept: Fix[] = [];
    for (const fix of issue.fixes) {
      const v = await validateChanges(provider, fix.plan.changes, now);
      if (!v.changes.length) continue;
      kept.push({ ...fix, plan: { ...fix.plan, changes: v.changes, warnings: v.errors.map((e) => e.error) } });
    }
    issue.fixes = kept;
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.date.localeCompare(b.date));

  const totalMeetingMin = days.reduce((s, d) => s + d.meetingMin, 0);
  const stats = {
    meetings: meetings.length,
    meetingHours: hours(totalMeetingMin),
    backToBacks: days.reduce((s, d) => s + d.chains, 0),
    conflicts: days.reduce((s, d) => s + d.conflicts, 0),
    heavyDays: days.filter((d) => d.heavy).length,
    focusHours: hours(days.reduce((s, d) => s + d.focusMin, 0)),
    focusTargetHours: rules.focusHoursPerDay * days.length,
  };
  const heaviest = [...days].sort((a, b) => b.meetingMin - a.meetingMin)[0];
  const parts = [`${stats.meetings} meetings (${stats.meetingHours}h) this week.`];
  if (heaviest && heaviest.meetingMin > 0) parts.push(`Heaviest day: ${heaviest.label}, ${hours(heaviest.meetingMin)}h.`);
  if (stats.conflicts) parts.push(`${stats.conflicts} double-booking${stats.conflicts === 1 ? "" : "s"}.`);
  if (stats.backToBacks) parts.push(`${stats.backToBacks} back-to-back transition${stats.backToBacks === 1 ? "" : "s"}.`);
  parts.push(`Focus time protected: ${stats.focusHours}h of ${stats.focusTargetHours}h.`);

  return { range: { start: rangeStart.toISOString(), end: rangeEnd.toISOString() }, stats, days, issues, summary: parts.join(" ") };
}

// "Protect N hours of focus time": a validated plan of create changes, no LLM needed.
export async function buildFocusPlan(args: BriefingArgs & { hoursPerDay?: number }): Promise<Plan> {
  const { provider, rules, rangeStart, rangeEnd, now = new Date() } = args;
  const hoursPerDay = args.hoursPerDay ?? rules.focusHoursPerDay;
  const events = (await provider.listEvents(rangeStart.toISOString(), rangeEnd.toISOString())).filter((e) => e.status !== "declined");
  const days = planFocusBlocks({
    events, rangeStart, rangeEnd, hoursPerDay, earliestHour: rules.workStart, latestHour: rules.workEnd, prefer: rules.focusPrefer, now,
    lunch: rules.protectLunch ? { start: rules.lunchStart, end: rules.lunchEnd } : null,
  });
  const raw: Change[] = days.flatMap((d) => d.blocks.map((b) => ({ id: "", type: "create" as const, title: "Focus time", kind: "focus" as const, reason: `Protects ${hoursPerDay}h of deep work`, to: { start: toLocalISO(b.start), end: toLocalISO(b.end) } })));
  raw.forEach((c, i) => (c.id = `c${i + 1}`));
  const v = await validateChanges(provider, raw, now);
  const short = days.filter((d) => d.shortfallMin > 0).map((d) => `${dayName(new Date(`${d.date}T12:00:00`))} (${hours(d.shortfallMin)}h short)`);
  return {
    summary: v.changes.length ? `Protecting ${hoursPerDay}h of focus time per day: ${v.changes.length} block${v.changes.length === 1 ? "" : "s"}.${short.length ? ` Not enough free time on ${short.join(", ")}.` : ""}` : "Your focus time is already protected for the remaining days.",
    changes: v.changes,
    warnings: v.errors.map((e) => e.error),
    source: "focus",
    rulesApplied: [`${hoursPerDay}h focus time per day`, `Prefers ${rules.focusPrefer === "any" ? "any time" : rules.focusPrefer}`],
  };
}
