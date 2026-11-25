import type { CalendarProvider, Plan } from "../types.js";
import { TOOLS, executeTool } from "./tools.js";
import { describe, toLocalISO, tzName } from "./time.js";
import { log } from "../logger.js";
import { DEFAULT_RULES, rulesToPrompt, type Rules } from "../rules.js";

// Minimal client shape so tests can inject a fake LLM.
export interface LLM {
  create(params: Record<string, unknown>): Promise<{ content: any[] }>;
}

const MAX_TURNS = 6;

function systemPrompt(now: Date, selfEmail: string, directory: string, rules: Rules): string {
  return `You are the planning engine of an AI-native calendar for a busy manager.
The user is ${selfEmail}. Timezone: ${tzName()}. Right now it is ${describe(now)} (${toLocalISO(now)}).
The user's standing rules (apply them unless the request says otherwise, and list the ones that shaped the plan in rules_applied):
${rulesToPrompt(rules)}
People you know (name <email>): ${directory || "none yet"}.
Attendees are identified by email. If the user names someone who is not in that list and gives no email, do not guess: return no changes and ask for their email address.

How you work:
- The user states an intent. You investigate with the read-only tools, then finish by calling propose_plan exactly once.
- You can NEVER change the calendar. You only propose; the user reviews ghost events and approves.
- To schedule a meeting, call find_common_slots (it does the free/busy maths). Propose the best slot as one "create" change and put the next 1-2 best slots in its "alternatives". Convert constraints into parameters: "not mornings" => earliest_hour 12; "afternoons only" => earliest_hour 12; "before lunch" => latest_hour 12.
- "This week" means the remaining working days of the current week, starting from now.
- To move, shorten or decline, use the event id from get_events. Never invent ids.
- All times in propose_plan must be ISO 8601 with offset, e.g. 2026-11-26T14:00:00+05:30.
- To protect focus / deep-work time, call plan_focus_blocks and propose its blocks as create changes (kind "focus", title "Focus time").
- If the user names no attendees, schedule it for the user alone (call find_common_slots with an empty emails list). If no duration is given, use the default meeting length from the rules. If a day is named ("this Friday"), set range_start and range_end to that date.
- If the user asks for a link, video call, Meet or Zoom, set addMeetLink true on that create change.
- Title new meetings sensibly (e.g. "Sync: Priya, Sam") and put attendee emails in "attendees".
- If a CURRENT PLAN is provided and the user's message is a follow-up ("make it Thursday", "shorter", "drop Sam"), return the full revised plan, changing only what they asked.
- If the request is ambiguous, impossible, or no slot exists, return an empty changes array and say why in summary (one short question at most).
- Keep reasons and summaries short and in plain language.`;
}

export interface PlannerArgs {
  llm: LLM;
  model: string;
  provider: CalendarProvider;
  intent: string;
  currentPlan?: Plan | null;
  now?: Date;
  rules?: Rules;
}

export interface RawPlan {
  summary: string;
  changes: unknown[];
  rulesApplied: string[];
  trace: string[];
}

function traceLine(name: string, input: Record<string, any>, out: any): string {
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  switch (name) {
    case "get_events": return `Read your calendar ${input.start} to ${input.end} (${n(out)} events)`;
    case "get_freebusy": return `Checked availability for ${n(input.emails)} ${n(input.emails) === 1 ? "person" : "people"}`;
    case "find_common_slots": return `Searched for ${input.duration_minutes}-minute slots, ${input.range_start} to ${input.range_end} (${n(out?.slots)} found)`;
    case "plan_focus_blocks": return `Planned focus blocks, ${input.range_start} to ${input.range_end} (${n(out?.blocks)} found)`;
    default: return `Ran ${name}`;
  }
}

export async function runPlanner({ llm, model, provider, intent, currentPlan, now = new Date(), rules = DEFAULT_RULES }: PlannerArgs): Promise<RawPlan> {
  const trace: string[] = [];
  const userText = currentPlan?.changes?.length
    ? `CURRENT PLAN:\n${JSON.stringify(currentPlan.changes.map(({ warning, eventTitle, from, ...c }) => c))}\n\nUSER FOLLOW-UP: ${intent}`
    : `USER REQUEST: ${intent}`;

  const directory = (await provider.people()).map((p) => `${p.name} <${p.email}>`).join(", ");
  const messages: any[] = [{ role: "user", content: userText }];
  log.info("planner start", { intent, model, refining: Boolean(currentPlan?.changes?.length), now: toLocalISO(now) });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastTurn = turn === MAX_TURNS - 1;
    let res: { content: any[] };
    try {
      res = await llm.create({
        model,
        max_tokens: 2000,
        system: systemPrompt(now, provider.selfEmail, directory, rules),
        tools: TOOLS,
        tool_choice: lastTurn ? { type: "tool", name: "propose_plan" } : { type: "auto" },
        messages,
      });
    } catch (err) {
      const e = err as Error & { status?: number };
      log.error("LLM call failed", { turn: turn + 1, model, status: e.status, message: e.message });
      throw err;
    }
    log.info("llm response", {
      turn: turn + 1,
      blocks: res.content.map((b) => (b.type === "tool_use" ? { tool: b.name, input: b.input } : { type: b.type, text: String(b.text ?? "").slice(0, 300) })),
    });

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    const final = toolUses.find((b) => b.name === "propose_plan");
    if (final) {
      const input = final.input ?? {};
      const proposed: RawPlan = {
        summary: String(input.summary ?? ""),
        changes: Array.isArray(input.changes) ? input.changes : [],
        rulesApplied: Array.isArray(input.rules_applied) ? input.rules_applied.map(String).slice(0, 6) : [],
        trace,
      };
      log.info("planner proposed", proposed);
      return proposed;
    }

    messages.push({ role: "assistant", content: res.content });

    if (!toolUses.length) {
      // Model answered in prose instead of calling propose_plan: nudge it.
      messages.push({ role: "user", content: "Please finish by calling propose_plan." });
      continue;
    }

    const results = await Promise.all(
      toolUses.map(async (t) => {
        try {
          const out = await executeTool(t.name, t.input ?? {}, { provider, now, rules });
          trace.push(traceLine(t.name, t.input ?? {}, out));
          log.info("tool result", { tool: t.name, result: JSON.stringify(out).slice(0, 1500) });
          return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(out) };
        } catch (err) {
          log.warn("tool failed", { tool: t.name, input: t.input, message: (err as Error).message });
          return { type: "tool_result", tool_use_id: t.id, content: `Error: ${(err as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  throw new Error("The planner did not produce a plan. Please try rephrasing.");
}
