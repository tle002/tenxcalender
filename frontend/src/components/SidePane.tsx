"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtWhen } from "@/lib/format";
import type { Briefing, HistoryEntry, Issue, Plan, Rules } from "@/lib/types";

export type Tab = "briefing" | "plan" | "history" | "rules";

const SEV: Record<Issue["severity"], string> = { high: "Needs attention", medium: "Worth a look", low: "Suggestion" };

export function BriefingPanel({ range, refreshKey, onPlan, onError }: { range: { start: string; end: string } | null; refreshKey: number; onPlan: (p: Plan) => void; onError: (m: string) => void }) {
  const [b, setB] = useState<Briefing | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!range) return;
    let live = true;
    setLoading(true);
    api
      .briefing(range.start, range.end)
      .then(({ briefing }) => {
        if (!live) return;
        setB(briefing);
        setText(briefing.summary);
        api.narrative(briefing.summary, briefing.issues).then((n) => live && setText(n.text)).catch(() => {});
      })
      .catch((e: Error) => live && onError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [range, refreshKey, onError]);

  if (!b) return <p className="muted">{loading ? "Reading your week…" : "No briefing yet."}</p>;
  const maxMin = Math.max(60, ...b.days.map((d) => d.meetingMin + d.focusMin));
  return (
    <div className="briefing">
      <p className="summary">{text}</p>
      <div className="daybars" aria-label="Meeting load per day">
        {b.days.map((d) => (
          <div key={d.date} className={`daybar ${d.isToday ? "is-today" : ""} ${d.isPast ? "is-past" : ""}`} title={`${d.label}: ${Math.round(d.meetingMin / 6) / 10}h meetings, ${Math.round(d.focusMin / 6) / 10}h focus`}>
            <div className="daybar-track">
              <div className="seg seg-focus" style={{ height: `${(d.focusMin / maxMin) * 100}%` }} />
              <div className={`seg ${d.heavy ? "seg-heavy" : "seg-meet"}`} style={{ height: `${(d.meetingMin / maxMin) * 100}%` }} />
            </div>
            <span className="daybar-label">{d.label.slice(0, 3)}</span>
          </div>
        ))}
      </div>
      <div className="legend"><span><i className="dot dot-meet" />Meetings</span><span><i className="dot dot-heavy" />Heavy day</span><span><i className="dot dot-focus" />Focus</span></div>

      {b.issues.length === 0 ? (
        <p className="muted">Nothing needs fixing this week.</p>
      ) : (
        b.issues.map((i) => (
          <div key={i.id} className={`issue issue-${i.severity}`}>
            <div className="issue-sev">{SEV[i.severity]}</div>
            <div className="issue-title">{i.title}</div>
            <div className="change-meta">{i.detail}</div>
            <div className="fixes">
              {i.fixes.map((f) => (
                <button key={f.id} className="fix" onClick={() => onPlan({ ...f.plan, summary: `${i.title}. ${f.label}.` })}>{f.label}</button>
              ))}
              {i.fixes.length === 0 && <span className="change-meta">No safe automatic fix.</span>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function HistoryPanel({ refreshKey, onUndone, onError }: { refreshKey: number; onUndone: (m: string) => void; onError: (m: string) => void }) {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.history().then((r) => setItems(r.history)).catch((e: Error) => onError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [refreshKey]);

  const undo = async (id: string) => {
    setBusy(true);
    try {
      const r = await api.undo(id);
      onUndone(`Undone: ${r.notes.join("; ") || "nothing to change"}.`);
      setConfirm(null);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const latestId = items.find((h) => !h.undoneAt)?.id; // only the newest applied change can be undone
  if (!items.length) return <p className="muted">Nothing applied yet. Every change you approve is listed here and can be undone.</p>;
  return (
    <div className="history">
      {items.map((h) => (
        <div key={h.id} className={`hist ${h.undoneAt ? "is-undone" : ""}`}>
          <div className="hist-top"><span className={`badge badge-src`}>{h.source === "command" ? "Request" : h.source === "fix" ? "Fix" : "Focus"}</span><span className="change-meta">{fmtWhen(h.at)}</span></div>
          <div className="hist-intent">{h.intent}</div>
          <ul className="hist-items">{h.items.map((i) => <li key={i.changeId}>{i.type} · {i.title}</li>)}</ul>
          {h.undoneAt ? (
            <div className="change-meta">Undone. {h.undoNotes?.join("; ")}</div>
          ) : confirm === h.id ? (
            <div className="confirm">
              <span>Undo {h.items.length} change{h.items.length === 1 ? "" : "s"}? Invites you sent may notify people.</span>
              <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={() => undo(h.id)} disabled={busy}>{busy ? "Undoing…" : "Undo"}</button>
            </div>
          ) : h.id === latestId ? (
            <button className="btn" onClick={() => setConfirm(h.id)}>Undo</button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RulesPanel({ onError, onSaved }: { onError: (m: string) => void; onSaved: () => void }) {
  const [r, setR] = useState<Rules | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.rules().then((x) => setR(x.rules)).catch((e: Error) => onError(e.message)); }, [onError]);
  if (!r) return <p className="muted">Loading…</p>;
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => { setR({ ...r, [k]: v }); setSaved(false); };
  const num = (k: keyof Rules, label: string, step = 1) => (
    <label className="field"><span>{label}</span><input type="number" step={step} value={r[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} /></label>
  );
  const save = async () => {
    try { setR((await api.saveRules(r)).rules); setSaved(true); onSaved(); } catch (e) { onError((e as Error).message); }
  };
  return (
    <div className="rules">
      <p className="muted">Your standing preferences. The planner follows them and the briefing uses them to judge your week.</p>
      <div className="field-row">{num("workStart", "Day starts (hour)")}{num("workEnd", "Day ends (hour)")}</div>
      <label className="check"><input type="checkbox" checked={r.protectLunch} onChange={(e) => set("protectLunch", e.target.checked)} /> Keep lunch free</label>
      <div className="field-row">{num("lunchStart", "Lunch from", 0.5)}{num("lunchEnd", "Lunch until", 0.5)}</div>
      <div className="field-row">{num("defaultMeetingMinutes", "Default meeting (min)", 5)}{num("heavyDayHours", "Heavy day (hours)", 0.5)}</div>
      <div className="field-row">
        {num("focusHoursPerDay", "Focus time per day (h)", 0.5)}
        <label className="field"><span>Prefer focus in the</span>
          <select value={r.focusPrefer} onChange={(e) => set("focusPrefer", e.target.value as Rules["focusPrefer"])}>
            <option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="any">Anywhere</option>
          </select>
        </label>
      </div>
      <label className="field"><span>Your own notes for the planner</span>
        <textarea rows={3} maxLength={500} value={r.notes} placeholder="e.g. Fridays are light: no external calls" onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="panel-actions"><button className="btn btn-primary" onClick={save}>{saved ? "Saved" : "Save rules"}</button></div>
    </div>
  );
}
