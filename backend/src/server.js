import http from 'node:http';
import { AlertEngine } from './alerts.js';
import { createApp } from './app.js';
import { DATA_SOURCE, initDb } from './db.js';
import { TelemetryReplay } from './telemetry.js';
import { attachWebSocket } from './ws.js';

const PORT = Number(process.env.PORT ?? 4000);
// One snapshot every 8 s, so a full 20-snapshot cycle takes under 3 minutes in a demo.
const REPLAY_INTERVAL_MS = Number(process.env.REPLAY_INTERVAL_MS ?? 8000);

await initDb();

const engine = new AlertEngine();
const replay = new TelemetryReplay(engine, { intervalMs: REPLAY_INTERVAL_MS });
const server = http.createServer(createApp({ engine, replay }));
attachWebSocket(server, { engine, replay });

await replay.start();
server.listen(PORT, () => {
  console.log(`Data source: ${DATA_SOURCE}`);
  console.log(`API on http://localhost:${PORT}/api, alerts on ws://localhost:${PORT}/ws`);
  console.log(`Replaying snapshot ${replay.snapshot}/${replay.lastSnapshot} every ${REPLAY_INTERVAL_MS / 1000}s`);
});
