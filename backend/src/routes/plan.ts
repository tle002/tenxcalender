import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { runPlanner, type LLM } from "../ai/planner.js";
import { validateChanges } from "../ai/validate.js";
import { config } from "../config.js";
import { getProvider } from "../providers/index.js";
import { describe } from "../ai/time.js";
import type { HistoryItem } from "../history.js";
import { log } from "../logger.js";
import type { Change, Plan } from "../types.js";
import { loadRules } from "../rules.js";
import { getHistory } from "../state.js";

export interface LLMConfig {
  llm: LLM;
  model: string;
}

// Real client, created lazily so the server can start without an API key.
export function realLLM(): LLMConfig | null {
  if (!config.anthropicApiKey) return null;
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  return { llm: { create: (p) => client.messages.create(p as any) as any }, model: config.anthropicModel };
}

function parseClarification(v: any): { intent: string; question: string } | null {
  if (!v || typeof v.intent !== "string" || typeof v.question !== "string") return null;
  return { intent: v.intent.slice(0, 500), question: v.question.slice(0, 500) };
}

export function createPlanRouter(getLLM: () => LLMConfig | null = realLLM) {
  const router = Router();

  // POST /api/plan  { intent, currentPlan? }  -> { plan }   (never writes)
  router.post("/plan", async (req, res, next) => {
    try {
      const intent = String(req.body?.intent ?? "").trim();
      if (!intent) return res.status(400).json({ error: "Please type what you want to do." });
      if (intent.length > 500) return res.status(400).json({ error: "That request is too long (500 characters max)." });

      const cfg = getLLM();
      if (!cfg) return res.status(503).json({ error: "ANTHROPIC_API_KEY is not set. Add it to backend/.env and restart the backend." });

      const provider = getProvider();
      const raw = await runPlanner({ llm: cfg.llm, model: cfg.model, provider, intent, currentPlan: req.body?.currentPlan ?? null, rules: loadRules(), clarification: parseClarification(req.body?.clarification) });
      const { changes, errors } = await validateChanges(provider, raw.changes);
      log.info("plan validated", {
        changes: changes.map((c) => ({ id: c.id, type: c.type, title: c.title ?? c.eventTitle, when: c.to ? `${describe(new Date(c.to.start))} - ${describe(new Date(c.to.end))}` : undefined, warning: c.warning, addMeetLink: c.addMeetLink })),
        dropped: errors,
      });
      const plan: Plan = {
        summary: raw.summary,
        changes,
        warnings: errors.map((e) => e.error),
        source: "command",
        rulesApplied: raw.rulesApplied,
        trace: raw.trace,
        ...(raw.clarify && !changes.length ? { clarify: raw.clarify, intent: parseClarification(req.body?.clarification)?.intent ?? intent } : {}),
      };
      res.json({ plan });
    } catch (err) {
      // Only genuine Anthropic API errors are mapped here; anything else (e.g. Google
      // not connected) goes to the central error handler.
      if (!(err instanceof Anthropic.APIError)) return next(err);
      const e = err;
      if (e.status === 401) return res.status(502).json({ error: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in backend/.env." });
      if (e.status === 404) return res.status(502).json({ error: `Model "${config.anthropicModel}" was not found. Check ANTHROPIC_MODEL in backend/.env.` });
      if (e.status === 429) return res.status(502).json({ error: "The Anthropic API is rate limiting or out of credits." });
      next(err);
    }
  });

  // POST /api/apply  { changes }  -> { applied, failed }
  // The ONLY route that writes to the calendar. Changes are re-validated against
  // the live calendar; the client's copy of event details is not trusted.
  router.post("/apply", async (req, res, next) => {
    try {
      const incoming = Array.isArray(req.body?.changes) ? (req.body.changes as Change[]) : [];
      if (!incoming.length) return res.status(400).json({ error: "No changes to apply." });
      if (incoming.length > 25) return res.status(400).json({ error: "Too many changes in one apply." });

      const provider = getProvider();
      log.info("apply requested", { count: incoming.length, ids: incoming.map((c) => c.id) });
      const { changes, errors } = await validateChanges(provider, incoming);
      const applied: { id: string; type: string; title: string; link?: string; eventId?: string }[] = [];
      const items: HistoryItem[] = [];
      const original = new Map<string, { start: string; end: string }>();
      const failed = [...errors];

      for (const c of changes) {
        try {
          let link: string | undefined;
          if (c.eventId && (c.type === "move" || c.type === "shorten")) {
            const ev = await provider.getEvent(c.eventId);
            if (ev) original.set(c.id, { start: ev.start, end: ev.end });
          }
          let eventId: string | undefined;
          if (c.type === "create") {
            const made = await provider.create({ title: c.title!, start: c.to!.start, end: c.to!.end, attendees: c.attendees, kind: c.kind, addMeetLink: c.addMeetLink });
            link = made.meetLink;
            eventId = made.id;
            log.info("event created", { id: made.id, title: made.title, start: made.start, end: made.end, local: `${describe(new Date(made.start))} - ${describe(new Date(made.end))}`, meetLink: made.meetLink, attendees: made.attendees, mockCalendar: config.useMock });
          } else if (c.type === "move" || c.type === "shorten") {
            await provider.move(c.eventId!, c.to!.start, c.to!.end);
          } else if (c.type === "decline") {
            await provider.decline(c.eventId!);
          }
          applied.push({ id: c.id, type: c.type, title: c.title ?? c.eventTitle ?? "", ...(link ? { link } : {}), ...(eventId ? { eventId } : {}) });
          items.push({ changeId: c.id, type: c.type, title: c.title ?? c.eventTitle ?? "", eventId: eventId ?? c.eventId, from: original.get(c.id), to: c.to });
        } catch (err) {
          log.error("apply failed for a change", { id: c.id, err });
          failed.push({ id: c.id, error: (err as Error).message });
        }
      }
      log.info("apply result", { applied: applied.length, failed });
      let historyId: string | undefined;
      if (items.length) {
        const intent = String(req.body?.intent ?? "").slice(0, 300);
        const source = req.body?.source === "fix" || req.body?.source === "focus" ? req.body.source : "command";
        historyId = getHistory().add({ intent: intent || "Applied changes", source, summary: String(req.body?.summary ?? "").slice(0, 300), items }).id;
      }
      res.json({ applied, failed, historyId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
