import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { Chips, ErrorNote, Fill, KV, Loading, Panel, Segmented, Status, usePaged, useSort, useTip } from '../components/ui.jsx';
import { fmtInt, fmtSec, fmtUsd, fmtUsd2, latencyClass, refreshClass } from '../format.js';
import { useLive } from '../live.jsx';

const axis = { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#59616b', fontWeight: 600 };
const FAILED = new Set(['FAILED', 'TIMED_OUT']);

const heat = (sec) => (sec == null ? '#efebe3' : sec > 45 ? '#7a3726' : sec > 30 ? '#a35139' : sec > 15 ? '#ffb162' : '#b9cbb9');
const statusColor = { SUCCESS: '#5b7f64', FAILED: '#a35139', TIMED_OUT: '#d98b6f', UNKNOWN: '#c9c1b1' };

function useMatrix(cells, of) {
  return useMemo(() => {
    const byReport = new Map();
    for (const c of cells ?? []) {
      if (!byReport.has(c.report_id)) byReport.set(c.report_id, { report_id: c.report_id, values: Array(of).fill(null) });
      byReport.get(c.report_id).values[c.snapshot_seq - 1] = c.avg_load_time_sec;
    }
    return [...byReport.values()]
      .map((r) => {
        const seen = r.values.filter((v) => v != null);
        return { ...r, breachRate: seen.filter((v) => v > 15).length / seen.length, avg: seen.reduce((a, b) => a + b, 0) / seen.length };
      })
      .sort((a, b) => b.breachRate - a.breachRate || b.avg - a.avg);
  }, [cells, of]);
}

function Heatmap({ rows, of, selected, onSelect }) {
  const tip = useTip();
  const cols = `repeat(${of}, minmax(0, 1fr))`;
  return (
    <div onMouseLeave={tip.hide}>
      <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) 46px', gap: '3px 10px', alignItems: 'center' }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Report</span>
        <span className="eyebrow" style={{ fontSize: 10 }}>Avg load time · month (snapshot) 1 → {of}</span>
        <span className="eyebrow" style={{ fontSize: 10, textAlign: 'right' }}>% &gt;15 s</span>
        {rows.map((r) => (
          <div key={r.report_id} style={{ display: 'contents' }}>
            <button className="link mono" style={{ fontSize: 11.5, textAlign: 'left', fontWeight: r.report_id === selected ? 800 : 600 }}
              onClick={() => onSelect(r.report_id)}>
              {r.report_id}
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, cursor: 'pointer',
              outline: r.report_id === selected ? '2px solid #1b2632' : 'none', outlineOffset: 1, borderRadius: 3 }}
              onClick={() => onSelect(r.report_id)}>
              {r.values.map((v, i) => (
                <div key={i} style={{ height: 14, borderRadius: 2, background: heat(v) }}
                  onMouseMove={(e) => v != null && tip.show(e, (
                    <><div style={{ marginBottom: 4 }}><b>{r.report_id}</b> · snapshot {i + 1}</div><KV k="Avg load time" v={fmtSec(v)} /></>
                  ))} />
              ))}
            </div>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{Math.round(r.breachRate * 100)}%</span>
          </div>
        ))}
        <span />
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, font: '600 10px IBM Plex Mono', color: '#59616b', textAlign: 'center' }}>
          {Array.from({ length: of }, (_, i) => <span key={i}>{(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span>)}
          <span style={{ gridColumn: '1 / -1', marginTop: 2 }}>month (snapshot)</span>
        </div>
        <span />
      </div>
      {tip.node}
      <div className="legend" style={{ marginTop: 14 }}>
        <span><i className="sw" style={{ background: '#b9cbb9' }} /> avg load ≤ 15 s</span>
        <span><i className="sw" style={{ background: '#ffb162' }} /> &gt;15–30 s</span>
        <span><i className="sw" style={{ background: '#a35139' }} /> &gt;30–45 s</span>
        <span><i className="sw" style={{ background: '#7a3726' }} /> &gt;45 s</span>
        <span><i className="sw" style={{ background: '#efebe3' }} /> not yet replayed</span>
      </div>
    </div>
  );
}

function ReportDetail({ id, snapshot }) {
  const { data, error } = useApi(id ? `/reports/${id}` : null, [snapshot]);
  if (!id) return null;
  if (error) return <Panel title={id}><ErrorNote error={error} /></Panel>;
  if (!data || data.report_id !== id) return <Panel title={id}><Loading /></Panel>;

  const h = data.history;
  const now = h[h.length - 1];
  const breaches = h.filter((s) => s.avg_load_time_sec > 15).length;
  const owners = new Set(h.map((s) => s.owner_email).filter(Boolean));
  // Kept apart: AWS is measured in USD, Snowflake is credits priced at an assumed $3.
  const aws = h.reduce((acc, s) => acc + s.aws_hosting_cost_usd, 0);
  const snowflake = h.reduce((acc, s) => acc + (s.credits_clean ?? 0) * 3, 0);
  const views = h.reduce((acc, s) => acc + s.monthly_active_views, 0);

  return (
    <Panel title={<><span className="mono">{data.report_id}</span> · {data.report_name}</>}
      sub={now.owner_email ? `Owned by ${now.owner_email}` : 'No owner in the current snapshot'}>
      <div className="detail-grid">
        <div className="stat"><b>{fmtSec(now.avg_load_time_sec)}</b><span>Avg load now</span></div>
        <div className="stat"><b>{breaches}/{h.length}</b><span>Snapshots over 15 s</span></div>
        <div className="stat"><b>{fmtUsd(aws)}</b><span>AWS so far · {fmtUsd2(aws / Math.max(views, 1))}/view</span></div>
        <div className="stat"><b>{fmtUsd(snowflake)}</b><span>Snowflake est. · {fmtUsd2(snowflake / Math.max(views, 1))}/view</span></div>
        <div className="stat"><b>{fmtInt(Math.round(views / h.length))}</b><span>Avg monthly views</span></div>
        <div className="stat"><b>{owners.size}</b><span>Owners so far</span></div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 4 }}>Avg load time by snapshot</div>
      <Fill min={150}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={h} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#ece6da" vertical={false} />
          <XAxis dataKey="snapshot_seq" tick={axis} tickLine={false} axisLine={{ stroke: '#c9c1b1' }} />
          <YAxis domain={[0, 60]} ticks={[0, 15, 30, 45, 60]} tick={axis} tickLine={false} axisLine={false} />
          <ReferenceLine y={15} stroke="#a35139" strokeDasharray="4 3" />
          <Tooltip formatter={(v) => [fmtSec(v), 'Avg load time']} labelFormatter={(l) => `Snapshot ${l}`}
            contentStyle={{ background: '#1b2632', border: 0, borderRadius: 8, color: '#eee9df', fontSize: 12 }} itemStyle={{ color: '#eee9df' }} />
          <Line type="linear" dataKey="avg_load_time_sec" stroke="#1b2632" strokeWidth={2} dot={{ r: 3, fill: '#1b2632' }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer></Fill>

      <div className="eyebrow" style={{ margin: '12px 0 6px' }}>Refresh result by snapshot</div>
      <div className="strip">
        {Array.from({ length: 20 }, (_, i) => {
          const s = h[i];
          return <div key={i} title={s ? `Snapshot ${i + 1}: ${s.last_refresh_status}` : 'Not yet replayed'}
            style={{ background: s ? statusColor[s.last_refresh_status] : '#efebe3' }} />;
        })}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {Object.entries(statusColor).map(([k, c]) => <span key={k}><i className="sw" style={{ background: c }} />{k.replace('_', ' ')}</span>)}
      </div>
    </Panel>
  );
}

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'slow', label: 'Over 15 s', test: (r) => r.latency_severity !== 'OK' },
  { key: 'failing', label: 'Failed refresh', test: (r) => FAILED.has(r.last_refresh_status) },
  { key: 'orphaned', label: 'No owner', test: (r) => r.is_orphaned },
  { key: 'unknown', label: 'Unknown status', test: (r) => r.last_refresh_status === 'UNKNOWN' },
];

function ReportTable({ reports, onSelect }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const rows = reports
    .filter(FILTERS.find((f) => f.key === filter).test)
    .filter((r) => !term || `${r.report_id} ${r.report_name} ${r.owner_email ?? ''}`.toLowerCase().includes(term));
  const { sorted, header } = useSort(rows, 'avg_load_time_sec', 'desc');
  const { pageRows, pager } = usePaged(sorted, 12, `${filter}|${term}`);

  return (
    <Panel
      flush
      title="All reports, current snapshot"
      actions={<input className="search" type="search" placeholder="Search ID, name or owner" aria-label="Search reports"
        value={search} onChange={(e) => setSearch(e.target.value)} />}
      foot={<><Chips value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: reports.filter(f.test).length }))} />{pager}</>}
    >
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              {header('report_id', 'Report')}
              {header('owner_email', 'Owner')}
              {header('last_refresh_status', 'Refresh')}
              {header('avg_load_time_sec', 'Avg load', { num: true })}
              {header('monthly_active_views', 'Monthly views', { num: true })}
              {header('concurrent_user_peak', 'Peak users', { num: true })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={6} className="empty">No reports match.</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.report_id} className="clickable" onClick={() => onSelect(r.report_id)}>
                <td><span className="mono strong">{r.report_id}</span> <span className="muted">{r.report_name}</span></td>
                <td>{r.owner_email ?? <span className="rust">no owner</span>}</td>
                <td><Status tone={refreshClass(r.last_refresh_status)}>{r.last_refresh_status.replace('_', ' ')}</Status></td>
                <td className="num"><Status tone={latencyClass(r.latency_severity)}>{fmtSec(r.avg_load_time_sec)}</Status></td>
                <td className="num">{fmtInt(r.monthly_active_views)}</td>
                <td className="num">
                  {r.concurrent_user_peak > r.monthly_active_views
                    ? <span className="rust" title="Peak concurrent users exceed monthly views: the usage counters disagree">{fmtInt(r.concurrent_user_peak)} ⚑</span>
                    : fmtInt(r.concurrent_user_peak)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default function Reports() {
  const { snapshot } = useLive();
  const matrix = useApi('/reports/latency-matrix', [snapshot]);
  const current = useApi('/reports', [snapshot]);
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState('top');
  const rows = useMatrix(matrix.data?.cells, matrix.data?.of ?? 20);

  if (matrix.error && !matrix.data) return <ErrorNote error={matrix.error} />;
  if (!matrix.data || !current.data) return <Loading />;

  const selected = params.get('id') ?? rows[0]?.report_id;
  const select = (id) => setParams({ id });
  const chronic = rows.filter((r) => r.breachRate >= 0.9).length;

  return (
    <>
      <div className="row r-2-1">
        <Panel
          title="Load time by report and snapshot"
          sub={`After ${matrix.data.snapshot} of ${matrix.data.of} snapshots · ${chronic} report${chronic === 1 ? '' : 's'} over 15 s in 90%+ of them`}
          actions={<Segmented value={scope} onChange={setScope} options={[{ key: 'top', label: 'Worst 30' }, { key: 'all', label: 'All 100' }]} />}
        >
          <Heatmap rows={scope === 'top' ? rows.slice(0, 30) : rows} of={matrix.data.of} selected={selected} onSelect={select} />
        </Panel>
        <ReportDetail id={selected} snapshot={snapshot} />
      </div>
      <ReportTable reports={current.data.reports} onSelect={(id) => { select(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
    </>
  );
}
