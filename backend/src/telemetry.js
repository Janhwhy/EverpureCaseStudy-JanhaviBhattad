import { EventEmitter } from 'node:events';
import { query } from './db.js';

/**
 * Stands in for the portal's live telemetry feed: replays the extract one snapshot
 * at a time (1..20, then wraps) and pushes each report's reading into the alert engine.
 * In production the same engine.ingest() would be fed by the portal, e.g. via POST /api/telemetry.
 *
 * Emits 'tick' with { snapshot, of }.
 */
export class TelemetryReplay extends EventEmitter {
  #timer = null;
  snapshot = 0;
  lastSnapshot = 0;

  constructor(engine, { intervalMs }) {
    super();
    this.engine = engine;
    this.intervalMs = intervalMs;
  }

  async start() {
    [{ last: this.lastSnapshot }] = await query('SELECT MAX(snapshot_seq) AS last FROM analytics.report_snapshots');
    await this.tick();
    if (this.intervalMs > 0) this.#timer = setInterval(() => this.tick().catch(console.error), this.intervalMs);
  }

  stop() {
    clearInterval(this.#timer);
  }

  async tick() {
    const next = (this.snapshot % this.lastSnapshot) + 1;
    const readings = await query(
      `SELECT report_id, report_name, owner_email, avg_load_time_sec, last_refresh_status, snapshot_seq
       FROM analytics.report_snapshots
       WHERE snapshot_seq = $1
       ORDER BY report_id`,
      [next],
    );
    this.snapshot = next;
    for (const reading of readings) this.engine.ingest(reading);
    this.emit('tick', { snapshot: next, of: this.lastSnapshot });
  }
}
