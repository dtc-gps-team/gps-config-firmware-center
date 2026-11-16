const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const adminRoutes = require('../src/routes/admin');
const { SchemaRegistry, validateSettings } = require('../src/schemas');

test('config updates after firmware downgrade', async (t) => {
  const schemas = new SchemaRegistry(path.join(__dirname, '../schemas'));
  const model = 'ESP32-DEVKIT-V1';
  const original = {
    device_id: 'BOX-0001', schema_version: 3, config_version: 14,
    settings: validateSettings(schemas.get(model, 3), {
      gps: { send_interval_sec: 15 },
      data_server: { protocol: 'http', host: '192.168.1.2', port: 3001 },
      speed_limit: { enabled: true, max_kmh: 80 },
    }).settings,
    history: [],
  };
  // The registered schema can be stale; the device's report takes precedence.
  const store = {
    data: {
      devices: { 'BOX-0001': {
        device_id: 'BOX-0001', hardware_model: model, schema_version: 3,
        reported: { schema_version: 1, firmware_version: '1.0.0' },
      } },
      configs: { 'BOX-0001': structuredClone(original) },
    },
    save() {},
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes({
    store, schemas, cfg: { adminToken: 'test-admin', dataServerAllowlist: [] }, audit() {},
  }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const update = async (body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/devices/BOX-0001/config?push=false`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  await t.test('drops stale keys, preserves supported values and archives original', async () => {
    // Also cover legacy unknown keys already persisted in storage.
    store.data.configs['BOX-0001'].settings.send_interval_sec = 30;
    const before = structuredClone(store.data.configs['BOX-0001']);
    const { status, body } = await update({ settings: { gps: { send_interval_sec: 20 } } });
    assert.equal(status, 200);
    assert.equal(body.schema_version, 1);
    assert.equal(body.config_version, 15);
    assert.equal(body.settings.gps.send_interval_sec, 20);
    assert.deepEqual(body.settings.data_server, original.settings.data_server);
    assert.equal(body.settings.speed_limit, undefined);
    assert.equal(body.settings.geofence, undefined);
    assert.equal(body.settings.send_interval_sec, undefined);
    const { history, ...snapshot } = before;
    assert.deepEqual(store.data.configs['BOX-0001'].history[0], snapshot);
  });

  await t.test('still rejects unsupported keys in new input without saving', async () => {
    const before = structuredClone(store.data.configs);
    const { status, body } = await update({ settings: {
      speed_limit: { enabled: true, max_kmh: 80 }, geofence: { enabled: false },
    } });
    assert.equal(status, 400);
    assert.equal(body.error, 'INVALID_CONFIG');
    assert.deepEqual(body.details.map((e) => e.key), ['speed_limit.enabled', 'speed_limit.max_kmh', 'geofence.enabled']);
    assert.deepEqual(store.data.configs, before);
  });

  await t.test('explains the correct nesting for send_interval_sec', async () => {
    const { status, body } = await update({ settings: { send_interval_sec: 20 } });
    assert.equal(status, 400);
    assert.match(body.details[0].message, /gps\.send_interval_sec/);
  });

  await t.test('still validates ranges and settings shape', async () => {
    for (const settings of [null, [], { gps: { send_interval_sec: 1 } }]) {
      const { status, body } = await update({ settings });
      assert.equal(status, 400);
      assert.equal(body.error, 'INVALID_CONFIG');
    }
  });

  await t.test('requires actual firmware update before using schema 3', async () => {
    const rejected = await update({ schema_version: 3, settings: {} });
    assert.equal(rejected.status, 409);
    store.data.devices['BOX-0001'].reported = { schema_version: 3, firmware_version: '1.2.0' };
    const { status, body } = await update({ settings: {
      speed_limit: { enabled: true, max_kmh: 90 },
      geofence: { enabled: true, center_lat: 13.75, center_lng: 100.5, radius_m: 500 },
    } });
    assert.equal(status, 200);
    assert.equal(body.settings.speed_limit.max_kmh, 90);
    assert.equal(body.settings.geofence.enabled, true);
    assert.equal(body.settings.gps.send_interval_sec, 20);
  });
});
