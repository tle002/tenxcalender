import { Router } from "express";
import { getProvider, isMock } from "../providers/index.js";

export const eventsRouter = Router();

// GET /api/events?start=ISO&end=ISO  -> events in range (declined ones hidden)
eventsRouter.get("/events", async (req, res, next) => {
  try {
    const start = String(req.query.start ?? "");
    const end = String(req.query.end ?? "");
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return res.status(400).json({ error: "start and end must be ISO date strings" });
    }
    const events = await getProvider().listEvents(start, end);
    res.json({ events: events.filter((e) => e.status !== "declined") });
  } catch (err) {
    next(err);
  }
});

// GET /api/freebusy?emails=a@x.com,b@x.com&start=ISO&end=ISO
eventsRouter.get("/freebusy", async (req, res, next) => {
  try {
    const emails = String(req.query.emails ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const start = String(req.query.start ?? "");
    const end = String(req.query.end ?? "");
    if (!emails.length || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return res.status(400).json({ error: "emails, start and end are required" });
    }
    res.json(await getProvider().freeBusy(emails, start, end));
  } catch (err) {
    next(err);
  }
});

// POST /api/reset  -> restore seeded demo data (mock only)
eventsRouter.post("/reset", (_req, res, next) => {
  try {
    const p = getProvider();
    if (!isMock(p)) return res.status(400).json({ error: "reset is only available with USE_MOCK=true" });
    p.reset();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
