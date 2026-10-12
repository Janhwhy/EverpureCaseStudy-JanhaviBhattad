import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';

export async function apiFetch(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401) window.dispatchEvent(new Event('pi:unauthorized'));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

/**
 * GET a resource and refetch whenever any value in `deps` changes
 * (pages pass the live snapshot number so they follow the replay).
 * Keeps showing the previous data while a refetch is in flight. A null path skips the request.
 */
export function useApi(path, deps = []) {
  const { token } = useAuth();
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    apiFetch(token, path)
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((error) => !cancelled && setState((s) => ({ data: s.data, error: error.message })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, path, ...deps]);

  return state;
}
