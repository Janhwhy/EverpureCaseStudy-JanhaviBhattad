import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { ErrorNote, Kpi, Loading, Status } from '../components/ui.jsx';
import { fmtInt, fmtSec, refreshClass } from '../format.js';
import { useLive } from '../live.jsx';

const FAILED = new Set(['FAILED', 'TIMED_OUT']);

export default function Orphaned() {
  const { snapshot } = useLive();
  const { data, error } = useApi('/reports/orphaned', [snapshot]);
  const health = useApi('/health', [snapshot]).data;

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const reports = data.reports;
  const views = reports.reduce((s, r) => s + r.monthly_active_views, 0);
  const atRisk = reports.filter((r) => FAILED.has(r.last_refresh_status) || r.avg_load_time_sec > 15).length;

  return (
    <>
      <div className="kpis">
        <Kpi label="Reports with no owner" value={reports.length} note={`snapshot ${data.snapshot}`} series={health?.trend.map((t) => t.orphaned)} />
        <Kpi label="Monthly views on them" value={fmtInt(views)} note="views, not unique users" />
        <Kpi label="Also over 15 s or failed refresh" value={atRisk} unit={`/ ${reports.length}`} />
      </div>


      {reports.length === 0 ? (
        <div className="panel empty">Every report has an owner in this snapshot.</div>
      ) : (
        <div className="cards">
          {reports.map((r) => (
            <article key={r.report_id} className="card">
              <div>
                <div className="card-head">
                  <Link className="link mono" style={{ fontSize: 14 }} to={`/reports?id=${r.report_id}`}>{r.report_id}</Link>
                  <span className="tag low mono" title="Raw value in the owner field">{r.owner_email_raw ?? 'NULL'}</span>
                </div>
                <div className="card-title">{r.report_name}</div>
              </div>
              <div className="card-metrics">
                <div><b>{fmtInt(r.monthly_active_views)}</b><span>Monthly views</span></div>
                <div><b>{fmtSec(r.avg_load_time_sec)}</b><span>Avg load</span></div>
                <div><Status tone={refreshClass(r.last_refresh_status)}><b style={{ fontSize: 13 }}>{r.last_refresh_status.replace('_', ' ')}</b></Status><span>Refresh</span></div>
              </div>
              {r.last_known_owner && (
                <div className="last-owner">Last owner <b>{r.last_known_owner.split('@')[0]}</b> · snapshot {r.last_known_owner_snapshot}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
