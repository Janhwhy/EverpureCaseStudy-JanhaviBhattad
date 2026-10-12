-- Current state of every report (its latest snapshot) plus ownership history.

CREATE OR REPLACE VIEW analytics.report_current AS
WITH latest AS (
    SELECT *
    FROM analytics.report_snapshots
    QUALIFY ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY snapshot_seq DESC) = 1
),
last_known_owner AS (
    -- For orphaned reports: the most recent owner we did have, as a reassignment hint.
    SELECT report_id, owner_email AS last_known_owner, snapshot_seq AS last_known_owner_snapshot
    FROM analytics.report_snapshots
    WHERE owner_email IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY snapshot_seq DESC) = 1
),
ownership AS (
    SELECT report_id, COUNT(DISTINCT owner_email) AS distinct_owners
    FROM analytics.report_snapshots
    GROUP BY report_id
)
SELECT
    l.report_id,
    l.report_name,
    l.snapshot_seq,
    l.owner_email,
    l.is_orphaned,
    k.last_known_owner,
    k.last_known_owner_snapshot,
    o.distinct_owners,
    l.last_refresh_status,
    l.is_refresh_failed,
    l.avg_load_time_sec,
    l.latency_severity,
    l.monthly_active_views,
    l.concurrent_user_peak,
    l.query_count_last_30d
FROM latest l
LEFT JOIN last_known_owner k USING (report_id)
JOIN ownership o USING (report_id);
