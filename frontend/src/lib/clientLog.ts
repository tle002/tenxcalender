const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Fire-and-forget: sends a line to the backend log so one file shows both sides.
export function clientLog(level: "info" | "warn" | "error", message: string, data?: unknown) {
  try {
    void fetch(`${BASE}/api/client-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, message, data }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* logging must never break the app */
  }
}
