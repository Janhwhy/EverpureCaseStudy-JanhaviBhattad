import { useState } from 'react';
import { useAuth } from '../auth.jsx';

const DEMO_ACCOUNTS = [
  { email: 'admin@company.com', password: 'admin-demo', role: 'Admin' },
  { email: 'user_3@company.com', password: 'owner-demo', role: 'Report owner' },
  { email: 'viewer@company.com', password: 'viewer-demo', role: 'Viewer' },
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-wrap">
        <h1 className="login-title">Admin visibility for the analytics portal, <em>back after Tableau.</em></h1>
        <form className="panel login-form" onSubmit={submit}>
          <h2>Sign in</h2>
          <label className="field">
            Work email
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <div className="panel demo">
          <div className="panel-head"><span className="eyebrow">Demo accounts · click to fill</span></div>
          <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" onClick={() => { setEmail(a.email); setPassword(a.password); }}>
                <span className="mono">{a.email}</span>
                <span className="muted">{a.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
