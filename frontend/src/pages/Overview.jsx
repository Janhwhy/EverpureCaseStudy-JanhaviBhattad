import { useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { LiveFeed } from '../components/AlertFeed.jsx';
import HealthMap from '../components/HealthMap.jsx';
import { Chips, ErrorNote, Fill, Kpi, Loading, Panel } from '../components/ui.jsx';
import { fmtSec } from '../format.js';
import { useLive } from '../live.jsx';

const axis = { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#59616b', fontWeight: 600 };
const FAILED = new Set(['FAILED', 'TIMED_OUT']);

const MAP_FILTERS = [
  { key: 'all', label: 'All', test: null },
  { key: 'slow', label: 'Slow', test: (r) => r.latency_severity !== 'OK' },
  { key: 'failing', label: 'Refresh failing', test: (r) => FAILED.has(r.last_refresh_status) },
  { key: 'orphaned', label: 'No owner', test: (r) => r.is_orphaned },
];

// 5-second buckets, coloured by which side of the thresholds they fall.
function distribution(reports) {
  const bins = Array.from({ length: 11 }, (_, i) => ({ from: i * 5, to: i * 5 + 5, count: 0 }));
  for (const r of reports) bins[Math.min(10, Math.floor(r.avg_load_time_sec / 5))].count += 1;
  return bins.map((b) => ({ ...b, label: `${b.from}–${b.to}s`, tone: b.from >= 30 ? '#a35139' : b.from >= 15 ? '#ffb162' : '#5b7f64' }));
}

const DistTooltip = ({ active, payload }) =>
  active && payload?.length ? (
    <div className="chart-tooltip"><b>{payload[0].payload.label}</b><div>{payload[0].value} reports</div></div>
  ) : null;

export default function Overview() {
  const live = useLive();
  const health = useApi('/health', [live.snapshot]);
  const reports = useApi('/reports', [live.snapshot]);
  const [mapFilter, setMapFilter] = useState('all');

  const h = health.data;
  const rows = reports.data?.reports;
  if (health.error && !h) return <ErrorNote error={health.error} />;
  if (!h || !rows) return <Loading />;

  const slow = h.latency_warning + h.latency_critical;
  const trend = h.trend;
  const series = (k) => trend.map((t) => t[k]);
  const statuses = ['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((s) => ({
    status: s,
    count: rows.filter((r) => r.last_refresh_status === s).length,
  }));
  const STATUS_COLOR = { SUCCESS: '#5b7f64', FAILED: '#a35139', TIMED_OUT: '#d98b6f', UNKNOWN: '#c9c1b1' };
  const filter = MAP_FILTERS.find((f) => f.key === mapFilter);

  return (
    <>
      <section className="hero">
        <div>
          <h2><em>{slow} of {h.reports}</em> dashboards miss the 15 s target</h2>
          <div className="hero-facts">
            <span>Median <b>{fmtSec(h.p50_load_sec)}</b></span>
            <span><b>{h.latency_critical}</b> over 30 s</span>
          </div>
        </div>
        <div className="hero-chart">
          <div className="eyebrow">Reports over 15 s, each snapshot</div>
          <div className="slots" style={{ gridTemplateColumns: `repeat(${h.of}, 1fr)` }}>
            {Array.from({ length: h.of }, (_, i) => {
              const t = trend[i];
              return (
                <div key={i} className={`slot ${i + 1 === h.snapshot ? 'current' : ''}`}
                  title={t ? `Snapshot ${i + 1}: ${t.latency_breaches} reports over 15 s` : `Snapshot ${i + 1}: not replayed yet`}>
                  {t && <span style={{ height: `${t.latency_breaches}%` }} />}
                </div>
              );
            })}
          </div>
          <div className="slots-axis"><span>1</span><span>snapshot</span><span>{h.of}</span></div>
        </div>
      </section>

      <div className="kpis">
        <Kpi label="Slow reports" value={slow} unit="/ 100" series={series('latency_breaches')} note={`${h.latency_critical} critical`} accent />
        <Kpi label="Refresh failing" value={h.refresh_failed} series={series('refresh_failed')} note={`${h.refresh_unknown} unknown`} />
        <Kpi label="No owner" value={h.orphaned} series={series('orphaned')} />
        <Kpi label="p95 load time" value={h.p95_load_sec} unit="s" series={series('p95_load_sec')} note={`Median ${fmtSec(h.p50_load_sec)}`} />
      </div>

      <div className="row r-2-1">
        <Panel
          title="Report health map"
          actions={<Chips value={mapFilter} onChange={setMapFilter} options={MAP_FILTERS.map((f) => ({ key: f.key, label: f.label }))} />}
        >
          <HealthMap reports={rows} highlight={filter.test} />
        </Panel>
        <LiveFeed events={live.events} />
      </div>

      <div className="row r-1-1">
        <Panel title="Load-time distribution">
          <Fill min={210}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distribution(rows)} margin={{ top: 16, right: 8, left: -18, bottom: 0 }} barCategoryGap={3}>
              <XAxis dataKey="from" tick={axis} tickLine={false} axisLine={{ stroke: '#c9c1b1' }} tickFormatter={(v) => `${v}s`} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<DistTooltip />} cursor={{ fill: '#f6f2ea' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {distribution(rows).map((b) => <Cell key={b.from} fill={b.tone} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </Fill>
          <div className="legend" style={{ marginTop: 8 }}>
            <span><i className="sw" style={{ background: '#5b7f64' }} /> Within the 15 s target</span>
            <span><i className="sw warning" /> 15–30 s</span>
            <span><i className="sw critical" /> Over 30 s</span>
          </div>
        </Panel>

        <Panel title="Refresh outcomes">
          <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', gap: 2, margin: '8px 0 18px' }}>
            {statuses.filter((s) => s.count).map((s) => (
              <div key={s.status} title={`${s.status}: ${s.count}`} style={{ flex: s.count, background: STATUS_COLOR[s.status] }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {statuses.map((s) => (
              <div key={s.status}>
                <div className="legend"><span><i className="sw" style={{ background: STATUS_COLOR[s.status] }} />{s.status.replace('_', ' ')}</span></div>
                <div className="kpi-value" style={{ fontSize: 28, marginTop: 4 }}>{s.count}</div>
              </div>
            ))}
          </div>
          <div className="eyebrow" style={{ margin: '18px 0 4px' }}>Failed or timed out, each snapshot</div>
          <Fill min={110}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 4, right: 0, left: -24, bottom: 0 }} barCategoryGap={3}>
                <XAxis dataKey="snapshot_seq" type="number" domain={[0.5, h.of + 0.5]} ticks={[1, 5, 10, 15, 20]} tick={axis} tickLine={false} axisLine={{ stroke: '#c9c1b1' }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                <Tooltip formatter={(v) => [v, 'Failed or timed out']} labelFormatter={(l) => `Snapshot ${l}`} cursor={{ fill: '#f6f2ea' }}
                  contentStyle={{ background: '#1b2632', border: 0, borderRadius: 8, fontSize: 12 }} itemStyle={{ color: '#eee9df' }} labelStyle={{ color: '#eee9df', fontWeight: 800 }} />
                <Bar dataKey="refresh_failed" fill="#a35139" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Fill>
        </Panel>
      </div>
    </>
  );
}
