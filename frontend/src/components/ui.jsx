import { useMemo, useState } from 'react';

export function Panel({ title, sub, actions, children, flush, foot, bodyClass = '' }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      {flush ? children : <div className={`panel-body ${bodyClass}`}>{children}</div>}
      {foot && <div className="panel-foot">{foot}</div>}
    </section>
  );
}

/** Full-width SVG sparkline (stretches to its container). */
export function Sparkline({ values, color = '#2c3b4d', height = 30 }) {
  if (!values || values.length < 2) return <div style={{ height }} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${height - 3 - ((v - min) / (max - min || 1)) * (height - 6)}`);
  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * KPI tile: value, change since the previous snapshot, sparkline of the run so far.
 * `higherIsBad` decides whether an increase is shown as bad (rust) or good (sage).
 */
export function Kpi({ label, value, unit, series, note, higherIsBad = true, accent, format = (v) => v }) {
  const prev = series?.length > 1 ? series[series.length - 2] : null;
  const diff = prev == null ? null : Math.round((series[series.length - 1] - prev) * 10) / 10;
  const tone = diff == null || diff === 0 ? 'flat' : (diff > 0) === higherIsBad ? 'bad' : 'good';
  return (
    <div className={`kpi ${accent ? 'accent' : ''}`}>
      <div className="kpi-top">
        <span className="eyebrow">{label}</span>
        {diff != null && (
          <span className={`delta ${tone}`} title="Change since the previous snapshot">
            {diff > 0 ? '▲' : diff < 0 ? '▼' : '•'} {format(Math.abs(diff))}
          </span>
        )}
      </div>
      <div className="kpi-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="kpi-note">{note}</div>
      {series && <Sparkline values={series} color={higherIsBad ? '#a35139' : '#2c3b4d'} />}
    </div>
  );
}

export const Status = ({ tone, children }) => (
  <span className="status">
    <span className={`dot ${tone}`} aria-hidden="true" />
    {children}
  </span>
);

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => (
        <button key={o.key} className={`chip ${value === o.key ? 'active' : ''}`} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
          {o.count != null && <span className="mono">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.key} className={value === o.key ? 'active' : ''} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Client-side sorting for the tables in this app. */
export function useSort(rows, initialKey, initialDir = 'asc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const sorted = useMemo(() => {
    if (!rows) return [];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }, [rows, sort]);

  const header = (key, label, { num } = {}) => (
    <th
      className={`sortable ${num ? 'num' : ''}`}
      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : num ? 'desc' : 'asc' }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return { sorted, header };
}

/** Pages a list; resets to page 1 when the list's identity-defining `resetKey` changes. */
export function usePaged(rows, pageSize, resetKey) {
  const [state, setState] = useState({ page: 0, key: resetKey });
  const page = state.key === resetKey ? state.page : 0;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const setPage = (p) => setState({ page: p, key: resetKey });
  return {
    pageRows: rows.slice(current * pageSize, current * pageSize + pageSize),
    pager: (
      <div className="pager">
        <span>
          {rows.length ? `${current * pageSize + 1}–${Math.min(rows.length, (current + 1) * pageSize)} of ${rows.length}` : '0 of 0'}
        </span>
        <button onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">←</button>
        <button onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Next page">→</button>
      </div>
    ),
  };
}

/** Hover tooltip for hand-drawn charts (health map, heatmap). */
export function useTip() {
  const [tip, setTip] = useState(null);
  const show = (e, content) => setTip({ x: e.clientX, y: e.clientY, content });
  const hide = () => setTip(null);
  const node = tip && (
    <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 230), top: tip.y + 14 }}>
      {tip.content}
    </div>
  );
  return { show, hide, node };
}

export const KV = ({ k, v }) => (
  <div className="row-kv"><span>{k}</span><b>{v}</b></div>
);

/** Grows to the card's remaining height (see .fill in styles.css). */
export const Fill = ({ min, scroll, children }) => (
  <div className="fill" style={{ minHeight: min }}>
    <div className={`fill-inner ${scroll ? 'scroll' : ''}`}>{children}</div>
  </div>
);

export const Loading = () => <div className="empty">Loading…</div>;
export const ErrorNote = ({ error }) => <div className="empty rust">{error}</div>;
