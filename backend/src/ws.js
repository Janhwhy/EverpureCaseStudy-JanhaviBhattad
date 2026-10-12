import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';

const AUTH_TIMEOUT_MS = 5000;

/**
 * WebSocket endpoint at /ws. The browser WebSocket API can't send an Authorization
 * header, so the client sends { type: 'auth', token } as its first message.
 * Until then it receives nothing; after 5 s without a valid token it is closed (4401).
 */
export function attachWebSocket(server, { engine, replay }) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set();

  wss.on('connection', (socket) => {
    const timeout = setTimeout(() => socket.close(4401, 'Authentication required'), AUTH_TIMEOUT_MS);

    socket.on('message', (raw) => {
      if (clients.has(socket)) return; // authenticated clients only listen
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return socket.close(4400, 'Invalid JSON');
      }
      const user = msg?.type === 'auth' ? verifyToken(msg.token) : null;
      if (!user) return socket.close(4401, 'Invalid token');

      clearTimeout(timeout);
      clients.add(socket);
      send(socket, {
        type: 'hello',
        user,
        snapshot: replay.snapshot,
        of: replay.lastSnapshot,
        open: engine.openAlerts(),
      });
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      clients.delete(socket);
    });
  });

  const broadcast = (payload) => clients.forEach((socket) => send(socket, payload));
  engine.on('event', (e) => broadcast({ type: 'alert', ...e }));
  replay.on('tick', (t) => broadcast({ type: 'tick', ...t, open_alerts: engine.openAlerts().length }));

  return wss;
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}
