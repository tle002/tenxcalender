import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { log } from "./logger.js";
import { authRouter } from "./routes/auth.js";
import { createPlanRouter, realLLM, type LLMConfig } from "./routes/plan.js";
import { NotConnectedError, dropAuthIfInvalid } from "./providers/index.js";
import { readAuth } from "./google/tokenStore.js";
import { googleConfigured } from "./google/oauth.js";
import { eventsRouter } from "./routes/events.js";

export function createApp(getLLM: () => LLMConfig | null = realLLM) {
  const app = express();
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json({ limit: "200kb" }));

  app.use((req, res, next) => {
    const t = Date.now();
    res.on("finish", () => {
      const url = req.originalUrl.split("?")[0];
      if (url !== "/api/health" && url !== "/api/client-log") log.info(`${req.method} ${url} -> ${res.statusCode}`, { ms: Date.now() - t });
    });
    next();
  });

  // The browser reports its own actions/errors here so one file tells the whole story.
  app.post("/api/client-log", (req, res) => {
    const { level, message, data } = req.body ?? {};
    const lv = level === "error" ? "error" : level === "warn" ? "warn" : "info";
    log[lv](`[client] ${String(message ?? "").slice(0, 300)}`, data);
    res.json({ ok: true });
  });

  app.get("/api/health", (_req, res) => {
    const a = readAuth();
    res.json({
      ok: true,
      mock: config.useMock,
      llmConfigured: Boolean(getLLM()),
      model: config.anthropicModel,
      googleConfigured: googleConfigured(),
      connected: config.useMock ? true : Boolean(a),
      email: config.useMock ? null : (a?.email ?? null),
    });
  });

  app.use("/api", authRouter);
  app.use("/api", eventsRouter);
  app.use("/api", createPlanRouter(getLLM));

  // Central error handler: log server-side, return a plain message.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof NotConnectedError || dropAuthIfInvalid(err)) {
      return res.status(401).json({ error: "Google Calendar is not connected. Please sign in again.", code: "not_connected" });
    }
    const gErr = err as { code?: number; errors?: { message?: string; reason?: string }[] };
    if (gErr.code === 403 || gErr.code === 404 || gErr.code === 400) {
      log.error("Google API error", { err, details: gErr.errors });
      return res.status(502).json({ error: `Google Calendar said: ${err.message}` });
    }
    log.error("Unhandled error in request", { err });
    res.status(500).json({ error: err.message });
  });
  return app;
}
