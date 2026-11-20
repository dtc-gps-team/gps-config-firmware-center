'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createCommandQueue } = require('../src/core/command-queue');
const { startHttpApi } = require('../src/core/http-api');
const fields = require('../src/protocols/meitrack/fields');

const DEV = '353358017784062';
const devices = new Map([[DEV, { model: 'TA255L', telemetryKey: 'k' }], ['353358017784063', { model: 'TA255L', telemetryKey: 'k2' }]]);

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-hub-http-'));
  const queue = createCommandQueue({ file: path.join(dir, 'q.json'), ttlHours: 24 });
  const tcp = {
    isOnline: (imei) => imei === DEV,
    lastSeenAt: (imei) => (imei === DEV ? '2026-11-19T00:00:00.000Z' : null),
    firmwareVersion: (imei) => (imei === DEV ? 'V028' : null),
  };
  const config = { ...loadConfig({ DEVICE_HUB_ADMIN_USERNAME: 'hub', DEVICE_HUB_ADMIN_PASSWORD: 'pw' }), httpPort: 0 };
  const { server, port } = await startHttpApi({ config, devices, tcp, queue, fieldsByModel: new Map([['TA255L', fields]]) });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const login = async () => (await (await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ username: 'hub', password: 'pw' }) })).json()).token;
  const token = await login();
  const call = (p, init = {}) => fetch(`${base}${p}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  return { server, base, call, queue };
}

const putConfig = (call, id, settings) => call(`/api/admin/devices/${id}/config`, { method: 'PUT', body: JSON.stringify({ settings }) });

test('login ถูกได้ token · ผิดได้ 401 · ไม่มี token ได้ 401', async (t) => {
  const { base, call } = await setup(t);
  const bad = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ username: 'hub', password: 'x' }) });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual((await fetch(`${base}/api/gw/devices`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/gw/devices`, { headers: { Authorization: 'Bearer nope' } })).status, 401);
  assert.strictEqual((await call('/api/gw/devices')).status, 200);
});

test('GET /api/gw/devices มี field ครบตาม RawGatewayDevice เฉพาะเครื่องที่เคยต่อเข้ามา', async (t) => {
  const { call } = await setup(t);
  const list = await (await call('/api/gw/devices')).json();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0], {
    device_id: DEV, hardware_model: 'TA255L', online: true, last_seen_at: '2026-11-19T00:00:00.000Z',
    firmware_version_reported: 'V028', config_version_reported: null, schema_version_reported: 1, last_command: null,
  });
});

test('GET /api/admin/devices คืนทุกเครื่องในทะเบียน', async (t) => {
  const { call } = await setup(t);
  const list = await (await call('/api/admin/devices')).json();
  assert.deepStrictEqual(list.map((d) => d.device_id), [DEV, '353358017784063']);
  assert.deepStrictEqual(list[0], { device_id: DEV, hardware_model: 'TA255L', schema_version: 1, status: 'active', config_version_desired: null });
});

test('PUT config ถูก → 200 ได้คำสั่งขึ้นต้น hub- สถานะ QUEUED และ last_command อัปเดต', async (t) => {
  const { call } = await setup(t);
  const res = await putConfig(call, DEV, { meitrack: { led_off: true } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.config_version, 1);
  assert.match(body.command.command_id, /^hub-/);
  assert.strictEqual(body.command.status, 'QUEUED');
  const job = await (await call(`/api/gw/jobs/${body.command.command_id}`)).json();
  assert.strictEqual(job.device_id, DEV);
  const [dev] = await (await call('/api/gw/devices')).json();
  assert.strictEqual(dev.last_command.command_id, body.command.command_id);
  assert.strictEqual(dev.last_command.status, 'QUEUED');
  const cmds = await (await call(`/api/gw/devices/${DEV}/commands`)).json();
  assert.strictEqual(cmds[0].command_id, body.command.command_id);
});

test('PUT config ผิด → 400 พร้อม details[].key', async (t) => {
  const { call } = await setup(t);
  const res = await putConfig(call, DEV, { gps: { send_interval_sec: 10 } });
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.details[0].key, 'gps.send_interval_sec');
  assert.ok(body.error);
});

test('PUT config เครื่องไม่อยู่ในทะเบียน → 404', async (t) => {
  const { call } = await setup(t);
  assert.strictEqual((await putConfig(call, '999999999999999', { meitrack: { led_off: true } })).status, 404);
});

test('GET schema TA255L/1 = schema() · เวอร์ชันอื่น 404', async (t) => {
  const { call } = await setup(t);
  assert.deepStrictEqual(await (await call('/api/admin/schemas/TA255L/1')).json(), fields.schema());
  assert.strictEqual((await call('/api/admin/schemas/TA255L/2')).status, 404);
  assert.strictEqual((await call('/api/admin/schemas/ESP32-DEVKIT-V1/1')).status, 404);
});

test('GET config ของเครื่อง: ยังไม่เคยสำเร็จ reported null · สำเร็จแล้วได้ค่าที่ใช้อยู่', async (t) => {
  const { call, queue } = await setup(t);
  assert.deepStrictEqual(await (await call(`/api/admin/devices/${DEV}/config`)).json(), { device_id: DEV, reported: null });
  const { command } = await (await putConfig(call, DEV, { meitrack: { led_off: true } })).json();
  queue.transition(command.command_id, 'SUCCESS');
  const cfg = await (await call(`/api/admin/devices/${DEV}/config`)).json();
  assert.strictEqual(cfg.reported.config_version, 1);
  assert.deepStrictEqual(cfg.reported.settings, { meitrack: { led_off: true } });
});

test('POST firmware → 400 ข้อความไทย', async (t) => {
  const { call } = await setup(t);
  const res = await call(`/api/admin/devices/${DEV}/firmware`, { method: 'POST', body: Buffer.alloc(100), headers: { 'Content-Type': 'application/octet-stream' } });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /firmware/);
});

test('body ไม่ใช่ JSON หรือใหญ่เกิน 64 KB → 400 และ server ยังทำงาน', async (t) => {
  const { call } = await setup(t);
  assert.strictEqual((await call(`/api/admin/devices/${DEV}/config`, { method: 'PUT', body: '{ bad' })).status, 400);
  const big = JSON.stringify({ settings: { meitrack: { pad: 'x'.repeat(70 * 1024) } } });
  assert.strictEqual((await call(`/api/admin/devices/${DEV}/config`, { method: 'PUT', body: big })).status, 400);
  assert.strictEqual((await call('/api/gw/devices')).status, 200);
});

test('job ที่ไม่มี และ path ที่ไม่รู้จัก → 404', async (t) => {
  const { call } = await setup(t);
  assert.strictEqual((await call('/api/gw/jobs/hub-none')).status, 404);
  assert.strictEqual((await call('/api/other')).status, 404);
});

test('HTTP ฟังที่ 127.0.0.1 เป็นค่าเริ่มต้น', async (t) => {
  const { server } = await setup(t);
  assert.strictEqual(server.address().address, '127.0.0.1');
});
