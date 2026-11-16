const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;

const config = {
  root,
  port: Number(env.PORT || 3018),
  adminToken: env.ADMIN_TOKEN || '',
  // ความยาวขั้นต่ำของ device token (ทุกกล่องใช้รหัสร่วมกันได้)
  minDeviceTokenLength: Number(env.MIN_DEVICE_TOKEN_LENGTH || 24),
  // ลงทะเบียนกล่องอัตโนมัติเมื่อใช้รหัสร่วมนี้ (ว่าง = ปิด ต้องลงทะเบียนเอง)
  autoRegisterToken: env.AUTO_REGISTER_TOKEN || '',
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  tlsCertFile: env.TLS_CERT_FILE || '',
  tlsKeyFile: env.TLS_KEY_FILE || '',
  heartbeatIntervalSec: Number(env.HEARTBEAT_INTERVAL_SEC || 10),
  commandTtlSec: Number(env.COMMAND_TTL_SEC || 24 * 3600),
  // แจ้งล้มเหลวเมื่อ: กล่องออฟไลน์จนคำสั่งไปไม่ถึง / รับคำสั่งแล้วเงียบ / รีบูตแล้วไม่กลับมา (0 = ไม่จำกัด)
  deliveryTimeoutSec: Number(env.COMMAND_DELIVERY_TIMEOUT_SEC ?? 600),
  responseTimeoutSec: Number(env.COMMAND_RESPONSE_TIMEOUT_SEC ?? 180),
  rebootTimeoutSec: Number(env.COMMAND_REBOOT_TIMEOUT_SEC ?? 300),
  // กล่องหลุดการเชื่อมต่อระหว่างทำคำสั่ง (ก่อนติดตั้ง/รีบูต) เกินเวลานี้ -> FAILED (DEVICE_DISCONNECTED) (0 = ปิด)
  disconnectGraceSec: Number(env.COMMAND_DISCONNECT_GRACE_SEC ?? 60),
  // รอหลังกล่องต่อ Gateway หรืองาน firmware ก่อนหน้าจบ ก่อนส่งงาน firmware ใหม่ (0 = ไม่รอ)
  firmwareSettleSec: Number(env.FIRMWARE_SETTLE_SEC ?? 30),
  // POST ผลคำสั่งที่จบแล้วไปยัง URL นี้ (ว่าง = ปิด)
  notifyWebhookUrl: env.NOTIFY_WEBHOOK_URL || '',
  notifyWebhookToken: env.NOTIFY_WEBHOOK_TOKEN || '',
  maxMessageBytes: Number(env.MAX_MESSAGE_BYTES || 16 * 1024),
};

if (config.adminToken.length < 16) {
  console.error('ต้องตั้ง ADMIN_TOKEN ใน .env (อย่างน้อย 16 ตัวอักษร)');
  process.exit(1);
}

module.exports = config;
