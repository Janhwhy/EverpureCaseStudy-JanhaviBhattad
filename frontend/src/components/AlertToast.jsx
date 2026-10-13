import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLive } from '../live.jsx';
import { VERB } from './AlertFeed.jsx';
import SwipeToast from './SwipeToast.jsx';

// A snapshot's alert events arrive as one burst; wait for it to end, then show one toast for it.
const SETTLE_MS = 400;
// Shorter than the 8 s replay interval, so toasts replace each other instead of piling up.
const TOAST_MS = 6000;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function summarise(events) {
  if (events.length === 1) {
    const { event, alert } = events[0];
    return {
      title: `${alert.report_id} ${alert.type === 'LATENCY' ? 'latency' : 'refresh'} ${VERB[event]}`,
      description: event === 'acknowledged' ? `by ${alert.acknowledged_by}` : alert.message,
      critical: event !== 'resolved' && alert.severity === 'CRITICAL',
    };
  }
  const count = (name) => events.filter((e) => e.event === name).length;
  const opened = count('opened');
  const critical = events.filter((e) => (e.event === 'opened' || e.event === 'escalated') && e.alert.severity === 'CRITICAL').length;
  const parts = [
    critical && `${critical} critical`,
    count('escalated') && `${count('escalated')} escalated`,
    count('resolved') && `${count('resolved')} resolved`,
    count('acknowledged') && `${count('acknowledged')} acknowledged`,
  ].filter(Boolean);
  return {
    title: opened ? plural(opened, 'new alert') : plural(events.length, 'alert update'),
    description: parts.join(' · '),
    critical: critical > 0,
  };
}

/** Swipe-to-dismiss toast for the alert events of each replayed snapshot. */
export default function AlertToast() {
  const { events } = useLive();
  const navigate = useNavigate();
  const seen = useRef(events[0]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!events.length || events[0] === seen.current) return undefined;
    const timer = setTimeout(() => {
      const last = events.indexOf(seen.current);
      const fresh = last === -1 ? events : events.slice(0, last);
      seen.current = events[0];
      setToast({ id: Date.now(), ...summarise(fresh) });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [events]);

  if (!toast) return null;
  return (
    <SwipeToast
      key={toast.id}
      title={toast.title}
      description={toast.description}
      icon={<span className={`toast-dot${toast.critical ? ' critical' : ''}`} />}
      actionLabel="View"
      onAction={() => navigate('/alerts')}
      onClose={() => setToast((t) => (t?.id === toast.id ? null : t))}
      background="#1b2632"
      color="#eee9df"
      fuseColor={toast.critical ? '#a35139' : '#ffb162'}
      duration={TOAST_MS}
      closeButton
    />
  );
}
