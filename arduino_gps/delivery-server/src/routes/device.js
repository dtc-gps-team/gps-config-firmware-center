const express = require('express');
const { deviceAuth } = require('../auth');
const { SEMVER_RE } = require('../schemas');
const fw = require('../firmware');

const isUint = (v) => Number.isInteger(v) && v >= 0;

module.exports = function deviceRoutes({ store, cfg, autoRegister }) {
  const r = express.Router();
  r.use(deviceAuth(store, autoRegister));

  // ดาวน์โหลด desired config ของกล่องตัวเอง
  r.get('/config', (req, res) => {
    const c = store.data.configs[req.device.device_id];
    if (!c) return res.status(404).json({ error: 'NO_CONFIG' });
    res.json({
      device_id: c.device_id,
      schema_version: c.schema_version,
      config_version: c.config_version,
      settings: c.settings,
    });
  });

  // ?target=1.1.0 (จาก command) &current=1.0.0 (เวอร์ชันที่รันอยู่)
  r.get('/firmware-manifest', (req, res) => {
    const d = req.device;
    const current = req.query.current || d.reported?.firmware_version;
    const target = req.query.target;
    if (target && !SEMVER_RE.test(target)) return res.status(400).json({ error: 'INVALID_TARGET' });
    if (current && !SEMVER_RE.test(current)) return res.status(400).json({ error: 'INVALID_CURRENT' });

    const candidates = store.data.firmware.filter((f) => f.hardware_model === d.hardware_model && f.rollout_status === 'active');
    const release = target
      ? candidates.find((f) => f.version === target)
      : candidates.sort((a, b) => fw.compareVersions(b.version, a.version))[0];
    if (!release) return res.status(404).json({ error: 'RELEASE_NOT_AVAILABLE' });

    // กัน downgrade / ติดตั้งซ้ำ
    if (current) {
      const c = fw.compareVersions(release.version, current);
      if (c === 0) return res.status(409).json({ error: 'ALREADY_INSTALLED', version: current });
      if (c < 0) {
        const a = store.data.downgradeAllow?.[d.device_id];
        const allowed = cfg.allowFirmwareDowngrade || (a && a.version === release.version && a.expires_at > Date.now());
        if (!allowed) return res.status(409).json({ error: 'DOWNGRADE_NOT_ALLOWED', current, target: release.version });
      }
    }

    const link = fw.signedDownloadUrl(cfg, release.hardware_model, release.version, d.device_id);
    res.json({
      hardware_model: release.hardware_model,
      version: release.version,
      schema_version: release.schema_version,
      size_bytes: release.size_bytes,
      sha256: release.sha256,
      signature: release.signature,
      signature_alg: release.signature_alg,
      url: link.url,
      url_expires_at: link.expires_at,
    });
  });

  // กล่องรายงานเวอร์ชันที่รันจริง + config ที่ apply แล้ว + health
  r.post('/report', (req, res) => {
    const d = req.device;
    const b = req.body || {};
    if (b.device_id !== undefined && b.device_id !== d.device_id) {
      return res.status(403).json({ error: 'DEVICE_ID_MISMATCH' });
    }
    const errors = [];
    if (b.firmware_version !== undefined && !SEMVER_RE.test(b.firmware_version)) errors.push('firmware_version');
    if (b.schema_version !== undefined && !isUint(b.schema_version)) errors.push('schema_version');
    if (b.config_version !== undefined && !isUint(b.config_version)) errors.push('config_version');
    if (b.reported_config !== undefined && (typeof b.reported_config !== 'object' || Array.isArray(b.reported_config))) errors.push('reported_config');
    if (b.health !== undefined && (typeof b.health !== 'object' || Array.isArray(b.health))) errors.push('health');
    if (errors.length) return res.status(400).json({ error: 'INVALID_REPORT', fields: errors });

    d.reported = {
      ...(d.reported || {}),
      ...Object.fromEntries(
        ['firmware_version', 'schema_version', 'config_version', 'reported_config', 'health']
          .filter((k) => b[k] !== undefined)
          .map((k) => [k, b[k]])
      ),
    };
    d.last_report_at = new Date().toISOString();
    store.save();

    const desired = store.data.configs[d.device_id];
    res.json({
      ok: true,
      desired_config_version: desired?.config_version ?? null,
      in_sync: !!desired && d.reported.config_version === desired.config_version,
    });
  });

  return r;
};
