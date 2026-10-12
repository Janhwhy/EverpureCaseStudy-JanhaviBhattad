-- Cloud cost allocation: Snowflake credits + AWS hosting, attributed to reports and owners.
--
-- On a real account the credits would come from SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY,
-- grouped by QUERY_TAG (each report tags its queries with its report_id). In this extract the
-- attribution has already been done per report, so we start from snowflake_credits_consumed.
--
-- USD 3.00 per credit is an assumption (Enterprise edition, on-demand list price, AWS region).
-- Change it in one place: the pricing CTE of each view.

CREATE OR REPLACE VIEW analytics.report_cost AS
WITH pricing AS (
    SELECT 3.00 AS usd_per_credit
),
per_report AS (
    SELECT
        report_id,
        COUNT(*)                                            AS snapshots,
        SUM(credits_clean)                                  AS credits,
        SUM(CASE WHEN is_negative_credits THEN snowflake_credits_consumed ELSE 0 END)
                                                            AS quarantined_credits,
        SUM(aws_hosting_cost_usd)                           AS aws_usd,
        SUM(monthly_active_views)                           AS views
    FROM analytics.report_snapshots
    GROUP BY report_id
)
SELECT
    r.report_id,
    c.report_name,
    c.owner_email                                           AS current_owner,
    c.is_orphaned,
    r.snapshots,
    r.credits,
    r.quarantined_credits,
    ROUND(r.credits * p.usd_per_credit, 2)                  AS snowflake_usd,
    r.aws_usd,
    ROUND(r.credits * p.usd_per_credit + r.aws_usd, 2)      AS total_usd,
    r.views,
    ROUND(r.credits / NULLIF(r.views, 0), 4)                AS credits_per_view,
    ROUND((r.credits * p.usd_per_credit + r.aws_usd) / NULLIF(r.views, 0), 4)
                                                            AS usd_per_view,
    DENSE_RANK() OVER (ORDER BY r.credits * p.usd_per_credit + r.aws_usd DESC)
                                                            AS cost_rank
FROM per_report r
JOIN analytics.report_current c USING (report_id)
CROSS JOIN pricing p;


-- Chargeback by the owner at the time the cost was incurred (not today's owner):
-- ownership changes between snapshots, and spend should follow who owned the report then.
CREATE OR REPLACE VIEW analytics.owner_cost AS
WITH pricing AS (
    SELECT 3.00 AS usd_per_credit
)
SELECT
    COALESCE(s.owner_email, 'UNASSIGNED')                   AS owner_email,
    COUNT(DISTINCT s.report_id)                             AS reports,
    SUM(s.credits_clean)                                    AS credits,
    ROUND(SUM(s.credits_clean) * MAX(p.usd_per_credit) + SUM(s.aws_hosting_cost_usd), 2)
                                                            AS total_usd,
    SUM(s.monthly_active_views)                             AS views,
    ROUND((SUM(s.credits_clean) * MAX(p.usd_per_credit) + SUM(s.aws_hosting_cost_usd))
          / NULLIF(SUM(s.monthly_active_views), 0), 4)      AS usd_per_view
FROM analytics.report_snapshots s
CROSS JOIN pricing p
GROUP BY COALESCE(s.owner_email, 'UNASSIGNED');


CREATE OR REPLACE VIEW analytics.cost_trend AS
WITH pricing AS (
    SELECT 3.00 AS usd_per_credit
)
SELECT
    s.snapshot_seq,
    SUM(s.credits_clean)                                    AS credits,
    ROUND(SUM(s.credits_clean) * MAX(p.usd_per_credit), 2)  AS snowflake_usd,
    SUM(s.aws_hosting_cost_usd)                             AS aws_usd,
    SUM(s.monthly_active_views)                             AS views,
    ROUND((SUM(s.credits_clean) * MAX(p.usd_per_credit) + SUM(s.aws_hosting_cost_usd))
          / NULLIF(SUM(s.monthly_active_views), 0), 4)      AS usd_per_view
FROM analytics.report_snapshots s
CROSS JOIN pricing p
GROUP BY s.snapshot_seq;
