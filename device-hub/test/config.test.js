'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, loadDevices } = require('../src/config');

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-hub-config-'));
  const file = path.join(dir, 'devices.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

test('ค่าเริ่มต้น', () => {
  const c = loadConfig({});
  assert.strictEqual(c.tcpPort, 5000);
  assert.strictEqual(c.httpHost, '127.0.0.1');
  assert.strictEqual(c.httpPort, 8090);
  assert.strictEqual(c.queueTtlHours, 24);
  assert.strictEqual(c.backendUrl, null);
  assert.strictEqual(c.adminUsername, null);
  assert.strictEqual(c.adminPassword, null);
  assert.strictEqual(c.devicesFile, 'devices.json');
  assert.strictEqual(c.dataDir, 'data');
  assert.strictEqual(c.logDir, 'logs');
  assert.strictEqual(c.idleMinSec, 120);
});

test('DEVICE_HUB_IDLE_MIN_SEC ตั้งเกณฑ์ต่ำสุดของการตัดสายที่เงียบ', () => {
  assert.strictEqual(loadConfig({ DEVICE_HUB_IDLE_MIN_SEC: '300' }).idleMinSec, 300);
  assert.throws(() => loadConfig({ DEVICE_HUB_IDLE_MIN_SEC: '0' }), /DEVICE_HUB_IDLE_MIN_SEC/);
});

test('อ่านค่าจาก env', () => {
  const c = loadConfig({
    DEVICE_HUB_TCP_PORT: '5100', DEVICE_HUB_HTTP_PORT: '9000', DEVICE_HUB_HTTP_HOST: '0.0.0.0',
    DEVICE_HUB_BACKEND_URL: 'http://localhost:3001/api/v1/', DEVICE_HUB_QUEUE_TTL_HOURS: '12',
    DEVICE_HUB_ADMIN_USERNAME: 'hub', DEVICE_HUB_ADMIN_PASSWORD: 'secret',
  });
  assert.strictEqual(c.tcpPort, 5100);
  assert.strictEqual(c.httpPort, 9000);
  assert.strictEqual(c.httpHost, '0.0.0.0');
  assert.strictEqual(c.backendUrl, 'http://localhost:3001/api/v1'); // ตัด / ท้าย
  assert.strictEqual(c.queueTtlHours, 12);
  assert.strictEqual(c.adminUsername, 'hub');
});

test('ตัวเลขผิดรูปแบบ throw พร้อมชื่อ env', () => {
  assert.throws(() => loadConfig({ DEVICE_HUB_TCP_PORT: 'abc' }), /DEVICE_HUB_TCP_PORT/);
  assert.throws(() => loadConfig({ DEVICE_HUB_QUEUE_TTL_HOURS: '0' }), /DEVICE_HUB_QUEUE_TTL_HOURS/);
});

test('loadDevices อ่านไฟล์ตัวอย่าง', () => {
  const map = loadDevices(path.join(__dirname, '..', 'devices.example.json'));
  assert.strictEqual(map.get('353358017784062').model, 'TA255L');
  assert.strictEqual(typeof map.get('353358017784062').telemetryKey, 'string');
});

test('loadDevices ปฏิเสธ IMEI ซ้ำ', () => {
  const d = { imei: '353358017784062', model: 'TA255L', telemetryKey: 'k' };
  assert.throws(() => loadDevices(tempFile({ devices: [d, d] })), /ซ้ำ/);
});

test('loadDevices ปฏิเสธ IMEI ที่ไม่ใช่ตัวเลข 15 หลัก', () => {
  assert.throws(() => loadDevices(tempFile({ devices: [{ imei: '12345', model: 'TA255L', telemetryKey: 'k' }] })), /IMEI/);
});

test('loadDevices ปฏิเสธรายการที่ไม่มี model หรือ telemetryKey', () => {
  assert.throws(() => loadDevices(tempFile({ devices: [{ imei: '353358017784062', telemetryKey: 'k' }] })), /model/);
  assert.throws(() => loadDevices(tempFile({ devices: [{ imei: '353358017784062', model: 'TA255L' }] })), /telemetryKey/);
});

test('loadDevices ไฟล์ JSON เสีย throw พร้อมชื่อไฟล์', () => {
  const file = tempFile('{ not json');
  assert.throws(() => loadDevices(file), (err) => err.message.includes(file));
});
