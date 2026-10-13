const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US');
// Every non-integer value is shown to exactly 2 decimals, so nothing on screen is rounded more coarsely than another.
const dec2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtUsd = (n) => (n == null ? '—' : usd2.format(n));
export const fmtUsd2 = (n) => (n == null ? '—' : usd2.format(n));
export const fmtInt = (n) => (n == null ? '—' : int.format(n));
export const fmtNum = (n) => (n == null ? '—' : dec2.format(n));
export const fmtSec = (n) => (n == null ? '—' : `${Number(n).toFixed(2)}s`);
export const fmtPct = (n) => `${(n * 100).toFixed(2)}%`;
export const fmtUsdShort = (n) =>
  n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(2)}K` : `$${n.toFixed(2)}`;

export function timeAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export const latencyClass = (severity) => ({ CRITICAL: 'critical', WARNING: 'warning' })[severity] ?? 'ok';
export const refreshClass = (status) =>
  ({ SUCCESS: 'ok', FAILED: 'critical', TIMED_OUT: 'critical', UNKNOWN: 'unknown' })[status] ?? 'unknown';
