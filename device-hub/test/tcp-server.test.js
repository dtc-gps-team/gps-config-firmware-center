'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { createTcpServer } = require('../src/core/tcp-server');
const { SAMPLE_IMEI, cceFrame, replyFrame } = require('./helpers/meitrack-fixtures');

const devices = new Map([[SAMPLE_IMEI, { model: 'TA255L', telemetryKey: 'k' }]]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await wait(10);
  }
  throw new Error('หมดเวลารอเงื่อนไข');
}

async function startServer(opts = {}) {
  const events = { online: [], offline: [], packets: [] };
  const server = createTcpServer({
    port: 0, host: '127.0.0.1', devices, log: () => {}, commandTimeoutMs: 300,
    onOnline: (imei) => events.online.push(imei),
    onOffline: (imei) => events.offline.push(imei),
    onPacket: (imei, packet, meta) => events.packets.push({ imei, packet, meta }),
    ...opts,
  });
  const port = await server.listen();
  return { server, port, events };
}

// กล่องปลอม: answer(code, args) คืน body ที่จะตอบ หรือ null = ไม่ตอบ
function fakeBox(port, { answer = () => null } = {}) {
  const sock = net.connect(port, '127.0.0.1');
  const received = [];
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString('latin1');
    let m;
    while ((m = buf.match(/^@@(.)\d+,(\d+),([^*]*)\*[0-9A-F]{2}\r\n/))) {
      buf = buf.slice(m[0].length);
      const [code, ...args] = m[3].split(',');
      received.push(m[3]);
      const body = answer(code, args, m[1]);
      if (body !== null) sock.write(replyFrame(m[1], code, body, m[2]));
    }
  });
  sock.on('error', () => {});
  const closed = new Promise((r) => sock.on('close', r));
  return { sock, received, closed };
}

const e91 = (code) => (code === 'E91' ? 'TA255L-V028,12345678' : null);

test('กล่องในทะเบียนต่อได้ → onOnline และได้แพ็กเก็ตพร้อม remainingCache', async (t) => {
  const { server, port, events } = await startServer();
  t.after(() => server.close());
  const box = fakeBox(port, { answer: e91 });
  t.after(() => box.sock.destroy());
  box.sock.write(cceFrame({ remainingCache: 3 }));
  await until(() => events.packets.length === 1);
  assert.deepStrictEqual(events.online, [SAMPLE_IMEI]);
  assert.ok(server.isOnline(SAMPLE_IMEI));
  assert.ok(server.lastSeenAt(SAMPLE_IMEI));
  assert.strictEqual(events.packets[0].packet.lat, 22.513638);
  assert.strictEqual(events.packets[0].meta.remainingCache, 3);
});

test('IMEI ไม่อยู่ในทะเบียน → ถูกตัดสาย ไม่มี onOnline', async (t) => {
  const { server, port, events } = await startServer();
  t.after(() => server.close());
  const box = fakeBox(port);
  box.sock.write(cceFrame({ imei: '999999999999999' }));
  await box.closed;
  assert.deepStrictEqual(events.online, []);
  assert.strictEqual(events.packets.length, 0);
});

test('sendCommand ส่ง @@ ถูกรูปแบบและได้คำตอบ', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const box = fakeBox(port, { answer: (code) => (code === 'A12' ? 'OK' : e91(code)) });
  t.after(() => box.sock.destroy());
  box.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  const reply = await server.sendCommand(SAMPLE_IMEI, 'A12,6');
  assert.deepStrictEqual(reply, { type: 'A12', body: 'OK' });
  assert.ok(box.received.includes(`A12,6`));
});

test('คำตอบที่เป็นแพ็กเก็ตพิกัด (A10) คืน type CCE และยังส่งแพ็กเก็ตต่อ', async (t) => {
  const { server, port, events } = await startServer();
  t.after(() => server.close());
  let box;
  box = fakeBox(port, {
    answer: (code, args, id) => {
      if (code === 'A10') {
        box.sock.write(cceFrame({ identifier: id }));
        return null;
      }
      return e91(code);
    },
  });
  t.after(() => box.sock.destroy());
  box.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  const reply = await server.sendCommand(SAMPLE_IMEI, 'A10');
  assert.strictEqual(reply.type, 'CCE');
  await until(() => events.packets.length === 2);
});

test('sendCommand ตอนไม่มีสาย → DEVICE_OFFLINE', async (t) => {
  const { server } = await startServer();
  t.after(() => server.close());
  await assert.rejects(server.sendCommand(SAMPLE_IMEI, 'A12,6'), { code: 'DEVICE_OFFLINE' });
});

test('กล่องไม่ตอบใน commandTimeoutMs → DEVICE_NO_REPLY', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const box = fakeBox(port, { answer: e91 });
  t.after(() => box.sock.destroy());
  box.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  await assert.rejects(server.sendCommand(SAMPLE_IMEI, 'A12,6'), { code: 'DEVICE_NO_REPLY' });
});

test('สายหลุดระหว่างรอคำตอบ แล้วกล่องไม่กลับมา → onOffline ทันที และ DEVICE_NO_REPLY เมื่อครบเวลารอ', async (t) => {
  const { server, port, events } = await startServer({ commandTimeoutMs: 500 });
  t.after(() => server.close());
  const box = fakeBox(port, { answer: (code) => { if (code === 'A12') box.sock.destroy(); return e91(code); } });
  box.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  const startedAt = Date.now();
  const reply = server.sendCommand(SAMPLE_IMEI, 'A12,6');
  await until(() => events.offline.length === 1);
  assert.strictEqual(server.isOnline(SAMPLE_IMEI), false);
  await assert.rejects(reply, { code: 'DEVICE_NO_REPLY' });
  // ไม่ตัดทิ้งตอนสายปิด: รอให้กล่องมีโอกาสตอบทางสายใหม่จนครบ commandTimeoutMs (docs/33 §11.6 ข้อ 3)
  assert.ok(Date.now() - startedAt >= 450, `ตัดทิ้งเร็วเกินไป ${Date.now() - startedAt} ms`);
});

test('สายหลุดระหว่างรอคำตอบ แล้วกล่องตอบทางสายใหม่ → ได้คำตอบ (docs/33 §11.6 ข้อ 3)', async (t) => {
  const { server, port } = await startServer({ commandTimeoutMs: 2000 });
  t.after(() => server.close());
  let askedId = null;
  const first = fakeBox(port, {
    answer: (code, args, id) => {
      if (code === 'A12') {
        askedId = id;
        first.sock.destroy(); // สายเก่าหลุดก่อนตอบ
        return null;
      }
      return e91(code);
    },
  });
  first.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  const reply = server.sendCommand(SAMPLE_IMEI, 'A12,6');
  await first.closed;
  // กล่องต่อสายใหม่ แล้วตอบคำสั่งเดิมด้วย identifier เดิม
  const second = fakeBox(port, { answer: e91 });
  t.after(() => second.sock.destroy());
  second.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  second.sock.write(replyFrame(askedId, 'A12', 'OK', SAMPLE_IMEI));
  assert.deepStrictEqual(await reply, { type: 'A12', body: 'OK' });
});

test('กล่องเงียบเกินเกณฑ์ (ยังไม่รู้รอบส่ง = ใช้ค่าต่ำสุด) → ตัดสาย onOffline (docs/33 §11.6 ข้อ 4)', async (t) => {
  const { server, port, events } = await startServer({ idleMinMs: 300 });
  t.after(() => server.close());
  const box = fakeBox(port, { answer: e91 });
  t.after(() => box.sock.destroy());
  box.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  await box.closed;
  await until(() => events.offline.length === 1);
  assert.deepStrictEqual(events.offline, [SAMPLE_IMEI]);
  assert.strictEqual(server.isOnline(SAMPLE_IMEI), false);
});

test('ส่งข้อมูลถี่กว่าเกณฑ์ต่ำสุด → ไม่ถูกตัดสาย', async (t) => {
  const { server, port, events } = await startServer({ idleMinMs: 300 });
  t.after(() => server.close());
  const box = fakeBox(port, { answer: e91 });
  t.after(() => box.sock.destroy());
  for (let i = 0; i < 6; i++) {
    box.sock.write(cceFrame());
    await wait(150);
  }
  assert.strictEqual(server.isOnline(SAMPLE_IMEI), true);
  assert.deepStrictEqual(events.offline, []);
});

test('เกณฑ์ปรับตามรอบส่งจริงของกล่อง (3 เท่าของช่วงห่างที่เห็น) แม้รอบส่งนานกว่าค่าต่ำสุด', async (t) => {
  const { server, port, events } = await startServer({ idleMinMs: 150 });
  t.after(() => server.close());
  const box = fakeBox(port, { answer: e91 });
  t.after(() => box.sock.destroy());
  // รอบส่งจริง ~120 ms ต่ำกว่าค่าต่ำสุดยังไม่เป็นไร แล้วหยุดไป 250 ms (นานกว่าค่าต่ำสุด แต่ไม่ถึง 3 เท่าของรอบ 120)
  for (let i = 0; i < 4; i++) {
    box.sock.write(cceFrame());
    await wait(120);
  }
  await wait(130);
  box.sock.write(cceFrame());
  await wait(50);
  assert.strictEqual(server.isOnline(SAMPLE_IMEI), true);
  assert.deepStrictEqual(events.offline, []);
});

test('ช่วงห่างที่เรียนรู้ติดไปกับกล่อง ต่อสายใหม่ไม่เริ่มนับจากค่าต่ำสุด', async (t) => {
  const { server, port, events } = await startServer({ idleMinMs: 150 });
  t.after(() => server.close());
  const first = fakeBox(port, { answer: e91 });
  for (let i = 0; i < 3; i++) {
    first.sock.write(cceFrame());
    await wait(120);
  }
  first.sock.destroy();
  await until(() => events.offline.length === 1);
  const second = fakeBox(port, { answer: e91 });
  t.after(() => second.sock.destroy());
  second.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  await wait(250); // นานกว่าค่าต่ำสุด 150 แต่ไม่ถึง 3 × 120
  assert.strictEqual(server.isOnline(SAMPLE_IMEI), true);
});

test('กล่องรอบส่งนานกว่าค่าต่ำสุด ถูกตัดผิดได้ครั้งเดียว ต่อกลับแล้วเกณฑ์ปรับตามช่วงห่างจริง', async (t) => {
  const { server, port, events } = await startServer({ idleMinMs: 100 });
  t.after(() => server.close());
  const first = fakeBox(port, { answer: e91 });
  first.sock.write(cceFrame());
  await first.closed; // ยังไม่รู้รอบส่ง ถูกตัดที่ค่าต่ำสุด
  await until(() => events.offline.length === 1);
  await wait(150); // กล่องต่อกลับตามรอบส่งของมัน (~250 ms หลังข้อมูลครั้งก่อน)
  const second = fakeBox(port, { answer: e91 });
  t.after(() => second.sock.destroy());
  second.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  await wait(300); // นานกว่าค่าต่ำสุดมาก แต่ไม่ถึง 3 × ~250
  assert.strictEqual(server.isOnline(SAMPLE_IMEI), true);
  assert.strictEqual(events.offline.length, 1);
});

test('ต่อแล้วส่ง E91 เองและเก็บเวอร์ชัน firmware', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const box = fakeBox(port, { answer: e91 });
  t.after(() => box.sock.destroy());
  box.sock.write(cceFrame());
  await until(() => server.firmwareVersion(SAMPLE_IMEI) !== null);
  assert.strictEqual(server.firmwareVersion(SAMPLE_IMEI), 'V028');
});

test('สายใหม่ของ IMEI เดิมแทนสายเก่า', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const first = fakeBox(port, { answer: e91 });
  first.sock.write(cceFrame());
  await until(() => server.isOnline(SAMPLE_IMEI));
  const second = fakeBox(port, { answer: (code) => (code === 'A12' ? 'OK' : e91(code)) });
  t.after(() => second.sock.destroy());
  second.sock.write(cceFrame());
  await first.closed;
  assert.deepStrictEqual(await server.sendCommand(SAMPLE_IMEI, 'A12,6'), { type: 'A12', body: 'OK' });
});

test('IP เดียวเปิดสายที่ยังไม่ระบุตัวเกิน 5 สาย → สายที่ 6 ถูกตัด', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const boxes = [];
  for (let i = 0; i < 5; i++) boxes.push(fakeBox(port));
  t.after(() => boxes.forEach((b) => b.sock.destroy()));
  await wait(100);
  const sixth = fakeBox(port);
  await sixth.closed;
  assert.ok(boxes.every((b) => !b.sock.destroyed));
});

test('ข้อมูลขยะไม่มี $$ เกิน 64 KB → ตัดสาย', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const box = fakeBox(port);
  box.sock.write(Buffer.alloc(70 * 1024, 0x41));
  await box.closed;
});

test('กล่องที่ระบุตัวแล้วหลายเครื่องจาก IP เดียวกัน (ซิมหลัง CGNAT) ไม่ถูกตัด', async (t) => {
  const many = new Map();
  for (let i = 1; i <= 8; i++) many.set(`35000000000000${i}`.slice(-15), { model: 'TA255L', telemetryKey: `k${i}` });
  const { server, port, events } = await startServer({ devices: many });
  t.after(() => server.close());
  const boxes = [];
  for (const imei of many.keys()) {
    const b = fakeBox(port, { answer: e91 });
    b.sock.write(cceFrame({ imei }));
    boxes.push(b);
    await until(() => events.online.includes(imei));
  }
  t.after(() => boxes.forEach((b) => b.sock.destroy()));
  for (const imei of many.keys()) assert.ok(server.isOnline(imei), imei);
});

test('ค่าเริ่มต้นรับได้ทั้ง IPv4 และ IPv6 (ssh tunnel บน Windows ส่ง localhost มาทาง ::1)', async (t) => {
  const server = createTcpServer({ port: 0, devices, log: () => {} });
  const port = await server.listen();
  t.after(() => server.close());
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise((resolve, reject) => {
      const s = net.connect(port, host, () => { s.destroy(); resolve(); });
      s.on('error', reject);
    });
  }
});
