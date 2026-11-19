// ค่าตั้งของ device-hub — อ่านจาก env + ไฟล์ทะเบียนเครื่อง (docs/33 D7) · ไม่ log รหัสผ่าน / telemetry key
'use strict';
const fs = require('node:fs');

function positiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} ต้องเป็นจำนวนเต็มบวก แต่ได้ "${raw}"`);
  return n;
}

function text(env, name, fallback) {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function loadConfig(env = process.env) {
  const backendUrl = text(env, 'DEVICE_HUB_BACKEND_URL', null);
  return {
    tcpPort: positiveInt(env, 'DEVICE_HUB_TCP_PORT', 5000),
    httpHost: text(env, 'DEVICE_HUB_HTTP_HOST', '127.0.0.1'),
    httpPort: positiveInt(env, 'DEVICE_HUB_HTTP_PORT', 8090),
    backendUrl: backendUrl === null ? null : backendUrl.replace(/\/+$/, ''),
    adminUsername: text(env, 'DEVICE_HUB_ADMIN_USERNAME', null),
    adminPassword: text(env, 'DEVICE_HUB_ADMIN_PASSWORD', null),
    devicesFile: text(env, 'DEVICE_HUB_DEVICES_FILE', 'devices.json'),
    dataDir: text(env, 'DEVICE_HUB_DATA_DIR', 'data'),
    queueTtlHours: positiveInt(env, 'DEVICE_HUB_QUEUE_TTL_HOURS', 24),
    logDir: text(env, 'DEVICE_HUB_LOG_DIR', 'logs'),
  };
}

// ทะเบียนเครื่องที่อนุญาตให้ต่อเข้ามา: { "devices": [ { "imei", "model", "telemetryKey" } ] }
function loadDevices(file) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`อ่านไฟล์ทะเบียนเครื่อง ${file} ไม่ได้: ${err.message}`);
  }
  if (!doc || !Array.isArray(doc.devices)) throw new Error(`ไฟล์ทะเบียนเครื่อง ${file} ต้องมี "devices" เป็น array`);
  const map = new Map();
  doc.devices.forEach((d, i) => {
    const where = `${file} รายการที่ ${i + 1}`;
    if (!d || typeof d.imei !== 'string' || !/^\d{15}$/.test(d.imei)) throw new Error(`${where}: IMEI ต้องเป็นตัวเลข 15 หลัก`);
    if (typeof d.model !== 'string' || !d.model.trim()) throw new Error(`${where}: ต้องมี model`);
    if (typeof d.telemetryKey !== 'string' || !d.telemetryKey) throw new Error(`${where}: ต้องมี telemetryKey`);
    if (map.has(d.imei)) throw new Error(`${where}: IMEI ${d.imei} ซ้ำ`);
    map.set(d.imei, { model: d.model.trim(), telemetryKey: d.telemetryKey });
  });
  return map;
}

module.exports = { loadConfig, loadDevices };
