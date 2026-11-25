process.env.LOG_TO_FILE = "false";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateChanges } from "../src/ai/validate.js";
import { GoogleProvider } from "../src/providers/GoogleProvider.js";

const ME = "me@gmail.com";

// A fake of the slice of the Google Calendar client that GoogleProvider uses.
function fakeCal(items: any[] = []) {
  const calls: Record<string, any[]> = { insert: [], patch: [], delete: [], get: [], list: [], query: [] };
  const byId = new Map(items.map((e) => [e.id, e]));
  const cal: any = {
    events: {
      list: async (p: any) => { calls.list.push(p); return { data: { items } }; },
      get: async (p: any) => {
        calls.get.push(p);
        const e = byId.get(p.eventId);
        if (!e) throw Object.assign(new Error("Not Found"), { code: 404 });
        return { data: e };
      },
      insert: async (p: any) => {
        calls.insert.push(p);
        const e = { id: "new1", summary: p.requestBody.summary, status: "confirmed", start: p.requestBody.start, end: p.requestBody.end, organizer: { email: ME, self: true }, attendees: [{ email: ME, self: true }, ...(p.requestBody.attendees ?? [])] };
        byId.set("new1", e);
        return { data: e };
      },
      patch: async (p: any) => { calls.patch.push(p); return { data: { ...byId.get(p.eventId), ...p.requestBody } }; },
      delete: async (p: any) => { calls.delete.push(p); return { data: {} }; },
    },
    freebusy: {
      query: async (p: any) => {
        calls.query.push(p);
        return { data: { calendars: { [ME]: { busy: [{ start: "2026-11-26T10:00:00Z", end: "2026-11-26T11:00:00Z" }] }, "priya@corp.com": { busy: [] }, "ext@other.com": { errors: [{ reason: "notFound" }] } } } };
      },
    },
  };
  return { cal, calls, byId };
}

const timed = (id: string, extra: any = {}) => ({
  id, summary: id, status: "confirmed",
  start: { dateTime: "2026-11-27T10:00:00+05:30" }, end: { dateTime: "2026-11-27T11:00:00+05:30" },
  organizer: { email: "boss@corp.com" },
  attendees: [{ email: ME, self: true, responseStatus: "accepted" }, { email: "boss@corp.com", displayName: "The Boss" }],
  ...extra,
});

test("listEvents maps events, skips all-day and cancelled, reads meet link and decline status", async () => {
  const { cal } = fakeCal([
    timed("a", { hangoutLink: "https://meet.google.com/aaa-bbbb-ccc" }),
    { id: "allday", summary: "Holiday", start: { date: "2026-11-27" }, end: { date: "2026-11-28" } },
    timed("gone", { status: "cancelled" }),
    timed("declined", { attendees: [{ email: ME, self: true, responseStatus: "declined" }] }),
  ]);
  const evs = await new GoogleProvider(cal, ME).listEvents("2026-11-23T00:00:00Z", "2026-11-30T00:00:00Z");
  assert.deepEqual(evs.map((e) => e.id), ["a", "declined"]);
  assert.equal(evs[0].meetLink, "https://meet.google.com/aaa-bbbb-ccc");
  assert.equal(evs[1].status, "declined");
});

test("create sends invites, excludes self from attendees, and requests a Meet link then polls for it", async () => {
  const { cal, calls, byId } = fakeCal();
  const p = new GoogleProvider(cal, ME, 1);
  // Simulate Google adding the link a moment after creation.
  setTimeout(() => { byId.get("new1").hangoutLink = "https://meet.google.com/xyz-abcd-efg"; }, 5);
  const ev = await p.create({ title: "Sync", start: "2026-11-27T10:30:00.000Z", end: "2026-11-27T11:00:00.000Z", attendees: [ME, "priya@corp.com"], addMeetLink: true });
  const req = calls.insert[0];
  assert.equal(req.sendUpdates, "all");
  assert.equal(req.conferenceDataVersion, 1);
  assert.equal(req.requestBody.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.deepEqual(req.requestBody.attendees, [{ email: "priya@corp.com" }]);
  assert.equal(ev.meetLink, "https://meet.google.com/xyz-abcd-efg");
});

test("create without a link does not request conferencing", async () => {
  const { cal, calls } = fakeCal();
  await new GoogleProvider(cal, ME).create({ title: "Solo", start: "2026-11-27T10:30:00.000Z", end: "2026-11-27T11:00:00.000Z" });
  assert.equal(calls.insert[0].conferenceDataVersion, 0);
  assert.equal(calls.insert[0].requestBody.conferenceData, undefined);
});

test("move patches times and notifies attendees", async () => {
  const { cal, calls } = fakeCal([timed("m", { organizer: { email: ME, self: true } })]);
  await new GoogleProvider(cal, ME).move("m", "2026-11-27T12:00:00.000Z", "2026-11-27T12:30:00.000Z");
  assert.equal(calls.patch[0].sendUpdates, "all");
  assert.deepEqual(calls.patch[0].requestBody, { start: { dateTime: "2026-11-27T12:00:00.000Z" }, end: { dateTime: "2026-11-27T12:30:00.000Z" } });
});

test("decline as attendee sets only MY response to declined; as organiser it cancels the event", async () => {
  const { cal, calls } = fakeCal([timed("att"), timed("org", { organizer: { email: ME, self: true } })]);
  const p = new GoogleProvider(cal, ME);
  await p.decline("att");
  const sent = calls.patch[0].requestBody.attendees;
  assert.equal(sent.find((a: any) => a.email === ME).responseStatus, "declined");
  assert.equal(sent.find((a: any) => a.email === "boss@corp.com").responseStatus, undefined);
  assert.equal(calls.delete.length, 0);
  await p.decline("org");
  assert.equal(calls.delete.length, 1);
  assert.equal(calls.delete[0].sendUpdates, "all");
});

test("freeBusy marks calendars it cannot see as unavailable instead of free", async () => {
  const { cal } = fakeCal();
  const r = await new GoogleProvider(cal, ME).freeBusy([ME, "priya@corp.com", "ext@other.com"], "2026-11-26T00:00:00Z", "2026-11-27T00:00:00Z");
  assert.deepEqual(r.unavailable, ["ext@other.com"]);
  assert.equal(r.busy[ME].length, 1);
  assert.deepEqual(r.busy["priya@corp.com"], []);
});

test("people() builds a name->email directory from attendees, excluding me", async () => {
  const { cal } = fakeCal([timed("a"), timed("b")]);
  const people = await new GoogleProvider(cal, ME).people();
  assert.deepEqual(people, [{ name: "The Boss", email: "boss@corp.com" }]);
});

test("getEvent returns null for missing and declined events", async () => {
  const { cal } = fakeCal([timed("d", { attendees: [{ email: ME, self: true, responseStatus: "declined" }] })]);
  const p = new GoogleProvider(cal, ME);
  assert.equal(await p.getEvent("nope"), null);
  assert.equal(await p.getEvent("d"), null);
});

test("validation enforces organiser rules on a real calendar", async () => {
  const future = (h: number) => new Date(Date.now() + 2 * 86_400_000 + h * 3_600_000).toISOString();
  const mine = timed("mine", { organizer: { email: ME, self: true }, start: { dateTime: future(0) }, end: { dateTime: future(1) } });
  const theirs = timed("theirs", { start: { dateTime: future(0) }, end: { dateTime: future(1) } });
  const { cal } = fakeCal([mine, theirs]);
  const p = new GoogleProvider(cal, ME);
  const r = await validateChanges(p, [
    { type: "move", eventId: "theirs", reason: "x", to: { start: future(3), end: future(4) } },
    { type: "decline", eventId: "mine", reason: "x" },
    { type: "decline", eventId: "theirs", reason: "x" },
  ]);
  assert.match(r.errors[0].error, /not the organiser/);
  assert.equal(r.changes.length, 2);
  assert.match(r.changes[0].warning!, /cancels it for 1 other attendee/);
  assert.equal(r.changes[1].warning, undefined);
});
