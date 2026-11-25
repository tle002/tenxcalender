import type { LLM } from "../src/ai/planner.js";

// A scripted stand-in for the model. It really reads tool results out of the
// conversation, so the tool loop and executors are exercised end to end.
export function scheduleFakeLLM(opts: { emails: string[]; duration: number; earliestHour?: number; thisWeekOnly?: boolean }): LLM & { calls: number } {
  const fake = {
    calls: 0,
    async create(params: any) {
      fake.calls++;
      const msgs = params.messages as any[];
      const last = msgs[msgs.length - 1];
      const toolResult = Array.isArray(last.content) ? last.content.find((b: any) => b.type === "tool_result") : null;

      if (!toolResult) {
        const now = new Date();
        let end = new Date(now.getTime() + 10 * 86_400_000);
        if (opts.thisWeekOnly) { end = new Date(now); while (end.getDay() !== 5) end.setDate(end.getDate() + 1); }
        const d = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
        return {
          content: [{
            type: "tool_use", id: "t1", name: "find_common_slots",
            input: { emails: opts.emails, duration_minutes: opts.duration, range_start: d(now), range_end: d(end), earliest_hour: opts.earliestHour ?? 9 },
          }],
        };
      }
      const { slots } = JSON.parse(toolResult.content);
      return {
        content: [{
          type: "tool_use", id: "t2", name: "propose_plan",
          input: {
            summary: `Found ${slots.length} slots`,
            changes: [{
              type: "create", title: "Sync: Priya, Sam", attendees: opts.emails, reason: "Best common slot",
              to: { start: slots[0].start, end: slots[0].end },
              alternatives: slots.slice(1, 3).map((s: any) => ({ start: s.start, end: s.end })),
            }],
          },
        }],
      };
    },
  };
  return fake as LLM & { calls: number };
}
