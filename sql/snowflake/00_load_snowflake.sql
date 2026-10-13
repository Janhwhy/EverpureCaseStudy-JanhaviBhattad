-- Snowflake equivalent of 00_load_duckdb.sql. Run this first, then sql/01..04 unchanged.
-- Run by the backend when DATA_SOURCE=snowflake (backend/src/db.js), or with SnowSQL.
-- (Snowsight worksheets cannot run PUT; use SnowSQL or the backend for the upload.)
--
-- {{csv_path}} is substituted by the runner with the absolute path of the CSV.

CREATE SCHEMA IF NOT EXISTS account_usage_sim;

CREATE OR REPLACE STAGE account_usage_sim.monitoring_stage
    FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"' EMPTY_FIELD_AS_NULL = TRUE);

PUT 'file://{{csv_path}}' @account_usage_sim.monitoring_stage AUTO_COMPRESS = TRUE OVERWRITE = TRUE;

CREATE OR REPLACE TABLE account_usage_sim.report_usage (
    source_row_number           INTEGER,
    report_id                   VARCHAR,
    report_name                 VARCHAR,
    owner_email                 VARCHAR,
    last_refresh_status         VARCHAR,
    monthly_active_views        INTEGER,
    snowflake_credits_consumed  NUMBER(12,2),
    avg_load_time_sec           NUMBER(6,1),
    aws_hosting_cost_usd        NUMBER(12,2),
    query_count_last_30d        INTEGER,
    concurrent_user_peak        INTEGER
);

-- METADATA$FILE_ROW_NUMBER keeps the file order, which is the only time signal in the extract.
COPY INTO account_usage_sim.report_usage
FROM (
    SELECT METADATA$FILE_ROW_NUMBER, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
    FROM @account_usage_sim.monitoring_stage
);
