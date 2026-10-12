// Reconciles the SQL layer against analysis/expected_metrics.json, which the pandas
// script computes independently from the raw CSV. Two implementations, one answer.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { initDb, query } from '../src/db.js';

const expected = JSON.parse(await readFile(new URL('../../analysis/expected_metrics.json', import.meta.url)));
const cents = (x) => Math.round(x * 100);

before(() => initDb());

test('row and report counts match the raw extract', async () => {
  const [r] = await query(
    'SELECT COUNT(*) AS rows, COUNT(DISTINCT report_id) AS reports, MAX(snapshot_seq) AS snapshots FROM analytics.report_snapshots',
  );
  assert.deepEqual(r, { rows: expected.rows, reports: expected.reports, snapshots: expected.snapshots });
});

test('every data-quality rule flags the same number of rows as pandas', async () => {
  const rows = await query('SELECT rule, affected_rows FROM analytics.dq_summary');
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.rule, r.affected_rows])), expected.issues);
});

test('credits reconcile: raw = clean + quarantined', async () => {
  const [r] = await query(
    `SELECT SUM(snowflake_credits_consumed) AS raw, SUM(credits_clean) AS clean,
            SUM(CASE WHEN is_negative_credits THEN snowflake_credits_consumed ELSE 0 END) AS quarantined
     FROM analytics.report_snapshots`,
  );
  assert.equal(cents(r.raw), cents(expected.credits.raw_total));
  assert.equal(cents(r.clean), cents(expected.credits.clean_total));
  assert.equal(cents(r.raw), cents(r.clean) + cents(r.quarantined));
});

test('cost allocation totals and top-5 ranking match pandas', async () => {
  const [t] = await query('SELECT SUM(total_usd) AS total, SUM(total_usd) / SUM(views) AS per_view FROM analytics.report_cost');
  assert.equal(cents(t.total), cents(expected.cost.total_usd));
  assert.equal(t.per_view.toFixed(4), expected.cost.usd_per_view_overall.toFixed(4));

  const top5 = await query('SELECT report_id, total_usd FROM analytics.report_cost ORDER BY cost_rank LIMIT 5');
  assert.deepEqual(top5, expected.cost.top5_reports_by_total_usd);
});

test('owner chargeback adds up to the same total as report allocation', async () => {
  const [o] = await query('SELECT SUM(total_usd) AS total FROM analytics.owner_cost');
  // Each owner row is rounded to cents, so allow one cent of drift per owner.
  const [{ owners }] = await query('SELECT COUNT(*) AS owners FROM analytics.owner_cost');
  assert.ok(Math.abs(cents(o.total) - cents(expected.cost.total_usd)) <= owners);
});

test('AWS hosting cost vs usage correlation matches pandas (it is ~0: cost does not follow usage)', async () => {
  const [r] = await query('SELECT CORR(aws_usd, views) AS r FROM analytics.report_cost');
  assert.equal(r.r.toFixed(3), expected.aws_vs_usage.r_aws_vs_views_per_report.toFixed(3));
  assert.ok(Math.abs(r.r) < 0.2);
});

test('latest snapshot health matches pandas', async () => {
  const [r] = await query(
    `SELECT COUNT_IF(is_orphaned) AS orphaned_reports, COUNT_IF(is_refresh_failed) AS failed_refreshes,
            COUNT_IF(latency_severity <> 'OK') AS latency_breaches
     FROM analytics.report_current`,
  );
  assert.deepEqual(r, expected.latest_snapshot);
});
