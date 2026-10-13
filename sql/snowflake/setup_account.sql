-- One-time setup on a Snowflake account. Run in a Snowsight worksheet as ACCOUNTADMIN.
--
-- Creates a least-privilege role, an extra-small warehouse that suspends itself after 60 s,
-- the database, and a SERVICE user that signs in with a key pair (no password, no MFA prompt).
-- Replace <PUBLIC_KEY> with the body of the public key (the lines between BEGIN/END, joined).

USE ROLE ACCOUNTADMIN;

CREATE ROLE IF NOT EXISTS PI_APP;

CREATE WAREHOUSE IF NOT EXISTS PI_WH
    WAREHOUSE_SIZE = XSMALL
    AUTO_SUSPEND = 60
    AUTO_RESUME = TRUE
    INITIALLY_SUSPENDED = TRUE;
GRANT USAGE, OPERATE ON WAREHOUSE PI_WH TO ROLE PI_APP;

CREATE DATABASE IF NOT EXISTS PURE_INSIGHTS;
GRANT OWNERSHIP ON DATABASE PURE_INSIGHTS TO ROLE PI_APP COPY CURRENT GRANTS;

CREATE USER IF NOT EXISTS PI_SERVICE
    TYPE = SERVICE
    DEFAULT_ROLE = PI_APP
    DEFAULT_WAREHOUSE = PI_WH
    DEFAULT_NAMESPACE = PURE_INSIGHTS.PUBLIC
    RSA_PUBLIC_KEY = '<PUBLIC_KEY>';
GRANT ROLE PI_APP TO USER PI_SERVICE;

-- Lets you look at the loaded tables and views from your own login in Snowsight.
GRANT ROLE PI_APP TO ROLE SYSADMIN;
