"use client";

import Logo from "./Logo";

interface Props {
  configured: boolean;
  onConnect: () => void;
}

export default function ConnectCard({ configured, onConnect }: Props) {
  return (
    <div className="hero-wrap">
      <div className="hero">
        <div className="hero-logo"><Logo size={84} /></div>
        <h1 className="hero-title">Say what you need.<br /><span className="c-blue">Your</span> <span className="c-red">calendar</span> <span className="c-yellow">handles</span> <span className="c-green">the rest.</span></h1>
        <p className="hero-sub">
          tenxcalender reads your Google Calendar, plans changes as ghost events you can preview, and only writes (and sends invites) after you press Apply.
        </p>
        {!configured && (
          <p className="connect-warn">Google credentials are missing. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env and restart the backend.</p>
        )}
        <button className="btn btn-primary hero-cta" onClick={onConnect} disabled={!configured}>Connect Google Calendar</button>
        <div className="features">
          <div className="feature"><div className="feature-icon fi-1">✦</div><h3>One command bar</h3><p>&quot;Find 45 min with Priya, not mornings.&quot; Availability, slots and invites in one step.</p></div>
          <div className="feature"><div className="feature-icon fi-2">◎</div><h3>Defends your focus time</h3><p>Protects deep-work blocks and shows what to move or decline when an invite lands on them.</p></div>
          <div className="feature"><div className="feature-icon fi-3">↺</div><h3>Preview, apply, undo</h3><p>Every change is a ghost until you approve it, and every applied change can be undone.</p></div>
        </div>
        <p className="connect-note">
          The app is in Google&apos;s test mode, so you will see an &quot;unverified app&quot; warning. Click <b>Advanced</b>, then <b>Go to tenxcalender</b>.
        </p>
      </div>
    </div>
  );
}
