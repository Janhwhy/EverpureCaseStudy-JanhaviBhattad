import { EventEmitter } from 'node:events';

export const LATENCY_WARNING_SEC = 15; // from the brief
export const LATENCY_CRITICAL_SEC = 30;
const FAILED_STATUSES = new Set(['FAILED', 'TIMED_OUT']);
const RECENT_EVENT_LIMIT = 200;

export function latencySeverity(seconds) {
  if (seconds > LATENCY_CRITICAL_SEC) return 'CRITICAL';
  if (seconds > LATENCY_WARNING_SEC) return 'WARNING';
  return 'OK';
}

/**
 * Turns a stream of per-report readings into incidents.
 *
 * An alert fires when a report *enters* a bad state, not on every reading while it stays
 * there: 1,490 of 2,000 readings are over 15 s, so alerting per reading would bury the
 * real changes. Each incident is then escalated (WARNING -> CRITICAL), acknowledged by a
 * person, or resolved when the report recovers.
 *
 * Emits 'event' with { event: 'opened' | 'escalated' | 'acknowledged' | 'resolved', alert, at }.
 */
export class AlertEngine extends EventEmitter {
  #open = new Map(); // `${report_id}:${type}` -> alert
  #recent = [];
  #nextId = 1;
  // Per-cycle statistics for the Alerts page; reset when the snapshot sequence starts over.
  #snapshot = null;
  #history = new Map(); // snapshot -> { opened, escalated, resolved }
  #incidentsByReport = new Map(); // report_id -> { report_id, report_name, incidents }

  ingest(reading) {
    this.#enterSnapshot(reading.snapshot_seq);
    this.#checkLatency(reading);
    this.#checkRefresh(reading);
  }

  #checkLatency(r) {
    const key = `${r.report_id}:LATENCY`;
    const open = this.#open.get(key);
    const severity = latencySeverity(r.avg_load_time_sec);

    if (severity === 'OK') {
      if (open) this.#resolve(key, r, `Avg load back to ${Number(r.avg_load_time_sec).toFixed(2)}s`);
      return;
    }
    if (!open) {
      this.#openAlert(key, 'LATENCY', severity, r, `Avg load ${Number(r.avg_load_time_sec).toFixed(2)}s, over ${LATENCY_WARNING_SEC} s`);
      return;
    }
    this.#touch(open, r);
    // Incidents only escalate; a CRITICAL that improves to WARNING stays CRITICAL until resolved.
    if (severity === 'CRITICAL' && open.severity === 'WARNING') {
      open.severity = 'CRITICAL';
      open.message = `Avg load ${Number(r.avg_load_time_sec).toFixed(2)}s, over ${LATENCY_CRITICAL_SEC} s`;
      this.#publish('escalated', open);
    }
  }

  #checkRefresh(r) {
    const key = `${r.report_id}:REFRESH`;
    const open = this.#open.get(key);

    if (FAILED_STATUSES.has(r.last_refresh_status)) {
      if (open) this.#touch(open, r);
      else this.#openAlert(key, 'REFRESH', 'CRITICAL', r, `Scheduled refresh ${r.last_refresh_status}`);
    } else if (r.last_refresh_status === 'SUCCESS' && open) {
      this.#resolve(key, r, 'Refresh succeeded');
    }
    // UNKNOWN: we can't tell whether it recovered, so leave any open incident as it is.
  }

  #openAlert(key, type, severity, r, message) {
    const alert = {
      id: this.#nextId++,
      type,
      severity,
      status: 'open',
      report_id: r.report_id,
      report_name: r.report_name,
      owner_email: r.owner_email ?? null,
      message,
      value: type === 'LATENCY' ? r.avg_load_time_sec : r.last_refresh_status,
      occurrences: 1,
      opened_snapshot: r.snapshot_seq,
      opened_at: new Date().toISOString(),
      acknowledged_by: null,
      acknowledged_at: null,
      resolved_snapshot: null,
      resolved_at: null,
    };
    this.#open.set(key, alert);
    this.#publish('opened', alert);
  }

  #touch(alert, r) {
    alert.occurrences += 1;
    alert.value = alert.type === 'LATENCY' ? r.avg_load_time_sec : r.last_refresh_status;
    alert.owner_email = r.owner_email ?? null;
  }

  #resolve(key, r, message) {
    const alert = this.#open.get(key);
    this.#open.delete(key);
    Object.assign(alert, { status: 'resolved', resolved_snapshot: r.snapshot_seq, resolved_at: new Date().toISOString(), message });
    this.#publish('resolved', alert);
  }

  acknowledge(id, email) {
    const alert = [...this.#open.values()].find((a) => a.id === id);
    if (!alert) return null;
    if (!alert.acknowledged_by) {
      Object.assign(alert, { acknowledged_by: email, acknowledged_at: new Date().toISOString() });
      this.#publish('acknowledged', alert);
    }
    return alert;
  }

  findOpen(id) {
    return [...this.#open.values()].find((a) => a.id === id) ?? null;
  }

  openAlerts() {
    return [...this.#open.values()];
  }

  recentEvents() {
    return [...this.#recent];
  }

  stats({ top = 8 } = {}) {
    return {
      history: [...this.#history.values()].sort((a, b) => a.snapshot - b.snapshot),
      noisiest: [...this.#incidentsByReport.values()].sort((a, b) => b.incidents - a.incidents).slice(0, top),
    };
  }

  #enterSnapshot(snapshot) {
    if (snapshot === this.#snapshot) return;
    if (this.#snapshot !== null && snapshot < this.#snapshot) {
      this.#history.clear();
      this.#incidentsByReport.clear();
    }
    this.#snapshot = snapshot;
    if (!this.#history.has(snapshot)) this.#history.set(snapshot, { snapshot, opened: 0, escalated: 0, resolved: 0 });
  }

  #publish(event, alert) {
    const counts = this.#history.get(this.#snapshot);
    if (counts && event in counts) counts[event] += 1;
    if (event === 'opened') {
      const entry = this.#incidentsByReport.get(alert.report_id) ?? { report_id: alert.report_id, report_name: alert.report_name, incidents: 0 };
      entry.incidents += 1;
      this.#incidentsByReport.set(alert.report_id, entry);
    }
    const payload = { event, alert: { ...alert }, at: new Date().toISOString() };
    this.#recent.unshift(payload);
    this.#recent.length = Math.min(this.#recent.length, RECENT_EVENT_LIMIT);
    this.emit('event', payload);
  }
}
