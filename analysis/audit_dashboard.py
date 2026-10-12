"""
Audits every number the dashboard displays against an independent pandas computation
from the raw CSV. Run while the backend is up:

    python3 analysis/audit_dashboard.py            # against http://localhost:4000

The live pages follow the replay, so the script pauses the comparison to the snapshot
the API reports at fetch time and recomputes that exact snapshot.
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4000/api"
CSV = Path(__file__).resolve().parent.parent / "data" / "pure_insights_monitoring.csv"
USD_PER_CREDIT = 3.0
ORPHAN = {"", "nan", "ORPHANED_REPORT"}
FAILED = {"FAILED", "TIMED_OUT"}


def call(path, token=None, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None,
                                 headers={"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


token = call("/auth/login", body={"email": "admin@company.com", "password": "admin-demo"})["token"]
owner_token = call("/auth/login", body={"email": "user_3@company.com", "password": "owner-demo"})["token"]

df = pd.read_csv(CSV, keep_default_na=False)
df["snap"] = df.groupby("report_id").cumcount() + 1
df["orphan"] = df["owner_email"].str.strip().isin(ORPHAN)
df["owner"] = df["owner_email"].where(~df["orphan"])
df["credits_clean"] = df["snowflake_credits_consumed"].where(df["snowflake_credits_consumed"] >= 0)
df["failed"] = df["last_refresh_status"].isin(FAILED)

results = []


def check(page, label, shown, expected, tol=0.0):
    ok = (shown is None and expected is None) or (
        shown is not None and expected is not None and abs(float(shown) - float(expected)) <= tol)
    results.append((ok, page, label, shown, expected))


def pct(series, q):  # PERCENTILE_CONT / MEDIAN = linear interpolation
    return float(np.percentile(series, q * 100, method="linear"))


# ---------- Live pages: pin to the snapshot the API is on ----------
health = call("/health", token)
s = health["snapshot"]
cur = df[df.snap == s]
slow = cur.avg_load_time_sec > 15
check("Overview", f"snapshot {s}: reports", health["reports"], len(cur))
check("Overview", "slow (avg load > 15 s), warning", health["latency_warning"], ((cur.avg_load_time_sec > 15) & (cur.avg_load_time_sec <= 30)).sum())
check("Overview", "slow, critical (> 30 s)", health["latency_critical"], (cur.avg_load_time_sec > 30).sum())
check("Overview", "refresh FAILED + TIMED_OUT", health["refresh_failed"], cur.failed.sum())
check("Overview", "refresh UNKNOWN", health["refresh_unknown"], (cur.last_refresh_status == "UNKNOWN").sum())
check("Overview", "refresh SUCCESS", health["refresh_ok"], (cur.last_refresh_status == "SUCCESS").sum())
check("Overview", "no owner", health["orphaned"], cur.orphan.sum())
check("Overview", "median of report avg load", health["p50_load_sec"], round(pct(cur.avg_load_time_sec, 0.5), 1), 0.05)
check("Overview", "p95 of report avg load", health["p95_load_sec"], round(pct(cur.avg_load_time_sec, 0.95), 1), 0.05)
for t in health["trend"]:
    sn = df[df.snap == t["snapshot_seq"]]
    check("Overview trend", f"snap {t['snapshot_seq']} breaches", t["latency_breaches"], (sn.avg_load_time_sec > 15).sum())
    check("Overview trend", f"snap {t['snapshot_seq']} failed", t["refresh_failed"], sn.failed.sum())
    check("Overview trend", f"snap {t['snapshot_seq']} orphaned", t["orphaned"], sn.orphan.sum())

reports = call("/reports", token)
if reports["snapshot"] == s:
    api = {r["report_id"]: r for r in reports["reports"]}
    for _, row in cur.iterrows():
        a = api[row.report_id]
        check("Reports", f"{row.report_id} load", a["avg_load_time_sec"], row.avg_load_time_sec, 0.001)
        check("Reports", f"{row.report_id} views", a["monthly_active_views"], row.monthly_active_views)
        if (a["owner_email"] is None) != bool(row.orphan):
            results.append((False, "Reports", f"{row.report_id} orphan flag", a["owner_email"], row.owner_email))

orph = call("/reports/orphaned", token)
if orph["snapshot"] == s:
    o = cur[cur.orphan]
    check("Orphaned", "count", len(orph["reports"]), len(o))
    check("Orphaned", "monthly views affected", sum(r["monthly_active_views"] for r in orph["reports"]), o.monthly_active_views.sum())
    check("Orphaned", "also slow or failing", sum(1 for r in orph["reports"] if r["avg_load_time_sec"] > 15 or r["last_refresh_status"] in FAILED),
          ((o.avg_load_time_sec > 15) | o.failed).sum())
    for r in orph["reports"]:
        hist = df[(df.report_id == r["report_id"]) & (df.snap < s) & df.owner.notna()]
        exp = hist.sort_values("snap").iloc[-1] if len(hist) else None
        if (exp is None and r["last_known_owner"] is not None) or (exp is not None and (exp.owner != r["last_known_owner"] or exp.snap != r["last_known_owner_snapshot"])):
            results.append((False, "Orphaned", f"{r['report_id']} last known owner", r["last_known_owner"], None if exp is None else exp.owner))

matrix = call("/reports/latency-matrix", token)
check("Reports heatmap", "cells = 100 x snapshot", len(matrix["cells"]), 100 * matrix["snapshot"])

# ---------- Costs (full 20 snapshots, independent of the replay) ----------
per = df.groupby("report_id").agg(credits=("credits_clean", "sum"), aws=("aws_hosting_cost_usd", "sum"),
                                   views=("monthly_active_views", "sum"), peak=("concurrent_user_peak", "mean"))
per["total"] = per.credits * USD_PER_CREDIT + per.aws
costs = call("/costs/reports", token)
t = costs["totals"]
check("Costs", "total cost", t["total_usd"], per.total.sum(), 0.01)
check("Costs", "credits", t["credits"], per.credits.sum(), 0.01)
check("Costs", "views", t["views"], per.views.sum())
check("Costs", "cost per view", t["usd_per_view"], per.total.sum() / per.views.sum(), 0.0001)
check("Costs", "AWS hosting (actual)", t["aws_usd"], per.aws.sum(), 0.01)
check("Costs", "Snowflake (est.)", t["snowflake_usd"], per.credits.sum() * USD_PER_CREDIT, 0.01)
check("Costs", "AWS per view", t["aws_usd_per_view"], per.aws.sum() / per.views.sum(), 0.0001)
check("Costs", "Snowflake per view", t["snowflake_usd_per_view"], per.credits.sum() * USD_PER_CREDIT / per.views.sum(), 0.0001)
check("Costs", "Snowflake share", sum(r["snowflake_usd"] for r in costs["reports"]) / t["total_usd"],
      per.credits.sum() * USD_PER_CREDIT / per.total.sum(), 0.0005)
api = {r["report_id"]: r for r in costs["reports"]}
for rid, row in per.iterrows():
    check("Costs", f"{rid} total", api[rid]["total_usd"], round(row.total, 2), 0.01)
    check("Costs", f"{rid} aws", api[rid]["aws_usd"], row.aws, 0.01)
    check("Costs", f"{rid} snowflake", api[rid]["snowflake_usd"], round(row.credits * USD_PER_CREDIT, 2), 0.01)
    check("Costs", f"{rid} AWS/view", api[rid]["aws_usd_per_view"], row.aws / row.views, 0.0001)
    check("Costs", f"{rid} SF/view", api[rid]["snowflake_usd_per_view"], row.credits * USD_PER_CREDIT / row.views, 0.0001)
    check("Costs", f"{rid} avg peak users", api[rid]["avg_peak_users"], row.peak, 0.0501)  # SQL rounds half-up to 1 dp
check("Costs scatter", "r(total, views)", np.corrcoef([api[i]["views"] for i in per.index], [api[i]["total_usd"] for i in per.index])[0, 1],
      per.total.corr(per.views), 0.005)
check("Costs scatter", "r(AWS, avg peak users)", np.corrcoef([api[i]["avg_peak_users"] for i in per.index], [api[i]["aws_usd"] for i in per.index])[0, 1],
      per.aws.corr(per.peak), 0.01)

owners = {o["owner_email"]: o for o in call("/costs/owners", token)}
by_owner = df.assign(o=df.owner.fillna("UNASSIGNED")).groupby("o").apply(
    lambda g: g.credits_clean.sum() * USD_PER_CREDIT + g.aws_hosting_cost_usd.sum(), include_groups=False)
for o, v in by_owner.items():
    check("Costs chargeback", o, owners[o]["total_usd"], v, 0.01)
owner_split = df.assign(o=df.owner.fillna("UNASSIGNED")).groupby("o").agg(aws=("aws_hosting_cost_usd", "sum"), credits=("credits_clean", "sum"))
for o, row in owner_split.iterrows():
    check("Costs chargeback", f"{o} AWS", owners[o]["aws_usd"], row.aws, 0.01)
    check("Costs chargeback", f"{o} Snowflake", owners[o]["snowflake_usd"], row.credits * USD_PER_CREDIT, 0.01)

trend = call("/costs/trend", token)
for t in trend:
    sn = df[df.snap == t["snapshot_seq"]]
    check("Costs monthly", f"snap {t['snapshot_seq']} AWS", t["aws_usd"], sn.aws_hosting_cost_usd.sum(), 0.01)
    check("Costs monthly", f"snap {t['snapshot_seq']} Snowflake", t["snowflake_usd"], sn.credits_clean.sum() * USD_PER_CREDIT, 0.01)

# Owner view: reports the owner owns in the LATEST snapshot, costs over all 20 snapshots.
own = call("/costs/reports", owner_token)
latest = df[df.snap == 20]
mine = set(latest[latest.owner == "user_3@company.com"].report_id)
check("Costs (owner)", "own report count", own["totals"]["reports"], len(mine))
check("Costs (owner)", "own total", own["totals"]["total_usd"], per.loc[sorted(mine)].total.sum(), 0.05)

# ---------- Data quality ----------
dq = call("/data-quality", token)
summ = {x["rule"]: x for x in dq["summary"]}
exp_rules = json.loads((CSV.parent.parent / "analysis" / "expected_metrics.json").read_text())["issues"]
for rule, n in exp_rules.items():
    check("Data quality", rule, summ[rule]["affected_rows"], n)
check("Data quality", "rule failures (sum)", sum(x["affected_rows"] for x in dq["summary"]), sum(exp_rules.values()))
rec = dq["reconciliation"]
check("Data quality", "raw credits", rec["raw_credits"], df.snowflake_credits_consumed.sum(), 0.01)
check("Data quality", "clean credits", rec["clean_credits"], df.credits_clean.sum(), 0.01)
check("Data quality", "rows checked", rec["rows"], len(df))

# ---------- Alerts: every report currently over 15 s must have exactly one open latency alert ----------
alerts = call("/alerts", token)
snap_now = call("/health", token)["snapshot"]
now = df[df.snap == snap_now]
open_latency = {a["report_id"] for a in alerts["open"] if a["type"] == "LATENCY"}
check("Alerts", f"open latency alerts = reports over 15 s (snapshot {snap_now})", len(open_latency), (now.avg_load_time_sec > 15).sum())
if open_latency != set(now[now.avg_load_time_sec > 15].report_id):
    results.append((False, "Alerts", "open latency alert set", sorted(open_latency)[:5], "differs from reports over 15 s"))
crit_latency = sum(1 for a in alerts["open"] if a["type"] == "LATENCY" and a["severity"] == "CRITICAL")
check("Alerts", "critical latency alerts >= reports over 30 s now", min(crit_latency, (now.avg_load_time_sec > 30).sum()), (now.avg_load_time_sec > 30).sum())

# ---------- Report ----------
bad = [r for r in results if not r[0]]
print(f"Checked {len(results)} values at live snapshot {s}: {len(results) - len(bad)} match, {len(bad)} differ.")
for ok, page, label, shown, exp in bad:
    print(f"  MISMATCH  {page:18} {label:40} shown={shown} expected={exp}")
sys.exit(1 if bad else 0)
