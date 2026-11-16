const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cfg = require('./config');
const { JsonStore } = require('./store');
const { CommandService } = require('./commands');
const { attachWebSocket, WS_PATH } = require('./ws');
const adminRoutes = require('./routes/admin');
const deviceRoutes = require('./routes/device');

const store = new JsonStore(path.join(cfg.dataDir, 'db.json'), { seq: 10000, devices: {}, commands: [] });
const connections = new Map();
const commands = new CommandService(store, connections, cfg);
const autoRegister = { token: cfg.autoRegisterToken, newRecord: (id) => ({ device_id: id, last_seen_at: null }) };

// audit log แบบ JSON lines (ห้ามใส่ token/secret)
const auditFile = path.join(cfg.dataDir, 'audit.log');
function audit(action, target, details) {
  fs.appendFileSync(auditFile, JSON.stringify({ time: new Date().toISOString(), actor: 'admin', action, target, details }) + '\n');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

app.get('/health', (req, res) =>
  res.json({ ok: true, service: 'ws-gateway', online_devices: connections.size, time: new Date().toISOString() })
);

app.use('/api/admin', adminRoutes({ store, commands, connections, cfg, audit }));
app.use('/api/device/me', deviceRoutes({ store, commands, autoRegister }));

app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' });
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

const useTls = cfg.tlsCertFile && cfg.tlsKeyFile;
const server = useTls
  ? https.createServer({ cert: fs.readFileSync(cfg.tlsCertFile), key: fs.readFileSync(cfg.tlsKeyFile) }, app)
  : http.createServer(app);

attachWebSocket(server, { store, commands, connections, cfg, autoRegister });

setInterval(() => commands.expireSweep(), 5 * 1000);

server.listen(cfg.port, () => {
  const scheme = useTls ? 'https' : 'http';
  console.log(`ws-gateway ฟังที่ ${scheme}://0.0.0.0:${cfg.port}`);
  console.log(`WebSocket: ${useTls ? 'wss' : 'ws'}://<host>:${cfg.port}${WS_PATH}`);
});
