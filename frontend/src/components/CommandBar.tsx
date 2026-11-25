"use client";

import { useState } from "react";

interface Props {
  busy: boolean;
  disabled?: boolean; // e.g. not signed in
  refining: boolean;
  replying?: boolean; // the planner asked a question and is waiting for the answer
  examples: string[];
  onSubmit: (text: string) => Promise<boolean>;
}

// One intent input (not a chat thread). With a plan on screen, the next entry
// is treated as a follow-up that refines that plan.
export default function CommandBar({ busy, disabled = false, refining, replying = false, examples, onSubmit }: Props) {
  const [text, setText] = useState("");

  const submit = async (value: string) => {
    const v = value.trim();
    if (!v || busy || disabled) return;
    const ok = await onSubmit(v);
    if (ok) setText("");
  };

  return (
    <div className="command">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <div className={`command-field ${busy ? "is-busy" : ""}`}>
          <span className="command-tag">{replying ? "Reply" : refining ? "Refine" : "Ask"}</span>
          <input
            className="command-input"
            value={text}
            disabled={busy || disabled}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              disabled
                ? "Connect your Google Calendar to get started"
                : replying
                ? "Answer the question on the left, or click one of the suggestions"
                : refining
                ? 'Refine this plan, e.g. "make it Thursday" or "30 minutes instead"'
                : 'Tell me what you need, e.g. "Find 45 min with Priya and Sam this week, not mornings"'
            }
            aria-label="Command bar"
            maxLength={500}
            autoFocus
          />
          <button className="command-go" type="submit" disabled={busy || disabled || !text.trim()}>
            {busy ? "Planning…" : "Plan"}
          </button>
        </div>
      </form>
      {!refining && !replying && !disabled && examples.length > 0 && (
        <div className="chips">
          {examples.map((ex) => (
            <button key={ex} className="chip" disabled={busy} onClick={() => void submit(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
