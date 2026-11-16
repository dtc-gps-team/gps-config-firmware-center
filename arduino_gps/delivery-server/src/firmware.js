const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeEqual } = require('./auth');

const SIGNATURE_ALG = 'ECDSA_P256_SHA256';

function compareVersions(a, b) {
  const A = a.split('.').map(Number);
  const B = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
  return 0;
}

function loadPublicKey(file) {
  return fs.existsSync(file) ? crypto.createPublicKey(fs.readFileSync(file)) : null;
}

// ลายเซ็น ECDSA P-256 (DER, base64) ของไฟล์ .bin ทั้งไฟล์ — กล่องตรวจด้วย public key ที่ฝังไว้
function verifySignature(publicKey, data, signatureB64) {
  try {
    return crypto.verify('sha256', data, { key: publicKey, dsaEncoding: 'der' }, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

// เซ็นไฟล์ด้วย private key บน server (ใช้เมื่อระบบที่อัปโหลดไม่ได้เซ็นมาเอง)
function signFirmware(privateKeyFile, data) {
  if (!fs.existsSync(privateKeyFile)) return null;
  return crypto.sign('sha256', data, { key: fs.readFileSync(privateKeyFile), dsaEncoding: 'der' }).toString('base64');
}

// อ่านป้าย "@@FWVER:1.1.0;SCHEMA:2;MODEL:ESP32-DEVKIT-V1@@" ที่ firmware ฝังไว้ (ไฟล์รุ่นเก่าไม่มี = null)
function readFirmwareTag(data) {
  if (!Buffer.isBuffer(data)) return null;
  const i = data.indexOf('@@FWVER:');
  if (i < 0) return null;
  const end = data.indexOf('@@', i + 8);
  if (end < 0 || end - i > 200) return null;
  const tag = data.toString('latin1', i + 8, end);
  const m = /^(\d+\.\d+\.\d+);SCHEMA:(\d+);MODEL:([A-Za-z0-9._-]+)$/.exec(tag);
  return m ? { version: m[1], schema_version: Number(m[2]), hardware_model: m[3] } : null;
}

function firmwarePath(dataDir, model, version) {
  return path.join(dataDir, 'firmware', model, `${version}.bin`);
}

function downloadSig(secret, model, version, deviceId, exp) {
  return crypto.createHmac('sha256', secret).update(`${model}|${version}|${deviceId}|${exp}`).digest('hex');
}

// ลิงก์ดาวน์โหลดอายุสั้น ผูกกับ device ที่ authenticate แล้ว
function signedDownloadUrl(cfg, model, version, deviceId) {
  const exp = Math.floor(Date.now() / 1000) + cfg.downloadUrlTtlSec;
  const sig = downloadSig(cfg.downloadUrlSecret, model, version, deviceId, exp);
  const q = new URLSearchParams({ device: deviceId, exp: String(exp), sig });
  return {
    url: `${cfg.publicBaseUrl}/firmware/download/${encodeURIComponent(model)}/${version}?${q}`,
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

function checkDownloadUrl(cfg, model, version, query) {
  const { device, exp, sig } = query;
  if (!device || !exp || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(String(sig), downloadSig(cfg.downloadUrlSecret, model, version, String(device), String(exp)));
}

module.exports = {
  SIGNATURE_ALG,
  compareVersions,
  loadPublicKey,
  verifySignature,
  signFirmware,
  readFirmwareTag,
  firmwarePath,
  signedDownloadUrl,
  checkDownloadUrl,
};
