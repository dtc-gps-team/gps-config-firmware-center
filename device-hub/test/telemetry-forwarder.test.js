'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTelemetryForwarder } = require('../src/core/telemetry-forwarder');

const IMEI = '353358017784062';
const devices = new Map([[IMEI, { model: 'TA255L', telemetryKey: 'k1' }]]);
for (let i = 1; i <= 4; i++) devices.set(`35000000000000${i}`, { model: 'TA255L', telemetryKey: `x${i}` });

function setup({ status = () => 201, ...opts } = {}) {
  const calls = [];
  const logs = [];
  let clock = 1_000_000;
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), method: init.method });
    const s = status(calls.length);
    if (s instanceof Error) throw s;
    return { ok: s >= 200 && s < 300, status: s };
  };
  const fwd = createTelemetryForwarder({
    backendUrl: 'http://b/api/v1', devices, fetchImpl, now: () => clock, log: (m) => logs.push(m), ...opts,
  });
  return { fwd, calls, logs, tick: (ms) => { clock += ms; } };
}

const report = (n) => ({ device_id: IMEI, latitude: 1, longitude: 2, timestamp: String(n) });

test('ส่งไป URL ถูกต้องพร้อม key ของเครื่อง', async () => {
  const { fwd, calls } = setup();
  fwd.enqueue(IMEI, report(1));
  await fwd.pump();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, `http://b/api/v1/device-sync/${IMEI}/telemetry/k1`);
  assert.strictEqual(fwd.size(IMEI), 0);
});

test('ไม่เกิน 60 ครั้ง/นาที/เครื่อง แล้วส่งที่เหลือในนาทีถัดไป', async () => {
  const { fwd, calls, tick } = setup();
  for (let i = 0; i < 70; i++) fwd.enqueue(IMEI, report(i));
  await fwd.pump();
  assert.strictEqual(calls.length, 60);
  tick(60_000);
  await fwd.pump();
  assert.strictEqual(calls.length, 70);
});

test('ไม่เกิน 240 ครั้ง/นาทีรวมทุกเครื่อง', async () => {
  const { fwd, calls } = setup();
  for (const imei of devices.keys()) for (let i = 0; i < 60; i++) fwd.enqueue(imei, report(i));
  await fwd.pump();
  assert.strictEqual(calls.length, 240);
});

test('ส่งตามลำดับที่เข้ามาของแต่ละเครื่อง', async () => {
  const { fwd, calls } = setup();
  for (let i = 0; i < 5; i++) fwd.enqueue(IMEI, report(i));
  await fwd.pump();
  assert.deepStrictEqual(calls.map((c) => c.body.timestamp), ['0', '1', '2', '3', '4']);
});

test('5xx หรือเครือข่ายล่ม → เก็บไว้ลองใหม่รอบถัดไป', async () => {
  let fail = true;
  const { fwd, calls } = setup({ status: () => (fail ? 503 : 201) });
  fwd.enqueue(IMEI, report(1));
  await fwd.pump();
  assert.strictEqual(fwd.size(IMEI), 1);
  fail = false;
  await fwd.pump();
  assert.strictEqual(fwd.size(IMEI), 0);
  assert.strictEqual(calls.length, 2);

  const net = setup({ status: (n) => (n === 1 ? new Error('ECONNREFUSED') : 201) });
  net.fwd.enqueue(IMEI, report(1));
  await net.fwd.pump();
  assert.strictEqual(net.fwd.size(IMEI), 1);
  await net.fwd.pump();
  assert.strictEqual(net.fwd.size(IMEI), 0);
});

test('400/401 → ทิ้งจุดนั้นพร้อม log ไม่วนส่งซ้ำ', async () => {
  const { fwd, calls, logs } = setup({ status: (n) => (n === 1 ? 400 : 401) });
  fwd.enqueue(IMEI, report(1));
  fwd.enqueue(IMEI, report(2));
  await fwd.pump();
  await fwd.pump();
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(fwd.size(IMEI), 0);
  assert.ok(logs.some((l) => l.includes('400')));
  assert.ok(!logs.join(' ').includes('k1'), 'ห้าม log key');
});

test('เกิน 5000 จุดต่อเครื่อง → ทิ้งจุดเก่าสุด', async () => {
  const { fwd, calls } = setup();
  for (let i = 0; i < 5001; i++) fwd.enqueue(IMEI, report(i));
  assert.strictEqual(fwd.size(IMEI), 5000);
  await fwd.pump();
  assert.strictEqual(calls[0].body.timestamp, '1');
});

test('IMEI ไม่อยู่ในทะเบียน → ไม่ส่งและ log', async () => {
  const { fwd, calls, logs } = setup();
  fwd.enqueue('999999999999999', report(1));
  await fwd.pump();
  assert.strictEqual(calls.length, 0);
  assert.ok(logs.length > 0);
});

test('backendUrl เป็น null → ไม่ส่งและไม่ throw', async () => {
  const { calls } = setup();
  const fwd = createTelemetryForwarder({ backendUrl: null, devices, fetchImpl: async () => { throw new Error('ไม่ควรถูกเรียก'); }, log: () => {} });
  fwd.enqueue(IMEI, report(1));
  await fwd.pump();
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(fwd.size(), 0);
});
