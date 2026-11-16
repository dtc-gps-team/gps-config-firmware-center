// ทดสอบการตรวจจับ "กล่องหลุดระหว่างทำคำสั่ง" โดยจำลองกล่องด้วย ws client (ไม่ต้องใช้กล่องจริง)
// รัน: node scripts/test-disconnect.js
// สคริปต์จะเปิด ws-gateway ตัวใหม่บนพอร์ตว่าง + data dir ชั่วคราว (ไม่แตะตัวที่รันอยู่ / data/db.json)
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const GRACE = 5;
const REBOOT_TIMEOUT = 20;
const DELIVERY_TIMEOUT = 8;
const ADMIN = 'test-admin-token-0123456789';
const DEV_TOKEN = 'test-device-token-1234';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let base;
const webhooks = [];
const results = [];

function check(name, ok, info = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}

async function api(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
const job = (id) => api('GET', '/api/admin/jobs/' + id);
const device = (id) => api('GET', '/api/admin/devices/' + id);

// กล่องจำลอง: เก็บ message ที่ได้รับ และรอ message ตามเงื่อนไขได้
class FakeBox {
  constructor(id) { this.id = id; this.inbox = []; this.waiters = []; }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(base.replace('http', 'ws') + '/ws/device', {
        headers: { Authorization: 'Bearer ' + DEV_TOKEN, 'X-Device-Id': this.id },
      });
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        const w = this.waiters.find((x) => x.pred(m));
        if (!w) return this.inbox.push(m);
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      });
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  waitFor(pred, ms = 5000) {
    const hit = this.inbox.find(pred);
    if (hit) { this.inbox.splice(this.inbox.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => { clearTimeout(t); resolve(m); } };
      const t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error(`${this.id}: timeout waiting message`)); }, ms);
      this.waiters.push(w);
    });
  }

  send(obj) { this.ws.send(JSON.stringify(obj)); }

  async hello(fw = '1.0.0', cfgVer = 1) {
    this.send({ type: 'HELLO', hardware_model: 'esp32-test', firmware_version: fw, schema_version: 1, config_version: cfgVer, boot_id: 'boot-' + Date.now() });
    return this.waitFor((m) => m.type === 'WELCOME');
  }

  async status(command_id, status, extra = {}) {
    this.send({ type: 'COMMAND_STATUS', command_id, status, ...extra });
    return this.waitFor((m) => (m.type === 'STATUS_ACK' || m.type === 'ERROR') && m.command_id === command_id);
  }

  close() {
    return new Promise((resolve) => { this.ws.once('close', resolve); this.ws.close(); });
  }

  // ตัด TCP ทิ้งแบบไม่ส่ง close frame (เหมือนไฟดับ/หลุดเน็ต)
  drop() {
    return new Promise((resolve) => { this.ws.once('close', resolve); this.ws.terminate(); });
  }
}

async function startBox(id, fw) {
  const box = new FakeBox(id);
  await box.connect();
  await box.hello(fw);
  return box;
}

async function waitJob(id, pred, ms) {
  const end = Date.now() + ms;
  let j;
  while (Date.now() < end) {
    j = await job(id);
    if (pred(j)) return j;
    await sleep(500);
  }
  return j;
}

// ---------------------------------------------------------------- scenarios

// 1 + 5: ACKNOWLEDGED แล้วหลุด -> FAILED/DEVICE_DISCONNECTED; ส่ง SUCCESS ช้า -> ยัง FAILED + LATE_REPORT
async function testDisconnectThenLateReport() {
  const box = await startBox('T-DISC');
  const created = await api('POST', '/api/admin/devices/T-DISC/commands/config-update', { target_config_version: 2 });
  const cmd = await box.waitFor((m) => m.type === 'COMMAND' && m.command_id === created.command_id);
  await box.status(cmd.command_id, 'ACKNOWLEDGED');
  const t0 = Date.now();
  await box.drop();

  let d;
  for (let i = 0; i < 20 && !(d = await device('T-DISC')).disconnected_at; i++) await sleep(100); // รอ server เห็นว่า socket ปิด
  check('[1] ปิด socket แล้ว device.disconnected_at ถูกตั้ง', !!d.disconnected_at, d.disconnected_at);

  const j = await waitJob(cmd.command_id, (x) => x.status === 'FAILED', (GRACE + 10) * 1000);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const ev = j.events.at(-1);
  check('[1] ACKNOWLEDGED + หลุด -> FAILED / DEVICE_DISCONNECTED ภายใน grace+10s',
    j.status === 'FAILED' && j.error_code === 'DEVICE_DISCONNECTED', `${j.status}/${j.error_code} หลัง ${sec}s`);
  check('[1] event FAILED มี reason + last_status=ACKNOWLEDGED',
    ev.status === 'FAILED' && ev.details.reason === 'DEVICE_DISCONNECTED' && ev.details.last_status === 'ACKNOWLEDGED', JSON.stringify(ev.details));
  check('[1] error_message ภาษาไทย', j.error_message === 'กล่องหลุดการเชื่อมต่อเกินเวลาที่กำหนดระหว่างทำคำสั่ง', j.error_message);

  await sleep(500);
  const hook = webhooks.find((w) => w.command_id === cmd.command_id);
  check('[6] webhook COMMAND_FINISHED ส่ง error_code DEVICE_DISCONNECTED',
    hook && hook.event === 'COMMAND_FINISHED' && hook.success === false && hook.error_code === 'DEVICE_DISCONNECTED',
    hook ? `${hook.event} success=${hook.success} error_code=${hook.error_code}` : 'ไม่ได้รับ webhook');

  // กล่องกลับมาแล้วรายงาน SUCCESS ช้า
  const box2 = await startBox('T-DISC');
  const d2 = await device('T-DISC');
  check('[2] HELLO ใหม่แล้ว disconnected_at ถูกลบ', d2.disconnected_at === undefined, String(d2.disconnected_at));
  const ack = await box2.status(cmd.command_id, 'SUCCESS', { reported_config_version: 2 });
  const j2 = await job(cmd.command_id);
  const late = j2.events.filter((e) => e.status === 'LATE_REPORT');
  check('[5] SUCCESS หลัง FAILED -> STATUS_ACK ตอบ FAILED (duplicate)', ack.type === 'STATUS_ACK' && ack.status === 'FAILED' && ack.duplicate === true, JSON.stringify(ack));
  check('[5] สถานะยังเป็น FAILED / DEVICE_DISCONNECTED', j2.status === 'FAILED' && j2.error_code === 'DEVICE_DISCONNECTED', `${j2.status}/${j2.error_code}`);
  check('[5] มี event LATE_REPORT เก็บ status/เวอร์ชันที่กล่องรายงาน',
    late.length === 1 && late[0].details.reported_status === 'SUCCESS' && late[0].details.reported_config_version === 2, JSON.stringify(late[0]?.details));
  check('[5] completed_at / updated_at ไม่เปลี่ยน', j2.completed_at === j.completed_at && j2.updated_at === j.updated_at);

  // ส่งซ้ำอีกรอบ (เช่น reconnect แล้วส่งใหม่) -> ไม่เพิ่ม LATE_REPORT ซ้ำ
  await box2.status(cmd.command_id, 'SUCCESS', { reported_config_version: 2 });
  const j3 = await job(cmd.command_id);
  check('[5] รายงานช้าเดิมซ้ำ ไม่บันทึกซ้ำ', j3.events.filter((e) => e.status === 'LATE_REPORT').length === 1);
  await box2.close();
}

// 2: หลุดแล้วต่อกลับ + HELLO ภายใน grace -> ไม่ FAILED
async function testReconnectWithinGrace() {
  const box = await startBox('T-RECON');
  const created = await api('POST', '/api/admin/devices/T-RECON/commands/config-update', { target_config_version: 3 });
  const cmd = await box.waitFor((m) => m.type === 'COMMAND' && m.command_id === created.command_id);
  await box.status(cmd.command_id, 'ACKNOWLEDGED');
  await box.status(cmd.command_id, 'DOWNLOADING', { progress_percent: 10 });
  await box.drop();
  await sleep(2000);
  const box2 = await startBox('T-RECON');
  await sleep((GRACE + 8) * 1000);
  const j = await job(cmd.command_id);
  check('[2] ต่อกลับ + HELLO ภายใน grace -> ไม่ FAILED', j.status === 'DOWNLOADING' && j.error_code === null, `${j.status}/${j.error_code}`);
  await box2.close();
}

// 3: REBOOTING แล้วหลุด -> ไม่ FAILED ภายใน grace, รอ rebootTimeout เดิม
async function testRebooting() {
  const box = await startBox('T-REBOOT', '1.0.0');
  const created = await api('POST', '/api/admin/devices/T-REBOOT/commands/firmware-update', { target_firmware_version: '1.1.0' });
  const cmd = await box.waitFor((m) => m.type === 'COMMAND' && m.command_id === created.command_id);
  for (const s of ['ACKNOWLEDGED', 'DOWNLOADING', 'VALIDATING', 'INSTALLING', 'REBOOTING']) await box.status(cmd.command_id, s);
  const t0 = Date.now();
  await box.drop();
  await sleep((GRACE + 8) * 1000);
  const j = await job(cmd.command_id);
  check('[3] REBOOTING + หลุด -> ไม่ FAILED หลัง grace', j.status === 'REBOOTING', `${j.status}/${j.error_code}`);
  const j2 = await waitJob(cmd.command_id, (x) => x.status === 'FAILED', (REBOOT_TIMEOUT + 10) * 1000);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  check('[3] REBOOTING ไม่กลับมา -> FAILED / DEVICE_NO_RESPONSE ตาม rebootTimeout เดิม',
    j2.status === 'FAILED' && j2.error_code === 'DEVICE_NO_RESPONSE' && sec >= REBOOT_TIMEOUT, `${j2.status}/${j2.error_code} หลัง ${sec}s (rebootTimeout=${REBOOT_TIMEOUT}s)`);
}

// 3b: INSTALLING แล้วหลุด -> ไม่ FAILED ภายใน grace, ใช้ rebootTimeout เหมือน REBOOTING
async function testInstalling() {
  const box = await startBox('T-INST', '1.0.0');
  const created = await api('POST', '/api/admin/devices/T-INST/commands/firmware-update', { target_firmware_version: '1.1.0' });
  const cmd = await box.waitFor((m) => m.type === 'COMMAND' && m.command_id === created.command_id);
  for (const s of ['ACKNOWLEDGED', 'DOWNLOADING', 'VALIDATING', 'INSTALLING']) await box.status(cmd.command_id, s);
  const t0 = Date.now();
  await box.drop();
  await sleep((GRACE + 8) * 1000);
  const j = await job(cmd.command_id);
  check('[3b] INSTALLING + หลุด -> ไม่ FAILED หลัง grace', j.status === 'INSTALLING', `${j.status}/${j.error_code}`);
  const j2 = await waitJob(cmd.command_id, (x) => x.status === 'FAILED', (REBOOT_TIMEOUT + 10) * 1000);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  check('[3b] INSTALLING ไม่กลับมา -> FAILED / DEVICE_NO_RESPONSE ตาม rebootTimeout',
    j2.status === 'FAILED' && j2.error_code === 'DEVICE_NO_RESPONSE' && sec >= REBOOT_TIMEOUT, `${j2.status}/${j2.error_code} หลัง ${sec}s (rebootTimeout=${REBOOT_TIMEOUT}s)`);
}

// 4: คำสั่ง PENDING ตอนกล่องออฟไลน์ -> deliveryTimeout เดิม (DEVICE_OFFLINE)
async function testPendingOffline() {
  const box = await startBox('T-PEND');
  await box.drop(); // disconnected_at ถูกตั้งไว้ก่อนสร้างคำสั่ง
  const created = await api('POST', '/api/admin/devices/T-PEND/commands/config-update', { target_config_version: 4 });
  const t0 = Date.now();
  await sleep((GRACE + 1.5) * 1000);
  const j = await job(created.command_id);
  check('[4] PENDING ตอนออฟไลน์ ไม่โดนกติกา grace', j.status === 'PENDING', `${j.status}/${j.error_code}`);
  const j2 = await waitJob(created.command_id, (x) => x.status !== 'PENDING', (DELIVERY_TIMEOUT + 10) * 1000);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  check('[4] PENDING -> FAILED / DEVICE_OFFLINE ตาม deliveryTimeout เดิม',
    j2.status === 'FAILED' && j2.error_code === 'DEVICE_OFFLINE' && sec >= DELIVERY_TIMEOUT, `${j2.status}/${j2.error_code} หลัง ${sec}s (deliveryTimeout=${DELIVERY_TIMEOUT}s)`);
}

// connection เก่าถูกแทนด้วยตัวใหม่ (close 4000) -> ไม่ตั้ง disconnected_at
async function testReplaced() {
  const box = await startBox('T-REPL');
  const created = await api('POST', '/api/admin/devices/T-REPL/commands/config-update', { target_config_version: 5 });
  const cmd = await box.waitFor((m) => m.type === 'COMMAND' && m.command_id === created.command_id);
  await box.status(cmd.command_id, 'ACKNOWLEDGED');
  const closed = new Promise((r) => box.ws.once('close', (code) => r(code)));
  const box2 = new FakeBox('T-REPL');
  await box2.connect(); // ยังไม่ HELLO เพื่อดูว่า disconnected_at ไม่ถูกตั้งจากการปิดตัวเก่า
  const code = await closed;
  await sleep(300);
  const d = await device('T-REPL');
  check('[replace] ตัวเก่าปิดด้วย 4000 แล้ว ไม่ตั้ง disconnected_at', code === 4000 && d.disconnected_at === undefined, `close=${code} disconnected_at=${d.disconnected_at}`);
  await sleep((GRACE + 6) * 1000);
  const j = await job(cmd.command_id);
  check('[replace] คำสั่งไม่ FAILED', j.status === 'ACKNOWLEDGED', `${j.status}/${j.error_code}`);
  await box2.close();
}

// ---------------------------------------------------------------- main

(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-gateway-test-'));

  const hookServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { webhooks.push(JSON.parse(body)); res.end('ok'); });
  });
  await new Promise((r) => hookServer.listen(0, '127.0.0.1', r));

  // ค่าที่ส่งผ่าน env มีลำดับเหนือกว่า .env
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_TOKEN: ADMIN,
      DATA_DIR: dataDir,
      AUTO_REGISTER_TOKEN: DEV_TOKEN,
      MIN_DEVICE_TOKEN_LENGTH: '4',
      FIRMWARE_SETTLE_SEC: '0',
      TLS_CERT_FILE: '',
      TLS_KEY_FILE: '',
      HEARTBEAT_INTERVAL_SEC: '10',
      COMMAND_TTL_SEC: '86400',
      COMMAND_DISCONNECT_GRACE_SEC: String(GRACE),
      COMMAND_DELIVERY_TIMEOUT_SEC: String(DELIVERY_TIMEOUT),
      COMMAND_RESPONSE_TIMEOUT_SEC: '120',
      COMMAND_REBOOT_TIMEOUT_SEC: String(REBOOT_TIMEOUT),
      NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${hookServer.address().port}/hook`,
      NOTIFY_WEBHOOK_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (c) => (log += c));
  server.stderr.on('data', (c) => (log += c));

  let code = 1;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + '/health')).ok) break; } catch {}
      if (i > 50) throw new Error('ws-gateway (test) ไม่ start:\n' + log);
      await sleep(100);
    }
    console.log(`ws-gateway (test) port ${port}, grace=${GRACE}s, reboot=${REBOOT_TIMEOUT}s, delivery=${DELIVERY_TIMEOUT}s\n`);

    const scenarios = [testDisconnectThenLateReport, testReconnectWithinGrace, testRebooting, testInstalling, testPendingOffline, testReplaced];
    const outcomes = await Promise.allSettled(scenarios.map((s) => s()));
    outcomes.forEach((o, i) => { if (o.status === 'rejected') check(`${scenarios[i].name} ทำงานจบ`, false, o.reason.message); });

    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} ผ่าน`);
    code = failed ? 1 : 0;
  } catch (e) {
    console.error(e.message);
  } finally {
    server.kill();
    hookServer.close();
    await sleep(300);
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (code) console.log('\n--- server log ---\n' + log);
    process.exit(code);
  }
})();
