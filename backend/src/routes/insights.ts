import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { buildBriefing, buildFocusPlan } from "../ai/insights.js";
import { addDays, startOfDay } from "../ai/time.js";
import { config } from "../config.js";
import { getHistory } from "../state.js";
import { undoEntry } from "../history.js";
import { loadRules, saveRules } from "../rules.js";
import { getProvider } from "../providers/index.js";
import { log } from "../logger.js";
import type { LLMConfig } from "./plan.js";

function weekRange(q: any) {
  const s = q.start ? new Date(String(q.start)) : new Date();
  const e = q.end ? new Date(String(q.end)) : null;
  const start = startOfDay(Number.isNaN(s.getTime()) ? new Date() : s);
  const end = e && !Number.isNaN(e.getTime()) ? e : addDays(start, 7);
  return { start, end };
}

export function createInsightsRouter(getLLM: () => LLMConfig | null) {
  const router = Router();

  // GET /api/rules, PUT /api/rules
  router.get("/rules", (_req, res) => res.json({ rules: loadRules() }));
  router.put("/rules", (req, res) => res.json({ rules: saveRules(req.body?.rules ?? {}) }));

  // GET /api/briefing?start&end -> deterministic analysis with validated fixes
  router.get("/briefing", async (req, res, next) => {
    try {
      const { start, end } = weekRange(req.query);
      const briefing = await buildBriefing({ provider: getProvider(), rules: loadRules(), rangeStart: start, rangeEnd: end });
      log.info("briefing", { issues: briefing.issues.length, stats: briefing.stats });
      res.json({ briefing });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/briefing/narrative { summary, issues } -> short friendly paragraph (LLM, optional)
  router.post("/briefing/narrative", async (req, res) => {
    const cfg = getLLM();
    const fallback = String(req.body?.summary ?? "");
    if (!cfg) return res.json({ text: fallback, source: "template" });
    try {
      const issues = Array.isArray(req.body?.issues) ? req.body.issues.slice(0, 8).map((i: any) => `${i.severity}: ${i.title}. ${i.detail}`) : [];
      const r: any = await cfg.llm.create({
        model: cfg.model,
        max_tokens: 250,
        messages: [{ role: "user", content: `Write a 2-3 sentence morning briefing for a busy manager about their calendar. Plain, calm, no greeting, no lists, do not invent facts.\n\nFacts: ${fallback}\nIssues:\n${issues.join("\n") || "none"}` }],
      });
      const text = r.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
      res.json({ text: text || fallback, source: text ? "llm" : "template" });
    } catch (err) {
      if (!(err instanceof Anthropic.APIError)) log.warn("narrative failed", { message: (err as Error).message });
      res.json({ text: fallback, source: "template" });
    }
  });

  // POST /api/focus/plan { hoursPerDay?, start?, end? } -> Plan (never writes)
  router.post("/focus/plan", async (req, res, next) => {
    try {
      const { start, end } = weekRange(req.body ?? {});
      const h = req.body?.hoursPerDay != null ? Number(req.body.hoursPerDay) : undefined;
      const plan = await buildFocusPlan({ provider: getProvider(), rules: loadRules(), rangeStart: start, rangeEnd: end, hoursPerDay: h && h > 0 && h <= 8 ? h : undefined });
      res.json({ plan });
    } catch (err) {
      next(err);
    }
  });

  // History
  router.get("/history", (_req, res) => res.json({ history: getHistory().list(), mock: config.useMock }));
  router.post("/history/:id/undo", async (req, res, next) => {
    try {
      const h = getHistory();
      const entry = h.get(req.params.id);
      if (!entry) return res.status(404).json({ error: "That entry was not found." });
      if (entry.undoneAt) return res.status(400).json({ error: "Already undone." });
      const result = await undoEntry(getProvider(), entry);
      h.markUndone(entry.id, result.notes);
      log.info("undo", { id: entry.id, ...result });
      res.json({ entry: h.get(entry.id), ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
