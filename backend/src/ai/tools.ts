import type { CalendarProvider } from "../types.js";
import { DEFAULT_RULES, type Rules } from "../rules.js";
import { buildFocusPlan } from "./insights.js";
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
      "Find the best meeting slots when the user and all listed attendees are free. Computed by code, so results never overlap anyone's busy time. Prefer this over reasoning about free/busy yourself. Slots avoid weekends and the past unless include_weekends is true.",
    input_schema: {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "string" }, description: "Attendee emails (the user is always included)" },
        duration_minutes: { type: "integer" },
        range_start: { type: "string", description: "Local date YYYY-MM-DD or ISO datetime" },
        range_end: { type: "string", description: "Local date YYYY-MM-DD (inclusive) or ISO datetime" },
        earliest_hour: { type: "integer", description: "Earliest start hour, 0-23. Defaults to the user's working hours. 'Not mornings' means 12." },
        latest_hour: { type: "integer", description: "Meeting must end by this hour, 1-24. Defaults to the user's working hours." },
        max_results: { type: "integer", description: "Default 5" },
        include_weekends: { type: "boolean", description: "Set true ONLY when the user explicitly asks for a Saturday or Sunday." },
      },
      required: ["emails", "duration_minutes", "range_start", "range_end"],
    },
  },
  {
    name: "plan_focus_blocks",
    description:
      "Find where to protect focus (deep-work) time around the user's meetings. Computed by code from the user's rules. Use for requests like 'protect 2 hours of focus time every day'. Returns blocks ready to put in propose_plan as create changes with kind 'focus' and title 'Focus time'.",
    input_schema: {
      type: "object",
      properties: {
        range_start: { type: "string", description: "Local date YYYY-MM-DD" },
        range_end: { type: "string", description: "Local date YYYY-MM-DD (inclusive)" },
        hours_per_day: { type: "number", description: "Defaults to the user's rule" },
      },
      required: ["range_start", "range_end"],
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
        needs_answer: { type: "boolean", description: "True when you are asking the user a question and proposing no changes because you need their answer." },
        clarify_options: { type: "array", items: { type: "string" }, description: "When needs_answer is true: 2-3 short, complete replies the user could click, e.g. 'Fri 4 Dec, 2pm'. Each must work as a standalone answer." },
        rules_applied: { type: "array", items: { type: "string" }, description: "Which of the user's rules or preferences shaped this plan, in a few words each (e.g. 'Lunch 13:00-14:00 kept free'). Empty if none." },
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
  rules?: Rules;
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  return { day: dayName(d), start: toLocalISO(d) };
};

export async function executeTool(name: string, input: Record<string, any>, ctx: ToolContext): Promise<unknown> {
  const rules = ctx.rules ?? DEFAULT_RULES;
  switch (name) {
    case "plan_focus_blocks": {
      const rangeStart = parseDateInput(String(input.range_start));
      const rangeEnd = parseDateInput(String(input.range_end), true);
      const plan = await buildFocusPlan({ provider: ctx.provider, rules, rangeStart, rangeEnd, now: ctx.now, hoursPerDay: input.hours_per_day ? Number(input.hours_per_day) : undefined });
      return { summary: plan.summary, blocks: plan.changes.map((c) => ({ title: c.title, kind: "focus", start: c.to!.start, end: c.to!.end })), warnings: plan.warnings };
    }
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
        earliestHour: Number(input.earliest_hour ?? rules.workStart),
        latestHour: Number(input.latest_hour ?? rules.workEnd),
        lunch: rules.protectLunch ? { start: rules.lunchStart, end: rules.lunchEnd } : null,
        busy: Object.values(busyMap).flat(),
        myEvents,
        now: ctx.now,
        maxResults: Number(input.max_results ?? 5),
        includeWeekends: input.include_weekends === true,
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
