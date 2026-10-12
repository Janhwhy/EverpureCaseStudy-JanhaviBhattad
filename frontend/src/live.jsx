import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';

const LiveContext = createContext(null);
const EVENT_LIMIT = 200;

/**
 * One WebSocket per signed-in session. Keeps the open-alert list and the replay
 * position in sync with the server, and reconnects with backoff if the line drops.
 */
export function LiveProvider({ children }) {
  const { token, logout } = useAuth();
  const [state, setState] = useState({ connected: false, snapshot: null, of: null, open: new Map(), events: [] });
  const retry = useRef(0);

  useEffect(() => {
    let socket;
    let timer;
    let stopped = false;

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/ws`);

      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));

      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'hello') {
          retry.current = 0;
          setState((s) => ({
            ...s,
            connected: true,
            snapshot: msg.snapshot,
            of: msg.of,
            open: new Map(msg.open.map((a) => [a.id, a])),
          }));
        } else if (msg.type === 'tick') {
          setState((s) => ({ ...s, snapshot: msg.snapshot, of: msg.of }));
        } else if (msg.type === 'alert') {
          setState((s) => {
            const open = new Map(s.open);
            if (msg.event === 'resolved') open.delete(msg.alert.id);
            else open.set(msg.alert.id, msg.alert);
            return { ...s, open, events: [msg, ...s.events].slice(0, EVENT_LIMIT) };
          });
        }
      };

      socket.onclose = (e) => {
        setState((s) => ({ ...s, connected: false }));
        if (stopped) return;
        if (e.code === 4401) return logout(); // token rejected
        const delay = Math.min(1000 * 2 ** retry.current++, 15000);
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [token, logout]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
