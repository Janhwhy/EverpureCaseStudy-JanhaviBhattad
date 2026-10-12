import { useNavigate } from 'react-router-dom';
import { fmtInt, fmtSec, latencyClass } from '../format.js';
import { KV, useTip } from './ui.jsx';

const FAILED = new Set(['FAILED', 'TIMED_OUT']);

/**
 * One tile per report (10 x 10). Fill = load-time severity, dark dot = refresh failing,
 * dashed outline = no owner. Click a tile to open the report.
 */
export default function HealthMap({ reports, highlight }) {
  const navigate = useNavigate();
  const tip = useTip();

  return (
    <>
      <div className="healthmap" onMouseLeave={tip.hide}>
        {reports.map((r) => {
          const failing = FAILED.has(r.last_refresh_status);
          const label = `${r.report_id}: ${fmtSec(r.avg_load_time_sec)}, refresh ${r.last_refresh_status}${r.is_orphaned ? ', no owner' : ''}`;
          return (
            <button
              key={r.report_id}
              className={`cell ${latencyClass(r.latency_severity)} ${r.is_orphaned ? 'orphan' : ''} ${highlight && !highlight(r) ? 'dim' : ''}`}
              aria-label={label}
              onClick={() => navigate(`/reports?id=${r.report_id}`)}
              onMouseMove={(e) => tip.show(e, (
                <>
                  <div style={{ marginBottom: 6 }}><b>{r.report_id}</b> · {r.report_name}</div>
                  <KV k="Load time" v={fmtSec(r.avg_load_time_sec)} />
                  <KV k="Refresh" v={r.last_refresh_status} />
                  <KV k="Owner" v={r.owner_email ?? 'none'} />
                  <KV k="Monthly views" v={fmtInt(r.monthly_active_views)} />
                </>
              ))}
            >
              {r.report_id.slice(4)}
              {failing && <span className="flag-fail" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {tip.node}
      <div className="legend" style={{ marginTop: 14 }}>
        <span><i className="sw ok" /> Under 15 s</span>
        <span><i className="sw warning" /> 15–30 s</span>
        <span><i className="sw critical" /> Over 30 s</span>
        <span><i className="sw fail" /> Refresh failing</span>
        <span><i className="sw orphan" /> No owner</span>
      </div>
    </>
  );
}
