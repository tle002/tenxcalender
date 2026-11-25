import type { BusyBlock, CalEvent } from "../types.js";
import { addDays, startOfDay } from "./time.js";

// Deterministic slot finder. The LLM decides WHAT to schedule; this code does
// the interval maths so slots are never double-booked by a model arithmetic slip.

export interface SlotQuery {
  durationMin: number;
  rangeStart: Date;
  rangeEnd: Date;
  earliestHour: number; // e.g. 9
  latestHour: number; // e.g. 18 (meeting must END by this hour)
  busy: BusyBlock[]; // everyone's busy time, flattened
  myEvents: CalEvent[]; // the user's events, used for ranking only
  now: Date;
  maxResults: number;
  stepMin?: number;
  lunch?: { start: number; end: number } | null; // hours; slots overlapping it are ranked lower
}

export interface Slot {
  start: Date;
  end: Date;
  score: number; // lower is better
}

const hours = (ms: number) => ms / 3_600_000;

export function findCommonSlots(q: SlotQuery): Slot[] {
  const step = (q.stepMin ?? 15) * 60_000;
  const dur = q.durationMin * 60_000;
  const busy = q.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const mine = q.myEvents
    .filter((e) => e.status !== "declined")
    .map((e) => [Date.parse(e.start), Date.parse(e.end)] as const);

  const candidates: Slot[] = [];
  let dayIndex = 0;
  for (let day = startOfDay(q.rangeStart); day < q.rangeEnd; day = addDays(day, 1)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;

    const winStart = new Date(day);
    winStart.setHours(q.earliestHour, 0, 0, 0);
    const winEnd = new Date(day);
    winEnd.setHours(q.latestHour, 0, 0, 0);
    const dayEnd = addDays(day, 1).getTime();
    const dayLoad = hours(
      mine.filter(([s]) => s >= day.getTime() && s < dayEnd).reduce((sum, [s, e]) => sum + (e - s), 0),
    );

    let t = Math.max(winStart.getTime(), q.rangeStart.getTime(), Math.ceil(q.now.getTime() / step) * step);
    t = Math.ceil(t / step) * step;
    for (; t + dur <= Math.min(winEnd.getTime(), q.rangeEnd.getTime()); t += step) {
      const e = t + dur;
      if (busy.some(([bs, be]) => bs < e && be > t)) continue;

      let score = dayLoad * 1.0 + dayIndex * 0.2;
      if (mine.some(([ms, me]) => me === t || ms === e)) score += 1.5; // would create a back-to-back
      const d = new Date(t);
      if (d.getMinutes() % 30 !== 0) score += 0.3; // prefer clean :00 / :30 starts
      if (q.lunch) {
        const lunchS = new Date(d).setHours(Math.floor(q.lunch.start), (q.lunch.start % 1) * 60, 0, 0);
        const lunchE = new Date(d).setHours(Math.floor(q.lunch.end), (q.lunch.end % 1) * 60, 0, 0);
        if (t < lunchE && e > lunchS) score += 0.7; // keep lunch free
      }
      candidates.push({ start: d, end: new Date(e), score });
    }
    dayIndex++;
  }

  // Greedy pick: best score first, at most 2 per day, no overlapping picks.
  candidates.sort((a, b) => a.score - b.score || a.start.getTime() - b.start.getTime());
  const picked: Slot[] = [];
  const perDay = new Map<string, number>();
  for (const c of candidates) {
    if (picked.length >= q.maxResults) break;
    const key = c.start.toDateString();
    if ((perDay.get(key) ?? 0) >= 2) continue;
    if (picked.some((p) => p.start < c.end && p.end > c.start)) continue;
    picked.push(c);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  return picked;
}
