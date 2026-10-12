import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';

/** Avatar button that opens a small panel with who you are and Log out. */
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
        <span className="avatar" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
        <span className="profile-name">{name}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="profile-panel" role="menu" style={pos}>
          <div className="profile-head">
            <span className="avatar lg" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
            <div>
              <div className="profile-email">{user.email}</div>
              <span className="role-tag">{user.role.toUpperCase()}</span>
            </div>
          </div>
          <button className="profile-logout" role="menuitem" onClick={logout}>Log out</button>
        </div>
      )}
    </div>
  );
}
