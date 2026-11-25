// TEST/DEV ONLY: runs the real backend with a scripted fake LLM so the UI can
// be exercised end to end without an API key. Not used in production.
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import type { LLM } from "../src/ai/planner.js";
import { toLocalISO } from "../src/ai/time.js";
import { scheduleFakeLLM } from "./fakeLLM.js";

const schedule = scheduleFakeLLM({ emails: ["priya@acme.com", "sam@acme.com"], duration: 45, earliestHour: 12, thisWeekOnly: true });

const llm: LLM = {
  async create(params: any) {
    const msgs = params.messages as any[];
    const first = String(msgs[0].content);
    const last = msgs[msgs.length - 1];
    const tr = Array.isArray(last.content) ? last.content.find((b: any) => b.type === "tool_result") : null;

    if (first.includes("ghosts")) {
      if (!tr) {
        const s = new Date(); const e = new Date(Date.now() + 10 * 86_400_000);
        const d = (x: Date) => x.toISOString().slice(0, 10);
        return { content: [{ type: "tool_use", id: "g1", name: "get_events", input: { start: d(s), end: d(e) } }] };
      }
      const evs = JSON.parse(tr.content) as any[];
      const by = (t: string) => evs.find((x) => x.title === t);
      const demo = by("Weekly demo"), crit = by("Design crit"), skip = by("Skip-level with Dev");
      const at = (iso: string, h: number, m: number) => { const x = new Date(iso); x.setHours(h, m, 0, 0); return toLocalISO(x); };
      return { content: [{ type: "tool_use", id: "g2", name: "propose_plan", input: {
        summary: "Three fixes: decline the skip-level, shorten the demo, move the design crit.",
        changes: [
          { type: "decline", eventId: skip.id, reason: "Low priority, overlaps your focus time" },
          { type: "shorten", eventId: demo.id, reason: "Demos rarely need the full hour", to: { start: demo.start, end: toLocalISO(new Date(Date.parse(demo.start) + 30 * 60_000)) } },
          { type: "move", eventId: crit.id, reason: "Frees Thursday morning", to: { start: at(demo.start, 15, 30), end: at(demo.start, 16, 30) } },
        ] } }] };
    }
    if (first.includes("link")) {
      const d = new Date(); do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
      d.setHours(16, 0, 0, 0);
      return { content: [{ type: "tool_use", id: "l1", name: "propose_plan", input: { summary: "A 30 min meeting with a link.", changes: [
        { type: "create", title: "Quick sync", reason: "You asked for a link", addMeetLink: true, to: { start: toLocalISO(d), end: toLocalISO(new Date(d.getTime() + 30 * 60_000)) } } ] } }] };
    }
    if (first.includes("USER FOLLOW-UP")) {
      const cur = JSON.parse(first.split("CURRENT PLAN:\n")[1].split("\n\n")[0]) as any[];
      const c = cur[0];
      const thu = new Date(); do { thu.setDate(thu.getDate() + 1); } while (thu.getDay() !== 4);
      const s = new Date(thu); s.setHours(15, 0, 0, 0);
      const e = new Date(s.getTime() + (Date.parse(c.to.end) - Date.parse(c.to.start)));
      return { content: [{ type: "tool_use", id: "r1", name: "propose_plan", input: { summary: "Moved to Thursday at 3 PM as asked.", changes: [{ ...c, to: { start: toLocalISO(s), end: toLocalISO(e) }, alternatives: [] }] } }] };
    }
    return schedule.create(params);
  },
};

createApp(() => ({ llm, model: "fake" })).listen(config.port, () => console.log(`DEV backend (fake LLM) on :${config.port}`));
