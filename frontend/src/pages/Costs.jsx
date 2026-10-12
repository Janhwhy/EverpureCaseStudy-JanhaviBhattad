import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorNote, Fill, Kpi, Loading, Panel, Segmented, SplitKpi, usePaged, useSort } from '../components/ui.jsx';
import { fmtInt, fmtUsd, fmtUsd2 } from '../format.js';

// AWS hosting is measured in USD. Snowflake is measured in credits and converted at an
// assumed price, so it is always an estimate. The two are never added together on this page.
const SOURCES = {
  snowflake: { key: 'snowflake_usd', perView: 'snowflake_usd_per_view', label: 'Snowflake (est.)', color: '#2c3b4d' },
  aws: { key: 'aws_usd', perView: 'aws_usd_per_view', label: 'AWS hosting', color: '#e8913a' },
};
const SOURCE_OPTIONS = [{ key: 'snowflake', label: 'Snowflake (est.)' }, { key: 'aws', label: 'AWS hosting' }];

const axis = { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#59616b', fontWeight: 600 };
const k = (v) => `$${Math.round(v / 1000)}K`;
const tooltipStyle = { contentStyle: { background: '#1b2632', border: 0, borderRadius: 8, fontSize: 12 }, itemStyle: { color: '#eee9df' }, labelStyle: { color: '#eee9df', fontWeight: 800 } };

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

// "Does cost follow usage?" for each source: Snowflake against views, and the brief's
// "active user counts vs AWS hosting compute costs".
const SCATTER = {
  snowflake: {
    x: 'views', y: 'snowflake_usd', rank: 'snowflake_usd_per_view',
    xLabel: 'Views (20 snapshots)', xTick: (v) => `${Math.round(v / 1000)}K`, xPad: 500, yPad: 2000,
    highlight: '5 highest Snowflake (est.) per view',
  },
  aws: {
    x: 'avg_peak_users', y: 'aws_usd', rank: 'aws_usd_per_view',
    xLabel: 'Avg peak concurrent users', xTick: (v) => Math.round(v), xPad: 3, yPad: 300,
    highlight: '5 highest AWS per view',
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
          <div>AWS {fmtUsd(r.aws_usd)} · {r.avg_peak_users} avg peak users</div>
          <div>{fmtUsd2(r.aws_usd_per_view)} AWS per view</div>
        </>
      ) : (
        <>
          <div>Snowflake (est.) {fmtUsd(r.snowflake_usd)} · {fmtInt(r.views)} views</div>
          <div>{fmtInt(Math.round(r.credits))} credits · {fmtUsd2(r.snowflake_usd_per_view)} per view</div>
        </>
      )}
    </div>
  );
};

function FullTable({ reports }) {
  const { sorted, header } = useSort(reports, 'credits', 'desc');
  const { pageRows, pager } = usePaged(sorted, 10, 'all');
  return (
    <Panel flush title="Cost by report, 20 snapshots" foot={<><span />{pager}</>}>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              {header('report_id', 'Report')}
              {header('current_owner', 'Current owner')}
              {header('credits', 'Credits', { num: true })}
              {header('snowflake_usd', 'Snowflake (est.)', { num: true })}
              {header('snowflake_usd_per_view', 'per view', { num: true })}
              {header('aws_usd', 'AWS hosting', { num: true })}
              {header('aws_usd_per_view', 'per view', { num: true })}
              {header('views', 'Views', { num: true })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.report_id}>
                <td><Link className="link mono" to={`/reports?id=${r.report_id}`}>{r.report_id}</Link></td>
                <td>{r.current_owner ?? <span className="rust">no owner</span>}</td>
                <td className="num">{fmtInt(Math.round(r.credits))}</td>
                <td className="num">{fmtUsd(r.snowflake_usd)}</td>
                <td className="num">{fmtUsd2(r.snowflake_usd_per_view)}</td>
                <td className="num">{fmtUsd(r.aws_usd)}</td>
                <td className="num">{fmtUsd2(r.aws_usd_per_view)}</td>
                <td className="num">{fmtInt(r.views)}</td>
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
  const [lens, setLens] = useState('snowflake');
  const [topSource, setTopSource] = useState('snowflake');
  const [trendSource, setTrendSource] = useState('snowflake');
  const [ownerSource, setOwnerSource] = useState('snowflake');

  if (error && !data) return <ErrorNote error={error} />;
  if (!data || (isAll && (!owners || !trend))) return <Loading />;

  const t = data.totals;
  const reports = data.reports;
  const price = `$${data.usd_per_credit.toFixed(2)}/credit, assumed`;
  const unowned = owners?.find((o) => o.owner_email === 'UNASSIGNED');
  const col = (key) => reports.map((x) => x[key]);
  const sc = SCATTER[lens];
  const cut = [...reports].sort((a, b) => b[sc.rank] - a[sc.rank])[Math.min(4, reports.length - 1)][sc.rank];
  const scatterSub = lens === 'snowflake'
    ? `r = ${pearson(col('views'), col('snowflake_usd')).toFixed(2)} vs views`
    : `r = ${pearson(col('avg_peak_users'), col('aws_usd')).toFixed(2)} vs users · r = ${pearson(col('views'), col('aws_usd')).toFixed(2)} vs views`;
  const top = SOURCES[topSource];
  const top10 = [...reports].sort((a, b) => b[top.key] - a[top.key]).slice(0, 10);
  const ownersSorted = owners && [...owners].sort((a, b) => b[SOURCES[ownerSource].key] - a[SOURCES[ownerSource].key]);
  const scope = isAll ? '20 snapshots' : `${t.reports} reports you own now · all 20 snapshots`;

  return (
    <>
      <div className="kpis">
        <SplitKpi label={`Cost · ${scope}`} aws={fmtUsd(t.aws_usd)} snowflake={fmtUsd(t.snowflake_usd)} />
        <SplitKpi label="Cost per view" aws={fmtUsd2(t.aws_usd_per_view)} snowflake={fmtUsd2(t.snowflake_usd_per_view)} />
        <Kpi label="Snowflake credits used" value={fmtInt(Math.round(t.credits))} note={`priced at ${price}`} />
        {isAll && (
          <SplitKpi label="Spend while unowned" aws={fmtUsd(unowned?.aws_usd ?? 0)} snowflake={fmtUsd(unowned?.snowflake_usd ?? 0)} />
        )}
      </div>

      <div className="row r-1-1">
        <Panel title="Does cost follow usage?" sub={scatterSub}
          actions={<Segmented value={lens} onChange={setLens} options={[{ key: 'snowflake', label: 'Snowflake vs views' }, { key: 'aws', label: 'AWS vs users' }]} />}>
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

        <Panel title="Top 10 reports"
          actions={<Segmented value={topSource} onChange={setTopSource} options={SOURCE_OPTIONS} />}>
          <Fill min={300}><ResponsiveContainer width="100%" height="100%">
            <BarChart data={top10} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }} barCategoryGap={5}>
              <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={k} />
              <YAxis type="category" dataKey="report_id" tick={{ ...axis, fill: '#1b2632' }} tickLine={false} axisLine={false} width={66} />
              <Tooltip formatter={(v) => [fmtUsd(v), top.label]} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
              <Bar dataKey={top.key} fill={top.color} radius={[0, 4, 4, 0]} isAnimationActive={false}
                label={{ position: 'right', fontSize: 11, fontWeight: 700, fill: '#1b2632', fontFamily: 'IBM Plex Mono', formatter: k }} />
            </BarChart>
          </ResponsiveContainer></Fill>
        </Panel>
      </div>

      {isAll && (
        <div className="row r-1-1">
          <Panel title="Cost per snapshot (≈ month)"
            actions={<Segmented value={trendSource} onChange={setTrendSource} options={SOURCE_OPTIONS} />}>
            <Fill min={260}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={4}>
                <CartesianGrid stroke="#ece6da" vertical={false} />
                <XAxis dataKey="snapshot_seq" tick={axis} tickLine={false} axisLine={{ stroke: '#c9c1b1' }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={k} />
                <Tooltip formatter={(v) => [fmtUsd(v), SOURCES[trendSource].label]} labelFormatter={(l) => `Snapshot ${l}`} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
                <Bar dataKey={SOURCES[trendSource].key} fill={SOURCES[trendSource].color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer></Fill>
          </Panel>

          <Panel title="Chargeback by owner at time of spend"
            actions={<Segmented value={ownerSource} onChange={setOwnerSource} options={SOURCE_OPTIONS} />}>
            <Fill min={260}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={ownersSorted}
                layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={3}>
                <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={k} />
                <YAxis type="category" dataKey="owner_email" interval={0} tick={{ ...axis, fill: '#1b2632', fontSize: 10.5 }} tickLine={false}
                  axisLine={false} width={92} tickFormatter={(v) => v.split('@')[0]} />
                <Tooltip formatter={(v) => [fmtUsd(v), SOURCES[ownerSource].label]} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
                <Bar dataKey={SOURCES[ownerSource].key} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {ownersSorted.map((o) => <Cell key={o.owner_email} fill={o.owner_email === 'UNASSIGNED' ? '#a35139' : SOURCES[ownerSource].color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer></Fill>
          </Panel>
        </div>
      )}

      <FullTable reports={reports} />
    </>
  );
}
