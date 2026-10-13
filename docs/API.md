# REST API and WebSocket Specification

Analytics Portal Monitoring and Cost Governance: backend API (`backend/src/app.js`, `backend/src/ws.js`).

| | |
|---|---|
| REST base URL | `http://localhost:4000/api` |
| WebSocket URL | `ws://localhost:4000/ws` |
| Format | JSON in and out (`Content-Type: application/json`), request bodies up to 10 KB |
| Auth | JWT bearer token from `POST /api/auth/login`, valid for 8 hours |

In development the frontend runs on `http://localhost:5173` and proxies `/api` and `/ws` to the
backend, so the browser talks to one origin.

**Live snapshot.** The backend replays the extract one snapshot at a time (1 → 20, then loops,
every 8 s by default). Endpoints marked *live* answer for the **current** snapshot, or for
snapshots up to it, so their numbers change as the replay moves. Cost and data-quality
endpoints cover all 20 snapshots and don't change.

**Numbers.** Values are returned at full stored precision (for example `27.6` or `0.3073`);
the dashboard formats every non-integer value to 2 decimals. Costs: `aws_usd` is measured;
`snowflake_usd` is credits × an assumed $3.00 and is an estimate.

---

## 1. Authentication and roles

Every endpoint except `POST /api/auth/login` needs the header:

```
Authorization: Bearer <token>
```

Each role has a fixed set of permissions, checked on the server for every request:

| Permission | admin | owner | viewer | Grants |
|---|:-:|:-:|:-:|---|
| `health:read` | ✓ | ✓ | ✓ | Health KPIs, alerts |
| `reports:read` | ✓ | ✓ | ✓ | Report lists and history |
| `alerts:ack` | ✓ | ✓ | | Acknowledge alerts (owners: only on their own reports) |
| `costs:read` | ✓ | ✓ | | Cost per report (owners: only reports they own now) |
| `costs:read:all` | ✓ | | | All reports' costs, owner chargeback, monthly trend |
| `dq:read` | ✓ | | | Data quality results |
| `telemetry:write` | ✓ | | | Push a reading into the alert engine |

Demo accounts: `admin@company.com` / `admin-demo`, `user_3@company.com` / `owner-demo`,
`viewer@company.com` / `viewer-demo`.

### Errors

Every error has the same shape:

```json
{ "error": "Missing permission: costs:read" }
```

| Status | When |
|---|---|
| `400` | Malformed JSON, or an invalid `POST /telemetry` body |
| `401` | No token, invalid or expired token, or wrong email/password at login |
| `403` | Signed in, but the role lacks the permission, or an owner acknowledging someone else's alert |
| `404` | Unknown report, no open alert with that id, or unknown route (when signed in; without a token every path returns `401`) |
| `413` | Request body over 10 KB |
| `500` | Unexpected server error (details are logged, not returned) |

---

## 2. Endpoint summary

| Method | Path | Permission | Live | Purpose |
|---|---|---|:-:|---|
| POST | `/auth/login` | none | | Sign in, get a token |
| GET | `/me` | any signed-in user | | Current user and permissions |
| GET | `/health` | `health:read` | ✓ | Portal health KPIs and per-snapshot trend |
| GET | `/reports` | `reports:read` | ✓ | All reports in the current snapshot |
| GET | `/reports/latency-matrix` | `reports:read` | ✓ | Load time per report per snapshot (heatmap) |
| GET | `/reports/orphaned` | `reports:read` | ✓ | Reports with no owner, with the last known owner |
| GET | `/reports/:id` | `reports:read` | ✓ | One report's history up to the current snapshot |
| GET | `/alerts` | `health:read` | ✓ | Open alerts, recent events, per-snapshot counts |
| POST | `/alerts/:id/ack` | `alerts:ack` | ✓ | Acknowledge an open alert |
| POST | `/telemetry` | `telemetry:write` | ✓ | Push one report reading into the alert engine |
| GET | `/costs/reports` | `costs:read` | | Cost per report and totals (owners: own reports only) |
| GET | `/costs/owners` | `costs:read:all` | | Cost charged to each owner at the time of spend |
| GET | `/costs/trend` | `costs:read:all` | | Cost per snapshot (≈ month) |
| GET | `/data-quality` | `dq:read` | | Rule summary, credit reconciliation, outlier threshold |
| GET | `/data-quality/issues` | `dq:read` | | Rows that failed the rules |

All paths are relative to `/api`.

---

## 3. Endpoints

Sample responses are real output from the backend. Arrays are cut to one item.

### POST `/auth/login`

Request:

```json
{ "email": "admin@company.com", "password": "admin-demo" }
```

`200`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "email": "admin@company.com",
    "role": "admin",
    "permissions": ["health:read", "reports:read", "alerts:ack", "costs:read", "costs:read:all", "dq:read", "telemetry:write"]
  }
}
```

`401` `{ "error": "Invalid email or password" }`. The response is the same, and takes the
same time, whether the email or the password is wrong, so it doesn't reveal which accounts exist.

### GET `/me`

`200`: the `user` object from login.

### GET `/health` (live)

Health of all 100 reports in the current snapshot, plus a trend for every snapshot so far.

```json
{
  "data_source": "duckdb",
  "snapshot": 15,
  "of": 20,
  "reports": 100,
  "refresh_ok": 63,
  "refresh_failed": 32,
  "refresh_unknown": 5,
  "latency_warning": 26,
  "latency_critical": 47,
  "orphaned": 12,
  "p50_load_sec": 27.6,
  "p95_load_sec": 50.83,
  "open_alerts": 108,
  "trend": [
    { "snapshot_seq": 1, "p95_load_sec": 49.07, "refresh_failed": 33, "latency_breaches": 77, "latency_critical": 40, "orphaned": 17 }
  ]
}
```

| Field | Meaning |
|---|---|
| `data_source` | `duckdb` or `snowflake` |
| `refresh_failed` | FAILED **plus** TIMED_OUT. UNKNOWN is counted separately in `refresh_unknown` |
| `latency_warning` / `latency_critical` | Average load time over 15 s up to 30 s / over 30 s |
| `p50_load_sec`, `p95_load_sec` | Median and 95th percentile of the 100 reports' **average** load times |
| `latency_breaches` (trend) | Reports over 15 s, i.e. warning + critical |

### GET `/reports` (live)

```json
{
  "snapshot": 15,
  "reports": [
    {
      "report_id": "RPT_200", "report_name": "Analytics Dashboard 1",
      "owner_email": "user_11@company.com", "is_orphaned": false,
      "last_refresh_status": "SUCCESS",
      "avg_load_time_sec": 17.4, "latency_severity": "WARNING",
      "monthly_active_views": 361, "concurrent_user_peak": 118, "query_count_last_30d": 7995
    }
  ]
}
```

`latency_severity` is `OK` (≤ 15 s), `WARNING` (> 15 s) or `CRITICAL` (> 30 s).
`owner_email` is `null` when the report has no owner.

### GET `/reports/latency-matrix` (live)

One cell per report per snapshot, up to the current snapshot.

```json
{
  "snapshot": 15,
  "of": 20,
  "cells": [
    { "report_id": "RPT_200", "snapshot_seq": 1, "avg_load_time_sec": 44.8, "last_refresh_status": "SUCCESS" }
  ]
}
```

### GET `/reports/orphaned` (live)

Reports with no owner in the current snapshot, most-viewed first.

```json
{
  "snapshot": 15,
  "reports": [
    {
      "report_id": "RPT_295", "report_name": "Analytics Dashboard 96",
      "owner_email_raw": "ORPHANED_REPORT",
      "last_refresh_status": "SUCCESS", "avg_load_time_sec": 40.4, "monthly_active_views": 1235,
      "last_known_owner": "user_13@company.com", "last_known_owner_snapshot": 14
    }
  ]
}
```

`owner_email_raw` is the value as it appears in the extract: empty (`null`), the text `"nan"`, or
`ORPHANED_REPORT`. `last_known_owner` is the most recent earlier snapshot with an owner, as a
reassignment hint (`null` if there never was one).

### GET `/reports/:id` (live)

```json
{
  "report_id": "RPT_223",
  "report_name": "Analytics Dashboard 24",
  "history": [
    {
      "snapshot_seq": 1, "owner_email": "user_10@company.com", "owner_email_raw": "user_10@company.com",
      "last_refresh_status": "SUCCESS", "avg_load_time_sec": 37.2, "latency_severity": "CRITICAL",
      "monthly_active_views": 40, "concurrent_user_peak": 55,
      "credits_clean": 370.75, "aws_hosting_cost_usd": 188.51
    }
  ]
}
```

`credits_clean` is `null` where the raw credits were negative (quarantined).
`404` `{ "error": "Unknown report RPT_999" }`.

### GET `/alerts` (live)

```json
{
  "open": [
    {
      "id": 21319, "type": "LATENCY", "severity": "CRITICAL", "status": "open",
      "report_id": "RPT_201", "report_name": "Analytics Dashboard 2", "owner_email": "user_7@company.com",
      "message": "Avg load 37.50s, over 30 s",
      "value": 54.5, "occurrences": 12,
      "opened_snapshot": 4, "opened_at": "2026-10-13T05:56:13.044Z",
      "acknowledged_by": null, "acknowledged_at": null,
      "resolved_snapshot": null, "resolved_at": null
    }
  ],
  "recent": [ { "event": "resolved", "alert": { "...": "same shape as above" }, "at": "2026-10-13T05:57:41.056Z" } ],
  "history": [ { "snapshot": 1, "opened": 47, "escalated": 6, "resolved": 37 } ],
  "noisiest": [ { "report_id": "RPT_289", "report_name": "Analytics Dashboard 90", "incidents": 10 } ]
}
```

| Field | Meaning |
|---|---|
| `type` | `LATENCY` or `REFRESH` |
| `message` | Text of the event that opened or last escalated the alert |
| `value` | Latest reading: seconds for `LATENCY`, a refresh status for `REFRESH` |
| `occurrences` | Readings received while the alert has been open |
| `recent` | Last 200 alert events, newest first |
| `history` | Alerts opened, escalated and resolved in each snapshot of the current replay cycle (reset when the replay loops back to 1) |
| `noisiest` | Top 8 reports by alerts opened this cycle |

Alert rules:

| Type | Opens when | Severity | Resolves when |
|---|---|---|---|
| `LATENCY` | Average load time > 15 s | `WARNING`; escalates to `CRITICAL` above 30 s (never goes back down) | Average load ≤ 15 s |
| `REFRESH` | Refresh FAILED or TIMED_OUT | `CRITICAL` | Refresh SUCCESS. UNKNOWN leaves it open |

An alert opens once, when the report **enters** a bad state, not on every bad reading.
Each report has at most one open alert per type.

### POST `/alerts/:id/ack` (live)

No body. `200`: the alert, with `acknowledged_by` and `acknowledged_at` set. Acknowledging an
alert that is already acknowledged returns it unchanged. Every connected dashboard is told
through the WebSocket (`acknowledged` event).

| Status | Error |
|---|---|
| `403` | `Owners can only acknowledge alerts on their own reports` |
| `404` | `No open alert with that id` |

### POST `/telemetry` (live)

Ingest point for the real portal: one reading for one report, checked by the same alert engine
as the replay. It applies to the current snapshot.

Request:

```json
{ "report_id": "RPT_223", "avg_load_time_sec": 42.5, "last_refresh_status": "FAILED" }
```

`202` `{ "accepted": true }`

| Status | When |
|---|---|
| `400` | `report_id` isn't a string, `avg_load_time_sec` isn't a number ≥ 0, or `last_refresh_status` isn't `SUCCESS`, `FAILED`, `TIMED_OUT` or `UNKNOWN` |
| `404` | `Unknown report RPT_999` |

### GET `/costs/reports`

Cost per report over all 20 snapshots, highest total first. Admins get all 100 reports
(`scope: "all"`). Owners get only the reports they own now, including what those reports
cost under previous owners (`scope: "own"`).

```json
{
  "scope": "all",
  "usd_per_credit": 3,
  "totals": {
    "reports": 100, "credits": 1206352.48,
    "aws_usd": 461949.25, "snowflake_usd": 3619057.44, "total_usd": 4081006.69,
    "views": 1503281,
    "aws_usd_per_view": 0.3073, "snowflake_usd_per_view": 2.4074, "usd_per_view": 2.7147
  },
  "reports": [
    {
      "report_id": "RPT_223", "report_name": "Analytics Dashboard 24",
      "current_owner": "user_13@company.com", "is_orphaned": false, "snapshots": 20,
      "credits": 17034.76, "quarantined_credits": 0,
      "snowflake_usd": 51104.28, "aws_usd": 5116.68, "total_usd": 56220.96,
      "views": 11259, "avg_peak_users": 69.05,
      "aws_usd_per_view": 0.4545, "snowflake_usd_per_view": 4.539, "credits_per_view": 1.513, "usd_per_view": 4.9934,
      "cost_rank": 1
    }
  ]
}
```

- `credits` excludes quarantined negative readings; `quarantined_credits` shows what was left out.
- `total_usd` adds a measured figure (AWS) to an estimate (Snowflake). It is used only for ranking and reconciliation; the dashboard never shows it.
- `views` is the sum of monthly views over the snapshots (views, not unique users).

### GET `/costs/owners`

Cost charged to the owner **at the time of spend**. `UNASSIGNED` collects spend while a report had no owner.

```json
[
  {
    "owner_email": "UNASSIGNED", "reports": 94, "credits": 141169.95,
    "snowflake_usd": 423509.85, "aws_usd": 57352.28, "total_usd": 480862.13,
    "views": 175407, "usd_per_view": 2.7414
  }
]
```

`reports` counts the distinct reports that owner was charged for at any point.

### GET `/costs/trend`

```json
[
  { "snapshot_seq": 1, "credits": 54674.26, "snowflake_usd": 164022.78, "aws_usd": 24762.88, "views": 78478, "usd_per_view": 2.4056 }
]
```

### GET `/data-quality`

```json
{
  "summary": [
    { "rule": "ORPHANED_OWNER", "severity": "HIGH", "affected_rows": 245, "affected_reports": 94,
      "handling": "Kept; listed in orphan queue for reassignment" }
  ],
  "reconciliation": {
    "raw_credits": 1206191.44, "clean_credits": 1206352.48, "quarantined_credits": -161.04,
    "rows": 2000, "flagged_rows": 525
  },
  "thresholds": { "aws_usd_per_view": 1.350765340493933 }
}
```

- Rules: `ORPHANED_OWNER`, `NEGATIVE_CREDITS`, `UNKNOWN_REFRESH_STATUS`, `PEAK_USERS_EXCEED_VIEWS`, `ZERO_VIEWS_WITH_COST`, `AWS_COST_PER_VIEW_OUTLIER`.
- `raw_credits` = `clean_credits` + `quarantined_credits`, to the cent.
- `flagged_rows` counts distinct rows. A row can fail several rules, so the sum of `affected_rows` (678) is higher than `flagged_rows` (525).
- `thresholds.aws_usd_per_view` is the outlier fence, Q3 + 1.5 × IQR of AWS cost per view.

### GET `/data-quality/issues?rule=<RULE>`

The rows that failed, at most 500, ordered by report and snapshot. Leave out `rule` to get every rule.

```json
[
  { "report_id": "RPT_201", "snapshot_seq": 20, "rule": "NEGATIVE_CREDITS", "severity": "HIGH",
    "observed_value": "-6.62", "handling": "Excluded from credit and cost totals" }
]
```

---

## 4. WebSocket `/ws`

Pushes alert events and replay progress to every signed-in dashboard, so pages update without polling.

### Connecting

The browser WebSocket API can't send an `Authorization` header, so the token is sent as the
**first message**:

```json
{ "type": "auth", "token": "<JWT from /auth/login>" }
```

Until then the server sends nothing. Every role can connect, and all receive the same messages.

```
client                                server
  │── connect ws://localhost:4000/ws ──▶│
  │── { type: "auth", token } ─────────▶│  token checked
  │◀───────── { type: "hello", ... } ───│  current state
  │◀───────── { type: "tick", ... } ────│  every snapshot (8 s)
  │◀───────── { type: "alert", ... } ───│  every alert event
```

After authenticating, the connection is receive-only; further client messages are ignored.

### Server messages

**`hello`**: sent once, right after a valid `auth`. Gives the full current state.

```json
{
  "type": "hello",
  "user": { "email": "admin@company.com", "role": "admin", "permissions": ["..."] },
  "snapshot": 15,
  "of": 20,
  "open": [ { "...": "open alert, same shape as GET /alerts" } ]
}
```

**`tick`**: sent when the replay moves to the next snapshot. Clients refetch live endpoints on it.

```json
{ "type": "tick", "snapshot": 16, "of": 20, "open_alerts": 104 }
```

**`alert`**: sent for every alert event.

```json
{
  "type": "alert",
  "event": "opened",
  "alert": { "...": "same shape as GET /alerts" },
  "at": "2026-10-13T05:57:41.056Z"
}
```

| `event` | Meaning | Client action |
|---|---|---|
| `opened` | A report entered a bad state | Add to the open list |
| `escalated` | A latency alert went over 30 s; `severity` is now `CRITICAL` | Replace in the open list |
| `acknowledged` | Someone acknowledged it; `acknowledged_by` is set | Replace in the open list |
| `resolved` | The report recovered; `status` is `resolved` | Remove from the open list |

### Close codes

| Code | Reason | When |
|---|---|---|
| `4401` | `Authentication required` | No `auth` message within 5 seconds |
| `4401` | `Invalid token` | Token missing, invalid or expired. The dashboard signs the user out |
| `4400` | `Invalid JSON` | First message isn't valid JSON |

On any other disconnect the dashboard reconnects with backoff (1 s, 2 s, 4 s … up to 15 s)
and gets a fresh `hello`.
