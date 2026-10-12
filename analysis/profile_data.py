"""
Profiles the raw monitoring extract and computes the reference metrics
independently of the SQL layer.

The SQL in /sql is the production logic. This script re-implements the same
rules in pandas so the two can be reconciled (see backend/test/reconciliation.test.js).
If they ever disagree, one of them has a bug.

    python3 analysis/profile_data.py            # print the profile
    python3 analysis/profile_data.py --write    # also refresh expected_metrics.json
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "pure_insights_monitoring.csv"
OUT = ROOT / "analysis" / "expected_metrics.json"

LATENCY_WARN_SEC = 15
LATENCY_CRITICAL_SEC = 30
USD_PER_CREDIT = 3.00
ORPHAN_MARKERS = {"", "nan", "ORPHANED_REPORT"}
FAILED_STATUSES = {"FAILED", "TIMED_OUT"}

# keep_default_na=False so the literal string 'nan' is visible as data, not silently parsed.
df = pd.read_csv(CSV, keep_default_na=False)
df["snapshot_seq"] = df.groupby("report_id").cumcount() + 1

orphan = df["owner_email"].str.strip().isin(ORPHAN_MARKERS)
negative_credits = df["snowflake_credits_consumed"] < 0
unknown_status = df["last_refresh_status"] == "UNKNOWN"
failed = df["last_refresh_status"].isin(FAILED_STATUSES)
breach = df["avg_load_time_sec"] > LATENCY_WARN_SEC
critical = df["avg_load_time_sec"] > LATENCY_CRITICAL_SEC
peak_exceeds_views = df["concurrent_user_peak"] > df["monthly_active_views"]
zero_views = df["monthly_active_views"] == 0

views = df["monthly_active_views"].where(~zero_views)
aws_per_view = df["aws_hosting_cost_usd"] / views
q1, q3 = aws_per_view.quantile([0.25, 0.75])
aws_per_view_fence = q3 + 1.5 * (q3 - q1)
aws_cost_outlier = aws_per_view > aws_per_view_fence

credits_clean = df["snowflake_credits_consumed"].where(~negative_credits)

# Report-level cost over the whole history.
per_report = (
    df.assign(credits_clean=credits_clean)
    .groupby("report_id")
    .agg(
        credits=("credits_clean", "sum"),
        aws_usd=("aws_hosting_cost_usd", "sum"),
        views=("monthly_active_views", "sum"),
    )
)
per_report["total_usd"] = per_report["credits"] * USD_PER_CREDIT + per_report["aws_usd"]
per_report["usd_per_view"] = per_report["total_usd"] / per_report["views"]

per_report["aws_usd"] = df.groupby("report_id")["aws_hosting_cost_usd"].sum()

latest = df[df["snapshot_seq"] == df["snapshot_seq"].max()]
latest_orphan = latest["owner_email"].str.strip().isin(ORPHAN_MARKERS)


def r(x, n=2):
    return round(float(x), n)


metrics = {
    "rows": len(df),
    "reports": df["report_id"].nunique(),
    "snapshots": int(df["snapshot_seq"].max()),
    "issues": {
        "ORPHANED_OWNER": int(orphan.sum()),
        "NEGATIVE_CREDITS": int(negative_credits.sum()),
        "UNKNOWN_REFRESH_STATUS": int(unknown_status.sum()),
        "PEAK_USERS_EXCEED_VIEWS": int(peak_exceeds_views.sum()),
        "ZERO_VIEWS_WITH_COST": int(zero_views.sum()),
        "AWS_COST_PER_VIEW_OUTLIER": int(aws_cost_outlier.sum()),
    },
    "aws_per_view_fence_usd": r(aws_per_view_fence, 4),
    "latency": {
        "rows_over_15s": int(breach.sum()),
        "rows_over_30s": int(critical.sum()),
        "max_sec": r(df["avg_load_time_sec"].max(), 1),
    },
    "refresh_failed_rows": int(failed.sum()),
    "credits": {
        "raw_total": r(df["snowflake_credits_consumed"].sum()),
        "clean_total": r(credits_clean.sum()),
        "quarantined_total": r(df.loc[negative_credits, "snowflake_credits_consumed"].sum()),
    },
    "cost": {
        "usd_per_credit": USD_PER_CREDIT,
        "total_usd": r(per_report["total_usd"].sum()),
        "usd_per_view_overall": r(per_report["total_usd"].sum() / per_report["views"].sum(), 4),
        "top5_reports_by_total_usd": [
            {"report_id": rid, "total_usd": r(v)}
            for rid, v in per_report["total_usd"].nlargest(5).items()
        ],
    },
    "aws_vs_usage": {
        # Brief: "discrepancies between active user counts and AWS hosting compute costs".
        "r_aws_vs_views_per_report": r(per_report["aws_usd"].corr(per_report["views"]), 3),
        "r_aws_vs_views_per_row": r(df["aws_hosting_cost_usd"].corr(df["monthly_active_views"]), 3),
    },
    "latest_snapshot": {
        "orphaned_reports": int(latest_orphan.sum()),
        "failed_refreshes": int(latest["last_refresh_status"].isin(FAILED_STATUSES).sum()),
        "latency_breaches": int((latest["avg_load_time_sec"] > LATENCY_WARN_SEC).sum()),
    },
}

owners_per_report = df.groupby("report_id")["owner_email"].nunique()

print(f"{metrics['rows']} rows, {metrics['reports']} reports x {metrics['snapshots']} snapshots (file order)")
print(f"owner changes: a report has {owners_per_report.min()}-{owners_per_report.max()} distinct owners across snapshots")
print(f"'nan' as literal text in owner_email: {(df['owner_email'] == 'nan').sum()} rows")
print("\nNumeric ranges:")
print(df.describe().T[["min", "50%", "max"]].to_string())
print("\nCorrelation of monthly views with AWS cost:", r(df["monthly_active_views"].corr(df["aws_hosting_cost_usd"]), 3))
print("\n" + json.dumps(metrics, indent=2))

if "--write" in sys.argv:
    OUT.write_text(json.dumps(metrics, indent=2) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)}")
