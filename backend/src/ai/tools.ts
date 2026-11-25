import type { CalendarProvider } from "../types.js";
import { findCommonSlots } from "./slots.js";
import { dayName, parseDateInput, toLocalISO } from "./time.js";

// Read-only tools the model may call while planning. There are deliberately no
// write tools: the model can only PROPOSE changes via propose_plan, and only
// /api/apply (after user approval) ever writes to the calendar.

export const TOOLS = [
  {
    name: "get_events",
    description: "List the user's calendar events between two dates (inclusive). Returns id, title, start, end, attendees.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Local date YYYY-MM-DD or ISO datetime" },
        end: { type: "string", description: "Local date YYYY-MM-DD (inclusive) or ISO datetime" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_freebusy",
    description: "Get busy blocks for people (by email) between two dates. Use for questions about someone's availability.",
    input_schema: {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "string" } },
        start: { type: "string" },
        end: { type: "string" },
      },
      required: ["emails", "start", "end"],
    },
  },
  {
    name: "find_common_slots",
    description:
      "Find the best meeting slots when the user and all listed attendees are free. Computed by code, so results never overlap anyone's busy time. Prefer this over reasoning about free/busy yourself. Slots already avoid weekends and the past.",
    input_schema: {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "string" }, description: "Attendee emails (the user is always included)" },
        duration_minutes: { type: "integer" },
        range_start: { type: "string", description: "Local date YYYY-MM-DD or ISO datetime" },
        range_end: { type: "string", description: "Local date YYYY-MM-DD (inclusive) or ISO datetime" },
        earliest_hour: { type: "integer", description: "Earliest start hour, 0-23. Default 9. 'Not mornings' means 12." },
        latest_hour: { type: "integer", description: "Meeting must end by this hour, 1-24. Default 18." },
        max_results: { type: "integer", description: "Default 5" },
      },
      required: ["emails", "duration_minutes", "range_start", "range_end"],
    },
  },
  {
    name: "propose_plan",
    description:
      "FINAL STEP. Submit the proposed calendar changes for the user to review. Nothing is written until the user approves. Call this exactly once when done. Use an empty changes array if no change is needed or the request is unclear (explain in summary).",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "1-2 plain sentences for the user describing the plan or the question you need answered." },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["create", "move", "decline", "shorten"] },
              reason: { type: "string", description: "One short sentence on why." },
              eventId: { type: "string", description: "Existing event id (move/decline/shorten)" },
              title: { type: "string", description: "Title for a new event (create)" },
              attendees: { type: "array", items: { type: "string" }, description: "Attendee emails (create)" },
              kind: { type: "string", enum: ["meeting", "focus", "personal"] },
              addMeetLink: { type: "boolean", description: "create: true if the user wants a video-call / meeting link." },
              to: {
                type: "object",
                properties: { start: { type: "string" }, end: { type: "string" } },
                required: ["start", "end"],
                description: "New time as ISO 8601 with offset. Required for create/move/shorten.",
              },
              alternatives: {
                type: "array",
                description: "For create: up to 2 other good slots the user can swap in.",
                items: {
                  type: "object",
                  properties: { start: { type: "string" }, end: { type: "string" } },
                  required: ["start", "end"],
                },
              },
            },
            required: ["type", "reason"],
          },
        },
      },
      required: ["summary", "changes"],
    },
  },
];

export interface ToolContext {
  provider: CalendarProvider;
  now: Date;
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  return { day: dayName(d), start: toLocalISO(d) };
};

export async function executeTool(name: string, input: Record<string, any>, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case "get_events": {
      const s = parseDateInput(String(input.start));
      const e = parseDateInput(String(input.end), true);
      const events = await ctx.provider.listEvents(s.toISOString(), e.toISOString());
      return events
        .filter((ev) => ev.status !== "declined")
        .slice(0, 100)
        .map((ev) => ({
          id: ev.id,
          title: ev.title,
          day: dayName(new Date(ev.start)),
          start: toLocalISO(new Date(ev.start)),
          end: toLocalISO(new Date(ev.end)),
          attendees: ev.attendees,
          kind: ev.kind,
        }));
    }
    case "get_freebusy": {
      const s = parseDateInput(String(input.start));
      const e = parseDateInput(String(input.end), true);
      const emails = (input.emails as string[]) ?? [];
      const fb = await ctx.provider.freeBusy(emails, s.toISOString(), e.toISOString());
      return {
        busy: Object.fromEntries(
          Object.entries(fb.busy).map(([k, v]) => [k, v.map((b) => ({ ...fmt(b.start), end: toLocalISO(new Date(b.end)) }))]),
        ),
        ...(fb.unavailable.length ? { note: `Availability unknown (calendar not visible) for: ${fb.unavailable.join(", ")}` } : {}),
      };
    }
    case "find_common_slots": {
      const emails = Array.from(new Set([ctx.provider.selfEmail, ...((input.emails as string[]) ?? [])]));
      const rangeStart = parseDateInput(String(input.range_start));
      const rangeEnd = parseDateInput(String(input.range_end), true);
      const duration = Number(input.duration_minutes);
      if (!Number.isFinite(duration) || duration < 5 || duration > 480) throw new Error("duration_minutes must be 5-480");
      const fb = await ctx.provider.freeBusy(emails, rangeStart.toISOString(), rangeEnd.toISOString());
      const busyMap = fb.busy;
      const myEvents = await ctx.provider.listEvents(rangeStart.toISOString(), rangeEnd.toISOString());
      const slots = findCommonSlots({
        durationMin: duration,
        rangeStart,
        rangeEnd,
        earliestHour: Number(input.earliest_hour ?? 9),
        latestHour: Number(input.latest_hour ?? 18),
        busy: Object.values(busyMap).flat(),
        myEvents,
        now: ctx.now,
        maxResults: Number(input.max_results ?? 5),
      });
      return {
        slots: slots.map((s) => ({ day: dayName(s.start), start: toLocalISO(s.start), end: toLocalISO(s.end) })),
        note:
          (slots.length ? "Ranked best first." : "No common slot found in this range with these constraints.") +
          (fb.unavailable.length ? ` WARNING: could not see the calendars of ${fb.unavailable.join(", ")}, so their availability was NOT considered. Tell the user.` : ""),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
