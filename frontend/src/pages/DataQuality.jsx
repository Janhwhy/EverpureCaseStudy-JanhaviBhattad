import { Fragment, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { ErrorNote, Fill, Loading, Panel } from '../components/ui.jsx';
import { fmtInt, fmtNum, fmtSec, fmtUsd } from '../format.js';
import { useLive } from '../live.jsx';

const axis = { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#59616b', fontWeight: 600 };
const SEVERITY_COLOR = { HIGH: '#a35139', MEDIUM: '#ffb162', LOW: '#c9c1b1' };

const RULE_TEXT = {
  ORPHANED_OWNER: 'Owner is empty, the text "nan", or ORPHANED_REPORT',
  NEGATIVE_CREDITS: 'Snowflake credits below zero',
  UNKNOWN_REFRESH_STATUS: 'Refresh status is UNKNOWN',
  PEAK_USERS_EXCEED_VIEWS: 'Peak concurrent users greater than monthly views',
  ZERO_VIEWS_WITH_COST: 'Hosting cost recorded with 0 views',
  AWS_COST_PER_VIEW_OUTLIER: 'AWS cost per view above Q3 + 1.5 × IQR',  // threshold value appended at render
};
const IN_BRIEF = new Set(['ORPHANED_OWNER', 'NEGATIVE_CREDITS', 'AWS_COST_PER_VIEW_OUTLIER', 'ZERO_VIEWS_WITH_COST']);

/** KPI card for one injected defect: headline number, two facts, and how it was handled. */
const DefectCard = ({ label, value, unit, rows, handled, bad }) => (
  <div className="kpi defect">
    <span className="eyebrow">{label}</span>
    <div className="kpi-value">{value}{unit && <small>{unit}</small>}</div>
    <dl className="defect-facts">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
    <div className={`defect-handled ${bad ? 'bad' : ''}`}>{handled}</div>
  </div>
);

function IssueRows({ rule }) {
  const { data, error } = useApi(`/data-quality/issues?rule=${encodeURIComponent(rule)}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <table style={{ background: '#fff', borderRadius: 8 }}>
      <thead><tr><th>Report</th><th className="num">Snapshot</th><th>Observed value</th></tr></thead>
      <tbody>
        {data.slice(0, 8).map((i) => (
          <tr key={`${i.report_id}-${i.snapshot_seq}`}>
            <td className="mono">{i.report_id}</td>
            <td className="num">{i.snapshot_seq}</td>
            <td className="mono">{i.observed_value}</td>
          </tr>
        ))}
        {data.length > 8 && <tr><td colSpan={3} className="muted">+ {fmtInt(data.length - 8)} more rows</td></tr>}
      </tbody>
    </table>
  );
}

export default function DataQuality() {
  const { data, error } = useApi('/data-quality');
  const { snapshot } = useLive();
  const health = useApi('/health', [snapshot]).data;
  const [openRule, setOpenRule] = useState(null);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const r = data.reconciliation;
  const reconciled = Math.round(r.raw_credits * 100) === Math.round((r.clean_credits + r.quarantined_credits) * 100);
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rule = (name) => data.summary.find((s) => s.rule === name) ?? { affected_rows: 0, affected_reports: 0 };
  const orphan = rule('ORPHANED_OWNER');
  const neg = rule('NEGATIVE_CREDITS');
  const outlier = rule('AWS_COST_PER_VIEW_OUTLIER');
  const peak = rule('PEAK_USERS_EXCEED_VIEWS');
  const lat = data.latency;
  const aws = data.aws_vs_users;

  return (
    <>
      {/* One card per data defect the brief says was injected, each with how it was handled. */}
      <div className="kpis">
        <DefectCard label="Orphaned report records" value={fmtInt(orphan.affected_rows)} unit={`/ ${fmtInt(r.rows)} rows`}
          rows={[['Reports affected', orphan.affected_reports], ['No owner now', health?.orphaned ?? '—']]}
          handled="Kept · listed for reassignment" />
        <DefectCard label="Negative credits" value={fmtInt(neg.affected_rows)} unit="rows"
          rows={[['Credits removed', fmtNum(r.quarantined_credits)], ['Raw = clean + quarantined', reconciled ? '✓ to the cent' : '✗ mismatch']]}
          handled="Quarantined from cost totals" bad={!reconciled} />
        <DefectCard label="Latency spikes" value={fmtSec(lat.max_sec)} unit="max"
          rows={[['Rows over 15 s', `${fmtInt(lat.rows_over_15s)} / ${fmtInt(r.rows)}`], ['Rows over 30 s', fmtInt(lat.rows_over_30s)]]}
          handled="Alert at 15 s · critical at 30 s" />
        <DefectCard label="Active users vs AWS cost" value={`r = ${aws.r_aws_vs_peak_users.toFixed(2)}`}
          rows={[
            [`Rows over $${data.thresholds.aws_usd_per_view.toFixed(2)}/view`, `${fmtInt(outlier.affected_rows)} · ${fmtUsd(aws.outlier_aws_usd)}`],
            ['Peak users > views', fmtInt(peak.affected_rows)],
          ]}
          handled="AWS cost doesn't follow usage" />
      </div>

      <div className="row r-1-2">
        <Panel title="Credit reconciliation"
          actions={<span className={`tag ${reconciled ? 'ok' : 'critical'}`}>{reconciled ? '✓ RECONCILED' : 'MISMATCH'}</span>}>
          {/* Laid out like a ledger sum: raw on top, the two parts it splits into below the rule. */}
          <div className="ledger">
            <div className="ledger-row"><span className="eyebrow">Raw credits</span><strong>{fmt(r.raw_credits)}</strong></div>
            <div className="ledger-row"><span className="eyebrow"><i className="op">=</i>Clean</span><strong>{fmt(r.clean_credits)}</strong></div>
            <div className="ledger-row"><span className="eyebrow"><i className="op">+</i>Quarantined</span><strong className="rust">{fmt(r.quarantined_credits)}</strong></div>
          </div>
          <ul className="checklist">
            <li><span>Quarantined</span><b>{neg.affected_rows} negative readings, out of cost totals</b></li>
            <li><span>Still counted for</span><b>load time, refresh, ownership</b></li>
            <li><span>Verified by</span><b>pandas audit · npm test</b></li>
          </ul>
        </Panel>

        <Panel title="Rows failing each rule">
          <Fill min={230}><ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.summary} layout="vertical" margin={{ top: 0, right: 36, left: 8, bottom: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="rule" width={200} tickLine={false} axisLine={false}
                tick={{ ...axis, fill: '#1b2632', fontSize: 10.5 }} />
              <Tooltip formatter={(v) => [fmtInt(v), 'Rows']} cursor={{ fill: '#f6f2ea' }}
                contentStyle={{ background: '#1b2632', border: 0, borderRadius: 8, fontSize: 12 }} itemStyle={{ color: '#eee9df' }} labelStyle={{ color: '#eee9df', fontWeight: 800 }} />
              <Bar dataKey="affected_rows" radius={[0, 4, 4, 0]} isAnimationActive={false}
                label={{ position: 'right', fontSize: 11.5, fontWeight: 800, fill: '#1b2632', fontFamily: 'IBM Plex Mono' }}>
                {data.summary.map((s) => <Cell key={s.rule} fill={SEVERITY_COLOR[s.severity]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer></Fill>
          <div className="legend">
            {Object.entries(SEVERITY_COLOR).map(([s, c]) => <span key={s}><i className="sw" style={{ background: c }} />{s}</span>)}
          </div>
        </Panel>
      </div>

      <Panel flush title="Validation rules">
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr><th>Rule</th><th>What it checks</th><th>Severity</th><th className="num">Rows</th><th className="num">Reports</th><th>How it's handled</th></tr>
            </thead>
            <tbody>
              {data.summary.map((s) => (
                <Fragment key={s.rule}>
                  <tr className="clickable" onClick={() => setOpenRule(openRule === s.rule ? null : s.rule)} aria-expanded={openRule === s.rule}>
                    <td className="mono strong">
                      {openRule === s.rule ? '▾' : '▸'} {s.rule}
                      {!IN_BRIEF.has(s.rule) && <span className="tag neutral" style={{ marginLeft: 8 }}>NOT IN BRIEF</span>}
                    </td>
                    <td className="muted wrap">
                      {RULE_TEXT[s.rule]}
                      {s.rule === 'AWS_COST_PER_VIEW_OUTLIER' && ` = $${data.thresholds.aws_usd_per_view.toFixed(2)}/view`}
                    </td>
                    <td><span className={`tag ${s.severity.toLowerCase()}`}>{s.severity}</span></td>
                    <td className="num">{fmtInt(s.affected_rows)}</td>
                    <td className="num">{fmtInt(s.affected_reports)}</td>
                    <td className="wrap">{s.handling}</td>
                  </tr>
                  {openRule === s.rule && (
                    <tr className="issue-detail"><td colSpan={6}><IssueRows rule={s.rule} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
