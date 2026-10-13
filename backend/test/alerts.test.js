import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlertEngine } from '../src/alerts.js';

const reading = (overrides) => ({
  report_id: 'RPT_1',
  report_name: 'Report 1',
  owner_email: 'a@company.com',
  avg_load_time_sec: 5,
  last_refresh_status: 'SUCCESS',
  snapshot_seq: 1,
  ...overrides,
});

function collect(engine) {
  const events = [];
  engine.on('event', (e) => events.push(`${e.alert.type}:${e.event}:${e.alert.severity}`));
  return events;
}

test('a slow report alerts once on entering breach, not on every slow reading', () => {
  const engine = new AlertEngine();
  const events = collect(engine);
  engine.ingest(reading({ avg_load_time_sec: 20 }));
  engine.ingest(reading({ avg_load_time_sec: 22 }));
  engine.ingest(reading({ avg_load_time_sec: 18 }));
  assert.deepEqual(events, ['LATENCY:opened:WARNING']);
  assert.equal(engine.openAlerts()[0].occurrences, 3);
});

test('exactly 15 s is not a breach; the threshold is "exceeds 15 s"', () => {
  const engine = new AlertEngine();
  engine.ingest(reading({ avg_load_time_sec: 15 }));
  assert.equal(engine.openAlerts().length, 0);
});

test('an alert that opens above 30 s names the 30 s threshold, not 15 s', () => {
  const engine = new AlertEngine();
  engine.ingest(reading({ avg_load_time_sec: 37.5 }));
  const [alert] = engine.openAlerts();
  assert.equal(alert.severity, 'CRITICAL');
  assert.equal(alert.message, 'Avg load 37.50s, over 30 s');
});

test('latency escalates to CRITICAL above 30 s and resolves when back under 15 s', () => {
  const engine = new AlertEngine();
  const events = collect(engine);
  engine.ingest(reading({ avg_load_time_sec: 20 }));
  engine.ingest(reading({ avg_load_time_sec: 45 }));
  engine.ingest(reading({ avg_load_time_sec: 25 })); // improves, but stays CRITICAL until resolved
  engine.ingest(reading({ avg_load_time_sec: 4 }));
  assert.deepEqual(events, ['LATENCY:opened:WARNING', 'LATENCY:escalated:CRITICAL', 'LATENCY:resolved:CRITICAL']);
  assert.equal(engine.openAlerts().length, 0);
});

test('failed and timed-out refreshes open one incident; UNKNOWN does not resolve it, SUCCESS does', () => {
  const engine = new AlertEngine();
  const events = collect(engine);
  engine.ingest(reading({ last_refresh_status: 'FAILED' }));
  engine.ingest(reading({ last_refresh_status: 'TIMED_OUT' }));
  engine.ingest(reading({ last_refresh_status: 'UNKNOWN' }));
  assert.equal(engine.openAlerts().length, 1);
  engine.ingest(reading({ last_refresh_status: 'SUCCESS' }));
  assert.deepEqual(events, ['REFRESH:opened:CRITICAL', 'REFRESH:resolved:CRITICAL']);
});

test('acknowledging records who and is idempotent', () => {
  const engine = new AlertEngine();
  const events = collect(engine);
  engine.ingest(reading({ avg_load_time_sec: 40 }));
  const [alert] = engine.openAlerts();
  engine.acknowledge(alert.id, 'admin@company.com');
  engine.acknowledge(alert.id, 'someone-else@company.com');
  assert.equal(engine.findOpen(alert.id).acknowledged_by, 'admin@company.com');
  assert.equal(events.filter((e) => e.includes('acknowledged')).length, 1);
  assert.equal(engine.acknowledge(9999, 'x'), null);
});

test('per-snapshot stats count opened/resolved and reset when the replay wraps', () => {
  const engine = new AlertEngine();
  engine.ingest(reading({ snapshot_seq: 1, avg_load_time_sec: 40 }));
  engine.ingest(reading({ snapshot_seq: 2, avg_load_time_sec: 5 }));
  assert.deepEqual(engine.stats().history, [
    { snapshot: 1, opened: 1, escalated: 0, resolved: 0 },
    { snapshot: 2, opened: 0, escalated: 0, resolved: 1 },
  ]);
  assert.deepEqual(engine.stats().noisiest, [{ report_id: 'RPT_1', report_name: 'Report 1', incidents: 1 }]);

  engine.ingest(reading({ snapshot_seq: 1, avg_load_time_sec: 5 }));
  assert.deepEqual(engine.stats().history, [{ snapshot: 1, opened: 0, escalated: 0, resolved: 0 }]);
});
