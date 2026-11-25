"use client";

import type { Change, Plan } from "@/lib/types";
import { fmtRange, fmtWhen, minutes } from "@/lib/format";

interface Props {
  plan: Plan | null;
  excluded: Set<string>;
  applying: boolean;
  onToggle: (id: string) => void;
  onSwap: (changeId: string, altIndex: number) => void;
  onApply: () => void;
  onDiscard: () => void;
}

const BADGE: Record<Change["type"], string> = { create: "New", move: "Move", decline: "Decline", shorten: "Shorten" };

function describeChange(c: Change): string {
  if (c.type === "create" && c.to) return fmtRange(c.to);
  if (c.type === "decline" && c.from) return `${fmtWhen(c.from.start)} · removed from your calendar`;
  if (c.type === "move" && c.from && c.to) return `${fmtWhen(c.from.start)} → ${fmtWhen(c.to.start)}`;
  if (c.type === "shorten" && c.from && c.to) return `${minutes(c.from)} min → ${minutes(c.to)} min`;
  return "";
}

export default function ProposalPanel({ plan, excluded, applying, onToggle, onSwap, onApply, onDiscard }: Props) {
  if (!plan) {
    return (
      <div>
        <p className="muted">
          Nothing proposed yet. Describe what you need, or open Briefing for one-click fixes. Plans appear here and on the calendar as ghost events.
          Nothing is written until you apply it.
        </p>
      </div>
    );
  }

  const count = plan.changes.filter((c) => !excluded.has(c.id)).length;

  return (
    <div>
      <p className="summary">{plan.summary}</p>
      {plan.rulesApplied && plan.rulesApplied.length > 0 && (
        <div className="rules-used">
          <span className="alts-label">Used your rules</span>
          {plan.rulesApplied.map((r, i) => <span key={i} className="rule-chip">{r}</span>)}
        </div>
      )}

      {plan.warnings && plan.warnings.length > 0 && (
        <ul className="warn-list">
          {plan.warnings.map((w, i) => (
            <li key={i}>Skipped: {w}</li>
          ))}
        </ul>
      )}

      <div className="changes">
        {plan.changes.map((c) => {
          const off = excluded.has(c.id);
          return (
            <div key={c.id} className={`change ${off ? "is-off" : ""}`}>
              <label className="change-head">
                <input type="checkbox" checked={!off} onChange={() => onToggle(c.id)} />
                <span className={`badge badge-${c.type}`}>{BADGE[c.type]}</span>
                <span className="change-title">{c.title ?? c.eventTitle}</span>
              </label>
              <div className="change-when">{describeChange(c)}</div>
              {c.addMeetLink && <div className="change-meta">A video-call link will be added</div>}
              {c.attendees && c.attendees.length > 0 && <div className="change-meta">With {c.attendees.join(", ")}</div>}
              <div className="change-reason">{c.reason}</div>
              {c.warning && <div className="change-warning">⚠ {c.warning}</div>}
              {c.alternatives && c.alternatives.length > 0 && !off && (
                <div className="alts">
                  <span className="alts-label">Other options</span>
                  {c.alternatives.map((a, i) => (
                    <button key={i} className="alt" onClick={() => onSwap(c.id, i)}>
                      {fmtWhen(a.start)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plan.trace && plan.trace.length > 0 && (
        <details className="trace">
          <summary>How I got this</summary>
          <ol>{plan.trace.map((t, i) => <li key={i}>{t}</li>)}</ol>
          <p className="muted small">Times come from your calendar and your rules, computed by code. The model only chose what to look for.</p>
        </details>
      )}

      <div className="panel-actions">
        <button className="btn" onClick={onDiscard} disabled={applying}>
          {plan.changes.length ? "Discard" : "Dismiss"}
        </button>
        {plan.changes.length > 0 && (
          <button className="btn btn-primary" onClick={onApply} disabled={applying || count === 0}>
            {applying ? "Applying…" : `Apply ${count} change${count === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
