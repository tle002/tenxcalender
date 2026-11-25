import type { CalEvent, Change, Plan } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export interface Health {
  ok: boolean;
  mock: boolean;
  llmConfigured: boolean;
  model: string;
  googleConfigured: boolean;
  connected: boolean;
  email: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Cannot reach the backend. Is it running on port 4000?");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.code);
  return body as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  authUrl: `${BASE}/api/auth/google`,
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  events: (start: string, end: string) =>
    request<{ events: CalEvent[] }>(`/api/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  reset: () => request<{ ok: boolean }>("/api/reset", { method: "POST" }),
  plan: (intent: string, currentPlan?: Plan | null) =>
    request<{ plan: Plan }>("/api/plan", { method: "POST", body: JSON.stringify({ intent, currentPlan }) }),
  apply: (changes: Change[]) =>
    request<{ applied: { id: string; type: string; title: string; link?: string; eventId?: string }[]; failed: { id: string; error: string }[] }>(
      "/api/apply",
      { method: "POST", body: JSON.stringify({ changes }) },
    ),
};
