'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toTelemetryReport } = require('../src/protocols/meitrack/telemetry');

const ctx = { imei: '353358017784062', firmwareVersion: null };
const base = { lat: 22.540113, lng: 114.076141, speedKmh: 0, gpsValid: 1, satellites: 5, eventCode: 35, time: '2026-01-01T00:00:00.000Z' };

test('แปลงแพ็กเก็ตรอบส่งปกติเป็น telemetry', () => {
  assert.deepStrictEqual(toTelemetryReport(base, ctx), {
    device_id: '353358017784062', latitude: 22.540113, longitude: 114.076141, speed_kmh: 0,
    fix: true, location_source: 'gps', satellites: 5, timestamp: '2026-01-01T00:00:00.000Z',
  });
});

test('ไม่มี GPS → fix false และ location_source default', () => {
  const r = toTelemetryReport({ ...base, gpsValid: 0 }, ctx);
  assert.strictEqual(r.fix, false);
  assert.strictEqual(r.location_source, 'default');
});

test('ใส่ firmware_version เมื่อรู้แล้ว', () => {
  assert.strictEqual(toTelemetryReport(base, { ...ctx, firmwareVersion: 'V028' }).firmware_version, 'V028');
});

test('ไม่มีเวลา → timestamp ว่าง (backend ใช้เวลาที่รับแทน)', () => {
  assert.strictEqual(toTelemetryReport({ ...base, time: undefined }, ctx).timestamp, '');
});

test('event 21 → GEOFENCE_EXIT, 20 → GEOFENCE_ENTER, 19 → OVERSPEED', () => {
  assert.strictEqual(toTelemetryReport({ ...base, eventCode: 21 }, ctx).event_type, 'GEOFENCE_EXIT');
  assert.strictEqual(toTelemetryReport({ ...base, eventCode: 20 }, ctx).event_type, 'GEOFENCE_ENTER');
  assert.strictEqual(toTelemetryReport({ ...base, eventCode: 19 }, ctx).event_type, 'OVERSPEED');
});

test('event อื่น (เช่น 81 ถูกถอด) ส่งเป็น telemetry ธรรมดา', () => {
  const r = toTelemetryReport({ ...base, eventCode: 81 }, ctx);
  assert.strictEqual(r.event_type, undefined);
  assert.strictEqual(r.fix, true);
});

test('ไม่มีความเร็ว → speed_kmh null', () => {
  assert.strictEqual(toTelemetryReport({ ...base, speedKmh: undefined }, ctx).speed_kmh, null);
});
