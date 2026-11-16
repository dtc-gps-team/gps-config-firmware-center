const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CommandService } = require('../src/commands');

const SETTLE_SEC = 60;
const ago = (sec) => Date.now() - sec * 1000;

function setup({ online = true, helloSecAgo = 600 } = {}) {
  const sent = [];
  const connections = new Map();
  if (online) {
    connections.set('BOX', {
      OPEN: 1,
      readyState: 1,
      helloDone: true,
      helloAt: ago(helloSecAgo),
      send: (raw) => sent.push(JSON.parse(raw)),
    });
  }
  const store = { data: { commands: [], devices: { BOX: { firmware_version_reported: '1.0.0' } } }, save() {} };
  const commands = new CommandService(store, connections, {
    commandTtlSec: 3600,
    deliveryTimeoutSec: 600,
    responseTimeoutSec: 180,
    rebootTimeoutSec: 300,
    disconnectGraceSec: 60,
    firmwareSettleSec: SETTLE_SEC,
  });
  return { commands, store, connections, sent };
}

function finishedFirmware(secAgo, status = 'SUCCESS') {
  const at = new Date(ago(secAgo)).toISOString();
  return {
    command_id: 'CMD-OLD', device_id: 'BOX', action: 'UPDATE_FIRMWARE', target_firmware_version: '1.0.0',
    status, created_at: at, updated_at: at, completed_at: at, expires_at: at, events: [],
  };
}

test('กล่องออนไลน์นานแล้วและไม่มีงานค้าง -> READY และส่งคำสั่งทันที', () => {
  const { commands, sent } = setup();
  assert.equal(commands.firmwareReadiness('BOX').state, 'READY');
  assert.equal(commands.firmwareReadiness('BOX').ready, true);

  const { cmd } = commands.create('BOX', 'UPDATE_FIRMWARE', { target_firmware_version: '1.2.0' });

  assert.equal(cmd.status, 'DELIVERED');
  assert.equal(sent.length, 1);
});

test('กล่องออฟไลน์ -> OFFLINE', () => {
  const { commands } = setup({ online: false });
  assert.equal(commands.firmwareReadiness('BOX').state, 'OFFLINE');
  assert.equal(commands.firmwareReadiness('BOX').ready, false);
});

test('เพิ่งอัปเดตเสร็จ -> SETTLING พร้อมบอกเวลาที่เหลือ', () => {
  const { commands, store } = setup();
  store.data.commands.push(finishedFirmware(10));

  const r = commands.firmwareReadiness('BOX');

  assert.equal(r.state, 'SETTLING');
  assert.equal(r.ready, false);
  assert.ok(r.remaining_sec > 45 && r.remaining_sec <= 50, `remaining ${r.remaining_sec}`);
});

test('กล่องเพิ่งต่อกลับเข้ามา -> SETTLING', () => {
  const { commands } = setup({ helloSecAgo: 5 });
  assert.equal(commands.firmwareReadiness('BOX').state, 'SETTLING');
});

test('สั่งตอนยังไม่พร้อม -> รับคำสั่งไว้ รอก่อน แล้วส่งเองเมื่อพร้อม', () => {
  const { commands, store, sent } = setup();
  store.data.commands.push(finishedFirmware(10));

  const { cmd, error } = commands.create('BOX', 'UPDATE_FIRMWARE', { target_firmware_version: '1.2.0' });

  assert.equal(error, undefined);
  assert.equal(cmd.status, 'PENDING');
  assert.equal(sent.length, 0);
  assert.equal(commands.firmwareReadiness('BOX').state, 'QUEUED');
  assert.match(commands.view(cmd).waiting_reason, /รอ/);

  commands.expireSweep();
  assert.equal(sent.length, 0, 'ยังไม่ครบเวลา ต้องยังไม่ส่ง');

  store.data.commands[0].completed_at = new Date(ago(SETTLE_SEC + 1)).toISOString();
  commands.expireSweep();
  assert.equal(cmd.status, 'DELIVERED');
  assert.equal(sent.length, 1);
});

test('มีงานอัปเดตทำอยู่ -> BUSY บอกเวอร์ชันกับความคืบหน้า และสั่งซ้ำไม่ได้', () => {
  const { commands } = setup();
  const { cmd } = commands.create('BOX', 'UPDATE_FIRMWARE', { target_firmware_version: '1.2.0' });
  commands.addEvent(cmd, 'DOWNLOADING', { progress_percent: 40 });

  const r = commands.firmwareReadiness('BOX');
  assert.equal(r.state, 'BUSY');
  assert.equal(r.active.command_id, cmd.command_id);
  assert.equal(r.active.target_firmware_version, '1.2.0');
  assert.equal(r.active.progress, 40);
  assert.match(r.message, /1\.2\.0/);

  const again = commands.create('BOX', 'UPDATE_FIRMWARE', { target_firmware_version: '1.1.0' });
  assert.equal(again.error, 'FIRMWARE_UPDATE_IN_PROGRESS');
  assert.match(again.message, /1\.2\.0/);
});

test('ส่งคำสั่งเดิมซ้ำหลังรีบูตได้ทันที ไม่ถูกหน่วง (กล่องต้องใช้ตัดสินผล OTA)', () => {
  const { commands, connections, sent } = setup();
  const { cmd } = commands.create('BOX', 'UPDATE_FIRMWARE', { target_firmware_version: '1.2.0' });
  commands.addEvent(cmd, 'REBOOTING');
  connections.get('BOX').helloAt = Date.now();
  sent.length = 0;

  commands.deliverPending('BOX');

  assert.equal(sent.length, 1);
});

test('คำสั่ง Config ไม่ถูกหน่วง', () => {
  const { commands, sent } = setup({ helloSecAgo: 1 });
  const { cmd } = commands.create('BOX', 'UPDATE_CONFIG', { target_config_version: 2 });
  assert.equal(cmd.status, 'DELIVERED');
  assert.equal(sent.length, 1);
});

test('ปิดการรอได้ด้วย firmwareSettleSec = 0', () => {
  const { commands, store, sent } = setup({ helloSecAgo: 1 });
  commands.cfg.firmwareSettleSec = 0;
  store.data.commands.push(finishedFirmware(1));

  commands.create('BOX', 'UPDATE_FIRMWARE', { target_firmware_version: '1.2.0' });

  assert.equal(sent.length, 1);
});
