import { randomBytes } from "node:crypto";
import { Router } from "express";
import { google } from "googleapis";
import { config } from "../config.js";
import { clearAuth, readAuth, writeAuth } from "../google/tokenStore.js";
import { SCOPES, googleConfigured, newOAuthClient } from "../google/oauth.js";
import { log } from "../logger.js";

export const authRouter = Router();
const pending = new Map<string, number>(); // OAuth state -> expiry (CSRF protection)

const back = (q: string) => `${config.frontendOrigin}/?${q}`;

// GET /api/auth/status
authRouter.get("/auth/status", (_req, res) => {
  const a = readAuth();
  res.json({ mock: config.useMock, configured: googleConfigured(), connected: config.useMock ? true : Boolean(a), email: config.useMock ? null : (a?.email ?? null) });
});

// GET /api/auth/google  -> redirect to Google's consent screen
authRouter.get("/auth/google", (_req, res) => {
  if (!googleConfigured()) {
    log.error("Google sign-in requested but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing");
    return res.redirect(back("auth_error=" + encodeURIComponent("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in backend/.env")));
  }
  const state = randomBytes(16).toString("hex");
  pending.set(state, Date.now() + 10 * 60_000);
  const url = newOAuthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state });
  log.info("redirecting to Google consent", { redirectUri: config.google.redirectUri });
  res.redirect(url);
});

// GET /api/auth/google/callback
authRouter.get("/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  try {
    if (error) throw new Error(`Google returned: ${error}`);
    const exp = state ? pending.get(state) : undefined;
    pending.delete(state ?? "");
    if (!exp || exp < Date.now()) throw new Error("Sign-in session expired or invalid. Please try again.");
    if (!code) throw new Error("No authorization code returned by Google.");

    const client = newOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const { data } = await google.calendar({ version: "v3", auth: client }).calendars.get({ calendarId: "primary" });
    if (!data.id) throw new Error("Could not read your primary calendar.");
    writeAuth({ tokens, email: data.id });
    log.info("google connected", { email: data.id, hasRefreshToken: Boolean(tokens.refresh_token), scopes: tokens.scope });
    res.redirect(back("connected=1"));
  } catch (err) {
    log.error("google sign-in failed", { err });
    res.redirect(back("auth_error=" + encodeURIComponent((err as Error).message)));
  }
});

// POST /api/auth/logout
authRouter.post("/auth/logout", (_req, res) => {
  clearAuth();
  log.info("google disconnected");
  res.json({ ok: true });
});
