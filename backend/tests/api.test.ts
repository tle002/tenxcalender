process.env.LOG_TO_FILE = "false";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { scheduleFakeLLM } from "./fakeLLM.js";

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
const fake = scheduleFakeLLM({ emails: ["priya@acme.com", "sam@acme.com"], duration: 45, earliestHour: 12 });

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
const eventCount = async () => {
  const s = new Date(); s.setDate(s.getDate() - 7);
  const e = new Date(); e.setDate(e.getDate() + 14);
  const r = await fetch(`${base}/api/events?start=${s.toISOString()}&end=${e.toISOString()}`);
  return ((await r.json()) as any).events.length as number;
};

before(async () => {
  server = createApp(() => ({ llm: fake, model: "fake" })).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await post("/api/reset", {});
});
after(() => server.close());

let plan: any;

test("POST /plan runs the tool loop and returns a validated create + alternatives, without writing", async () => {
  const before = await eventCount();
  const r = await post("/api/plan", { intent: "Find 45 min with Priya and Sam this week, not mornings" });
  assert.equal(r.status, 200);
  plan = r.body.plan;
  assert.equal(fake.calls, 2); // one tool call, then propose_plan
  assert.equal(plan.changes.length, 1);
  const c = plan.changes[0];
  assert.equal(c.type, "create");
  assert.ok(new Date(c.to.start).getHours() >= 12, "respects 'not mornings'");
  assert.equal(new Date(c.to.end).getTime() - new Date(c.to.start).getTime(), 45 * 60_000);
  assert.ok(c.alternatives.length >= 1);
  assert.equal(c.warning, undefined, "common slot should have no warnings");
  assert.equal(await eventCount(), before, "planning must not write to the calendar");
});

test("POST /apply writes only after approval, and the event appears", async () => {
  const before = await eventCount();
  const r = await post("/api/apply", { changes: plan.changes });
  assert.equal(r.status, 200);
  assert.equal(r.body.applied.length, 1);
  assert.equal(r.body.failed.length, 0);
  assert.equal(await eventCount(), before + 1);
});

test("/apply rejects bad changes instead of trusting the client", async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const r = await post("/api/apply", {
    changes: [
      { type: "decline", eventId: "does_not_exist", reason: "x" },
      { type: "create", title: "Time travel", to: { start: past, end: new Date(Date.parse(past) + 3_600_000).toISOString() }, reason: "x" },
      { type: "bogus", reason: "x" },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.applied.length, 0);
  assert.equal(r.body.failed.length, 3);
});

test("/apply with nothing returns 400; /plan validates input", async () => {
  assert.equal((await post("/api/apply", { changes: [] })).status, 400);
  assert.equal((await post("/api/plan", { intent: "   " })).status, 400);
  assert.equal((await post("/api/plan", { intent: "x".repeat(501) })).status, 400);
});

test("/plan returns 503 with a clear message when no API key", async () => {
  const s2 = createApp(() => null).listen(0);
  const url = `http://localhost:${(s2.address() as AddressInfo).port}`;
  const r = await fetch(url + "/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "hi" }) });
  assert.equal(r.status, 503);
  assert.match(((await r.json()) as any).error, /ANTHROPIC_API_KEY/);
  s2.close();
});

test("overlap and busy-attendee warnings are flagged", async () => {
  await post("/api/reset", {});
  // Monday 'Roadmap review' 10:00-11:00 on the demo week; find any event to clash with.
  const s = new Date(); s.setDate(s.getDate() - 7);
  const e = new Date(); e.setDate(e.getDate() + 14);
  const evs = ((await (await fetch(`${base}/api/events?start=${s.toISOString()}&end=${e.toISOString()}`)).json()) as any).events;
  const target = evs.find((x: any) => Date.parse(x.start) > Date.now() && x.attendees.includes("priya@acme.com"));
  assert.ok(target, "need a future event with Priya in the seed");
  const llm = { calls: 0, async create() {
    return { content: [{ type: "tool_use", id: "p", name: "propose_plan", input: { summary: "clash", changes: [
      { type: "create", title: "Clash", attendees: ["priya@acme.com"], reason: "x", to: { start: target.start, end: target.end } },
    ] } }] };
  } };
  const s2 = createApp(() => ({ llm, model: "fake" })).listen(0);
  const url = `http://localhost:${(s2.address() as AddressInfo).port}`;
  const r = await (await fetch(url + "/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "clash" }) })).json() as any;
  assert.match(r.plan.changes[0].warning, /Overlaps/);
  assert.match(r.plan.changes[0].warning, /priya@acme.com appear busy/);
  s2.close();
});

test("create with addMeetLink returns a Meet link on apply", async () => {
  await post("/api/reset", {});
  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(16, 0, 0, 0);
  while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + 30 * 60_000);
  const r = await post("/api/apply", { changes: [{ type: "create", title: "Quick sync", reason: "x", addMeetLink: true, to: { start: start.toISOString(), end: end.toISOString() } }] });
  assert.equal(r.body.applied.length, 1);
  assert.match(r.body.applied[0].link, /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
});
