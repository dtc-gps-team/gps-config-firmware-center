const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { adminAuth, hashToken, newToken } = require('../auth');
const { validateSettings, supportedSettings, MODEL_RE, SEMVER_RE } = require('../schemas');
const fw = require('../firmware');

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,32}$/;
const ROLLOUT_STATUSES = ['active', 'paused', 'revoked'];
const CONFIG_HISTORY_LIMIT = 50;
const DIST_MODEL = 'ESP32-DEVKIT-V1';

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}

function publicDevice(d, store) {
  const { token_hash, ...rest } = d;
  const cfg = store.data.configs[d.device_id];
  return { ...rest, config_version_desired: cfg ? cfg.config_version : null };
}

module.exports = function adminRoutes({ store, schemas, cfg, audit }) {
  const r = express.Router();
  r.use(adminAuth(cfg.adminToken));

  const getDevice = (req, res) => {
    const d = store.data.devices[req.params.id];
    if (!d) res.status(404).json({ error: 'DEVICE_NOT_FOUND' });
    return d;
  };

  // ---------- Devices ----------
  r.get('/devices', (req, res) => {
    res.json(Object.values(store.data.devices).map((d) => publicDevice(d, store)));
  });

  // ลงทะเบียนกล่อง: token คืนให้ครั้งเดียว (server เก็บแค่ hash)
  r.post('/devices', (req, res) => {
    const { device_id, hardware_model, schema_version = 1, token } = req.body || {};
    if (!DEVICE_ID_RE.test(device_id || '')) return res.status(400).json({ error: 'INVALID_DEVICE_ID' });
    if (!MODEL_RE.test(hardware_model || '')) return res.status(400).json({ error: 'INVALID_HARDWARE_MODEL' });
    if (!schemas.get(hardware_model, schema_version)) return res.status(400).json({ error: 'UNKNOWN_SCHEMA' });
    if (token !== undefined && (typeof token !== 'string' || token.length < cfg.minDeviceTokenLength)) {
      return res.status(400).json({ error: 'TOKEN_TOO_SHORT', message: `token ต้องยาวอย่างน้อย ${cfg.minDeviceTokenLength} ตัวอักษร` });
    }
    if (store.data.devices[device_id]) return res.status(409).json({ error: 'DEVICE_EXISTS' });

    const plain = token || newToken();
    store.data.devices[device_id] = {
      device_id,
      hardware_model,
      schema_version,
      token_hash: hashToken(plain),
      status: 'active',
      created_at: new Date().toISOString(),
      rotated_at: null,
      reported: null,
      last_report_at: null,
    };
    store.save();
    audit('DEVICE_REGISTER', device_id, { hardware_model, schema_version });
    res.status(201).json({ device_id, hardware_model, schema_version, token: plain });
  });

  r.get('/devices/:id', (req, res) => {
    const d = getDevice(req, res);
    if (d) res.json(publicDevice(d, store));
  });

  r.post('/devices/:id/rotate-token', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const plain = newToken();
    d.token_hash = hashToken(plain);
    d.rotated_at = new Date().toISOString();
    store.save();
    audit('DEVICE_ROTATE_TOKEN', d.device_id, {});
    res.json({ device_id: d.device_id, token: plain });
  });

  r.post('/devices/:id/revoke', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    d.status = 'revoked';
    store.save();
    audit('DEVICE_REVOKE', d.device_id, {});
    res.json(publicDevice(d, store));
  });

  // ---------- Schemas ----------
  r.get('/schemas', (req, res) => res.json(schemas.list()));

  r.get('/schemas/:model/:version', (req, res) => {
    const s = schemas.get(req.params.model, Number(req.params.version));
    if (!s) return res.status(404).json({ error: 'SCHEMA_NOT_FOUND' });
    res.json(s);
  });

  r.post('/schemas', (req, res) => {
    const { errors, schema } = schemas.add(req.body);
    if (errors) return res.status(400).json({ error: 'INVALID_SCHEMA', details: errors });
    audit('SCHEMA_CREATE', `${schema.hardware_model}@${schema.schema_version}`, {});
    res.status(201).json(schema);
  });

  // ---------- Config ----------
  // ใช้ schema ที่กล่อง "รายงานว่าติดตั้งจริง" ก่อน ถ้ายังไม่เคยรายงานใช้ค่าตอนลงทะเบียน
  const deviceSchemaVersion = (d) => d.reported?.schema_version ?? d.schema_version;

  r.get('/devices/:id/config', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const c = store.data.configs[d.device_id];
    const reportedVersion = d.reported?.config_version ?? null;
    res.json({
      device_id: d.device_id,
      desired: c ? { schema_version: c.schema_version, config_version: c.config_version, settings: c.settings, updated_at: c.updated_at } : null,
      reported: d.reported ? { config_version: reportedVersion, settings: d.reported.reported_config ?? null, reported_at: d.last_report_at } : null,
      in_sync: !!c && reportedVersion === c.config_version,
    });
  });

  // X-Wait-Result: true (หรือ ?wait=true) = รอจนกล่องทำเสร็จแล้วค่อยตอบ (สูงสุด WAIT_MAX_SEC)
  const WAIT_MAX_SEC = 300;
  const TERMINAL = ['SUCCESS', 'FAILED', 'ROLLED_BACK', 'EXPIRED'];
  const wantWait = (req) => req.get('X-Wait-Result') === 'true' || req.query.wait === 'true';
  async function waitResult(commandId, req) {
    const deadline = Date.now() + Math.min(Number(req.get('X-Wait-Seconds') || req.query.wait_seconds || WAIT_MAX_SEC), WAIT_MAX_SEC) * 1000;
    let last = null;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${cfg.gatewayAdminUrl}/api/admin/jobs/${commandId}`, {
          headers: { Authorization: 'Bearer ' + cfg.gatewayAdminToken },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const { events, nonce, ...job } = await r.json();
          last = { ...job, steps: events.map((e) => e.status + (e.progress !== null ? ' ' + e.progress + '%' : '')) };
          if (TERMINAL.includes(job.status)) return { done: true, ...last };
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { done: false, ...(last || {}), note: 'ยังไม่จบภายในเวลาที่รอ — ดูผลต่อที่ GET /api/gw/jobs/' + commandId };
  }
  const resultMessage = (r) =>
    !r.done ? 'ยังไม่จบ (หมดเวลารอ)'
      : r.status === 'SUCCESS' ? 'สำเร็จ'
      : 'ไม่สำเร็จ: ' + (r.error_message || r.error_code || r.status);

  // สั่งกล่องดึง config ใหม่ผ่าน Gateway ทันที (กล่องออฟไลน์ = รอส่งเมื่อออนไลน์)
  async function pushConfig(deviceId, configVersion) {
    if (!cfg.gatewayAdminUrl || !cfg.gatewayAdminToken) return { error: 'GATEWAY_NOT_CONFIGURED', message: 'ตั้ง GATEWAY_ADMIN_URL / GATEWAY_ADMIN_TOKEN ใน .env' };
    try {
      const r = await fetch(`${cfg.gatewayAdminUrl}/api/admin/devices/${encodeURIComponent(deviceId)}/commands/config-update`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.gatewayAdminToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_config_version: configVersion }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { error: body.error || 'HTTP_' + r.status, message: r.status === 404 ? 'Gateway ยังไม่รู้จักกล่องนี้ (กล่องยังไม่เคยต่อ Gateway)' : body.message };
      const { events, nonce, ...cmd } = body;
      return cmd;
    } catch (e) {
      return { error: 'GATEWAY_UNREACHABLE', message: 'ต่อ ws-gateway ไม่ได้ (' + cfg.gatewayAdminUrl + ')' };
    }
  }

  // ?push=false = บันทึกอย่างเดียว ไม่สั่งกล่อง
  r.put('/devices/:id/config', async (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const schemaVersion = req.body?.schema_version ?? deviceSchemaVersion(d);
    const schema = schemas.get(d.hardware_model, schemaVersion);
    if (!schema) return res.status(400).json({ error: 'UNKNOWN_SCHEMA', schema_version: schemaVersion });
    if (schemaVersion !== deviceSchemaVersion(d)) {
      return res.status(409).json({
        error: 'SCHEMA_MISMATCH',
        message: `กล่องรัน schema ${deviceSchemaVersion(d)} อยู่ ต้องอัปเดต firmware ก่อนจึงจะใช้ schema ${schemaVersion} ได้`,
      });
    }

    // ค่าที่ไม่ได้ส่งมา คงค่าเดิมที่ตั้งไว้ (ส่งเฉพาะค่าที่ต้องการเปลี่ยนได้)
    const incoming = req.body?.settings;
    // หลัง downgrade ค่าเดิมอาจมี key ของ firmware ใหม่กว่า ต้องตัดออกก่อน merge
    const saved = store.data.configs[d.device_id]?.settings;
    const current = saved ? supportedSettings(schema, saved) : null;
    const merged = current && incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? deepMerge(current, incoming) : incoming;
    const { errors, settings } = validateSettings(schema, merged, cfg.dataServerAllowlist);
    if (errors) return res.status(400).json({ error: 'INVALID_CONFIG', details: errors });

    const prev = store.data.configs[d.device_id];
    const entry = {
      device_id: d.device_id,
      schema_version: schemaVersion,
      config_version: (prev?.config_version ?? 0) + 1,
      settings,
      updated_at: new Date().toISOString(),
      history: [],
    };
    if (prev) {
      const { history, ...snapshot } = prev;
      entry.history = [snapshot, ...history].slice(0, CONFIG_HISTORY_LIMIT);
    }
    store.data.configs[d.device_id] = entry;
    store.save();
    audit('CONFIG_UPDATE', d.device_id, { config_version: entry.config_version });

    const { history, ...out } = entry;
    if (req.query.push === 'false') return res.json(out);
    const command = await pushConfig(d.device_id, entry.config_version);
    if (command.command_id && wantWait(req)) {
      const result = await waitResult(command.command_id, req);
      return res.json({ ...out, command, result, message: resultMessage(result) });
    }
    res.json({ ...out, command });
  });

  // กล่องออนไลน์และว่างไหม (เช็คจาก Gateway) คืนเหตุผลถ้ายังรีเซ็ตเลข config ไม่ได้
  async function resetBlocker(deviceId) {
    const get = async (p) => {
      const r = await fetch(`${cfg.gatewayAdminUrl}/api/admin/devices/${encodeURIComponent(deviceId)}${p}`, {
        headers: { Authorization: 'Bearer ' + cfg.gatewayAdminToken },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error('HTTP_' + r.status);
      return r.json();
    };
    try {
      const [device, commands] = await Promise.all([get(''), get('/commands')]);
      if (!device.online) return { code: 409, error: 'DEVICE_OFFLINE', message: 'กล่องออฟไลน์ รีเซ็ตได้เมื่อกล่องออนไลน์' };
      if (commands.some((c) => !TERMINAL.includes(c.status))) return { code: 409, error: 'DEVICE_BUSY', message: 'กล่องมีงานค้างอยู่ รอให้จบก่อน' };
      return null;
    } catch (e) {
      return { code: 502, error: 'GATEWAY_UNREACHABLE', message: 'ต่อ ws-gateway ไม่ได้ (' + cfg.gatewayAdminUrl + ')' };
    }
  }

  // ตั้ง config_version กลับเป็น 1 และล้างประวัติ โดยค่าตั้งไม่เปลี่ยน แล้วส่งเข้ากล่องทันที
  // ต้องเลขตรงกันก่อน: กล่องตอบสำเร็จโดยไม่ดึงค่าถ้าเลขเป้าหมายเท่าเลขที่ตัวเองใช้อยู่
  r.post('/devices/:id/config/reset-version', async (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const prev = store.data.configs[d.device_id];
    if (!prev) return res.status(404).json({ error: 'CONFIG_NOT_FOUND', message: 'กล่องนี้ยังไม่เคยตั้ง Config' });
    if (d.reported?.config_version !== prev.config_version) {
      return res.status(409).json({ error: 'CONFIG_NOT_IN_SYNC', message: 'เลข Config ของ Server กับกล่องยังไม่ตรงกัน ส่ง Config ให้ตรงกันก่อน' });
    }
    const blocker = await resetBlocker(d.device_id);
    if (blocker) return res.status(blocker.code).json({ error: blocker.error, message: blocker.message });

    const { history, ...current } = prev;
    const entry = { ...current, config_version: 1, updated_at: new Date().toISOString(), history: [] };
    store.data.configs[d.device_id] = entry;
    store.save();
    if (prev.config_version === 1) {
      audit('CONFIG_HISTORY_CLEAR', d.device_id, { deleted: history.length });
      return res.json({ config_version: 1, command: null });
    }
    const command = await pushConfig(d.device_id, 1);
    if (!command.command_id) {
      store.data.configs[d.device_id] = prev;
      store.save();
      return res.status(502).json({ error: command.error, message: 'ส่งเข้ากล่องไม่ได้ จึงคงเลขเดิมไว้: ' + (command.message || command.error) });
    }
    audit('CONFIG_VERSION_RESET', d.device_id, { from: prev.config_version, history_deleted: history.length, command_id: command.command_id });
    res.json({ config_version: 1, command });
  });

  r.get('/devices/:id/config/history', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const c = store.data.configs[d.device_id];
    if (!c) return res.json([]);
    const { history, ...current } = c;
    res.json([current, ...history]);
  });

  // ---------- Firmware ----------
  r.get('/firmware', (req, res) => res.json(store.data.firmware));

  // ตรวจ + บันทึก firmware release (ใช้ทั้งอัปโหลดเองและนำเข้าจาก firmware/dist)
  function createRelease({ model, version, schemaVersion, signature, data, replace = false }) {
    if (!MODEL_RE.test(model)) return [400, { error: 'INVALID_HARDWARE_MODEL' }];
    if (!SEMVER_RE.test(version)) return [400, { error: 'INVALID_VERSION' }];
    const schema = schemas.get(model, schemaVersion);
    if (!schema) {
      return [400, { error: 'UNKNOWN_SCHEMA', message: `ยังไม่มี schema ${schemaVersion} — ถ้า firmware นี้มีค่าตั้งใหม่ ให้อัปโหลด schema ก่อน (POST /api/admin/schemas)` }];
    }
    // firmware ใช้ schema ของเวอร์ชันที่เก่ากว่าหรือเท่ากันได้ (เช่น 1.2.1 แก้บั๊กใช้ schema ของ 1.2.0)
    if (fw.compareVersions(version, schema.firmware_version) < 0) {
      return [400, { error: 'SCHEMA_FIRMWARE_MISMATCH', message: `schema ${schemaVersion} เริ่มใช้ตั้งแต่ firmware ${schema.firmware_version} แต่ firmware นี้คือ ${version}` }];
    }
    if (!Buffer.isBuffer(data) || data.length === 0) return [400, { error: 'EMPTY_BODY' }];
    // ไฟล์ firmware ของ ESP32 ขึ้นต้นด้วย magic byte 0xE9
    if (data[0] !== 0xe9) return [400, { error: 'NOT_ESP32_IMAGE' }];
    const existing = store.data.firmware.findIndex((f) => f.hardware_model === model && f.version === version);
    if (existing >= 0 && !replace) {
      return [409, { error: 'RELEASE_EXISTS', message: `มี v${version} บน Server แล้ว — ถ้าต้องการทับให้เติม ?replace=true หรือลบก่อน` }];
    }

    // ไม่ได้ส่งลายเซ็นมา -> ให้ server เซ็นเอง (ถ้าเปิด SIGN_ON_UPLOAD และมี private key)
    let signedByServer = false;
    if (!signature && cfg.signOnUpload) {
      signature = fw.signFirmware(cfg.firmwarePrivateKeyFile, data);
      if (!signature) return [500, { error: 'NO_PRIVATE_KEY', message: 'SIGN_ON_UPLOAD=true แต่ไม่พบ private key สำหรับเซ็น' }];
      signedByServer = true;
    }

    const publicKey = fw.loadPublicKey(cfg.firmwarePublicKeyFile);
    if (publicKey) {
      if (!signature) return [400, { error: 'SIGNATURE_REQUIRED', message: 'ต้องส่ง X-Firmware-Signature (หรือเปิด SIGN_ON_UPLOAD=true)' }];
      if (!fw.verifySignature(publicKey, data, signature)) return [400, { error: 'INVALID_SIGNATURE' }];
    } else if (!cfg.allowUnsignedFirmware) {
      return [500, { error: 'NO_SIGNING_KEY', message: 'ยังไม่มี public key สำหรับตรวจลายเซ็น (รัน npm run keygen)' }];
    }

    if (existing >= 0) store.data.firmware.splice(existing, 1);
    const file = fw.firmwarePath(cfg.dataDir, model, version);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);

    const release = {
      hardware_model: model,
      version,
      schema_version: schemaVersion,
      size_bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      signature: signature || null,
      signature_alg: signature ? fw.SIGNATURE_ALG : null,
      rollout_status: 'active',
      signed_by_server: signedByServer,
      created_at: new Date().toISOString(),
    };
    store.data.firmware.push(release);
    store.save();
    audit('FIRMWARE_CREATE', `${model}@${version}`, { sha256: release.sha256, size_bytes: release.size_bytes, signed_by_server: signedByServer });
    return [201, release];
  }

  // อัปโหลด .bin เป็น raw body + metadata ใน header
  // สั่งกล่องอัปเดต firmware ผ่าน Gateway
  async function pushFirmware(deviceId, version) {
    if (!cfg.gatewayAdminUrl || !cfg.gatewayAdminToken) return { device_id: deviceId, error: 'GATEWAY_NOT_CONFIGURED' };
    try {
      const r = await fetch(`${cfg.gatewayAdminUrl}/api/admin/devices/${encodeURIComponent(deviceId)}/commands/firmware-update`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.gatewayAdminToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_firmware_version: version }),
        signal: AbortSignal.timeout(10000),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        return { device_id: deviceId, error: b.error || 'HTTP_' + r.status,
          message: r.status === 404 ? 'Gateway ยังไม่รู้จักกล่องนี้' : b.error === 'FIRMWARE_UPDATE_IN_PROGRESS' ? 'กล่องมีงานอัปเดต firmware ค้างอยู่' : b.message };
      }
      return { device_id: deviceId, command_id: b.command_id, status: b.status, waiting_reason: b.waiting_reason };
    } catch (e) {
      return { device_id: deviceId, error: 'GATEWAY_UNREACHABLE' };
    }
  }

  // อัปโหลด .bin เป็น raw body + metadata ใน header
  //   ?replace=true            ทับเวอร์ชันเดิมที่มีอยู่แล้ว
  //   X-Deploy-To: BOX-0001    อัปโหลดแล้วสั่งกล่องอัปเดตทันที (คั่นหลายกล่องด้วย , หรือ all = ทุกกล่องที่ยังไม่ใช่เวอร์ชันนี้)
  r.post('/firmware', express.raw({ type: () => true, limit: cfg.maxFirmwareBytes }), async (req, res) => {
    const tag = fw.readFirmwareTag(req.body);
    const model = req.get('X-Hardware-Model') || (tag && tag.hardware_model) || '';
    const version = req.get('X-Firmware-Version') || (tag && tag.version) || '';
    if (tag && version !== tag.version) {
      return res.status(400).json({ error: 'VERSION_MISMATCH', message: `ไฟล์นี้คือ firmware v${tag.version} แต่ระบุเวอร์ชันมาเป็น ${version}` });
    }
    const schemaHeader = Number(req.get('X-Schema-Version'));
    const [status, body] = createRelease({
      model,
      version,
      schemaVersion: schemaHeader || (tag && schemas.get(model, tag.schema_version) ? tag.schema_version : 0),
      signature: req.get('X-Firmware-Signature') || '',
      data: req.body,
      replace: req.query.replace === 'true' || req.get('X-Replace') === 'true',
    });
    const deployTo = (req.get('X-Deploy-To') || req.query.deploy_to || '').trim();
    if (status !== 201 || !deployTo) return res.status(status).json(body);

    const targets = deployTo.toLowerCase() === 'all'
      ? Object.values(store.data.devices)
          .filter((d) => d.status === 'active' && d.hardware_model === model && d.reported?.firmware_version !== version)
          .map((d) => d.device_id)
      : [...new Set(deployTo.split(',').map((x) => x.trim()).filter(Boolean))];
    const deployments = [];
    for (const id of targets) deployments.push(await pushFirmware(id, version));
    audit('FIRMWARE_DEPLOY', `${model}@${version}`, { targets });
    res.status(201).json({ ...body, deployments });
  });

  // ส่ง firmware ให้กล่องทันทีในคำสั่งเดียว: body = ไฟล์ .bin, header X-Firmware-Version
  // (Server เก็บไฟล์ให้กล่องดาวน์โหลด, ทับเวอร์ชันเดิมอัตโนมัติ, เลือก schema ให้เองถ้าไม่ระบุ, เซ็นให้ถ้าไม่มีลายเซ็น)
  r.post('/devices/:id/firmware', express.raw({ type: () => true, limit: cfg.maxFirmwareBytes }), async (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const tag = fw.readFirmwareTag(req.body);
    const given = (req.get('X-Firmware-Version') || req.query.version || '').trim();
    if (tag && given && given !== tag.version) {
      return res.status(400).json({ error: 'VERSION_MISMATCH', message: `ไฟล์นี้คือ firmware v${tag.version} แต่ระบุเวอร์ชันมาเป็น ${given}` });
    }
    if (tag && tag.hardware_model !== d.hardware_model) {
      return res.status(400).json({ error: 'HARDWARE_MISMATCH', message: `ไฟล์นี้สำหรับ ${tag.hardware_model} แต่กล่องเป็น ${d.hardware_model}` });
    }
    const version = given || (tag && tag.version) || '';
    if (!SEMVER_RE.test(version)) return res.status(400).json({ error: 'INVALID_VERSION', message: 'อ่านเวอร์ชันจากไฟล์ไม่ได้ (ไฟล์รุ่นเก่า) — ใส่ header X-Firmware-Version เช่น 1.1.0' });
    const running = d.reported?.firmware_version;
    // ลดเวอร์ชัน: ต้องอนุญาตชัดเจน (X-Allow-Downgrade: true) — อนุญาตเฉพาะกล่องนี้ + เวอร์ชันนี้ ภายใน 1 ชั่วโมง
    if (running && SEMVER_RE.test(running) && fw.compareVersions(version, running) < 0) {
      const allow = cfg.allowFirmwareDowngrade || req.get('X-Allow-Downgrade') === 'true' || req.query.allow_downgrade === 'true';
      if (!allow) {
        return res.status(409).json({
          error: 'DOWNGRADE_NOT_ALLOWED',
          message: `กล่องใช้ v${running} อยู่ — ห้ามลดเวอร์ชันเป็น v${version} โดยไม่ได้อนุญาต (ถ้าต้องการจริง ให้ส่ง header X-Allow-Downgrade: true)`,
        });
      }
      store.data.downgradeAllow = store.data.downgradeAllow || {};
      store.data.downgradeAllow[d.device_id] = { version, expires_at: Date.now() + 3600 * 1000 };
      store.save();
      audit('FIRMWARE_DOWNGRADE_ALLOW', d.device_id, { from: running, to: version });
    }
    if (running === version && req.query.force !== 'true') {
      return res.status(409).json({ error: 'ALREADY_ON_VERSION', message: `กล่อง ${d.device_id} ใช้ firmware v${version} อยู่แล้ว ไม่ต้องอัปเดต (ไฟล์ใหม่ให้ขึ้นเลขเวอร์ชันใหม่)` });
    }

    // กล่องมีงานอัปเดต firmware ค้างอยู่ -> ไม่แตะไฟล์ (กันไฟล์ที่กล่องกำลังดาวน์โหลดถูกทับ)
    if (cfg.gatewayAdminUrl && cfg.gatewayAdminToken) {
      try {
        const r = await fetch(`${cfg.gatewayAdminUrl}/api/admin/devices/${encodeURIComponent(d.device_id)}/commands`, {
          headers: { Authorization: 'Bearer ' + cfg.gatewayAdminToken },
          signal: AbortSignal.timeout(5000),
        });
        const list = r.ok ? await r.json() : [];
        const busy = list.find((c) => c.action === 'UPDATE_FIRMWARE' && !['SUCCESS', 'FAILED', 'ROLLED_BACK', 'EXPIRED'].includes(c.status));
        if (busy) {
          return res.status(409).json({
            error: 'FIRMWARE_UPDATE_IN_PROGRESS',
            message: `กล่องกำลังอัปเดตเป็น v${busy.target_firmware_version} อยู่ (${busy.command_id} ${busy.status}) — รอให้เสร็จหรือยกเลิกก่อน`,
            command_id: busy.command_id,
          });
        }
      } catch (e) {}
    }

    let schemaVersion = Number(req.get('X-Schema-Version') || req.query.schema_version || 0);
    if (!schemaVersion && tag && schemas.get(d.hardware_model, tag.schema_version)) schemaVersion = tag.schema_version;
    if (!schemaVersion) {
      // schema ล่าสุดที่เริ่มใช้ไม่ใหม่กว่า firmware นี้
      const pick = schemas.list()
        .filter((x) => x.hardware_model === d.hardware_model && fw.compareVersions(version, x.firmware_version) >= 0)
        .sort((a, b) => b.schema_version - a.schema_version)[0];
      schemaVersion = pick ? pick.schema_version : 0;
    }

    const [status, release] = createRelease({
      model: d.hardware_model,
      version,
      schemaVersion,
      signature: req.get('X-Firmware-Signature') || '',
      data: req.body,
      replace: true,
    });
    if (status !== 201) return res.status(status).json(release);

    const command = await pushFirmware(d.device_id, version);
    const { signature, ...firmware } = release;
    const schemaInfo = schemas.get(d.hardware_model, schemaVersion);
    if (schemaInfo && schemaInfo.firmware_version !== version) {
      firmware.note = `ใช้ค่าตั้งชุดเดิม (schema ${schemaVersion} ของ v${schemaInfo.firmware_version}) — ถ้า firmware นี้มีค่าตั้งใหม่ ให้เพิ่ม schema ก่อนตั้ง Config`;
    }
    if (command.command_id && wantWait(req)) {
      const result = await waitResult(command.command_id, req);
      return res.status(result.done && result.status !== 'SUCCESS' ? 500 : 201).json({
        ok: result.done && result.status === 'SUCCESS',
        device_id: d.device_id,
        firmware,
        command,
        result,
        message: `อัปเดต firmware v${version}: ` + resultMessage(result),
      });
    }
    res.status(command.command_id ? 201 : 502).json({
      ok: !!command.command_id,
      device_id: d.device_id,
      firmware,
      command,
      message: command.command_id
        ? (command.status === 'PENDING' ? 'กล่องออฟไลน์ — จะเริ่มอัปเดตเมื่อกล่องออนไลน์' : 'ส่งคำสั่งอัปเดตให้กล่องแล้ว')
        : 'เก็บไฟล์แล้ว แต่สั่งกล่องไม่ได้: ' + (command.message || command.error),
    });
  });

  // ---------- firmware ที่ build ไว้ใน firmware/dist (สร้างด้วย node firmware/build.js) ----------
  const readDist = () => {
    const file = path.join(cfg.firmwareDistDir, 'releases.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  };

  r.get('/firmware/dist', (req, res) => {
    const dist = readDist();
    res.json(
      Object.entries(dist).map(([version, d]) => {
        const up = store.data.firmware.find((f) => f.hardware_model === DIST_MODEL && f.version === version);
        return {
          version,
          schema_version: d.schema_version,
          size_bytes: d.size_bytes,
          sha256: d.sha256,
          uploaded: !!up,
          same_build: !!up && up.sha256 === d.sha256,
        };
      })
    );
  });

  r.post('/firmware/import-dist', (req, res) => {
    const version = req.body?.version;
    const d = readDist()[version];
    if (!d) return res.status(404).json({ error: 'NOT_IN_DIST', message: `ไม่พบ v${version} ใน firmware/dist` });
    const binFile = path.join(cfg.firmwareDistDir, path.basename(d.file));
    if (!fs.existsSync(binFile)) return res.status(404).json({ error: 'BIN_NOT_FOUND' });
    const [status, body] = createRelease({
      model: DIST_MODEL,
      version,
      schemaVersion: d.schema_version,
      signature: d.signature,
      data: fs.readFileSync(binFile),
    });
    res.status(status).json(body);
  });

  // ลบ release (เช่น build ใหม่แล้วต้องการอัปโหลดทับเวอร์ชันเดิม)
  r.delete('/firmware/:model/:version', (req, res) => {
    const i = store.data.firmware.findIndex((x) => x.hardware_model === req.params.model && x.version === req.params.version);
    if (i < 0) return res.status(404).json({ error: 'RELEASE_NOT_FOUND' });
    const [f] = store.data.firmware.splice(i, 1);
    store.save();
    fs.rmSync(fw.firmwarePath(cfg.dataDir, f.hardware_model, f.version), { force: true });
    audit('FIRMWARE_DELETE', `${f.hardware_model}@${f.version}`, {});
    res.json({ ok: true });
  });

  r.patch('/firmware/:model/:version', (req, res) => {
    const f = store.data.firmware.find((x) => x.hardware_model === req.params.model && x.version === req.params.version);
    if (!f) return res.status(404).json({ error: 'RELEASE_NOT_FOUND' });
    const status = req.body?.rollout_status;
    if (!ROLLOUT_STATUSES.includes(status)) return res.status(400).json({ error: 'INVALID_ROLLOUT_STATUS', allowed: ROLLOUT_STATUSES });
    f.rollout_status = status;
    store.save();
    audit('FIRMWARE_ROLLOUT', `${f.hardware_model}@${f.version}`, { rollout_status: status });
    res.json(f);
  });

  return r;
};
