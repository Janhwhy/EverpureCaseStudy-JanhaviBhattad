import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);
// sessionStorage: survives a page refresh, cleared when the tab closes.
const STORAGE_KEY = 'pi_session';

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Sign-in failed');
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(body));
    setSession(body);
  }, []);

  // An expired or invalid token anywhere in the app sends the user back to sign-in.
  useEffect(() => {
    window.addEventListener('pi:unauthorized', logout);
    return () => window.removeEventListener('pi:unauthorized', logout);
  }, [logout]);

  const can = useCallback((permission) => Boolean(session?.user.permissions.includes(permission)), [session]);

  return (
    <AuthContext.Provider value={{ token: session?.token, user: session?.user, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
