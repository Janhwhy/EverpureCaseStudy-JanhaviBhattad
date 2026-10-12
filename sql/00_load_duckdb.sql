-- Loads the monitoring extract into a table shaped like a Snowflake ACCOUNT_USAGE feed.
-- DuckDB-only: Snowflake uses snowflake/00_load_snowflake.sql instead. Every file after this
-- one runs unchanged on both engines.
--
-- {{csv_path}} is substituted by the runner (backend/src/db.js).

CREATE SCHEMA IF NOT EXISTS account_usage_sim;

CREATE OR REPLACE TABLE account_usage_sim.report_usage AS
SELECT
    -- File order is the only time signal in the extract (there is no date column),
    -- so keep it explicitly instead of relying on table order later.
    ROW_NUMBER() OVER () AS source_row_number,
    *
FROM read_csv(
    '{{csv_path}}',
    header = true,
    -- Keep the literal text 'nan' in owner_email visible as data instead of guessing.
    nullstr = '',
    columns = {
        'report_id': 'VARCHAR',
        'report_name': 'VARCHAR',
        'owner_email': 'VARCHAR',
        'last_refresh_status': 'VARCHAR',
        'monthly_active_views': 'INTEGER',
        'snowflake_credits_consumed': 'DECIMAL(12,2)',
        'avg_load_time_sec': 'DECIMAL(6,1)',
        'aws_hosting_cost_usd': 'DECIMAL(12,2)',
        'query_count_last_30d': 'INTEGER',
        'concurrent_user_peak': 'INTEGER'
    }
);
