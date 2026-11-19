'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MODEL, SCHEMA_VERSION, schema, planCommands, parseReadback } = require('../src/protocols/meitrack/fields');

const idling = { time_sec: 180, speed_kmh: 5, alert_sec: 120 };

test('รุ่นและเวอร์ชัน schema', () => {
  assert.strictEqual(MODEL, 'TA255L');
  assert.strictEqual(SCHEMA_VERSION, 1);
  assert.strictEqual(schema().hardware_model, 'TA255L');
  assert.strictEqual(schema().schema_version, 1);
});

test('schema มี 5 parameter ตามตาราง เรียงตามลำดับ', () => {
  assert.deepStrictEqual(schema().parameters.map((p) => p.key), [
    'meitrack.track_interval_sec', 'meitrack.idling.time_sec', 'meitrack.idling.speed_kmh',
    'meitrack.idling.alert_sec', 'meitrack.led_off',
  ]);
  const a12 = schema().parameters[0];
  assert.deepStrictEqual([a12.type, a12.min, a12.max, a12.default], ['integer', 0, 655350, 60]);
  const led = schema().parameters[4];
  assert.deepStrictEqual([led.type, led.default], ['boolean', false]);
});

test('A12: ตั้ง 60 วิ → A12,6 ยืนยันจากรอบส่งจริง', () => {
  assert.deepStrictEqual(planCommands({ meitrack: { track_interval_sec: 60 } }), {
    steps: [{ group: 'track_interval', command: 'A12,6', verify: 'interval', expected: { track_interval_sec: 60 } }],
  });
});

test('A12: ค่า 0 (ปิด) → ยืนยันแค่กล่องตอบรับ', () => {
  const { steps } = planCommands({ meitrack: { track_interval_sec: 0 } });
  assert.strictEqual(steps[0].command, 'A12,0');
  assert.strictEqual(steps[0].verify, 'ack');
});

test('A12: ค่าไม่หาร 10 ลงตัว → error', () => {
  const r = planCommands({ meitrack: { track_interval_sec: 65 } });
  assert.strictEqual(r.errors[0].key, 'meitrack.track_interval_sec');
  assert.match(r.errors[0].message, /10/);
});

test('B14 ครบ 3 ค่า → คำสั่งเดียว ยืนยันด้วยการอ่านกลับ', () => {
  assert.deepStrictEqual(planCommands({ meitrack: { idling } }).steps[0], {
    group: 'idling', command: 'B14,180,5,120', verify: 'readback', readCommand: 'B14', expected: idling,
  });
});

test('B14 ไม่ครบ → error บอก key ที่ขาด', () => {
  const r = planCommands({ meitrack: { idling: { time_sec: 180, speed_kmh: 5 } } });
  assert.deepStrictEqual(r.errors.map((e) => e.key), ['meitrack.idling.alert_sec']);
  assert.match(r.errors[0].message, /idling/);
});

test('B31: true → B31,10 · false → B31,00', () => {
  assert.strictEqual(planCommands({ meitrack: { led_off: true } }).steps[0].command, 'B31,10');
  assert.strictEqual(planCommands({ meitrack: { led_off: false } }).steps[0].command, 'B31,00');
  assert.strictEqual(planCommands({ meitrack: { led_off: true } }).steps[0].verify, 'ack');
});

test('หลายกลุ่ม → เรียงตามตาราง (A12, B14, B31)', () => {
  const { steps } = planCommands({ meitrack: { led_off: true, idling, track_interval_sec: 60 } });
  assert.deepStrictEqual(steps.map((s) => s.group), ['track_interval', 'idling', 'led']);
});

test('key ที่ไม่รู้จัก (เช่นของ ESP32) → error', () => {
  const r = planCommands({ gps: { send_interval_sec: 10 } });
  assert.deepStrictEqual(r.errors.map((e) => e.key), ['gps.send_interval_sec']);
  assert.match(r.errors[0].message, /TA255L/);
});

test('ค่านอกช่วง / ผิดชนิด → error', () => {
  assert.strictEqual(planCommands({ meitrack: { idling: { ...idling, speed_kmh: 201 } } }).errors[0].key, 'meitrack.idling.speed_kmh');
  assert.strictEqual(planCommands({ meitrack: { led_off: 'yes' } }).errors[0].key, 'meitrack.led_off');
  assert.strictEqual(planCommands({ meitrack: { track_interval_sec: 1.5 } }).errors[0].key, 'meitrack.track_interval_sec');
});

test('settings ว่าง → error (ไม่มีอะไรให้ส่ง)', () => {
  assert.ok(planCommands({}).errors.length > 0);
});

test('parseReadback อ่านค่า B14 ที่กล่องตอบ', () => {
  assert.deepStrictEqual(parseReadback('idling', '180,5,120'), idling);
  assert.strictEqual(parseReadback('idling', 'Error'), null);
  assert.strictEqual(parseReadback('idling', '180,5'), null);
  assert.strictEqual(parseReadback('track_interval', '6'), null); // กลุ่มที่ไม่มีการอ่านกลับ
});

test('ไฟล์ schemas/TA255L-1.json ตรงกับ schema()', () => {
  const file = path.join(__dirname, '..', 'schemas', 'TA255L-1.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), schema());
});

test('ไม่มีคำสั่งต้องห้ามในไฟล์ fields.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'protocols', 'meitrack', 'fields.js'), 'utf8');
  for (const banned of ['A21', 'A23', 'C01', 'D72', 'F09', 'F11', 'F20', 'CFF']) {
    assert.ok(!src.includes(banned), `พบ ${banned}`);
  }
});
