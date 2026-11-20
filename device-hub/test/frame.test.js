'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCommand, extractFrames, parseFrame, parseCCE } = require('../src/protocols/meitrack/frame');
const { cceFrame, ccePacket } = require('./helpers/meitrack-fixtures');

test('buildCommand ตรงกับตัวอย่างในเอกสาร', () => {
  const cases = [
    ['Q', '353358017784062', 'A10', '@@Q25,353358017784062,A10*6A\r\n'],
    ['S', '353358017784062', 'A11,10', '@@S28,353358017784062,A11,10*FD\r\n'],
    ['V', '353358017784062', 'A12,6', '@@V27,353358017784062,A12,6*D5\r\n'],
    ['P', '353358017784062', 'B07,60', '@@P28,353358017784062,B07,60*05\r\n'],
    ['W', '353358017784062', 'E91', '@@W25,353358017784062,E91*7D\r\n'],
  ];
  for (const [id, imei, cmd, want] of cases) assert.strictEqual(buildCommand(id, imei, cmd).toString('latin1'), want, cmd);
});

test('parseFrame ตรวจ checksum คำตอบตัวอย่างในเอกสาร', () => {
  for (const r of ['$$S28,353358017784062,A11,OK*FE\r\n', '$$V28,353358017784062,A12,OK*02\r\n', '$$P28,353358017784062,B07,OK*01\r\n']) {
    const f = parseFrame(Buffer.from(r, 'latin1'));
    assert.ok(f.checksumOk, r);
    assert.strictEqual(f.body.toString(), 'OK');
  }
});

test('extractFrames แยก frame ตาม length แม้มี 0x0D0A อยู่ใน CCE', () => {
  const fr = cceFrame();
  const crlf = fr.indexOf(Buffer.from([0x0d, 0x0a]));
  assert.ok(crlf >= 0 && crlf < fr.length - 2, 'fixture ต้องมี CRLF อยู่ข้างใน');
  const split = extractFrames(Buffer.concat([fr, fr.subarray(0, 10)]));
  assert.strictEqual(split.frames.length, 1);
  assert.strictEqual(split.rest.length, 10);
  assert.ok(parseFrame(split.frames[0]).checksumOk);
});

test('parseCCE อ่าน lat/lng/eventCode ตามตารางตัวอย่าง', () => {
  const cce = parseCCE(parseFrame(cceFrame()).body);
  const p = cce.packets[0];
  assert.strictEqual(p.lat, 22.513638);
  assert.strictEqual(p.lng, 114.05719);
  assert.strictEqual(p.speedKmh, 21);
  assert.strictEqual(p.eventCode, 35);
  assert.strictEqual(p.event, 'Track By Time Interval');
  assert.strictEqual(cce.remainingCache, 0);
});

test('parseCCE อ่าน id 2 byte (0xFExx)', () => {
  const cce = parseCCE(parseFrame(cceFrame({ packets: [ccePacket({ battery: 0x1234 })] })).body);
  assert.strictEqual(cce.packets[0].battery, 0x1234);
  assert.strictEqual(cce.packets[0].lat, 22.513638);
});
