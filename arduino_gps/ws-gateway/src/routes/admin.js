const express = require('express');
const { adminAuth, hashToken, newToken } = require('../auth');

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,32}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

module.exports = function adminRoutes({ store, commands, connections, cfg, audit }) {
  const r = express.Router();
  r.use(adminAuth(cfg.adminToken));

  const view = (d) => {
    const { token_hash, ...rest } = d;
    const last = commands.forDevice(d.device_id).at(-1);
    return {
      ...rest,
      online: connections.has(d.device_id),
      // คำสั่งล่าสุด + ผล (ให้เห็นทันทีว่าล้มเหลวเพราะอะไร)
      last_command: last
        ? { command_id: last.command_id, action: last.action, target: last.target_firmware_version ?? last.target_config_version,
            status: last.status, error_code: last.error_code, error_message: commands.view(last).error_message, updated_at: last.updated_at }
        : null,
    };
  };

  const getDevice = (req, res) => {
    const d = store.data.devices[req.params.id];
    if (!d) res.status(404).json({ error: 'DEVICE_NOT_FOUND' });
    return d;
  };

  const ttl = (body) => {
    const t = body?.ttl_sec;
    return Number.isInteger(t) && t >= 60 && t <= 30 * 24 * 3600 ? t : undefined;
  };

  // ---------- Devices ----------
  r.get('/devices', (req, res) => res.json(Object.values(store.data.devices).map(view)));

  // ลงทะเบียน token ของกล่อง (ใช้ token เดียวกับที่ได้จาก delivery-server ได้)
  r.post('/devices', (req, res) => {
    const { device_id, token } = req.body || {};
    if (!DEVICE_ID_RE.test(device_id || '')) return res.status(400).json({ error: 'INVALID_DEVICE_ID' });
    if (token !== undefined && (typeof token !== 'string' || token.length < cfg.minDeviceTokenLength)) {
      return res.status(400).json({ error: 'TOKEN_TOO_SHORT', message: `token ต้องยาวอย่างน้อย ${cfg.minDeviceTokenLength} ตัวอักษร` });
    }
    if (store.data.devices[device_id]) return res.status(409).json({ error: 'DEVICE_EXISTS' });
    const plain = token || newToken();
    store.data.devices[device_id] = {
      device_id,
      token_hash: hashToken(plain),
      status: 'active',
      created_at: new Date().toISOString(),
      last_seen_at: null,
    };
    store.save();
    audit('DEVICE_REGISTER', device_id, {});
    res.status(201).json({ device_id, token: plain });
  });

  r.get('/devices/:id', (req, res) => {
    const d = getDevice(req, res);
    if (d) res.json(view(d));
  });

  // เปลี่ยน token: ต้องตั้งให้ตรงกับ delivery-server ด้วย
  r.put('/devices/:id/token', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const token = req.body?.token;
    if (typeof token !== 'string' || token.length < cfg.minDeviceTokenLength) return res.status(400).json({ error: 'TOKEN_TOO_SHORT' });
    d.token_hash = hashToken(token);
    store.save();
    connections.get(d.device_id)?.close(4001, 'credential rotated');
    audit('DEVICE_SET_TOKEN', d.device_id, {});
    res.json({ device_id: d.device_id, ok: true });
  });

  r.post('/devices/:id/revoke', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    d.status = 'revoked';
    store.save();
    connections.get(d.device_id)?.close(4003, 'revoked');
    audit('DEVICE_REVOKE', d.device_id, {});
    res.json(view(d));
  });

  r.get('/devices/:id/commands', (req, res) => {
    const d = getDevice(req, res);
    if (d) res.json(commands.forDevice(d.device_id).slice().reverse().map((c) => commands.view(c)));
  });

  // ล้างประวัติคำสั่งที่จบแล้วของกล่อง (คำสั่งที่ยังทำงานอยู่จะไม่ถูกลบ)
  r.delete('/devices/:id/commands', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const deleted = commands.clearFinished(d.device_id);
    audit('COMMAND_HISTORY_CLEAR', d.device_id, { deleted });
    res.json({ device_id: d.device_id, deleted });
  });

  r.get('/devices/:id/firmware-readiness', (req, res) => {
    const d = getDevice(req, res);
    if (d) res.json(commands.firmwareReadiness(d.device_id));
  });

  // ---------- Commands ----------
  r.post('/devices/:id/commands/config-update', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const v = req.body?.target_config_version;
    if (!Number.isInteger(v) || v < 1) return res.status(400).json({ error: 'INVALID_TARGET_CONFIG_VERSION' });
    const { cmd, error, message } = commands.create(d.device_id, 'UPDATE_CONFIG', { target_config_version: v }, ttl(req.body));
    if (error) return res.status(409).json({ error, message });
    audit('COMMAND_CREATE', d.device_id, { command_id: cmd.command_id, action: cmd.action, target_config_version: v });
    res.status(201).json({ ...commands.view(cmd), online: connections.has(d.device_id) });
  });

  r.post('/devices/:id/commands/firmware-update', (req, res) => {
    const d = getDevice(req, res);
    if (!d) return;
    const v = req.body?.target_firmware_version;
    if (!SEMVER_RE.test(v || '')) return res.status(400).json({ error: 'INVALID_TARGET_FIRMWARE_VERSION' });
    const { cmd, error, message } = commands.create(d.device_id, 'UPDATE_FIRMWARE', { target_firmware_version: v }, ttl(req.body));
    if (error) return res.status(409).json({ error, message });
    audit('COMMAND_CREATE', d.device_id, { command_id: cmd.command_id, action: cmd.action, target_firmware_version: v });
    res.status(201).json({ ...commands.view(cmd), online: connections.has(d.device_id) });
  });

  r.get('/jobs/:jobId', (req, res) => {
    const cmd = commands.find(req.params.jobId);
    if (!cmd) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    res.json(commands.view(cmd));
  });

  // ยกเลิกได้เฉพาะช่วงที่ยังไม่เริ่มดาวน์โหลด/ติดตั้ง
  r.post('/jobs/:jobId/cancel', (req, res) => {
    const cmd = commands.find(req.params.jobId);
    if (!cmd) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    if (!commands.cancel(cmd)) return res.status(409).json({ error: 'NOT_CANCELLABLE', status: cmd.status });
    audit('COMMAND_CANCEL', cmd.device_id, { command_id: cmd.command_id });
    res.json(commands.view(cmd));
  });

  // ลบออกจากประวัติ ลบได้เฉพาะคำสั่งที่จบแล้ว
  r.delete('/jobs/:jobId', (req, res) => {
    const cmd = commands.find(req.params.jobId);
    if (!cmd) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    if (!commands.remove(cmd)) {
      return res.status(409).json({ error: 'COMMAND_ACTIVE', status: cmd.status, message: 'คำสั่งนี้ยังทำงานอยู่ ลบได้เมื่อจบแล้ว' });
    }
    audit('COMMAND_DELETE', cmd.device_id, { command_id: cmd.command_id, status: cmd.status });
    res.json({ command_id: cmd.command_id, deleted: true });
  });

  return r;
};
