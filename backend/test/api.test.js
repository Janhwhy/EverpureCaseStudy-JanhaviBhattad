import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { AlertEngine } from '../src/alerts.js';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db.js';
import { TelemetryReplay } from '../src/telemetry.js';

let server;
let base;
const tokens = {};

const call = (path, { token, method = 'GET', body } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });

before(async () => {
  await initDb();
  const engine = new AlertEngine();
  const replay = new TelemetryReplay(engine, { intervalMs: 0 }); // one snapshot, no timer
  await replay.start();
  server = http.createServer(createApp({ engine, replay })).listen(0);
  base = `http://localhost:${server.address().port}/api`;

  for (const [role, email] of [['admin', 'admin@company.com'], ['owner', 'user_3@company.com'], ['viewer', 'viewer@company.com']]) {
    const res = await call('/auth/login', { method: 'POST', body: { email, password: `${role}-demo` } });
    tokens[role] = (await res.json()).token;
  }
});

after(() => server.close());

test('login rejects a wrong password', async () => {
  const res = await call('/auth/login', { method: 'POST', body: { email: 'admin@company.com', password: 'wrong' } });
  assert.equal(res.status, 401);
});

test('protected routes need a valid token (401), and a tampered token is rejected', async () => {
  assert.equal((await call('/health')).status, 401);
  assert.equal((await call('/health', { token: `${tokens.admin}x` })).status, 401);
});

test('RBAC: each role gets exactly its permissions (403 otherwise)', async () => {
  const matrix = {
    '/health': { admin: 200, owner: 200, viewer: 200 },
    '/reports/orphaned': { admin: 200, owner: 200, viewer: 200 },
    '/costs/reports': { admin: 200, owner: 200, viewer: 403 },
    '/costs/owners': { admin: 200, owner: 403, viewer: 403 },
    '/data-quality': { admin: 200, owner: 403, viewer: 403 },
  };
  for (const [path, byRole] of Object.entries(matrix)) {
    for (const [role, status] of Object.entries(byRole)) {
      assert.equal((await call(path, { token: tokens[role] })).status, status, `${role} ${path}`);
    }
  }
});

test('owners only see cost for reports they own', async () => {
  const body = await (await call('/costs/reports', { token: tokens.owner })).json();
  assert.equal(body.scope, 'own');
  assert.ok(body.reports.length > 0);
  assert.ok(body.reports.every((r) => r.current_owner === 'user_3@company.com'));

  const all = await (await call('/costs/reports', { token: tokens.admin })).json();
  assert.equal(all.reports.length, 100);
});

test('owners cannot acknowledge alerts on reports they do not own', async () => {
  const { open } = await (await call('/alerts', { token: tokens.admin })).json();
  const foreign = open.find((a) => a.owner_email !== 'user_3@company.com');
  const res = await call(`/alerts/${foreign.id}/ack`, { token: tokens.owner, method: 'POST' });
  assert.equal(res.status, 403);

  const ok = await call(`/alerts/${foreign.id}/ack`, { token: tokens.admin, method: 'POST' });
  assert.equal((await ok.json()).acknowledged_by, 'admin@company.com');
});

test('telemetry ingest validates input and raises an alert for a slow load', async () => {
  const bad = await call('/telemetry', { token: tokens.admin, method: 'POST', body: { report_id: 'RPT_200', avg_load_time_sec: '40' } });
  assert.equal(bad.status, 400);

  // Take a report that is currently fast (so no latency alert is open) and push a 50 s reading.
  const { reports } = await (await call('/reports', { token: tokens.admin })).json();
  const fast = reports.find((r) => r.latency_severity === 'OK');
  const isOpen = (alerts) => alerts.some((a) => a.report_id === fast.report_id && a.type === 'LATENCY');

  assert.ok(!isOpen((await (await call('/alerts', { token: tokens.admin })).json()).open));
  const res = await call('/telemetry', {
    token: tokens.admin, method: 'POST', body: { report_id: fast.report_id, avg_load_time_sec: 50, last_refresh_status: 'SUCCESS' },
  });
  assert.equal(res.status, 202);
  assert.ok(isOpen((await (await call('/alerts', { token: tokens.admin })).json()).open));
});

test('report detail returns its history, and /reports/orphaned is not mistaken for a report id', async () => {
  const detail = await (await call('/reports/RPT_200', { token: tokens.viewer })).json();
  assert.equal(detail.report_id, 'RPT_200');
  assert.equal(detail.history.length, 1); // replay is at snapshot 1
  assert.equal((await call('/reports/RPT_999', { token: tokens.viewer })).status, 404);

  const orphaned = await (await call('/reports/orphaned', { token: tokens.viewer })).json();
  assert.ok(Array.isArray(orphaned.reports));
});

// Half away from zero on the exact value: strip float noise first (50.834999... is really 50.835).
const round2 = (x) => Math.round(Number(x.toFixed(9)) * 100 + Number.EPSILON * 100) / 100;

test('median and p95 load time match an independent linear-interpolation percentile', async () => {
  const health = await (await call('/health', { token: tokens.viewer })).json();
  const { reports } = await (await call('/reports', { token: tokens.viewer })).json();
  const v = reports.map((r) => r.avg_load_time_sec).sort((a, b) => a - b);
  const pct = (q) => { const i = q * (v.length - 1); const lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo); };
  assert.equal(health.p50_load_sec, round2(pct(0.5)));
  assert.equal(health.p95_load_sec, round2(pct(0.95)));
});
