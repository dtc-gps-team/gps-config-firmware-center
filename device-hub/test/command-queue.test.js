'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCommandQueue } = require('../src/core/command-queue');

const DEV = '353358017784062';
const HOUR = 3_600_000;
const steps = [{ group: 'led', command: 'B31,10', verify: 'ack', expected: { led_off: true } }];
const settings = { meitrack: { led_off: true } };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-hub-queue-'));
  const file = path.join(dir, 'queue.json');
  let clock = Date.parse('2026-11-19T00:00:00.000Z');
  let n = 0;
  const make = () => createCommandQueue({ file, ttlHours: 24, now: () => clock, newId: () => `hub-${++n}` });
  return { file, make, tick: (ms) => { clock += ms; } };
}

test('create → QUEUED, id ขึ้นต้น hub-, version 1, หมดอายุใน 24 ชม.', () => {
  const { make } = setup();
  const q = make();
  const job = q.create(DEV, settings, steps);
  assert.strictEqual(job.status, 'QUEUED');
  assert.match(job.command_id, /^hub-/);
  assert.strictEqual(job.device_id, DEV);
  assert.strictEqual(job.action, 'config');
  assert.strictEqual(job.target_config_version, 1);
  assert.strictEqual(Date.parse(job.expires_at) - Date.parse(job.created_at), 24 * HOUR);
  assert.strictEqual(q.deviceState(DEV).desiredVersion, 1);
  assert.strictEqual(q.nextRunnable(DEV).command_id, job.command_id);
});

test('id เริ่มต้นสุ่มและขึ้นต้น hub- เสมอ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-hub-queue-'));
  const q = createCommandQueue({ file: path.join(dir, 'q.json'), ttlHours: 24 });
  assert.match(q.create(DEV, settings, steps).command_id, /^hub-[0-9a-f-]{36}$/);
});

test('create ซ้ำขณะงานแรกยัง QUEUED → งานแรกถูกแทนที่ (FAILED + SUPERSEDED)', () => {
  const q = setup().make();
  const first = q.create(DEV, settings, steps);
  const second = q.create(DEV, settings, steps);
  assert.strictEqual(q.get(first.command_id).status, 'FAILED');
  assert.strictEqual(q.get(first.command_id).error_code, 'SUPERSEDED');
  assert.strictEqual(second.target_config_version, 2);
  assert.strictEqual(q.nextRunnable(DEV).command_id, second.command_id);
});

test('create ซ้ำขณะงานแรกกำลังส่ง → งานแรกไม่ถูกแทนที่ และงานใหม่รอจนงานแรกจบ', () => {
  const q = setup().make();
  const first = q.create(DEV, settings, steps);
  q.transition(first.command_id, 'SENT');
  const second = q.create(DEV, settings, steps);
  assert.strictEqual(q.get(first.command_id).status, 'SENT');
  assert.strictEqual(q.nextRunnable(DEV), null);
  q.transition(first.command_id, 'SUCCESS');
  assert.strictEqual(q.nextRunnable(DEV).command_id, second.command_id);
});

test('expireOld → งาน QUEUED ที่เกิน 24 ชม. เป็น EXPIRED + TTL_EXPIRED', () => {
  const { make, tick } = setup();
  const q = make();
  const job = q.create(DEV, settings, steps);
  tick(25 * HOUR);
  const expired = q.expireOld();
  assert.deepStrictEqual(expired.map((j) => j.command_id), [job.command_id]);
  assert.strictEqual(q.get(job.command_id).status, 'EXPIRED');
  assert.strictEqual(q.get(job.command_id).error_code, 'TTL_EXPIRED');
  assert.strictEqual(q.nextRunnable(DEV), null);
});

test('SUCCESS → สถานะเครื่องอัปเดตค่าที่ใช้อยู่และเวอร์ชัน', () => {
  const q = setup().make();
  const job = q.create(DEV, settings, steps);
  q.transition(job.command_id, 'SENT');
  q.transition(job.command_id, 'SUCCESS');
  const state = q.deviceState(DEV);
  assert.strictEqual(state.reportedVersion, 1);
  assert.deepStrictEqual(state.reportedSettings, settings);
  assert.ok(state.reportedAt);

  const next = q.create(DEV, { meitrack: { track_interval_sec: 60 } }, steps);
  q.transition(next.command_id, 'SUCCESS');
  assert.deepStrictEqual(q.deviceState(DEV).reportedSettings, { meitrack: { led_off: true, track_interval_sec: 60 } });
});

test('ทุกการเปลี่ยนสถานะเพิ่ม event พร้อมเวลาและรายละเอียด', () => {
  const q = setup().make();
  const job = q.create(DEV, settings, steps);
  q.transition(job.command_id, 'FAILED', { errorCode: 'DEVICE_REJECTED', errorMessage: 'กล่องตอบ Error', details: 'B31' });
  const j = q.get(job.command_id);
  assert.strictEqual(j.error_message, 'กล่องตอบ Error');
  assert.deepStrictEqual(j.events.map((e) => e.status), ['QUEUED', 'FAILED']);
  assert.strictEqual(j.events[1].details, 'B31');
});

test('เปิดไฟล์ใหม่ (restart) → งาน SENT/ACKED กลับเป็น QUEUED และงาน QUEUED อยู่ครบ', () => {
  const { make } = setup();
  const q1 = make();
  const sent = q1.create(DEV, settings, steps);
  q1.transition(sent.command_id, 'SENT');
  const other = q1.create('353358017784063', settings, steps);
  const q2 = make();
  assert.strictEqual(q2.get(sent.command_id).status, 'QUEUED');
  assert.ok(q2.get(sent.command_id).events.at(-1).details.includes('เริ่มระบบใหม่'));
  assert.strictEqual(q2.get(other.command_id).status, 'QUEUED');
  assert.strictEqual(q2.deviceState(DEV).desiredVersion, 1);
});

test('ไม่มีไฟล์ → เริ่มคิวว่าง · ไฟล์เสีย → throw พร้อมชื่อไฟล์', () => {
  const { file, make } = setup();
  assert.deepStrictEqual(make().listForDevice(DEV), []);
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => make(), (err) => err.message.includes(file));
});

test('transition งานที่จบแล้วซ้ำ → throw', () => {
  const q = setup().make();
  const job = q.create(DEV, settings, steps);
  q.transition(job.command_id, 'SUCCESS');
  assert.throws(() => q.transition(job.command_id, 'FAILED'), /จบแล้ว/);
});

test('listForDevice เรียงใหม่สุดก่อน', () => {
  const { make, tick } = setup();
  const q = make();
  const a = q.create(DEV, settings, steps);
  tick(1000);
  const b = q.create(DEV, settings, steps);
  assert.deepStrictEqual(q.listForDevice(DEV).map((j) => j.command_id), [b.command_id, a.command_id]);
});
