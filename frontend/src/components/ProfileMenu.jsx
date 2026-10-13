import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';

const ROLES = {
  admin: { title: 'Administrator', tone: 'admin' },
  owner: { title: 'Report owner', tone: 'owner' },
  viewer: { title: 'Viewer', tone: 'viewer' },
};

// "user_3" -> "U3", "admin" -> "AD"
const initials = (name) => {
  const parts = name.split(/[._-]/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : name.slice(0, 2)).toUpperCase();
};

/** Avatar button that opens a small panel with who you are, your role, and Log out. */
export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);

  // The nav bar clips its overflow (for the CardNav animation), so the panel is fixed to the viewport,
  // aligned under the button.
  const toggle = () => {
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 10, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };
  const name = user.email.split('@')[0];
  const role = ROLES[user.role] ?? { title: user.role, tone: 'viewer' };

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="profile" ref={ref}>
      <button ref={btnRef} className="profile-btn" onClick={toggle} aria-haspopup="true" aria-expanded={open}>
        <span className={`avatar ${role.tone}`} aria-hidden="true">{initials(name)}</span>
        <span className="profile-name">{name}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="profile-panel" role="menu" style={pos}>
          <div className="profile-head">
            <span className={`avatar lg ${role.tone}`} aria-hidden="true">{initials(name)}</span>
            <div className="profile-id">
              <div className="profile-name-lg">{name}</div>
              <div className="profile-email">{user.email}</div>
            </div>
          </div>
          <div className="profile-role">
            <span className="eyebrow">Signed in as</span>
            <span className={`profile-role-name ${role.tone}`}><i aria-hidden="true" />{role.title}</span>
          </div>
          <div className="profile-foot">
            <button className="profile-logout" role="menuitem" onClick={logout}>
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.5 8H6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
