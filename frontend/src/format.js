const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US');

export const fmtUsd = (n) => (n == null ? '—' : usd0.format(n));
export const fmtUsd2 = (n) => (n == null ? '—' : usd2.format(n));
export const fmtInt = (n) => (n == null ? '—' : int.format(n));
export const fmtSec = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}s`);
export const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;
export const fmtUsdShort = (n) =>
  n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

export function timeAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export const latencyClass = (severity) => ({ CRITICAL: 'critical', WARNING: 'warning' })[severity] ?? 'ok';
export const refreshClass = (status) =>
  ({ SUCCESS: 'ok', FAILED: 'critical', TIMED_OUT: 'critical', UNKNOWN: 'unknown' })[status] ?? 'unknown';
