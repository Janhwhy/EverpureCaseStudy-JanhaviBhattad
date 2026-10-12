import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { sortAlerts, useAcknowledge } from '../components/AlertFeed.jsx';
import { Chips, Fill, Kpi, Panel, usePaged } from '../components/ui.jsx';
import { fmtSec, timeAgo } from '../format.js';
import { useLive } from '../live.jsx';

const axis = { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#59616b', fontWeight: 600 };
const tooltipStyle = { contentStyle: { background: '#1b2632', border: 0, borderRadius: 8, fontSize: 12 }, itemStyle: { color: '#eee9df' }, labelStyle: { color: '#eee9df', fontWeight: 800 } };

export default function Alerts() {
  const live = useLive();
  const { user } = useAuth();
  const stats = useApi('/alerts', [live.snapshot]).data;
  const { canAck, acknowledge, error } = useAcknowledge();

  const FILTERS = [
    { key: 'all', label: 'All', test: () => true },
    { key: 'critical', label: 'Critical', test: (a) => a.severity === 'CRITICAL' },
    { key: 'warning', label: 'Warning', test: (a) => a.severity === 'WARNING' },
    { key: 'latency', label: 'Latency', test: (a) => a.type === 'LATENCY' },
    { key: 'refresh', label: 'Refresh', test: (a) => a.type === 'REFRESH' },
    { key: 'unacked', label: 'Unacknowledged', test: (a) => !a.acknowledged_by },
    ...(user.role === 'owner' ? [{ key: 'mine', label: 'My reports', test: (a) => a.owner_email === user.email }] : []),
  ];
  const [filter, setFilter] = useState('all');

  const alerts = sortAlerts([...live.open.values()]);
  const rows = alerts.filter(FILTERS.find((f) => f.key === filter).test);
  const { pageRows, pager } = usePaged(rows, 12, filter);

  const history = stats?.history ?? [];
  const flow = history.map((h) => ({ snapshot: h.snapshot, Opened: h.opened, Resolved: -h.resolved }));
  const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const unacked = alerts.filter((a) => !a.acknowledged_by).length;
  const latest = history[history.length - 1];

  return (
    <>
      <div className="kpis">
        <Kpi label="Open alerts" value={alerts.length} />
        <Kpi label="Critical" value={critical} note={`${Math.round((critical / Math.max(alerts.length, 1)) * 100)}% of open`} accent />
        <Kpi label="Unacknowledged" value={unacked} />
        <Kpi label="Opened this snapshot" value={latest?.opened ?? 0} series={history.map((h) => h.opened)}
          note={`${latest?.resolved ?? 0} resolved this snapshot`} />
      </div>

      <div className="row r-2-1">
        <Panel title="Incident flow">
          <Fill min={250}><ResponsiveContainer width="100%" height="100%">
            <BarChart data={flow} stackOffset="sign" margin={{ top: 8, right: 8, left: -14, bottom: 0 }} barCategoryGap={4}>
              <CartesianGrid stroke="#ece6da" vertical={false} />
              <XAxis dataKey="snapshot" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => Math.abs(v)} />
              <ReferenceLine y={0} stroke="#1b2632" />
              <Tooltip formatter={(v, n) => [Math.abs(v), n]} labelFormatter={(l) => `Snapshot ${l}`} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12, fontWeight: 700 }} formatter={(v) => <span style={{ color: '#1b2632' }}>{v}</span>} />
              <Bar dataKey="Opened" stackId="f" fill="#a35139" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Resolved" stackId="f" fill="#5b7f64" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer></Fill>
        </Panel>

        <Panel title="Noisiest reports">
          <Fill min={290}><ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats?.noisiest ?? []} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }} barCategoryGap={5}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="report_id" tick={{ ...axis, fill: '#1b2632' }} tickLine={false} axisLine={false} width={66} />
              <Tooltip formatter={(v) => [v, 'Incidents']} cursor={{ fill: '#f6f2ea' }} {...tooltipStyle} />
              <Bar dataKey="incidents" fill="#2c3b4d" radius={[0, 4, 4, 0]} isAnimationActive={false}
                label={{ position: 'right', fontSize: 11.5, fontWeight: 800, fill: '#1b2632', fontFamily: 'IBM Plex Mono' }} />
            </BarChart>
          </ResponsiveContainer></Fill>
        </Panel>
      </div>

      <Panel
        flush
        title="Open alerts"
        foot={<><Chips value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: alerts.filter(f.test).length }))} />{pager}</>}
      >
        {error && <div className="panel-body error">{error}</div>}
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Severity</th><th>Report</th><th>Problem</th><th>Owner</th>
                <th className="num">Seen</th><th>Opened</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={8} className="empty">No alerts match this filter.</td></tr>}
              {pageRows.map((a) => (
                <tr key={a.id}>
                  <td><span className={`tag ${a.severity.toLowerCase()}`}>{a.severity}</span></td>
                  <td><Link className="link mono" to={`/reports?id=${a.report_id}`}>{a.report_id}</Link></td>
                  <td>
                    {a.type === 'LATENCY' ? <>Slow load · <span className="mono">{fmtSec(a.value)}</span></> : <>Refresh · <span className="mono">{a.value}</span></>}
                  </td>
                  <td>{a.owner_email ?? <span className="rust">no owner</span>}</td>
                  <td className="num">{a.occurrences}×</td>
                  <td className="muted">snapshot {a.opened_snapshot} · {timeAgo(a.opened_at)}</td>
                  <td>{a.acknowledged_by ? <span className="tag neutral">ACK · {a.acknowledged_by.split('@')[0]}</span> : <span className="muted">Open</span>}</td>
                  <td className="num">{canAck(a) && <button className="btn-sm" onClick={() => acknowledge(a)}>Acknowledge</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
