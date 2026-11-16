const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CommandService } = require('../src/commands');

const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();

function command(id, status, { deviceId = 'BOX', secAgo = 600, action = 'UPDATE_FIRMWARE' } = {}) {
  const done = ['SUCCESS', 'FAILED', 'ROLLED_BACK', 'EXPIRED'].includes(status);
  return {
    command_id: id, device_id: deviceId, action, target_firmware_version: '1.2.0', status,
    created_at: ago(secAgo + 60), updated_at: ago(secAgo), completed_at: done ? ago(secAgo) : null, expires_at: ago(-3600), events: [],
  };
}

function setup(cmds) {
  let saves = 0;
  const store = { data: { seq: 10010, commands: cmds, devices: { BOX: {}, OTHER: {} } }, save() { saves += 1; } };
  const connections = new Map([['BOX', { OPEN: 1, readyState: 1, helloDone: true, helloAt: Date.now() - 3600 * 1000, send() {} }]]);
  const commands = new CommandService(store, connections, {
    commandTtlSec: 3600, deliveryTimeoutSec: 600, responseTimeoutSec: 180, rebootTimeoutSec: 300, disconnectGraceSec: 60, firmwareSettleSec: 60,
  });
  return { commands, store, saves: () => saves };
}

test('ลบคำสั่งที่จบแล้วได้ทุกสถานะ', () => {
  for (const status of ['SUCCESS', 'FAILED', 'ROLLED_BACK', 'EXPIRED']) {
    const { commands, store, saves } = setup([command('CMD-1', status)]);
    assert.equal(commands.remove(store.data.commands[0]), true);
    assert.equal(commands.find('CMD-1'), null);
    assert.equal(saves(), 1);
  }
});

test('ลบคำสั่งที่ยังทำงานอยู่ไม่ได้', () => {
  for (const status of ['PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'DOWNLOADING', 'VALIDATING', 'INSTALLING', 'REBOOTING']) {
    const { commands, store, saves } = setup([command('CMD-1', status)]);
    assert.equal(commands.remove(store.data.commands[0]), false);
    assert.ok(commands.find('CMD-1'));
    assert.equal(saves(), 0);
  }
});

test('ล้างประวัติลบเฉพาะคำสั่งที่จบแล้วของกล่องนั้น', () => {
  const { commands } = setup([
    command('CMD-1', 'SUCCESS'),
    command('CMD-2', 'ROLLED_BACK'),
    command('CMD-3', 'DOWNLOADING'),
    command('CMD-4', 'SUCCESS', { deviceId: 'OTHER' }),
  ]);

  assert.equal(commands.clearFinished('BOX'), 2);

  assert.deepEqual(commands.all.map((c) => c.command_id), ['CMD-3', 'CMD-4']);
});

test('ไม่มีอะไรให้ล้าง -> คืน 0 และไม่บันทึกไฟล์', () => {
  const { commands, saves } = setup([command('CMD-3', 'DOWNLOADING')]);
  assert.equal(commands.clearFinished('BOX'), 0);
  assert.equal(saves(), 0);
});

test('ลบงาน firmware ที่เพิ่งจบแล้ว เวลารอให้กล่องพร้อมยังนับต่อ', () => {
  const { commands, store } = setup([command('CMD-1', 'SUCCESS', { secAgo: 10 })]);

  commands.remove(store.data.commands[0]);

  const r = commands.firmwareReadiness('BOX');
  assert.equal(r.state, 'SETTLING');
  assert.ok(r.remaining_sec > 45 && r.remaining_sec <= 50, `remaining ${r.remaining_sec}`);
});

test('ล้างประวัติแล้ว เวลารอยังใช้งานล่าสุด ไม่ใช่งานเก่า', () => {
  const { commands } = setup([command('CMD-1', 'SUCCESS', { secAgo: 500 }), command('CMD-2', 'SUCCESS', { secAgo: 20 }), command('CMD-3', 'SUCCESS', { secAgo: 300 })]);

  commands.clearFinished('BOX');

  const r = commands.firmwareReadiness('BOX');
  assert.equal(r.state, 'SETTLING');
  assert.ok(r.remaining_sec > 35 && r.remaining_sec <= 40, `remaining ${r.remaining_sec}`);
});

test('ลบแล้วเลขคำสั่งใหม่ไม่ซ้ำของเดิม', () => {
  const { commands, store } = setup([command('CMD-10010', 'SUCCESS')]);
  commands.clearFinished('BOX');

  const { cmd } = commands.create('BOX', 'UPDATE_CONFIG', { target_config_version: 2 });

  assert.equal(cmd.command_id, 'CMD-10011');
  assert.equal(store.data.seq, 10011);
});
