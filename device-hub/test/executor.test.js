'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCommandQueue } = require('../src/core/command-queue');
const { createExecutor } = require('../src/core/executor');
const { planCommands, parseReadback } = require('../src/protocols/meitrack/fields');

const DEV = '353358017784062';
const T0 = Date.parse('2026-11-19T00:00:00.000Z');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup({ reply = () => 'OK', online = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-hub-exec-'));
  let clock = T0;
  const now = () => clock;
  const queue = createCommandQueue({ file: path.join(dir, 'q.json'), ttlHours: 24, now });
  const sent = [];
  const tcp = {
    online,
    isOnline() { return this.online; },
    async sendCommand(imei, command) {
      sent.push(command);
      const r = await reply(command, sent.length);
      if (r instanceof Error) throw r;
      return { type: command.split(',')[0], body: r };
    },
  };
  const executor = createExecutor({ queue, tcp, parseReadback, now, log: () => {} });
  const enqueue = (settings) => queue.create(DEV, settings, planCommands(settings).steps);
  const status = (job) => queue.get(job.command_id);
  async function settle(job, until = (j) => ['SUCCESS', 'FAILED', 'EXPIRED'].includes(j.status) || j.status === 'QUEUED' && j.attempts > 0) {
    for (let i = 0; i < 200; i++) {
      if (until(status(job))) return status(job);
      await wait(5);
    }
    throw new Error(`งานไม่จบ: ${JSON.stringify(status(job).status)}`);
  }
  const packet = (eventCode, secondsAfterT0) => ({ eventCode, time: new Date(T0 + secondsAfterT0 * 1000).toISOString() });
  return { queue, tcp, sent, executor, enqueue, status, settle, packet, tick: (ms) => { clock += ms; } };
}

const offline = () => Object.assign(new Error('offline'), { code: 'DEVICE_OFFLINE' });
const noReply = () => Object.assign(new Error('no reply'), { code: 'DEVICE_NO_REPLY' });

test('ack: B31 ตอบ OK → SUCCESS', async () => {
  const s = setup();
  const job = s.enqueue({ meitrack: { led_off: true } });
  await s.executor.tick();
  const done = await s.settle(job);
  assert.strictEqual(done.status, 'SUCCESS');
  assert.deepStrictEqual(s.sent, ['B31,10']);
  assert.ok(done.events.some((e) => e.status === 'ACKED'));
});

test('กล่องตอบ Error → FAILED + DEVICE_REJECTED', async () => {
  const s = setup({ reply: () => 'Error' });
  const job = s.enqueue({ meitrack: { led_off: true } });
  await s.executor.tick();
  const done = await s.settle(job);
  assert.strictEqual(done.status, 'FAILED');
  assert.strictEqual(done.error_code, 'DEVICE_REJECTED');
  assert.match(done.error_message, /B31/);
});

test('readback ตรง → SUCCESS', async () => {
  const s = setup({ reply: (cmd) => (cmd === 'B14' ? '180,5,120' : 'OK') });
  const job = s.enqueue({ meitrack: { idling: { time_sec: 180, speed_kmh: 5, alert_sec: 120 } } });
  await s.executor.tick();
  assert.strictEqual((await s.settle(job)).status, 'SUCCESS');
  assert.deepStrictEqual(s.sent, ['B14,180,5,120', 'B14']);
});

test('readback ไม่ตรง → FAILED + NOT_VERIFIED', async () => {
  const s = setup({ reply: (cmd) => (cmd === 'B14' ? '180,5,60' : 'OK') });
  const job = s.enqueue({ meitrack: { idling: { time_sec: 180, speed_kmh: 5, alert_sec: 120 } } });
  await s.executor.tick();
  const done = await s.settle(job);
  assert.strictEqual(done.error_code, 'NOT_VERIFIED');
  assert.match(done.error_message, /อ่านกลับ/);
});

test('interval ตรง: ข้ามแพ็กเก็ตแรก แล้วดูช่วงห่างแพ็กเก็ตที่ 2 กับ 3', async () => {
  const s = setup();
  const job = s.enqueue({ meitrack: { track_interval_sec: 60 } });
  await s.executor.tick();
  await s.settle(job, (j) => j.status === 'ACKED');
  s.executor.onPacket(DEV, s.packet(35, 1), { remainingCache: 0 });
  s.executor.onPacket(DEV, s.packet(35, 61), { remainingCache: 0 });
  assert.strictEqual(s.status(job).status, 'ACKED');
  s.executor.onPacket(DEV, s.packet(35, 121), { remainingCache: 0 });
  const done = await s.settle(job);
  assert.strictEqual(done.status, 'SUCCESS');
  assert.ok(done.events.at(-1).details.includes('60'));
});

test('interval ไม่นับแพ็กเก็ตย้อนหลัง (remainingCache > 0) และแพ็กเก็ตที่เวลาก่อนตอบรับ', async () => {
  const s = setup();
  const job = s.enqueue({ meitrack: { track_interval_sec: 60 } });
  await s.executor.tick();
  await s.settle(job, (j) => j.status === 'ACKED');
  s.executor.onPacket(DEV, s.packet(35, 1), { remainingCache: 0 }); // ข้าม (ครั้งแรก)
  s.executor.onPacket(DEV, s.packet(35, 31), { remainingCache: 5 }); // ข้อมูลค้าง ไม่นับ
  s.executor.onPacket(DEV, s.packet(35, -600), { remainingCache: 0 }); // เวลาก่อนตอบรับ ไม่นับ
  s.executor.onPacket(DEV, s.packet(35, 61), { remainingCache: 0 });
  s.executor.onPacket(DEV, s.packet(35, 121), { remainingCache: 0 });
  assert.strictEqual((await s.settle(job)).status, 'SUCCESS');
});

test('interval ไม่ตรง (ห่าง 30 วิ ตั้ง 60) → FAILED + NOT_VERIFIED', async () => {
  const s = setup();
  const job = s.enqueue({ meitrack: { track_interval_sec: 60 } });
  await s.executor.tick();
  await s.settle(job, (j) => j.status === 'ACKED');
  for (const t of [1, 31, 61]) s.executor.onPacket(DEV, s.packet(35, t), { remainingCache: 0 });
  const done = await s.settle(job);
  assert.strictEqual(done.error_code, 'NOT_VERIFIED');
  assert.match(done.error_message, /30/);
});

test('interval หมดเวลาและเห็น event 21 → ข้อความบอกเรื่อง geofence', async () => {
  const s = setup();
  const job = s.enqueue({ meitrack: { track_interval_sec: 60 } });
  await s.executor.tick();
  await s.settle(job, (j) => j.status === 'ACKED');
  s.executor.onPacket(DEV, s.packet(21, 5), { remainingCache: 0 });
  s.tick(181_000); // เกิน max(3 × 60, 120) วิ
  await s.executor.tick();
  const done = await s.settle(job);
  assert.strictEqual(done.error_code, 'NOT_VERIFIED');
  assert.match(done.error_message, /geofence/);
});

test('สายหลุดหลังส่ง → กลับเป็น QUEUED แล้วส่งใหม่สำเร็จเมื่อกล่องกลับมา', async () => {
  const s = setup({ reply: (cmd, n) => (n === 1 ? noReply() : 'OK') });
  const job = s.enqueue({ meitrack: { led_off: true } });
  await s.executor.tick();
  const waiting = await s.settle(job);
  assert.strictEqual(waiting.status, 'QUEUED');
  assert.strictEqual(waiting.attempts, 1);
  assert.match(waiting.waiting_reason, /รอกล่อง/);
  await s.executor.tick();
  assert.strictEqual((await s.settle(job, (j) => j.status === 'SUCCESS')).status, 'SUCCESS');
  assert.deepStrictEqual(s.sent, ['B31,10', 'B31,10']);
});

test('หลุดครบ 3 ครั้ง → FAILED + DEVICE_NO_REPLY', async () => {
  const s = setup({ reply: () => offline() });
  const job = s.enqueue({ meitrack: { led_off: true } });
  for (let i = 0; i < 3; i++) {
    await s.executor.tick();
    await s.settle(job, (j) => j.attempts === i + 1);
  }
  const done = s.status(job);
  assert.strictEqual(done.status, 'FAILED');
  assert.strictEqual(done.error_code, 'DEVICE_NO_REPLY');
});

test('หลาย step ล้มที่ step 2 → ไม่ส่ง step 3 และข้อความบอกกลุ่ม', async () => {
  const s = setup({ reply: (cmd) => (cmd.startsWith('B14') ? 'Error' : 'OK') });
  const job = s.enqueue({ meitrack: { track_interval_sec: 0, idling: { time_sec: 180, speed_kmh: 5, alert_sec: 120 }, led_off: true } });
  await s.executor.tick();
  const done = await s.settle(job);
  assert.strictEqual(done.status, 'FAILED');
  assert.match(done.error_message, /idling/);
  assert.deepStrictEqual(s.sent, ['A12,0', 'B14,180,5,120']);
});

test('เครื่องออฟไลน์ → ไม่ส่งคำสั่ง งานคง QUEUED', async () => {
  const s = setup({ online: false });
  const job = s.enqueue({ meitrack: { led_off: true } });
  await s.executor.tick();
  await wait(20);
  assert.strictEqual(s.status(job).status, 'QUEUED');
  assert.strictEqual(s.status(job).attempts, 0);
  assert.deepStrictEqual(s.sent, []);
});

test('tick ซ้อนกันไม่ส่งงานเดียวกันซ้ำ', async () => {
  let release;
  const s = setup({ reply: () => new Promise((r) => { release = () => r('OK'); }) });
  const job = s.enqueue({ meitrack: { led_off: true } });
  await s.executor.tick();
  await s.executor.tick();
  await wait(10);
  assert.deepStrictEqual(s.sent, ['B31,10']);
  release();
  assert.strictEqual((await s.settle(job)).status, 'SUCCESS');
});
