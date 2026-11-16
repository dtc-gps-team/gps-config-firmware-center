// คำอธิบาย error_code เป็นภาษาไทย (ทั้งที่กล่องรายงานมา และที่ server ตั้งเอง)
const MESSAGES = {
  // ---------- server ----------
  DEVICE_OFFLINE: 'คำสั่งไปไม่ถึงกล่อง — กล่องออฟไลน์เกินเวลาที่กำหนด',
  DEVICE_NO_RESPONSE: 'กล่องไม่ตอบสนอง — รับคำสั่งไปแล้วแต่ไม่รายงานผลภายในเวลาที่กำหนด (อาจไฟดับ / หลุดเน็ต)',
  DEVICE_DISCONNECTED: 'กล่องหลุดการเชื่อมต่อเกินเวลาที่กำหนดระหว่างทำคำสั่ง',
  TTL_EXPIRED: 'คำสั่งหมดอายุก่อนกล่องจะทำ',
  SUPERSEDED: 'ถูกแทนที่ด้วยคำสั่ง Config ใหม่กว่า',
  CANCELLED: 'ผู้ดูแลยกเลิกคำสั่ง',

  // ---------- Config ----------
  CONFIG_INVALID_JSON: 'Config ที่กล่องได้รับเสียหาย (อ่าน JSON ไม่ได้)',
  CONFIG_VERSION_MISMATCH: 'Config บน Server เปลี่ยนไปแล้วระหว่างส่ง — ให้ส่งใหม่อีกครั้ง',
  SCHEMA_NOT_SUPPORTED: 'Config นี้ใช้ schema ที่ firmware ในกล่องไม่รองรับ — อัปเดต firmware ก่อน',
  SETTINGS_MISSING: 'Config ไม่มีค่าตั้ง (settings)',

  // ---------- Firmware ----------
  MANIFEST_INVALID_JSON: 'ข้อมูล firmware (manifest) ที่กล่องได้รับเสียหาย',
  HARDWARE_MISMATCH: 'firmware นี้ไม่ใช่ของรุ่นบอร์ดนี้',
  VERSION_MISMATCH: 'เวอร์ชันที่ Server ส่งมาไม่ตรงกับที่สั่ง',
  UNSIGNED_FIRMWARE: 'firmware ไม่มีลายเซ็น กล่องไม่ยอมติดตั้ง',
  NO_OTA_PARTITION: 'กล่องไม่มีพื้นที่สำรองสำหรับ OTA — ต้องแฟลชผ่าน USB ใหม่ โดยเลือก Partition Scheme: Minimal SPIFFS (1.9MB APP with OTA)',
  SIZE_NOT_SUPPORTED: 'firmware ใหญ่เกินพื้นที่ OTA ของกล่อง (ตอนแฟลชครั้งแรกต้องเลือก Partition: Minimal SPIFFS 1.9MB APP with OTA)',
  DOWNLOAD_URL_INVALID: 'ลิงก์ดาวน์โหลด firmware ไม่ถูกต้อง (ตรวจ PUBLIC_BASE_URL ใน delivery-server/.env)',
  SIZE_MISMATCH: 'ขนาดไฟล์ที่ดาวน์โหลดไม่ตรงกับที่ Server แจ้ง',
  UPDATE_BEGIN_FAILED: 'กล่องเตรียมพื้นที่ติดตั้ง firmware ไม่ได้ (ดูรายละเอียด) — มักเกิดจาก Partition Scheme ไม่รองรับ OTA',
  FLASH_WRITE_FAILED: 'เขียน firmware ลงหน่วยความจำกล่องไม่สำเร็จ',
  DOWNLOAD_TIMEOUT: 'ดาวน์โหลด firmware ค้าง (เน็ตช้า / หลุด)',
  SHA256_MISMATCH: 'ไฟล์ที่ดาวน์โหลดเสียหาย (SHA-256 ไม่ตรง) — ไม่ติดตั้ง',
  SIGNATURE_INVALID: 'ลายเซ็น firmware ไม่ถูกต้อง — ไม่ติดตั้ง (ป้องกัน firmware ปลอม)',
  UPDATE_END_FAILED: 'ติดตั้ง firmware ไม่สำเร็จ',
  NEW_FIRMWARE_FAILED_HEALTH_CHECK: 'firmware ใหม่ต่อ Server ไม่ได้หลังรีบูต กล่องจึงย้อนกลับไปใช้เวอร์ชันเดิม',
  UNSUPPORTED_ACTION: 'firmware ในกล่องไม่รู้จักคำสั่งนี้',
};

const HTTP_TH = {
  '-1': 'ต่อ Delivery Server ไม่ได้ (ตรวจ Delivery URL ในกล่อง / server ปิดอยู่ / Firewall)',
  401: 'Server ไม่ยอมรับกล่อง (Device ID / รหัสไม่ถูก หรือถูกระงับ)',
  403: 'ลิงก์ดาวน์โหลดหมดอายุหรือไม่ถูกต้อง',
  404: 'ไม่พบข้อมูลบน Server',
  409: 'Server ปฏิเสธคำขอ',
};

function describeError(code, detail = '') {
  if (!code) return null;
  if (/DOWNGRADE_NOT_ALLOWED/.test(detail)) return 'Server ไม่อนุญาตให้ลดเวอร์ชัน firmware — ถ้าต้องการย้อนเวอร์ชันจริง ให้ส่งพร้อม X-Allow-Downgrade: true';
  if (/ALREADY_INSTALLED/.test(detail)) return 'กล่องใช้ firmware เวอร์ชันนี้อยู่แล้ว';
  if (/RELEASE_NOT_AVAILABLE/.test(detail)) return 'ไม่พบ firmware เวอร์ชันนี้บน Server (ยังไม่ได้อัปโหลด หรือถูกพัก/ยกเลิก)';
  if (MESSAGES[code]) return MESSAGES[code];
  let m = /^(CONFIG|MANIFEST|DOWNLOAD)_HTTP_(-?\d+)$/.exec(code);
  if (m) {
    const what = { CONFIG: 'ดึง Config', MANIFEST: 'ขอข้อมูล firmware', DOWNLOAD: 'ดาวน์โหลด firmware' }[m[1]];
    const code = Number(m[2]);
    return `${what} ไม่สำเร็จ (HTTP ${code}): ${HTTP_TH[code < 0 ? '-1' : code] || 'Server ตอบผิดปกติ'}`;
  }
  m = /^UNSUPPORTED_PARAMETER:(.+)$/.exec(code);
  if (m) return `firmware ในกล่องไม่รองรับค่า "${m[1]}" — อัปเดต firmware ก่อน หรือเอาค่านี้ออก`;
  m = /^INVALID_VALUE:(.+)$/.exec(code);
  if (m) return `ค่า "${m[1]}" ไม่ถูกต้อง (ชนิดข้อมูล / ช่วงค่าไม่ผ่าน)`;
  m = /^INVALID_GROUP:(.+)$/.exec(code);
  if (m) return `กลุ่มค่าตั้ง "${m[1]}" มีรูปแบบไม่ถูกต้อง`;
  return code;
}

module.exports = { describeError };
