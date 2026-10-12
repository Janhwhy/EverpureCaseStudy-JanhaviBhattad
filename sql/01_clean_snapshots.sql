-- One row per report per snapshot, typed and flagged. Nothing is deleted here:
-- bad values are nulled in the *_clean columns and the reason is kept as a flag,
-- so every downstream total can be reconciled back to the raw extract.

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE OR REPLACE VIEW analytics.report_snapshots AS
WITH typed AS (
    SELECT
        source_row_number,
        report_id,
        report_name,
        TRIM(owner_email) AS owner_email_raw,
        last_refresh_status,
        monthly_active_views,
        snowflake_credits_consumed,
        avg_load_time_sec,
        aws_hosting_cost_usd,
        query_count_last_30d,
        concurrent_user_peak,
        -- Each report appears once per snapshot, in file order.
        ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY source_row_number) AS snapshot_seq
    FROM account_usage_sim.report_usage
)
SELECT
    *,
    CASE
        WHEN owner_email_raw IS NULL
          OR owner_email_raw IN ('', 'nan', 'ORPHANED_REPORT') THEN NULL
        ELSE LOWER(owner_email_raw)
    END AS owner_email,
    CASE WHEN snowflake_credits_consumed >= 0 THEN snowflake_credits_consumed END AS credits_clean,
    CASE WHEN monthly_active_views > 0 THEN monthly_active_views END AS views_clean,

    owner_email_raw IS NULL OR owner_email_raw IN ('', 'nan', 'ORPHANED_REPORT') AS is_orphaned,
    snowflake_credits_consumed < 0                         AS is_negative_credits,
    last_refresh_status = 'UNKNOWN'                        AS is_unknown_status,
    last_refresh_status IN ('FAILED', 'TIMED_OUT')         AS is_refresh_failed,
    concurrent_user_peak > monthly_active_views            AS is_peak_exceeds_views,
    monthly_active_views = 0                               AS is_zero_views,
    CASE
        WHEN avg_load_time_sec > 30 THEN 'CRITICAL'
        WHEN avg_load_time_sec > 15 THEN 'WARNING'
        ELSE 'OK'
    END AS latency_severity
FROM typed;
