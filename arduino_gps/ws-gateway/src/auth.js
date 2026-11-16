const crypto = require('crypto');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function safeEqual(a, b) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1].trim() : null;
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,32}$/;

// ระบุกล่องจาก header X-Device-Id + ตรวจ token ของกล่องนั้น
// (ทุกกล่องใช้ token ร่วมกันได้ จึงต้องมี Device ID มาด้วย)
// autoRegister = { token, newRecord(id) } : กล่องที่ยังไม่มีในระบบแต่ใช้รหัสร่วมถูกต้อง จะถูกเพิ่มให้เอง
function findDevice(store, token, deviceId, autoRegister) {
  if (!token || !deviceId) return null;
  let d = Object.hasOwn(store.data.devices, deviceId) ? store.data.devices[deviceId] : null;
  if (!d && autoRegister && autoRegister.token && DEVICE_ID_RE.test(deviceId) &&
      safeEqual(hashToken(token), hashToken(autoRegister.token))) {
    d = store.data.devices[deviceId] = {
      ...autoRegister.newRecord(deviceId),
      token_hash: hashToken(token),
      status: 'active',
      created_at: new Date().toISOString(),
      auto_registered: true,
    };
    store.save();
    console.log(`[auto-register] เพิ่มกล่อง ${deviceId}`);
  }
  if (!d || d.status !== 'active') return null;
  return safeEqual(d.token_hash, hashToken(token)) ? d : null;
}

function deviceIdHeader(req) {
  return (req.headers['x-device-id'] || '').toString().trim();
}

function adminAuth(adminToken) {
  const expected = hashToken(adminToken);
  return (req, res, next) => {
    const token = bearer(req);
    if (!token || !safeEqual(hashToken(token), expected)) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    next();
  };
}

// ผูกทุก request กับกล่องที่ยืนยันแล้ว (X-Device-Id + token) ไม่เชื่อ device_id ใน body
function deviceAuth(store, autoRegister) {
  return (req, res, next) => {
    const device = findDevice(store, bearer(req), deviceIdHeader(req), autoRegister);
    if (!device) return res.status(401).json({ error: 'UNAUTHORIZED' });
    req.device = device;
    next();
  };
}

module.exports = { hashToken, safeEqual, bearer, deviceIdHeader, newToken, findDevice, adminAuth, deviceAuth };
