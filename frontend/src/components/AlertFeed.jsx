import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { useAuth } from '../auth.jsx';
import { timeAgo } from '../format.js';
import { Fill } from './ui.jsx';

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1 };

export const sortAlerts = (alerts) =>
  [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.id - a.id);

export function useAcknowledge() {
  const { token, user, can } = useAuth();
  const [error, setError] = useState(null);

  // Mirrors the server rule so the button is only offered when it will work.
  const canAck = (alert) =>
    can('alerts:ack') && !alert.acknowledged_by && (user.role !== 'owner' || alert.owner_email === user.email);

  const acknowledge = async (alert) => {
    setError(null);
    try {
      await apiFetch(token, `/alerts/${alert.id}/ack`, { method: 'POST' });
      // The server broadcasts 'acknowledged' over the WebSocket; every open dashboard updates from that.
    } catch (e) {
      setError(e.message);
    }
  };

  return { canAck, acknowledge, error };
}

const ICON = { opened: '!', escalated: '▲', resolved: '✓', acknowledged: '•' };
const VERB = { opened: 'opened', escalated: 'escalated to critical', resolved: 'resolved', acknowledged: 'acknowledged' };

/** Compact stream of the latest alert events, as they arrive over the WebSocket. */
export function LiveFeed({ events, limit = 30 }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Live incident stream</h2>
        <Link className="link" to="/alerts">All alerts →</Link>
      </div>
      <Fill min={240} scroll>
      <ul className="feed" style={{ marginTop: 10 }}>
        {events.length === 0 && <li className="empty" style={{ display: 'block' }}>Waiting for the next snapshot…</li>}
        {events.slice(0, limit).map((e, i) => (
          <li key={`${e.alert.id}-${e.event}-${i}`}>
            <span className={`ev ${e.event}`} aria-hidden="true">{ICON[e.event]}</span>
            <span className="t">
              <span className="mono">{e.alert.report_id}</span> {e.alert.type === 'LATENCY' ? 'latency' : 'refresh'} {VERB[e.event]}
            </span>
            <span className="when">{timeAgo(e.at)}</span>
            <span className="m">{e.alert.message}</span>
          </li>
        ))}
      </ul>
      </Fill>
    </section>
  );
}
