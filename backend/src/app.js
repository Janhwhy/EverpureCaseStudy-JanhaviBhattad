import express from 'express';
import { can, login, requireAuth, requirePermission } from './auth.js';
import { DATA_SOURCE, query } from './db.js';

const REFRESH_STATUSES = new Set(['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN']);

export function createApp({ engine, replay }) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  const api = express.Router();
  app.use('/api', api);

  api.post('/auth/login', async (req, res) => {
    const session = await login(req.body?.email, req.body?.password);
    if (!session) return res.status(401).json({ error: 'Invalid email or password' });
    res.json(session);
  });

  api.use(requireAuth);

  api.get('/me', (req, res) => res.json(req.user));

  // ---- System health (live snapshot) -------------------------------------------------

  api.get('/health', requirePermission('health:read'), async (req, res) => {
    // Percentiles are taken on DOUBLE: on a DECIMAL(6,1) input DuckDB returns DECIMAL(6,1) and
    // truncates the interpolated value (a median of 24.85 would show as 24.8). The result goes
    // through DECIMAL before ROUND: an exact 50.835 comes back as the double 50.834999..., which
    // ROUND on a double turns into 50.83 instead of 50.84.
    const [summary] = await query(
      `SELECT
          COUNT(*)                                          AS reports,
          COUNT_IF(last_refresh_status = 'SUCCESS')         AS refresh_ok,
          COUNT_IF(is_refresh_failed)                       AS refresh_failed,
          COUNT_IF(is_unknown_status)                       AS refresh_unknown,
          COUNT_IF(latency_severity = 'WARNING')            AS latency_warning,
          COUNT_IF(latency_severity = 'CRITICAL')           AS latency_critical,
          COUNT_IF(is_orphaned)                             AS orphaned,
          ROUND(MEDIAN(avg_load_time_sec::DOUBLE)::DECIMAL(12,6), 2)::DOUBLE AS p50_load_sec,
          ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec::DOUBLE))::DECIMAL(12,6), 2)::DOUBLE AS p95_load_sec
       FROM analytics.report_snapshots
       WHERE snapshot_seq = $1`,
      [replay.snapshot],
    );
    const trend = await query(
      `SELECT
          snapshot_seq,
          ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec::DOUBLE))::DECIMAL(12,6), 2)::DOUBLE AS p95_load_sec,
          COUNT_IF(is_refresh_failed)                       AS refresh_failed,
          COUNT_IF(latency_severity <> 'OK')                AS latency_breaches,
          COUNT_IF(latency_severity = 'CRITICAL')           AS latency_critical,
          COUNT_IF(is_orphaned)                             AS orphaned
       FROM analytics.report_snapshots
       WHERE snapshot_seq <= $1
       GROUP BY snapshot_seq
       ORDER BY snapshot_seq`,
      [replay.snapshot],
    );
    res.json({
      data_source: DATA_SOURCE,
      snapshot: replay.snapshot,
      of: replay.lastSnapshot,
      ...summary,
      open_alerts: engine.openAlerts().length,
      trend,
    });
  });

  api.get('/reports', requirePermission('reports:read'), async (req, res) => {
    const reports = await query(
      `SELECT report_id, report_name, owner_email, is_orphaned, last_refresh_status,
              avg_load_time_sec, latency_severity, monthly_active_views,
              concurrent_user_peak, query_count_last_30d
       FROM analytics.report_snapshots
       WHERE snapshot_seq = $1
       ORDER BY report_id`,
      [replay.snapshot],
    );
    res.json({ snapshot: replay.snapshot, reports });
  });

  // Load time per report per snapshot, up to the live snapshot (heatmap).
  api.get('/reports/latency-matrix', requirePermission('reports:read'), async (req, res) => {
    const cells = await query(
      `SELECT report_id, snapshot_seq, avg_load_time_sec, last_refresh_status
       FROM analytics.report_snapshots
       WHERE snapshot_seq <= $1
       ORDER BY report_id, snapshot_seq`,
      [replay.snapshot],
    );
    res.json({ snapshot: replay.snapshot, of: replay.lastSnapshot, cells });
  });

  api.get('/reports/orphaned', requirePermission('reports:read'), async (req, res) => {
    const reports = await query(
      `WITH last_known AS (
          SELECT report_id, owner_email AS last_known_owner, snapshot_seq AS last_known_owner_snapshot
          FROM analytics.report_snapshots
          WHERE snapshot_seq < $1 AND owner_email IS NOT NULL
          QUALIFY ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY snapshot_seq DESC) = 1
       )
       SELECT s.report_id, s.report_name, s.owner_email_raw, s.last_refresh_status,
              s.avg_load_time_sec, s.monthly_active_views,
              k.last_known_owner, k.last_known_owner_snapshot
       FROM analytics.report_snapshots s
       LEFT JOIN last_known k USING (report_id)
       WHERE s.snapshot_seq = $1 AND s.is_orphaned
       ORDER BY s.monthly_active_views DESC`,
      [replay.snapshot],
    );
    res.json({ snapshot: replay.snapshot, reports });
  });

  api.get('/reports/:id', requirePermission('reports:read'), async (req, res) => {
    const history = await query(
      `SELECT snapshot_seq, owner_email, owner_email_raw, last_refresh_status, avg_load_time_sec, latency_severity,
              monthly_active_views, concurrent_user_peak, credits_clean, aws_hosting_cost_usd
       FROM analytics.report_snapshots
       WHERE report_id = $1 AND snapshot_seq <= $2
       ORDER BY snapshot_seq`,
      [req.params.id, replay.snapshot],
    );
    if (!history.length) return res.status(404).json({ error: `Unknown report ${req.params.id}` });
    const [{ report_name }] = await query('SELECT report_name FROM analytics.report_current WHERE report_id = $1', [req.params.id]);
    res.json({ report_id: req.params.id, report_name, history });
  });

  // ---- Alerts ------------------------------------------------------------------------

  api.get('/alerts', requirePermission('health:read'), (req, res) => {
    res.json({ open: engine.openAlerts(), recent: engine.recentEvents(), ...engine.stats() });
  });

  api.post('/alerts/:id/ack', requirePermission('alerts:ack'), (req, res) => {
    const alert = engine.findOpen(Number(req.params.id));
    if (!alert) return res.status(404).json({ error: 'No open alert with that id' });
    if (req.user.role === 'owner' && alert.owner_email !== req.user.email) {
      return res.status(403).json({ error: 'Owners can only acknowledge alerts on their own reports' });
    }
    res.json(engine.acknowledge(alert.id, req.user.email));
  });

  // Ingest point for the real portal. The replay feeds the same engine.
  api.post('/telemetry', requirePermission('telemetry:write'), async (req, res) => {
    const { report_id, avg_load_time_sec, last_refresh_status } = req.body ?? {};
    if (typeof report_id !== 'string' || !Number.isFinite(avg_load_time_sec) || avg_load_time_sec < 0
        || !REFRESH_STATUSES.has(last_refresh_status)) {
      return res.status(400).json({
        error: 'Expected { report_id: string, avg_load_time_sec: number >= 0, last_refresh_status: SUCCESS|FAILED|TIMED_OUT|UNKNOWN }',
      });
    }
    const [report] = await query(
      `SELECT report_id, report_name, owner_email FROM analytics.report_snapshots
       WHERE report_id = $1 AND snapshot_seq = $2`,
      [report_id, replay.snapshot],
    );
    if (!report) return res.status(404).json({ error: `Unknown report ${report_id}` });
    engine.ingest({ ...report, avg_load_time_sec, last_refresh_status, snapshot_seq: replay.snapshot });
    res.status(202).json({ accepted: true });
  });

  // ---- Cost allocation ---------------------------------------------------------------

  api.get('/costs/reports', requirePermission('costs:read'), async (req, res) => {
    // Owners see only the reports they currently own; admins see everything.
    const ownOnly = !can(req.user, 'costs:read:all');
    const reports = await query(
      `SELECT * FROM analytics.report_cost
       ${ownOnly ? 'WHERE current_owner = $1' : ''}
       ORDER BY cost_rank`,
      ownOnly ? [req.user.email] : [],
    );
    const sum = (k) => reports.reduce((acc, r) => acc + r[k], 0);
    const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
    const views = sum('views');
    const perView = (usd) => (views ? round(usd / views, 4) : null);
    // AWS is measured in USD; Snowflake is measured in credits and priced at an assumed rate.
    // They are reported separately; total_usd is kept only for ranking and reconciliation.
    res.json({
      scope: ownOnly ? 'own' : 'all',
      usd_per_credit: 3,
      totals: {
        reports: reports.length,
        credits: round(sum('credits'), 2),
        aws_usd: round(sum('aws_usd'), 2),
        snowflake_usd: round(sum('snowflake_usd'), 2),
        total_usd: round(sum('total_usd'), 2),
        views,
        aws_usd_per_view: perView(sum('aws_usd')),
        snowflake_usd_per_view: perView(sum('snowflake_usd')),
        usd_per_view: perView(sum('total_usd')),
      },
      reports,
    });
  });

  api.get('/costs/owners', requirePermission('costs:read:all'), async (req, res) => {
    res.json(await query('SELECT * FROM analytics.owner_cost ORDER BY total_usd DESC'));
  });

  api.get('/costs/trend', requirePermission('costs:read:all'), async (req, res) => {
    res.json(await query('SELECT * FROM analytics.cost_trend ORDER BY snapshot_seq'));
  });

  // ---- Data quality ------------------------------------------------------------------

  api.get('/data-quality', requirePermission('dq:read'), async (req, res) => {
    const summary = await query(
      `SELECT * FROM analytics.dq_summary
       ORDER BY CASE severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, affected_rows DESC`,
    );
    const [reconciliation] = await query(
      `SELECT
          SUM(snowflake_credits_consumed)                                         AS raw_credits,
          SUM(credits_clean)                                                      AS clean_credits,
          SUM(CASE WHEN is_negative_credits THEN snowflake_credits_consumed END) AS quarantined_credits,
          COUNT(*)                                                                AS "rows"
       FROM analytics.report_snapshots`,
    );
    // A row can fail several rules, so rule hits (sum of affected_rows) > distinct rows flagged.
    const [{ flagged_rows }] = await query('SELECT COUNT(*) AS flagged_rows FROM (SELECT DISTINCT report_id, snapshot_seq FROM analytics.dq_issues)');
    const [{ upper_usd_per_view }] = await query('SELECT upper_usd_per_view FROM analytics.aws_cost_per_view_fence');
    // The brief's injected latency spikes and the "active users vs AWS cost" discrepancy, over all 2,000 rows.
    const [latency] = await query(
      `SELECT MAX(avg_load_time_sec)::DOUBLE              AS max_sec,
              COUNT_IF(latency_severity <> 'OK')        AS rows_over_15s,
              COUNT_IF(latency_severity = 'CRITICAL')   AS rows_over_30s
       FROM analytics.report_snapshots`,
    );
    const [aws_vs_users] = await query(
      `SELECT ROUND(CORR(aws_usd, avg_peak_users)::DECIMAL(12,6), 2)::DOUBLE AS r_aws_vs_peak_users,
              (SELECT ROUND(SUM(s.aws_hosting_cost_usd), 2)::DOUBLE
                 FROM analytics.dq_issues i
                 JOIN analytics.report_snapshots s ON s.report_id = i.report_id AND s.snapshot_seq = i.snapshot_seq
                WHERE i.rule = 'AWS_COST_PER_VIEW_OUTLIER')      AS outlier_aws_usd
       FROM analytics.report_cost`,
    );
    res.json({
      summary,
      reconciliation: { ...reconciliation, flagged_rows },
      thresholds: { aws_usd_per_view: upper_usd_per_view },
      latency,
      aws_vs_users,
    });
  });

  api.get('/data-quality/issues', requirePermission('dq:read'), async (req, res) => {
    const rule = typeof req.query.rule === 'string' ? req.query.rule : null;
    res.json(await query(
      `SELECT * FROM analytics.dq_issues
       WHERE $1::VARCHAR IS NULL OR rule = $1
       ORDER BY report_id, snapshot_seq, rule
       LIMIT 500`,
      [rule],
    ));
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, next) => {
    // Client errors raised by express (e.g. malformed JSON body) keep their 4xx status.
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
