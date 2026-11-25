import type { CalEvent } from "../types.js";
import { addDays, startOfDay } from "./time.js";

// Deterministic focus-time planner: finds where deep-work blocks fit around the
// user's meetings. The LLM only decides to ask for it; this code does the placement.

export interface FocusQuery {
  events: CalEvent[]; // everything on the user's calendar (focus blocks included)
  rangeStart: Date;
  rangeEnd: Date;
  hoursPerDay: number;
  earliestHour: number;
  latestHour: number;
  prefer: "morning" | "afternoon" | "any";
  now: Date;
  lunch?: { start: number; end: number } | null; // hours, avoided when possible
}

export interface FocusBlock {
  start: Date;
  end: Date;
}

export interface FocusDay {
  date: string; // YYYY-MM-DD
  existingMin: number; // focus time already on the calendar
  neededMin: number;
  blocks: FocusBlock[];
  plannedMin: number;
  shortfallMin: number;
}

const STEP = 30 * 60_000;
const MIN_CHUNK = 60; // when splitting, never make a block shorter than 1h
const ceilTo = (t: number, step: number) => Math.ceil(t / step) * step;
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hourOf = (t: number) => {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
};

function merge(iv: [number, number][]): [number, number][] {
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

export function planFocusBlocks(q: FocusQuery): FocusDay[] {
  const out: FocusDay[] = [];
  for (let day = startOfDay(q.rangeStart); day < q.rangeEnd; day = addDays(day, 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const winS = new Date(day).setHours(q.earliestHour, 0, 0, 0);
    const winE = new Date(day).setHours(q.latestHour, 0, 0, 0);
    const from = Math.max(winS, ceilTo(q.now.getTime(), STEP));
    if (from >= winE) continue; // that day is over

    const live = q.events.filter((e) => e.status !== "declined");
    const existingMin = Math.round(
      merge(
        live
          .filter((e) => e.kind === "focus")
          .map((e) => [Math.max(Date.parse(e.start), winS), Math.min(Date.parse(e.end), winE)] as [number, number])
          .filter(([a, b]) => b > a),
      ).reduce((sum, [a, b]) => sum + (b - a), 0) / 60_000,
    );
    const need = Math.round(q.hoursPerDay * 60) - existingMin;
    const res: FocusDay = { date: dayKey(day), existingMin, neededMin: Math.max(0, need), blocks: [], plannedMin: 0, shortfallMin: 0 };
    if (need <= 0) {
      out.push(res);
      continue;
    }

    const busy = merge(live.map((e) => [Date.parse(e.start), Date.parse(e.end)] as [number, number]).filter(([a, b]) => b > from && a < winE));
    const free: [number, number][] = [];
    let cursor = from;
    for (const [a, b] of busy) {
      if (a > cursor) free.push([cursor, Math.min(a, winE)]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < winE) free.push([cursor, winE]);

    const lunchS = q.lunch ? new Date(day).setHours(Math.floor(q.lunch.start), (q.lunch.start % 1) * 60, 0, 0) : 0;
    const lunchE = q.lunch ? new Date(day).setHours(Math.floor(q.lunch.end), (q.lunch.end % 1) * 60, 0, 0) : 0;
    const score = (s: number, e: number) => {
      const h = hourOf(s);
      let sc = q.prefer === "morning" ? h : q.prefer === "afternoon" ? -h : Math.abs(h - 10.5);
      if (q.lunch && s < lunchE && e > lunchS) sc += 3;
      return sc;
    };

    // 1) one contiguous block
    const needMs = need * 60_000;
    let best: { s: number; sc: number } | null = null;
    for (const [fs, fe] of free) {
      for (let s = ceilTo(fs, STEP); s + needMs <= fe; s += STEP) {
        const sc = score(s, s + needMs);
        if (!best || sc < best.sc) best = { s, sc };
      }
    }
    if (best) {
      res.blocks.push({ start: new Date(best.s), end: new Date(best.s + needMs) });
    } else {
      // 2) split across free gaps (blocks of at least 1h)
      let remaining = needMs;
      const gaps = free
        .map(([fs, fe]) => [ceilTo(fs, STEP), fe] as [number, number])
        .filter(([a, b]) => b - a >= MIN_CHUNK * 60_000)
        .sort((x, y) => score(x[0], x[1]) - score(y[0], y[1]));
      for (const [a, b] of gaps) {
        if (remaining <= 0 || res.blocks.length >= 3) break;
        const len = Math.min(remaining, Math.floor((b - a) / STEP) * STEP);
        if (len < MIN_CHUNK * 60_000) continue;
        const s = q.prefer === "afternoon" ? b - len : a;
        res.blocks.push({ start: new Date(s), end: new Date(s + len) });
        remaining -= len;
      }
      res.blocks.sort((x, y) => x.start.getTime() - y.start.getTime());
    }
    res.plannedMin = Math.round(res.blocks.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()), 0) / 60_000);
    res.shortfallMin = Math.max(0, res.neededMin - res.plannedMin);
    out.push(res);
  }
  return out;
}
