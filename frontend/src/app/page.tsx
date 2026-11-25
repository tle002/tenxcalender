"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CommandBar from "@/components/CommandBar";
import ProposalPanel from "@/components/ProposalPanel";
import WeekCalendar from "@/components/WeekCalendar";
import ConnectCard from "@/components/ConnectCard";
import Logo from "@/components/Logo";
import { BriefingPanel, HistoryPanel, RulesPanel, type Tab } from "@/components/SidePane";
import { ApiError, api, type Health } from "@/lib/api";
import { clientLog } from "@/lib/clientLog";
import { fmtRange } from "@/lib/format";
import type { CalEvent, Plan } from "@/lib/types";

const DEMO_EXAMPLES = ["Find 45 min with Priya and Sam this week, not mornings", "Protect 2 hours of focus time every day this week"];
const GOOGLE_EXAMPLES = ["Create a 30 minute meeting this Friday afternoon with a Meet link"];

export default function Home() {
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; links: string[] } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<Tab>("briefing");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastIntent, setLastIntent] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  // The briefing always covers one work week, whichever view (day/week/month) is showing.
  const briefingRange = useMemo(() => {
    if (!range) return null;
    const rs = new Date(range.start), re = new Date(range.end);
    const now = new Date();
    const base = re.getTime() - rs.getTime() > 8 * 86400000 && now >= rs && now < re ? now : rs;
    const mon = new Date(base);
    mon.setHours(0, 0, 0, 0);
    const dow = mon.getDay();
    mon.setDate(mon.getDate() + (dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow));
    const end = new Date(mon);
    end.setDate(end.getDate() + 7);
    return { start: mon.toISOString(), end: end.toISOString() };
  }, [range]);
  const isMock = health?.mock ?? true;
  const needsConnect = Boolean(health && !health.mock && !health.connected);

  useEffect(() => {
    // Returning from Google sign-in: ?connected=1 or ?auth_error=...
    const q = new URLSearchParams(window.location.search);
    const authError = q.get("auth_error");
    if (authError) setError(`Google sign-in failed: ${authError}`);
    if (q.has("connected") || authError) window.history.replaceState({}, "", window.location.pathname);

    api
      .health()
      .then((h) => {
        setHealth(h);
        clientLog("info", "app loaded", { mock: h.mock, connected: h.connected, email: h.email, llmConfigured: h.llmConfigured, model: h.model, ua: navigator.userAgent });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    try { setRecents(JSON.parse(localStorage.getItem("tenx.recents") ?? "[]")); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    const onErr = (e: ErrorEvent) => clientLog("error", "window error", { message: e.message, at: `${e.filename}:${e.lineno}` });
    const onRej = (e: PromiseRejectionEvent) => clientLog("error", "unhandled rejection", { reason: String(e.reason) });
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  const loadEvents = useCallback(async (): Promise<CalEvent[]> => {
    if (!range) return [];
    try {
      const { events } = await api.events(range.start, range.end);
      setEvents(events);
      return events;
    } catch (e) {
      if (e instanceof ApiError && e.code === "not_connected") {
        setHealth((h) => (h ? { ...h, connected: false } : h));
        return [];
      }
      clientLog("error", "loading events failed", { message: (e as Error).message });
      setError((e as Error).message);
      return [];
    }
  }, [range]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.links.length ? 30000 : 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const onRange = useCallback((start: string, end: string) => {
    setRange((r) => (r && r.start === start && r.end === end ? r : { start, end }));
  }, []);

  const submit = async (text: string): Promise<boolean> => {
    setError(null);
    setPlanning(true);
    clientLog("info", "plan requested", { text, refining: Boolean(plan?.changes.length) });
    try {
      const { plan: next } = await api.plan(text, plan);
      clientLog("info", "plan received", { summary: next.summary, changes: next.changes.length, dropped: next.warnings });
      setPlan(next);
      setExcluded(new Set());
      setTab("plan");
      setLastIntent(text);
      setRecents((r) => {
        const n = [text, ...r.filter((x) => x !== text)].slice(0, 4);
        try { localStorage.setItem("tenx.recents", JSON.stringify(n)); } catch { /* ignore */ }
        return n;
      });
      return true;
    } catch (e) {
      clientLog("error", "plan failed", { message: (e as Error).message });
      setError((e as Error).message);
      return false;
    } finally {
      setPlanning(false);
    }
  };

  const included = useMemo(() => (plan ? plan.changes.filter((c) => !excluded.has(c.id)) : []), [plan, excluded]);
  const focusDate = included[0]?.to?.start ?? included[0]?.from?.start ?? null;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Swap the proposed slot with one of the alternatives (the old slot becomes an alternative).
  const swap = (changeId: string, altIndex: number) =>
    setPlan((p) => {
      if (!p) return p;
      return {
        ...p,
        changes: p.changes.map((c) => {
          if (c.id !== changeId || !c.to || !c.alternatives) return c;
          const alt = c.alternatives[altIndex];
          const rest = c.alternatives.filter((_, i) => i !== altIndex);
          return { ...c, to: alt, alternatives: [c.to, ...rest], warning: undefined };
        }),
      };
    });

  const apply = async () => {
    if (!included.length) return;
    setApplying(true);
    setError(null);
    try {
      clientLog("info", "apply clicked", { ids: included.map((c) => c.id) });
      const res = await api.apply(included, { intent: plan?.source === "fix" || plan?.source === "focus" ? plan.summary : lastIntent, source: plan?.source ?? "command", summary: plan?.summary });
      if (res.failed.length) setError(`Some changes could not be applied: ${res.failed.map((f) => f.error).join("; ")}`);
      if (res.applied.length) {
        const what = res.applied
          .map((a) => {
            const c = included.find((x) => x.id === a.id);
            return `${a.title}${c?.to ? ` (${fmtRange(c.to)})` : ""}`;
          })
          .join("; ");
        setNotice({
          text: isMock
            ? `Applied in demo mode: ${what}. This is not synced to Google Calendar and no invites were sent.`
            : `Applied: ${what}.`,
          links: res.applied.flatMap((a) => (a.link ? [a.link] : [])),
        });
      }
      setPlan(null);
      setExcluded(new Set());
      setRefreshKey((k) => k + 1);
      setTab("briefing");
      const list = await loadEvents();
      const created = res.applied.flatMap((a) => (a.eventId ? [a.eventId] : []));
      clientLog("info", "apply finished", { applied: res.applied.length, failed: res.failed, eventsInView: list.length, createdEventsVisibleInThisWeek: created.map((id) => ({ id, visible: list.some((e) => e.id === id) })) });
    } catch (e) {
      clientLog("error", "apply failed", { message: (e as Error).message });
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const discard = () => {
    setPlan(null);
    setExcluded(new Set());
  };

  const openPlan = useCallback((p: Plan) => {
    setError(null);
    setPlan(p);
    setExcluded(new Set());
    setTab("plan");
  }, []);

  const protectFocus = async () => {
    if (!briefingRange) return;
    setPlanning(true);
    try {
      openPlan((await api.focusPlan(briefingRange.start, briefingRange.end)).plan);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const onPaneError = useCallback((m: string) => setError(m), []);
  const afterUndo = (m: string) => {
    setNotice({ text: m, links: [] });
    setRefreshKey((k) => k + 1);
    void loadEvents();
  };

  const disconnect = async () => {
    try {
      await api.logout();
      discard();
      setEvents([]);
      setHealth((h) => (h ? { ...h, connected: false, email: null } : h));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resetDemo = async () => {
    try {
      await api.reset();
      setRefreshKey((k) => k + 1);
      discard();
      setError(null);
      await loadEvents();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><Logo size={36} /><div className="brand-name">tenxcalender<span className="brand-tag">Your calendar, on intent</span></div></div>
        <CommandBar busy={planning} disabled={needsConnect} refining={Boolean(plan && plan.changes.length)} examples={[...recents, ...(isMock ? DEMO_EXAMPLES : GOOGLE_EXAMPLES)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 5)} onSubmit={submit} />
        <div className="topbar-right">
          <span className="mode" title={isMock ? "Changes stay inside this app. Nothing is sent to Google Calendar." : "Connected to Google Calendar"}>
            {!health ? "connecting…" : isMock ? "Demo calendar" : health.connected ? `Google · ${health.email}` : "Not connected"}
          </span>
          {isMock ? (
            <button className="btn" onClick={resetDemo}>Reset demo</button>
          ) : health?.connected ? (
            <button className="btn" onClick={disconnect}>Disconnect</button>
          ) : null}
        </div>
      </header>

      {error && (
        <div className="banner banner-error" role="alert">
          {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="banner banner-ok" role="status">
          {notice.text}
          {notice.links.map((l) => (
            <span key={l}> Meeting link: <a href={l} target="_blank" rel="noreferrer">{l}</a></span>
          ))}
        </div>
      )}

      {needsConnect ? (
        <ConnectCard configured={health?.googleConfigured ?? false} onConnect={() => { clientLog("info", "connect google clicked"); window.location.href = api.authUrl; }} />
      ) : (
      <main className="main">
        <section className="calendar-pane">
          <WeekCalendar events={events} changes={included} focusDate={focusDate} onRange={onRange} />
        </section>
        <aside className="side-pane">
          <div className="tabs" role="tablist">
            {(["briefing", "plan", "history", "rules"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "is-active" : ""}`} onClick={() => setTab(t)}>
                {t === "briefing" ? "Briefing" : t === "plan" ? `Plan${included.length ? ` (${included.length})` : ""}` : t === "history" ? "History" : "Rules"}
              </button>
            ))}
          </div>
          {tab === "briefing" && (
            <>
              <BriefingPanel range={briefingRange} refreshKey={refreshKey} onPlan={openPlan} onError={onPaneError} />
              <button className="btn focus-btn" onClick={protectFocus} disabled={planning}>Protect focus time this week</button>
            </>
          )}
          {tab === "plan" && <ProposalPanel plan={plan} excluded={excluded} applying={applying} onToggle={toggle} onSwap={swap} onApply={apply} onDiscard={discard} />}
          {tab === "history" && <HistoryPanel refreshKey={refreshKey} onUndone={afterUndo} onError={onPaneError} />}
          {tab === "rules" && <RulesPanel onError={onPaneError} onSaved={() => setRefreshKey((k) => k + 1)} />}
        </aside>
      </main>
      )}
    </div>
  );
}
