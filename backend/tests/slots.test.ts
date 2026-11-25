import assert from "node:assert/strict";
import { test } from "node:test";
import { findCommonSlots } from "../src/ai/slots.js";
import { seedBusy, seedEvents } from "../src/providers/seed.js";

const ws = new Date(2026, 10, 23); // Mon 23 Nov 2026 local
const events = seedEvents(ws);
const busyMap = seedBusy(ws);
const busy = [
  ...events.filter((e) => e.attendees.some((a) => ["priya@acme.com", "sam@acme.com", "you@acme.com"].includes(a))).map((e) => ({ start: e.start, end: e.end })),
  ...busyMap["priya@acme.com"],
  ...busyMap["sam@acme.com"],
];
const base = {
  durationMin: 45, rangeStart: ws, rangeEnd: new Date(2026, 10, 28), earliestHour: 9, latestHour: 18,
  busy, myEvents: events, now: new Date(2026, 10, 23, 8, 0), maxResults: 5,
};

test("never overlaps anyone's busy time and stays in window", () => {
  const slots = findCommonSlots(base);
  assert.ok(slots.length >= 3);
  for (const s of slots) {
    for (const b of busy) assert.ok(!(Date.parse(b.start) < s.end.getTime() && Date.parse(b.end) > s.start.getTime()), `overlap at ${s.start}`);
    assert.ok(s.start.getHours() >= 9 && (s.end.getHours() < 18 || (s.end.getHours() === 18 && s.end.getMinutes() === 0)));
    assert.ok([1, 2, 3, 4, 5].includes(s.start.getDay()));
  }
});

test("'not mornings' (earliest 12) yields only afternoon slots", () => {
  const slots = findCommonSlots({ ...base, earliestHour: 12 });
  assert.ok(slots.length > 0);
  assert.ok(slots.every((s) => s.start.getHours() >= 12));
});

test("never proposes the past", () => {
  const now = new Date(2026, 10, 25, 15, 0);
  const slots = findCommonSlots({ ...base, now });
  assert.ok(slots.every((s) => s.start.getTime() >= now.getTime()));
});

test("returns at most 2 per day and non-overlapping picks", () => {
  const slots = findCommonSlots({ ...base, maxResults: 8 });
  const perDay = new Map<string, number>();
  for (const s of slots) perDay.set(s.start.toDateString(), (perDay.get(s.start.toDateString()) ?? 0) + 1);
  assert.ok([...perDay.values()].every((n) => n <= 2));
});

test("returns nothing when no slot exists", () => {
  assert.equal(findCommonSlots({ ...base, durationMin: 600 }).length, 0);
});
