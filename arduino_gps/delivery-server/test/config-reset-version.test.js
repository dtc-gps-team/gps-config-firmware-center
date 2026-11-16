const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ADMIN = 'test-admin-token-0123456789';
const URL_RESET = '/api/admin/devices/BOX-TEST/config/reset-version';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); });
});

// ws-gateway จำลอง: กำหนดได้ว่ากล่องออนไลน์ไหม มีงานค้างไหม และส่งคำสั่งสำเร็จไหม
const gw = { online: true, commands: [], pushOk: true, pushes: [] };
const fakeGateway = http.createServer((req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/api/admin/devices/BOX-TEST') return json(200, { device_id: 'BOX-TEST', online: gw.online });
  if (req.method === 'GET' && req.url === '/api/admin/devices/BOX-TEST/commands') return json(200, gw.commands);
  if (req.method === 'POST' && req.url === '/api/admin/devices/BOX-TEST/commands/config-update') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      gw.pushes.push(JSON.parse(raw).target_config_version);
      if (gw.pushOk) json(201, { command_id: 'CMD-1', status: 'DELIVERED', events: [], nonce: 'x' });
      else json(409, { error: 'NOPE', message: 'ส่งไม่ได้' });
    });
    return undefined;
  }
  return json(404, {});
});

let dataDir, base, server;
const dbFile = () => path.join(dataDir, 'db.json');
const readDb = () => JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
const seed = (desired, reported) => ({
  devices: { 'BOX-TEST': { device_id: 'BOX-TEST', hardware_model: 'ESP32-DEVKIT-V1', schema_version: 2, token_hash: 'x', status: 'active', created_at: '2026-10-30T10:00:00.000Z', reported: { config_version: reported, schema_version: 2 }, last_report_at: null } },
  configs: { 'BOX-TEST': { device_id: 'BOX-TEST', schema_version: 2, config_version: desired, settings: { a: 1 }, updated_at: '2026-10-30T10:00:00.000Z', history: [{ config_version: desired - 1, settings: { a: 0 } }] } },
  firmware: [],
  downgradeAllow: {},
});
const reset = () => fetch(base + URL_RESET, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: '{}' });

async function startServer(desired, reported) {
  server?.kill();
  await sleep(200);
  fs.writeFileSync(dbFile(), JSON.stringify(seed(desired, reported)));
  const port = await freePort();
  base = `http://localhost:${port}`;
  server = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: { ...process.env, PORT: port, ADMIN_TOKEN: ADMIN, DATA_DIR: dataDir, GATEWAY_ADMIN_URL: `http://localhost:${fakeGateway.address().port}`, GATEWAY_ADMIN_TOKEN: ADMIN },
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/admin'); return; } catch (e) { await sleep(100); }
  }
  throw new Error('server did not start');
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-reset-'));
  await new Promise((r) => fakeGateway.listen(0, r));
});
after(() => { server?.kill(); fakeGateway.close(); });
beforeEach(() => { Object.assign(gw, { online: true, commands: [], pushOk: true, pushes: [] }); });

test('รีเซ็ตเป็น 1 ค่าตั้งเดิมไม่เปลี่ยน ล้างประวัติ และส่งเข้ากล่อง', async () => {
  await startServer(26, 26);
  const r = await reset();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.config_version, 1);
  assert.equal(body.command.command_id, 'CMD-1');
  assert.deepEqual(gw.pushes, [1]);
  const c = readDb().configs['BOX-TEST'];
  assert.equal(c.config_version, 1);
  assert.deepEqual(c.settings, { a: 1 });
  assert.deepEqual(c.history, []);
});

test('Server กับกล่องเลขไม่ตรงกัน -> ปฏิเสธ เพราะอาจทำให้กล่องไม่ได้รับค่า', async () => {
  await startServer(26, 1);
  const r = await reset();
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'CONFIG_NOT_IN_SYNC');
  assert.deepEqual(gw.pushes, []);
  assert.equal(readDb().configs['BOX-TEST'].config_version, 26);
});

test('กล่องออฟไลน์ -> ปฏิเสธ', async () => {
  await startServer(26, 26);
  gw.online = false;
  const r = await reset();
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'DEVICE_OFFLINE');
  assert.equal(readDb().configs['BOX-TEST'].config_version, 26);
});

test('กล่องมีงานค้าง -> ปฏิเสธ', async () => {
  await startServer(26, 26);
  gw.commands = [{ command_id: 'CMD-9', status: 'DOWNLOADING' }, { command_id: 'CMD-8', status: 'SUCCESS' }];
  const r = await reset();
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'DEVICE_BUSY');
  assert.equal(readDb().configs['BOX-TEST'].config_version, 26);
});

test('ส่งเข้ากล่องไม่ได้ -> คืนค่าเดิมทั้งเลขและประวัติ', async () => {
  await startServer(26, 26);
  gw.pushOk = false;
  const r = await reset();
  assert.equal(r.status, 502);
  const c = readDb().configs['BOX-TEST'];
  assert.equal(c.config_version, 26);
  assert.equal(c.history.length, 1);
});

test('เป็น 1 อยู่แล้ว -> ล้างประวัติอย่างเดียว ไม่ส่งเข้ากล่อง', async () => {
  await startServer(1, 1);
  const r = await reset();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).command, null);
  assert.deepEqual(gw.pushes, []);
  assert.deepEqual(readDb().configs['BOX-TEST'].history, []);
});
