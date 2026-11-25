import { google } from "googleapis";
import { config } from "../config.js";
import { clearAuth, readAuth, writeAuth } from "../google/tokenStore.js";
import { newOAuthClient } from "../google/oauth.js";
import { log } from "../logger.js";
import type { CalendarProvider } from "../types.js";
import { GoogleProvider } from "./GoogleProvider.js";
import { MockProvider } from "./MockProvider.js";

export class NotConnectedError extends Error {
  readonly status = 401;
  constructor(message = "Google Calendar is not connected.") {
    super(message);
  }
}

let mock: MockProvider | null = null;

export function getProvider(): CalendarProvider {
  if (config.useMock) return (mock ??= new MockProvider());

  const stored = readAuth();
  if (!stored) throw new NotConnectedError();
  const client = newOAuthClient();
  client.setCredentials(stored.tokens);
  // Persist refreshed access tokens.
  client.on("tokens", (t) => {
    log.info("google tokens refreshed");
    writeAuth({ ...stored, tokens: { ...stored.tokens, ...t } });
  });
  return new GoogleProvider(google.calendar({ version: "v3", auth: client }), stored.email);
}

export function isMock(p: CalendarProvider): p is MockProvider {
  return p instanceof MockProvider;
}

// Revoked / expired refresh token: forget it so the user is asked to sign in again.
export function dropAuthIfInvalid(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  if (msg.includes("invalid_grant") || msg.includes("Invalid Credentials")) {
    log.warn("Google credentials are no longer valid; clearing stored tokens", { message: msg });
    clearAuth();
    return true;
  }
  return false;
}
