process.env.LOG_TO_FILE = "false";
process.env.USE_MOCK = "false";
process.env.GOOGLE_CLIENT_ID = "test-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_TOKEN_FILE = "/nonexistent/never-written.json"; // tests must never touch a real login
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { scheduleFakeLLM } from "./fakeLLM.js";

let server: any;
let base = "";
before(async () => {
  const { createApp } = await import("../src/app.js");
  server = createApp(() => ({ llm: scheduleFakeLLM({ emails: [], duration: 30 }), model: "fake" })).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test("not signed in: health says so, data routes return 401 not_connected (not an Anthropic error)", async () => {
  const h = (await (await fetch(base + "/api/health")).json()) as any;
  assert.equal(h.mock, false);
  assert.equal(h.connected, false);
  assert.equal(h.googleConfigured, true);

  const ev = await fetch(`${base}/api/events?start=2026-11-23T00:00:00Z&end=2026-11-30T00:00:00Z`);
  assert.equal(ev.status, 401);
  assert.equal(((await ev.json()) as any).code, "not_connected");

  const plan = await fetch(base + "/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "hi" }) });
  assert.equal(plan.status, 401);
  assert.equal(((await plan.json()) as any).code, "not_connected");

  const apply = await fetch(base + "/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes: [{ type: "decline", eventId: "x", reason: "x" }] }) });
  assert.equal(apply.status, 401);
});

test("consent redirect asks for offline access with the right scopes, callback and state", async () => {
  const r = await fetch(base + "/api/auth/google", { redirect: "manual" });
  assert.equal(r.status, 302);
  const u = new URL(r.headers.get("location")!);
  assert.equal(u.host, "accounts.google.com");
  assert.equal(u.searchParams.get("client_id"), "test-id.apps.googleusercontent.com");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:4000/api/auth/google/callback");
  assert.match(u.searchParams.get("scope")!, /calendar\.events/);
  assert.ok(u.searchParams.get("state"));
});

test("callback rejects a forged state and an OAuth error", async () => {
  const forged = await fetch(base + "/api/auth/google/callback?code=x&state=forged", { redirect: "manual" });
  assert.match(forged.headers.get("location")!, /auth_error=Sign-in/);
  const denied = await fetch(base + "/api/auth/google/callback?error=access_denied", { redirect: "manual" });
  assert.match(denied.headers.get("location")!, /auth_error=Google%20returned%3A%20access_denied/);
});
