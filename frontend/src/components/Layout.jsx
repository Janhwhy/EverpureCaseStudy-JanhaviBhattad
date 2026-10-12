import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtUsdShort } from '../format.js';
import { useLive } from '../live.jsx';
import CardNav from './CardNav.jsx';
import ProfileMenu from './ProfileMenu.jsx';

export const PAGES = [
  { path: '/', label: 'Overview' },
  { path: '/reports', label: 'Reports' },
  { path: '/alerts', label: 'Alerts' },
  { path: '/orphaned', label: 'Orphaned' },
  { path: '/costs', label: 'Costs', permission: 'costs:read' },
  { path: '/data-quality', label: 'Data Quality', permission: 'dq:read' },
];

const GROUPS = [
  { label: 'Monitor', hint: 'Dashboard health', paths: ['/', '/reports'], bgColor: '#2c3b4d', textColor: '#eee9df' },
  { label: 'Respond', hint: 'Incidents & ownership', paths: ['/alerts', '/orphaned'], bgColor: '#a35139', textColor: '#ffffff' },
  { label: 'Govern', hint: 'Cost & data trust', paths: ['/costs', '/data-quality'], bgColor: '#ffb162', textColor: '#1b2632' },
];

/** "updated Ns ago", ticking on its own so the rest of the page doesn't re-render every second. */
function Updated({ snapshot }) {
  const [since, setSince] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => setSince(Date.now()), [snapshot]);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <>updated {Math.round((Date.now() - since) / 1000)}s ago</>;
}

export default function Layout() {
  const { can } = useAuth();
  const { connected, snapshot, of, open } = useLive();
  const { pathname } = useLocation();
  const page = PAGES.find((p) => p.path === pathname) ?? PAGES[0];

  const health = useApi('/health', [snapshot]).data;
  // Only requested when the role may see them, so the menu never triggers a 403.
  const costs = useApi(can('costs:read') ? '/costs/reports' : null).data;
  const dq = useApi(can('dq:read') ? '/data-quality' : null).data;
  const critical = [...open.values()].filter((a) => a.severity === 'CRITICAL').length;

  // Live headline per card and a stat beside every link.
  const stats = health && {
    Monitor: { value: `${health.latency_warning + health.latency_critical}/${health.reports}`, label: 'avg load over 15 s' },
    Respond: { value: open.size, label: 'open alerts' },
    Govern: costs && [
      { value: fmtUsdShort(costs.totals.aws_usd), label: 'AWS' },
      { value: fmtUsdShort(costs.totals.snowflake_usd), label: costs.scope === 'own' ? `Snowflake est. · ${costs.totals.reports} reports you own` : 'Snowflake est.' },
    ],
  };
  const meta = health && {
    '/': `p95 avg load ${health.p95_load_sec}s`,
    '/reports': `${health.reports} reports`,
    '/alerts': `${critical} critical`,
    '/orphaned': `${health.orphaned} now`,
    '/costs': costs?.totals.aws_usd_per_view != null
      ? `AWS $${costs.totals.aws_usd_per_view.toFixed(2)} · SF $${costs.totals.snowflake_usd_per_view.toFixed(2)} /view` : null,
    '/data-quality': dq ? `${dq.summary.length} rules` : null,
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const pulse = health && [
    { to: '/reports', tone: 'critical', value: health.latency_warning + health.latency_critical, label: 'over 15 s' },
    { to: '/alerts', tone: 'critical', value: health.refresh_failed, label: 'failed refreshes' },
    { to: '/orphaned', tone: 'orphan', value: health.orphaned, label: 'no owner' },
    { to: '/alerts', tone: 'alert', value: open.size, label: 'open alerts' },
  ];

  // Cards only list pages this role may open; a group with nothing left is dropped.
  const items = GROUPS.map((g) => ({
    ...g,
    stat: stats?.[g.label] || null,
    links: PAGES.filter((p) => g.paths.includes(p.path) && (!p.permission || can(p.permission))).map((p) => ({
      to: p.path,
      label: p.label,
      active: p.path === pathname,
      meta: meta?.[p.path] ?? null,
    })),
  })).filter((g) => g.links.length > 0);

  return (
    <div className="app">
      <CardNav
        items={items}
        left={<span className="nav-crumb">{page.label}</span>}
        center={pulse && (
          <div className="pulse" aria-label="Live portal health">
            {pulse.map((p) => (
              <Link key={p.label} to={p.to} className="pulse-item" title={`${p.value} ${p.label}: open ${p.to.slice(1)}`}>
                <span className={`pulse-mark ${p.tone}`} aria-hidden="true">{p.tone === 'alert' ? '!' : ''}</span>
                <b>{p.value}</b> <span className="pulse-label">{p.label}</span>
              </Link>
            ))}
          </div>
        )}
        right={
          <>
            <ProfileMenu />
          </>
        }
      />

      <main className="main">
        <header className="topbar">
          <h1>{page.label}</h1>
          <div className={`topbar-meta ${connected ? '' : 'offline'}`} title="The extract is replayed one snapshot at a time, as a live feed">
            <span className="live-dot" aria-hidden="true" />
            {connected ? (
              <>
                <b>Live replay</b>
                <span className="sep">·</span>
                Snapshot <b>{snapshot}</b> of {of}
                <span className="sep">·</span>
                <Updated snapshot={snapshot} />
              </>
            ) : 'Reconnecting…'}
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
