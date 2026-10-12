import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorNote, Fill, Kpi, Loading, Panel, Segmented, usePaged, useSort } from '../components/ui.jsx';
import { fmtInt, fmtPct, fmtUsd, fmtUsd2 } from '../format.js';

const axis = { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#59616b', fontWeight: 600 };
const k = (v) => `$${Math.round(v / 1000)}K`;
const tooltipStyle = { contentStyle: { background: '#1b2632', border: 0, borderRadius: 8, fontSize: 12 }, itemStyle: { color: '#eee9df' }, labelStyle: { color: '#eee9df', fontWeight: 800 } };
const legend = <Legend iconType="square" wrapperStyle={{ fontSize: 12, fontWeight: 700 }} formatter={(v) => <span style={{ color: '#1b2632' }}>{v}</span>} />;

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// Two lenses on "does cost follow usage?": all spend vs views, and the brief's
// "active user counts vs AWS hosting compute costs".
const SCATTER = {
  total: {
    x: 'views', y: 'total_usd', rank: 'usd_per_view',
    xLabel: 'Views (20 snapshots)', xTick: (v) => `${Math.round(v / 1000)}K`, xPad: 500, yPad: 2000,
    highlight: '5 highest cost per view',
  },
  aws: {
    x: 'avg_peak_users', y: 'aws_usd', rank: 'aws_usd_per_view',
    xLabel: 'Avg peak concurrent users', xTick: (v) => Math.round(v), xPad: 3, yPad: 300,
    highlight: '5 highest AWS cost per view',
  },
};

const ScatterTip = ({ active, payload, mode }) => {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <b>{r.report_id}</b> · {r.current_owner ?? 'no owner'}
      {mode === 'aws' ? (
        <>
          <div>{fmtUsd(r.aws_usd)} AWS hosting · {r.avg_peak_users} avg peak users</div>
          <div>{fmtUsd2(r.aws_usd_per_view)} AWS per view</div>
        </>
      ) : (
        <>
          <div>{fmtUsd(r.total_usd)} for {fmtInt(r.views)} views</div>
          <div>{fmtUsd2(r.usd_per_view)} per view</div>
        </>
      )}
    </div>
  );
};

function FullTable({ reports }) {
  const { sorted, header } = useSort(reports, 'cost_rank');
  const { pageRows, pager } = usePaged(sorted, 10, 'all');
  return (
    <Panel flush title="Cost by report" foot={<><span />{pager}</>}>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              {header('cost_rank', '#', { num: true })}
              {header('report_id', 'Report')}
              {header('current_owner', 'Owner')}
              {header('snowflake_usd', 'Snowflake', { num: true })}
              {header('aws_usd', 'AWS', { num: true })}
              {header('total_usd', 'Total', { num: true })}
              {header('views', 'Views', { num: true })}
              {header('usd_per_view', 'Per view', { num: true })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.report_id}>
                <td className="num">{r.cost_rank}</td>
                <td><Link className="link mono" to={`/reports?id=${r.report_id}`}>{r.report_id}</Link></td>
                <td>{r.current_owner ?? <span className="rust">no owner</span>}</td>
                <td className="num">{fmtUsd(r.snowflake_usd)}</td>
                <td className="num">{fmtUsd(r.aws_usd)}</td>
                <td className="num strong">{fmtUsd(r.total_usd)}</td>
                <td className="num">{fmtInt(r.views)}</td>
                <td className="num">{fmtUsd2(r.usd_per_view)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default function Costs() {
  const { can } = useAuth();
  const isAll = can('costs:read:all');
  const { data, error } = useApi('/costs/reports');
  // Owner-level and trend views are admin-only; owners never request them.
  const owners = useApi(isAll ? '/costs/owners' : null).data;
  const trend = useApi(isAll ? '/costs/trend' : null).data;
  const [chargeback, setChargeback] = useState('chart');
  const [lens, setLens] = useState('total');

  if (error && !data) return <ErrorNote error={error} />;
  if (!data || (isAll && (!owners || !trend))) return <Loading />;

  const t = data.totals;
  const reports = data.reports;
  const snowflake = reports.reduce((s, r) => s + r.snowflake_usd, 0);
  const unassigned = owners?.find((o) => o.owner_email === 'UNASSIGNED')?.total_usd ?? 0;
  const col = (key) => reports.map((x) => x[key]);
  const sc = SCATTER[lens];
  const cut = [...reports].sort((a, b) => b[sc.rank] - a[sc.rank])[Math.min(4, reports.length - 1)][sc.rank];
  const scatterSub = lens === 'total'
    ? `Correlation r = ${pearson(col('views'), col('total_usd')).toFixed(2)}`
    : `r = ${pearson(col('avg_peak_users'), col('aws_usd')).toFixed(2)} vs users · r = ${pearson(col('views'), col('aws_usd')).toFixed(2)} vs views`;
  const top10 = [...reports].sort((a, b) => b.total_usd - a.total_usd).slice(0, 10);

  return (
    <>

      <div className="kpis">
        <Kpi label={isAll ? 'Total cost · 20 snapshots' : `Your ${t.reports} reports · 20 snapshots`} value={fmtUsd(t.total_usd)}
          note={`${fmtInt(Math.round(t.credits))} credits at $${data.usd_per_credit.toFixed(2)} each`} />
        <Kpi label="Cost per view" value={fmtUsd2(t.usd_per_view)} note={`${fmtInt(t.views)} views`} />
        <Kpi label="Snowflake share" value={fmtPct(snowflake / t.total_usd)} note={`AWS ${fmtPct(1 - snowflake / t.total_usd)}`} />
        {isAll && <Kpi label="Spend with no owner" value={fmtUsd(unassigned)} note={`${fmtPct(unassigned / t.total_usd)} of spend`} accent />}
      </div>

      <div className="row r-1-1">
        <Panel title="Does cost follow usage?" sub={scatterSub}
          actions={<Segmented value={lens} onChange={setLens} options={[{ key: 'total', label: 'Total vs views' }, { key: 'aws', label: 'AWS vs users' }]} />}>
          <Fill min={290}><ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 12, left: 4, bottom: 8 }}>
              <CartesianGrid stroke="#ece6da" />
              <XAxis type="number" dataKey={sc.x} tick={axis} tickLine={false} axisLine={{ stroke: '#c9c1b1' }}
                tickFormatter={sc.xTick} domain={[`dataMin - ${sc.xPad}`, `dataMax + ${sc.xPad}`]}
                label={{ value: sc.xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fontWeight: 700, fill: '#59616b' }} />
              <YAxis type="number" dataKey={sc.y} tick={axis} tickLine={false} axisLine={false} tickFormatter={k}
                domain={[`dataMin - ${sc.yPad}`, `dataMax + ${sc.yPad}`]} />
              <ZAxis range={[70, 70]} />
              <Tooltip content={<ScatterTip mode={lens} />} cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={reports} isAnimationActive={false}>
                {reports.map((x) => (
                  <Cell key={x.report_id} fill={x[sc.rank] >= cut ? '#a35139' : '#2c3b4d'}
                    fillOpacity={x[sc.rank] >= cut ? 1 : 0.55} stroke="#fff" strokeWidth={1.5} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer></Fill>
          <div className="legend">
            <span><i className="sw" style={{ background: '#a35139' }} /> {sc.highlight}</span>
            <span><i className="sw" style={{ background: '#2c3b4d', opacity: 0.55 }} /> Other reports</span>
          </div>
        </Panel>

        <Panel title="Most expensive reports">
          <Fill min={316}><ResponsiveContainer width="100%" height="100%">
            <BarChart data={top10} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={5}>
              <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={k} />
              <YAxis type="category" dataKey="report_id" tick={{ ...axis, fill: '#1b2632' }} tickLine={false} axisLine={false} width={66} />
              <Tooltip formatter={(v, n) => [fmtUsd(v), n]} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
              {legend}
              <Bar dataKey="snowflake_usd" name="Snowflake" stackId="c" fill="#2c3b4d" isAnimationActive={false} />
              <Bar dataKey="aws_usd" name="AWS hosting" stackId="c" fill="#ffb162" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer></Fill>
        </Panel>
      </div>

      {isAll && (
        <div className="row r-1-1">
          <Panel title="Monthly cost">
            <Fill min={260}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={4}>
                <CartesianGrid stroke="#ece6da" vertical={false} />
                <XAxis dataKey="snapshot_seq" tick={axis} tickLine={false} axisLine={{ stroke: '#c9c1b1' }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={k} />
                <Tooltip formatter={(v, n) => [fmtUsd(v), n]} labelFormatter={(l) => `Snapshot ${l}`} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
                {legend}
                <Bar dataKey="snowflake_usd" name="Snowflake" stackId="c" fill="#2c3b4d" isAnimationActive={false} />
                <Bar dataKey="aws_usd" name="AWS hosting" stackId="c" fill="#ffb162" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer></Fill>
          </Panel>

          <Panel title="Chargeback by owner"
            actions={<Segmented value={chargeback} onChange={setChargeback} options={[{ key: 'chart', label: 'Chart' }, { key: 'table', label: 'Table' }]} />}>
            {chargeback === 'chart' ? (
              <Fill min={260}><ResponsiveContainer width="100%" height="100%">
                <BarChart data={owners} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={3}>
                  <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={k} />
                  <YAxis type="category" dataKey="owner_email" interval={0} tick={{ ...axis, fill: '#1b2632', fontSize: 10.5 }} tickLine={false} axisLine={false}
                    width={92} tickFormatter={(v) => v.split('@')[0]} />
                  <Tooltip formatter={(v) => [fmtUsd(v), 'Total']} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
                  <Bar dataKey="total_usd" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {owners.map((o) => <Cell key={o.owner_email} fill={o.owner_email === 'UNASSIGNED' ? '#a35139' : '#2c3b4d'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></Fill>
            ) : (
              <table>
                <thead><tr><th>Owner</th><th className="num">Reports</th><th className="num">Total</th><th className="num">Per view</th></tr></thead>
                <tbody>
                  {owners.map((o) => (
                    <tr key={o.owner_email}>
                      <td className={o.owner_email === 'UNASSIGNED' ? 'rust strong' : ''}>{o.owner_email}</td>
                      <td className="num">{o.reports}</td>
                      <td className="num strong">{fmtUsd(o.total_usd)}</td>
                      <td className="num">{fmtUsd2(o.usd_per_view)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}

      <FullTable reports={reports} />
    </>
  );
}
