"use client";

interface Props {
  configured: boolean;
  onConnect: () => void;
}

export default function ConnectCard({ configured, onConnect }: Props) {
  return (
    <div className="connect-wrap">
      <div className="connect-card">
        <h1 className="connect-title">Connect your Google Calendar</h1>
        <p className="muted">
          tenxcalender reads your real calendar, proposes changes as ghost events, and only writes (and sends invites) after you press Apply.
        </p>
        {!configured && (
          <p className="connect-warn">
            Google credentials are missing. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env and restart the backend.
          </p>
        )}
        <button className="btn btn-primary connect-btn" onClick={onConnect} disabled={!configured}>
          Connect Google Calendar
        </button>
        <p className="connect-note">
          The app is in Google&apos;s test mode, so you will see an &quot;unverified app&quot; warning. Click <b>Advanced</b>, then <b>Go to tenxcalender</b>.
        </p>
      </div>
    </div>
  );
}
