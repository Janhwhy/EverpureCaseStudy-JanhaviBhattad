-- Issue log: one row per (snapshot row, rule) that failed. This is what the
-- Data Quality page is built from.

-- Tukey fence (Q3 + 1.5 * IQR) on AWS hosting cost per view. A named view, so the rule below
-- and the dashboard quote the same threshold.
CREATE OR REPLACE VIEW analytics.aws_cost_per_view_fence AS
WITH aws_per_view AS (
    SELECT aws_hosting_cost_usd / views_clean AS usd_per_view
    FROM analytics.report_snapshots
    WHERE views_clean IS NOT NULL
)
SELECT
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY usd_per_view)
    + 1.5 * (
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY usd_per_view)
      - PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY usd_per_view)
    ) AS upper_usd_per_view
FROM aws_per_view;


CREATE OR REPLACE VIEW analytics.dq_issues AS
WITH aws_per_view AS (
    SELECT
        report_id,
        snapshot_seq,
        aws_hosting_cost_usd / views_clean AS usd_per_view
    FROM analytics.report_snapshots
    WHERE views_clean IS NOT NULL
)
SELECT report_id, snapshot_seq, 'ORPHANED_OWNER' AS rule, 'HIGH' AS severity,
       COALESCE(owner_email_raw, '<null>') AS observed_value,
       'Kept; listed in orphan queue for reassignment' AS handling
FROM analytics.report_snapshots WHERE is_orphaned

UNION ALL
SELECT report_id, snapshot_seq, 'NEGATIVE_CREDITS', 'HIGH',
       CAST(snowflake_credits_consumed AS VARCHAR),
       'Excluded from credit and cost totals'
FROM analytics.report_snapshots WHERE is_negative_credits

UNION ALL
SELECT report_id, snapshot_seq, 'UNKNOWN_REFRESH_STATUS', 'MEDIUM',
       last_refresh_status,
       'Counted separately; not treated as success or failure'
FROM analytics.report_snapshots WHERE is_unknown_status

UNION ALL
SELECT report_id, snapshot_seq, 'PEAK_USERS_EXCEED_VIEWS', 'MEDIUM',
       CAST(concurrent_user_peak AS VARCHAR) || ' peak vs ' || CAST(monthly_active_views AS VARCHAR) || ' views',
       'Kept; usage counters disagree, flagged for source check'
FROM analytics.report_snapshots WHERE is_peak_exceeds_views

UNION ALL
SELECT report_id, snapshot_seq, 'ZERO_VIEWS_WITH_COST', 'MEDIUM',
       'USD ' || CAST(aws_hosting_cost_usd AS VARCHAR) || ' with 0 views',
       'Excluded from per-view unit cost (no denominator)'
FROM analytics.report_snapshots WHERE is_zero_views

UNION ALL
SELECT a.report_id, a.snapshot_seq, 'AWS_COST_PER_VIEW_OUTLIER', 'LOW',
       'USD ' || CAST(ROUND(a.usd_per_view, 2) AS VARCHAR) || '/view',
       'Kept; hosting cost out of line with usage'
FROM aws_per_view a CROSS JOIN analytics.aws_cost_per_view_fence f
WHERE a.usd_per_view > f.upper_usd_per_view;


CREATE OR REPLACE VIEW analytics.dq_summary AS
SELECT
    rule,
    MIN(severity)               AS severity,
    COUNT(*)                    AS affected_rows,
    COUNT(DISTINCT report_id)   AS affected_reports,
    MIN(handling)               AS handling
FROM analytics.dq_issues
GROUP BY rule;
