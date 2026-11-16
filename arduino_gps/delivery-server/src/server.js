const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cfg = require('./config');
const { JsonStore } = require('./store');
const { SchemaRegistry } = require('./schemas');
const fw = require('./firmware');
const { adminAuth, hashToken, safeEqual } = require('./auth');
const adminRoutes = require('./routes/admin');
const deviceRoutes = require('./routes/device');

const store = new JsonStore(path.join(cfg.dataDir, 'db.json'), { devices: {}, configs: {}, firmware: [] });
const schemas = new SchemaRegistry(cfg.schemasDir);
const autoRegister = {
  token: cfg.autoRegisterToken,
  // schema จริงจะอัปเดตจาก report ของกล่อง
  newRecord: (id) => ({ device_id: id, hardware_model: 'ESP32-DEVKIT-V1', schema_version: 1, rotated_at: null, reported: null, last_report_at: null }),
};

// audit log แบบ JSON lines (ห้ามใส่ token/secret)
const auditFile = path.join(cfg.dataDir, 'audit.log');
function audit(action, target, details) {
  fs.appendFileSync(auditFile, JSON.stringify({ time: new Date().toISOString(), actor: 'admin', action, target, details }) + '\n');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

app.get('/health', (req, res) => res.json({ ok: true, service: 'delivery-server', time: new Date().toISOString() }));

app.use('/api/admin', adminRoutes({ store, schemas, cfg, audit }));

// หน้าเว็บจัดการ (Web Admin) — ตัวหน้าเว็บไม่มีข้อมูลลับ ทุก API ยังต้องใช้ ADMIN_TOKEN
app.get('/admin', (req, res) => res.sendFile(path.join(cfg.root, 'admin', 'index.html')));

// เข้าสู่ระบบด้วยชื่อผู้ใช้ / รหัสผ่าน -> ได้ ADMIN_TOKEN (จำกัด 5 ครั้งที่ผิดต่อนาทีต่อ IP)
const loginFails = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const recent = (loginFails.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 5) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'ใส่รหัสผิดหลายครั้ง รอ 1 นาทีแล้วลองใหม่' });
  if (!cfg.adminUsername || !cfg.adminPassword) {
    return res.status(503).json({ error: 'LOGIN_NOT_CONFIGURED', message: 'ตั้ง ADMIN_USERNAME / ADMIN_PASSWORD ใน .env' });
  }
  const { username = '', password = '' } = req.body || {};
  const ok = safeEqual(hashToken(String(username)), hashToken(cfg.adminUsername)) &
    safeEqual(hashToken(String(password)), hashToken(cfg.adminPassword));
  if (!ok) {
    loginFails.set(ip, [...recent, now]);
    return res.status(401).json({ error: 'INVALID_LOGIN', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  loginFails.delete(ip);
  audit('ADMIN_LOGIN', String(username), { ip });
  res.json({ token: cfg.adminToken });
});

// ส่งต่อคำขอ /api/gw/* ไปที่ Admin API ของ ws-gateway (ใช้ GATEWAY_ADMIN_TOKEN ฝั่ง server)
app.use('/api/gw', adminAuth(cfg.adminToken), async (req, res) => {
  if (!cfg.gatewayAdminUrl || !cfg.gatewayAdminToken) {
    return res.status(503).json({ error: 'GATEWAY_NOT_CONFIGURED', message: 'ตั้ง GATEWAY_ADMIN_URL และ GATEWAY_ADMIN_TOKEN ใน .env' });
  }
  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const r = await fetch(cfg.gatewayAdminUrl + '/api/admin' + req.url, {
      method: req.method,
      headers: { Authorization: 'Bearer ' + cfg.gatewayAdminToken, 'Content-Type': 'application/json' },
      body: hasBody ? JSON.stringify(req.body || {}) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    res.status(r.status).type('application/json').send(await r.text());
  } catch (e) {
    res.status(502).json({ error: 'GATEWAY_UNREACHABLE', message: `ต่อ ws-gateway ไม่ได้ (${cfg.gatewayAdminUrl})` });
  }
});
app.use('/api/device/me', deviceRoutes({ store, cfg, autoRegister }));

// ลิงก์ดาวน์โหลดที่ออกให้ใน firmware-manifest
app.get('/firmware/download/:model/:version', (req, res) => {
  const { model, version } = req.params;
  if (!fw.checkDownloadUrl(cfg, model, version, req.query)) return res.status(403).json({ error: 'INVALID_OR_EXPIRED_LINK' });
  const device = store.data.devices[req.query.device];
  if (!device || device.status !== 'active' || device.hardware_model !== model) return res.status(403).json({ error: 'DEVICE_NOT_ALLOWED' });
  const release = store.data.firmware.find((f) => f.hardware_model === model && f.version === version);
  if (!release || release.rollout_status === 'revoked') return res.status(404).json({ error: 'RELEASE_NOT_FOUND' });

  res.set('Content-Type', 'application/octet-stream');
  res.set('X-Firmware-SHA256', release.sha256);
  res.sendFile(fw.firmwarePath(cfg.dataDir, model, version));
});

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

server.listen(cfg.port, () => {
  console.log(`delivery-server ฟังที่ ${useTls ? 'https' : 'http'}://0.0.0.0:${cfg.port}`);
  console.log(`PUBLIC_BASE_URL = ${cfg.publicBaseUrl}`);
  if (!fw.loadPublicKey(cfg.firmwarePublicKeyFile)) {
    console.warn(
      cfg.allowUnsignedFirmware
        ? 'คำเตือน: ALLOW_UNSIGNED_FIRMWARE=true รับ firmware ที่ไม่มีลายเซ็น (ใช้ทดสอบเท่านั้น)'
        : 'คำเตือน: ไม่พบ public key สำหรับตรวจลายเซ็น firmware — รัน npm run keygen ก่อนอัปโหลด firmware'
    );
  }
});
