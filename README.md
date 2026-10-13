# Analytics Portal Monitoring and Cost Governance

An administrative dashboard for the internal analytics portal. It monitors report load times,
failed refreshes and reports without an owner, raises live alerts, and allocates Snowflake and
AWS costs to each report and owner.

Submitted for Case Study 3, Technical Data & AI Validation Intern – Monetization.

- **Frontend:** React 19 + Vite, Recharts
- **Backend:** Node.js + Express REST API, WebSocket alerts, JWT auth with three roles
- **Data:** SQL views over the monitoring extract. Runs on DuckDB by default (no setup) or on a real Snowflake account with one setting
- **Validation:** 22 automated tests, plus an audit script that recomputes every number on the dashboard in pandas

The full REST API and WebSocket specification is in [`docs/API.md`](docs/API.md).

---

## Getting started

Requirements: Node.js 22.9+ (built on 24; the start scripts use `--env-file-if-exists`), Python 3 with pandas and numpy (only for the audit scripts).

```sh
# Backend: API on http://localhost:4000/api, WebSocket on ws://localhost:4000/ws
cd backend
npm install
npm start

# Frontend: http://localhost:5173 (proxies /api and /ws to the backend)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in with a demo account (also listed on the login page):

| Account | Password | Role | Can see |
|---|---|---|---|
| `admin@company.com` | `admin-demo` | Admin | Everything, all costs, data quality, can acknowledge any alert |
| `user_3@company.com` | `owner-demo` | Report owner | Health, reports and alerts; costs **only for the 11 reports they own**; can acknowledge alerts on their own reports |
| `viewer@company.com` | `viewer-demo` | Viewer | Health, reports and alerts (read only). No costs, no data quality |

Roles are enforced on the server (`backend/src/auth.js`). The frontend only hides what the role can't open.

### Settings

All optional, set in `backend/.env` (see `backend/.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `DATA_SOURCE` | DuckDB | `snowflake` runs every query on Snowflake |
| `PORT` | `4000` | Backend port |
| `REPLAY_INTERVAL_MS` | `8000` | Time between replayed snapshots |
| `JWT_SECRET` | random | Without it, a new secret is made at start, so sign-ins end on restart |

---

## Live data replay and alerting

The extract has 2,000 rows: 100 reports × 20 rows each, with **no date column**. I treat the
20 rows per report as 20 monthly snapshots in file order (an assumption, stated on screen as
"snapshot (≈ month)").

The backend replays one snapshot every 8 seconds (1 → 20, then loops). Each reading goes
through an alert engine (`backend/src/alerts.js`), and alerts are pushed to every open dashboard over the WebSocket.
The header says **Live replay**, not live, because it is a historical extract being replayed.

Alert rules:

| Alert | Opens when | Severity | Resolves when |
|---|---|---|---|
| Latency | Avg load time > 15 s (the brief's threshold) | WARNING; escalates to CRITICAL above 30 s | Avg load ≤ 15 s |
| Refresh | Last refresh FAILED or TIMED_OUT | CRITICAL | Refresh SUCCESS (UNKNOWN leaves it open) |

An alert fires when a report **enters** a bad state, not on every reading: 1,490 of the 2,000
readings are over 15 s, so alerting per reading would bury the real changes.

---

## Why DuckDB

The brief asks for Snowflake SQL. The dashboard runs on DuckDB by default, and on Snowflake with one setting.

- **Anyone can run it.** DuckDB runs inside the Node process with nothing to install and no account, password or key. A reviewer can clone the repo and see the dashboard in two commands.
- **Same SQL as Snowflake.** DuckDB supports the Snowflake features this project uses: `QUALIFY`, `MEDIAN`, `PERCENTILE_CONT ... WITHIN GROUP`, `CREATE OR REPLACE VIEW` and window functions. So `sql/01`–`04` run unchanged on both engines; only the CSV loader (`00_*`) differs.
- **No cost while building.** Each test run, restart and audit is free and instant, instead of using warehouse credits.
- **Proven on Snowflake.** It isn't a substitute for Snowflake: the same tests and the number audit were also run against a real Snowflake account (see below and `docs/snowflake/`).

Trade-offs:

- DuckDB is a local database, not a shared warehouse. The `account_usage_sim` schema stands in for Snowflake's `ACCOUNT_USAGE` views, which a real deployment would read instead.
- The engines differ in small ways. For example, DuckDB's `MEDIAN` on a `DECIMAL(6,1)` column returned a `DECIMAL(6,1)`, cutting 24.85 to 24.8. The audit caught it, and the queries now cast to `DOUBLE` before taking percentiles.
- Floating point matters at 2 decimals. An exact p95 of 50.835 comes back as the double 50.834999…, which rounds to 50.83 instead of 50.84. The Snowflake audit caught this; percentiles now go through `DECIMAL` before rounding, on both engines.

## Running on Snowflake

The SQL in `sql/01`–`04` runs unchanged on both engines. Only the loader differs.

1. Run `sql/snowflake/setup_account.sql` once in a Snowsight worksheet as ACCOUNTADMIN. It creates
   a least-privilege role `PI_APP`, an extra-small warehouse `PI_WH` that suspends after 60 s,
   the `PURE_INSIGHTS` database, and a service user that signs in with a key pair.
2. Put the private key in `.snowflake/rsa_key.p8` (gitignored) and fill in `backend/.env`.
3. From `backend/`:

```sh
npm run test:snowflake    # reconciliation + API tests against Snowflake
npm run start:snowflake   # dashboard on Snowflake; the header shows a "Snowflake" tag
```

On startup the backend uploads the CSV (PUT + COPY INTO) and recreates every view, so a
restart always reflects the current SQL. Screenshots of the Snowflake run are in `docs/snowflake/`.

---

## SQL script suite

Run in this order. The backend runs them automatically on start (`backend/src/db.js`).

| File | What it does |
|---|---|
| `sql/00_load_duckdb.sql` | Loads the CSV into `account_usage_sim.report_usage`, keeping file order as `snapshot_seq` (DuckDB) |
| `sql/snowflake/00_load_snowflake.sql` | Same, on Snowflake: stage, PUT, COPY INTO |
| `sql/01_clean_snapshots.sql` | Types and cleans every row. **Nothing is deleted:** bad values are nulled in `*_clean` columns and flagged, so every total reconciles back to the raw file |
| `sql/02_data_quality.sql` | Six validation rules, one issue row per failure, plus the AWS cost-per-view outlier fence (Q3 + 1.5 × IQR) |
| `sql/03_report_status.sql` | Current state of each report, latency severity, orphan status and last known owner |
| `sql/04_cost_allocation.sql` | Cost per report, per owner (owner **at the time of spend**) and per month, plus cost per view |

Cost assumptions:

- **AWS hosting** is measured in USD and used as given.
- **Snowflake** is measured in credits. It is converted at an **assumed $3.00 per credit** and always labelled *est.* The price sits in one place: the `pricing` CTE in `04_cost_allocation.sql`.
- The two are **never added together on screen**, so the measured AWS figure is never mixed with an assumed price.

---

## Data quality validation

| Rule | Rows | How it's handled |
|---|---:|---|
| `ORPHANED_OWNER`: owner empty, `"nan"` or `ORPHANED_REPORT` | 245 | Kept; listed on the Orphaned page with the last known owner |
| `NEGATIVE_CREDITS` | 24 | Quarantined from credit and cost totals (−161.04 credits) |
| `UNKNOWN_REFRESH_STATUS` | 100 | Shown separately, not counted as success or failure |
| `PEAK_USERS_EXCEED_VIEWS`: peak concurrent users > monthly views | 93 | Kept; the usage counters disagree, flagged for a source check |
| `ZERO_VIEWS_WITH_COST` | 4 | Left out of per-view cost (no denominator) |
| `AWS_COST_PER_VIEW_OUTLIER`: above $1.35/view | 212 | Kept; hosting cost out of line with usage |

Credits reconcile to the cent: raw 1,206,191.44 = clean 1,206,352.48 + quarantined −161.04.
The Data Quality page shows this check live.

---

## Testing and number audit

```sh
cd backend && npm test                  # 22 tests: alert engine, API + roles, reconciliation against pandas
python3 analysis/audit_dashboard.py     # with the backend running: recomputes every number the dashboard shows
python3 analysis/profile_data.py        # profiles the raw extract; add --write to refresh analysis/expected_metrics.json
```

The audit script signs in, reads every endpoint the dashboard uses, recomputes the same
snapshot independently in pandas from the raw CSV, and prints any value that differs. Latest runs:
974 of 974 values matched on DuckDB (snapshot 17) and 968 of 968 on Snowflake (snapshot 15).

Display rule: every value that isn't a whole count is shown with exactly 2 decimals.

---

## Repository structure

```
backend/
  src/
    server.js      start-up: database, replay loop, HTTP + WebSocket
    app.js         REST API
    auth.js        demo users, roles and permissions, JWT
    alerts.js      alert engine (open / escalate / acknowledge / resolve)
    telemetry.js   replays one snapshot at a time into the alert engine
    ws.js          WebSocket: auth, then pushes alerts and snapshot ticks
    db.js          DuckDB or Snowflake, runs the SQL suite on start
  test/            node:test suites
frontend/
  src/
    pages/         Overview, Reports, Alerts, Orphaned, Costs, Data Quality, Login
    components/    navigation, KPI tiles, health map, alert feed
sql/               SQL suite (see above), sql/snowflake/ for the Snowflake loader and account setup
analysis/          pandas profiling and the dashboard audit
data/              pure_insights_monitoring.csv (the extract)
docs/API.md        REST API and WebSocket specification
docs/snowflake/    screenshots of the Snowflake run
```

---

## Assumptions

| Assumption | Why | Would confirm with |
|---|---|---|
| 20 rows per report = 20 monthly snapshots, in file order | No date column; file order is the only time signal | Data owner |
| Snowflake price is $3.00 per credit | Enterprise on-demand list price; the real contract rate isn't in the extract | Finance / Snowflake contract |
| Cost is charged to the owner at the time of spend | Owners change between snapshots | Finance |
| Load time > 15 s is a breach; > 30 s is critical | 15 s is from the brief; 30 s is my choice for escalation | Product owner |
| Negative credits are errors, not refunds | Credits consumed can't be below zero | Snowflake admin |
