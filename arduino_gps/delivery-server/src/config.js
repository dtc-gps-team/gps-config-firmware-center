const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const port = Number(env.PORT || 3019);

const config = {
  root,
  port,
  adminToken: env.ADMIN_TOKEN || '',
  // ชื่อผู้ใช้ / รหัสผ่าน สำหรับเข้าหน้า /admin (ได้ ADMIN_TOKEN กลับไปใช้เรียก API)
  adminUsername: env.ADMIN_USERNAME || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  // ความยาวขั้นต่ำของ device token (ทุกกล่องใช้รหัสร่วมกันได้)
  minDeviceTokenLength: Number(env.MIN_DEVICE_TOKEN_LENGTH || 24),
  // ลงทะเบียนกล่องอัตโนมัติเมื่อใช้รหัสร่วมนี้ (ว่าง = ปิด ต้องลงทะเบียนเอง)
  autoRegisterToken: env.AUTO_REGISTER_TOKEN || '',
  // URL ที่กล่องมองเห็น ใช้สร้างลิงก์ดาวน์โหลด firmware
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  schemasDir: path.join(root, 'schemas'),
  tlsCertFile: env.TLS_CERT_FILE || '',
  tlsKeyFile: env.TLS_KEY_FILE || '',
  firmwarePublicKeyFile: path.resolve(root, env.FIRMWARE_PUBLIC_KEY_FILE || 'keys/firmware-signing-public.pem'),
  allowUnsignedFirmware: env.ALLOW_UNSIGNED_FIRMWARE === 'true',
  // อัปโหลด firmware ที่ไม่มีลายเซ็น -> server เซ็นให้ด้วย private key นี้
  signOnUpload: env.SIGN_ON_UPLOAD === 'true',
  // อนุญาตย้อนเป็น firmware เวอร์ชันเก่า (false = ต้องส่ง X-Allow-Downgrade: true ทุกครั้ง)
  allowFirmwareDowngrade: env.ALLOW_FIRMWARE_DOWNGRADE !== 'false',
  firmwarePrivateKeyFile: path.resolve(root, env.FIRMWARE_PRIVATE_KEY_FILE || 'keys/firmware-signing-private.pem'),
  maxFirmwareBytes: Number(env.MAX_FIRMWARE_BYTES || 4 * 1024 * 1024),
  // ถ้าไม่ตั้ง secret ลิงก์ดาวน์โหลดจะใช้ไม่ได้หลังรีสตาร์ท server (ซึ่งยอมรับได้ เพราะลิงก์อายุสั้น)
  downloadUrlSecret: env.DOWNLOAD_URL_SECRET || crypto.randomBytes(32).toString('hex'),
  downloadUrlTtlSec: Number(env.DOWNLOAD_URL_TTL_SEC || 600),
  // หน้า /admin เรียก Gateway ผ่าน delivery-server (browser ใช้ token เดียว)
  gatewayAdminUrl: (env.GATEWAY_ADMIN_URL || '').replace(/\/$/, ''),
  gatewayAdminToken: env.GATEWAY_ADMIN_TOKEN || '',
  // โฟลเดอร์ firmware ที่ build ไว้ (ปุ่ม "นำเข้า" ในหน้า /admin)
  firmwareDistDir: path.resolve(root, env.FIRMWARE_DIST_DIR || '../firmware/dist'),
  dataServerAllowlist: (env.DATA_SERVER_HOST_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

if (config.adminToken.length < 16) {
  console.error('ต้องตั้ง ADMIN_TOKEN ใน .env (อย่างน้อย 16 ตัวอักษร)');
  process.exit(1);
}

module.exports = config;
