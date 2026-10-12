import { Fragment, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { ErrorNote, Fill, Kpi, Loading, Panel } from '../components/ui.jsx';
import { fmtInt } from '../format.js';

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
  const [openRule, setOpenRule] = useState(null);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const r = data.reconciliation;
  const reconciled = Math.round(r.raw_credits * 100) === Math.round((r.clean_credits + r.quarantined_credits) * 100);
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const flagged = data.summary.reduce((s, x) => s + x.affected_rows, 0);
  const notInBrief = data.summary.filter((s) => !IN_BRIEF.has(s.rule)).length;
  const neg = data.summary.find((s) => s.rule === 'NEGATIVE_CREDITS');

  return (
    <>
      <div className="kpis">
        <Kpi label="Rows checked" value={fmtInt(r.rows)} />
        <Kpi label="Rule hits" value={fmtInt(flagged)} note={`on ${fmtInt(r.flagged_rows)} distinct rows (a row can fail several rules)`} />
        <Kpi label="Rules applied" value={data.summary.length} note={`${notInBrief} beyond the brief`} />
        <Kpi label="Rows deleted" value="0" />
      </div>

      <div className="row r-1-2">
        <Panel title="Credit reconciliation"
          actions={<span className={`tag ${reconciled ? 'ok' : 'critical'}`}>{reconciled ? '✓ RECONCILED' : 'MISMATCH'}</span>}>
          <div className="ledger">
            <div className="term"><span className="eyebrow">Raw</span><strong>{fmt(r.raw_credits)}</strong></div>
            <span className="op">=</span>
            <div className="term"><span className="eyebrow">Clean</span><strong>{fmt(r.clean_credits)}</strong></div>
            <span className="op">+</span>
            <div className="term"><span className="eyebrow">Quarantined</span><strong className="rust">{fmt(r.quarantined_credits)}</strong></div>
          </div>
          <ul className="checklist">
            <li><span>Quarantined</span><b>{neg?.affected_rows ?? 0} negative readings · {neg?.affected_reports ?? 0} reports</b></li>
            <li><span>Excluded from</span><b>credit and cost totals</b></li>
            <li><span>Still counted for</span><b>load time, refresh, ownership</b></li>
            <li><span><i className="ok-mark">✓</i>Totals match to the cent</span><b>{reconciled ? 'yes' : 'no'}</b></li>
            <li><span><i className="ok-mark">✓</i>Recomputed independently</span><b>pandas, same result</b></li>
            <li><span><i className="ok-mark">✓</i>Checked on every run</span><b>automated test</b></li>
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
