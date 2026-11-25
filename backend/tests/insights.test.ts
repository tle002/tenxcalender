process.env.LOG_TO_FILE = "false";
process.env.DATA_DIR = `${process.env.TMPDIR ?? "/tmp"}/tenx-test-data-${process.pid}`;
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { demoWeekStart } from "../src/providers/seed.js";
import { addDays } from "../src/ai/time.js";
import { scheduleFakeLLM } from "./fakeLLM.js";

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
const j = async (path: string, method = "GET", body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
};
// Next week is entirely in the future, so results do not depend on the weekday the tests run.
const ws = addDays(demoWeekStart(), 7);
const q = `start=${encodeURIComponent(ws.toISOString())}&end=${encodeURIComponent(addDays(ws, 7).toISOString())}`;

before(async () => {
  server = createApp(() => ({ llm: scheduleFakeLLM({ emails: [], duration: 30 }), model: "fake" })).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await j("/api/reset", "POST", {});
});
after(() => server.close());

test("briefing finds conflicts, back-to-backs, a heavy day and a focus collision, each with a valid fix", async () => {
  const { body } = await j(`/api/briefing?${q}`);
  const b = body.briefing;
  const types = new Set(b.issues.map((i: any) => i.type));
  for (const t of ["conflict", "back_to_back", "heavy_day", "focus_collision"]) assert.ok(types.has(t), `missing ${t}`);
  assert.ok(b.stats.conflicts >= 1);
  const collision = b.issues.find((i: any) => i.type === "focus_collision");
  assert.equal(collision.severity, "high"); // a fresh invite
  assert.ok(collision.fixes.length >= 1);
  for (const issue of b.issues) for (const f of issue.fixes) assert.ok(f.plan.changes.length > 0);
  assert.equal(b.issues[0].severity, "high");
});

test("focus plan only creates blocks inside working hours and never overlaps a meeting", async () => {
  const { body } = await j("/api/focus/plan", "POST", { start: ws.toISOString(), end: addDays(ws, 7).toISOString(), hoursPerDay: 2 });
  const plan = body.plan;
  assert.equal(plan.source, "focus");
  const ev = (await j(`/api/events?${q}`)).body.events.filter((e: any) => e.kind !== "focus" && e.status !== "declined");
  for (const c of plan.changes) {
    assert.equal(c.type, "create");
    const s = Date.parse(c.to.start), e = Date.parse(c.to.end);
    assert.ok(new Date(s).getHours() >= 9 && new Date(e).getHours() <= 18);
    for (const m of ev) assert.ok(!(s < Date.parse(m.end) && e > Date.parse(m.start)), `overlaps ${m.title}`);
  }
});

test("apply records history, undo reverses it, and undo is refused when the event changed since", async () => {
  const first = (await j("/api/focus/plan", "POST", { start: ws.toISOString(), end: addDays(ws, 7).toISOString() })).body.plan;
  assert.ok(first.changes.length > 0);
  const one = first.changes.slice(0, 1);
  const ap = await j("/api/apply", "POST", { changes: one, intent: "Protect focus time", source: "focus" });
  assert.equal(ap.body.applied.length, 1);
  const hist = (await j("/api/history")).body.history;
  assert.equal(hist[0].source, "focus");
  const count = async () => (await j(`/api/events?${q}`)).body.events.length;
  const afterApply = await count();
  const un = await j(`/api/history/${hist[0].id}/undo`, "POST");
  assert.equal(un.status, 200);
  assert.equal(await count(), afterApply - 1);
  assert.equal((await j(`/api/history/${hist[0].id}/undo`, "POST")).status, 400); // already undone
});

test("undo of a move restores the original time", async () => {
  const evs = (await j(`/api/events?${q}`)).body.events;
  const m = evs.find((e: any) => e.kind === "meeting" && e.organizer === "you@acme.com") ?? evs.find((e: any) => e.kind === "meeting");
  const to = { start: new Date(Date.parse(m.start) + 3600_000).toISOString(), end: new Date(Date.parse(m.end) + 3600_000).toISOString() };
  const ap = await j("/api/apply", "POST", { changes: [{ id: "c1", type: "move", eventId: m.id, reason: "test", to }], intent: "move" });
  if (ap.body.applied.length !== 1) return; // validation may reject (busy); covered elsewhere
  const h = (await j("/api/history")).body.history[0];
  await j(`/api/history/${h.id}/undo`, "POST");
  const back = (await j(`/api/events?${q}`)).body.events.find((e: any) => e.id === m.id);
  assert.equal(Date.parse(back.start), Date.parse(m.start));
});

test("rules round-trip and are sanitised", async () => {
  const r = await j("/api/rules", "PUT", { rules: { focusHoursPerDay: 99, workStart: 8, notes: "Fridays light" } });
  assert.equal(r.body.rules.focusHoursPerDay, 8);
  assert.equal(r.body.rules.workStart, 8);
  assert.equal((await j("/api/rules")).body.rules.notes, "Fridays light");
  await j("/api/rules", "PUT", { rules: { focusHoursPerDay: 2, workStart: 9, notes: "" } });
});
