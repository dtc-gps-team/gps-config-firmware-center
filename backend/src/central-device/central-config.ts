import type {
  RawCentralCommand,
  RawCentralSchema,
  RawSchemaParameter,
} from './central-device.types';

export type BuildSettingsResult =
  { settings: Record<string, unknown> } | { errors: string[] };

function coerce(
  param: RawSchemaParameter,
  value: unknown,
): { value: unknown } | { error: string } {
  switch (param.type) {
    case 'boolean': {
      if (typeof value === 'boolean') return { value };
      if (value === 'true') return { value: true };
      if (value === 'false') return { value: false };
      return { error: 'ต้องเป็น true/false' };
    }
    case 'integer':
    case 'number': {
      const n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : Number.NaN;
      if (!Number.isFinite(n)) return { error: 'ต้องเป็นตัวเลข' };
      if (param.type === 'integer' && !Number.isInteger(n)) {
        return { error: 'ต้องเป็นจำนวนเต็ม' };
      }
      return { value: n };
    }
    case 'enum': {
      const match = (param.options ?? []).find(
        (o) => String(o) === String(value),
      );
      return match === undefined
        ? { error: `ต้องเป็นหนึ่งใน ${(param.options ?? []).join(', ')}` }
        : { value: match };
    }
    default:
      // string, hostname และชนิดอื่นที่ Server กลางตรวจเองอีกชั้น
      return typeof value === 'string' || typeof value === 'number'
        ? { value: String(value) }
        : { error: 'ต้องเป็นข้อความ' };
  }
}

/**
 * แปลง Config ของเรา (`{ "gps.send_interval_sec": "20" }` คีย์แบบมีจุด ค่าอาจเป็นข้อความ)
 * เป็น `settings` ซ้อนชั้นที่ Server กลางรับ (`{ gps: { send_interval_sec: 20 } }`) โดยแปลงชนิด
 * ค่าตาม schema ของกล่อง · คีย์ที่ schema ไม่มี หรือค่าที่แปลงไม่ได้ ถือว่าส่งไม่ได้ทั้งชุด
 * (ไม่ส่งครึ่งๆ กลางๆ) พร้อมรายการเหตุผลทุกข้อ · ช่วงค่า (min/max) ปล่อยให้ Server กลางตรวจ
 * เองและส่งเหตุผลกลับมา เพราะเขาเป็นเจ้าของกฎ
 */
export function buildCentralSettings(
  fields: Record<string, unknown>,
  schema: RawCentralSchema,
): BuildSettingsResult {
  const byKey = new Map(schema.parameters.map((p) => [p.key, p]));
  const errors: string[] = [];
  const settings: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(fields)) {
    const param = byKey.get(key);
    if (!param) {
      errors.push(
        `พารามิเตอร์ "${key}" ไม่มีใน schema ของ ${schema.hardware_model} (schema ${schema.schema_version})`,
      );
      continue;
    }
    const result = coerce(param, raw);
    if ('error' in result) {
      errors.push(`"${key}" ${result.error} (ได้รับ ${JSON.stringify(raw)})`);
      continue;
    }
    const path = key.split('.');
    let cursor = settings;
    for (const part of path.slice(0, -1)) {
      const next = cursor[part];
      if (typeof next === 'object' && next !== null) {
        cursor = next as Record<string, unknown>;
      } else {
        const created: Record<string, unknown> = {};
        cursor[part] = created;
        cursor = created;
      }
    }
    cursor[path[path.length - 1]] = result.value;
  }

  if (errors.length > 0) return { errors };
  if (Object.keys(settings).length === 0) {
    return { errors: ['Config ไม่มี field ใดเลยให้ส่ง'] };
  }
  return { settings };
}

/** ผลของคำสั่งหนึ่งรายการ ในมุมที่ Rollout ต้องตัดสิน */
export type CentralCommandOutcome =
  | { kind: 'pending' }
  | { kind: 'success' }
  /** นับเป็นความล้มเหลวของ Rollout (เข้า Auto Pause) · `errorCode` = `error_code`
   * ดิบจาก Server กลาง (docs/31 ใช้ตัดสินว่าลองส่งใหม่ได้ไหม) */
  | { kind: 'failed'; detail: string; errorCode?: string | null }
  /** ไม่ใช่ความผิดของ Config: กล่องออฟไลน์ หรือคำสั่งถูกแทนที่/ยกเลิก ไม่นับล้มเหลว */
  | { kind: 'skipped'; detail: string; errorCode?: string | null }
  /** ถามสถานะไม่ได้ตอนนี้ (Server กลางติดต่อไม่ได้) ไม่ตัดสิน รอรอบถัดไป */
  | { kind: 'unavailable' };

const TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'FAILED',
  'ROLLED_BACK',
  'EXPIRED',
]);

function describe(command: RawCentralCommand): string {
  const parts = [command.status];
  if (command.error_code) parts.push(command.error_code);
  // กล่องบางตัวส่งข้อความซ้ำกับรหัส ไม่ต้องแสดงสองรอบ
  if (command.error_message && command.error_message !== command.error_code) {
    parts.push(command.error_message);
  }
  return `Server กลางรายงาน ${parts.join(' ')}`;
}

/**
 * ข้อความ `resultDetail` ที่อ่านง่ายกว่า `describe()` ดิบๆ สำหรับ `error_code`
 * ที่รู้จักแน่ชัดว่าหมายถึงอะไร (docs/27 §7.2) — รหัสอื่นที่ไม่อยู่ในตารางนี้
 * (รวมรหัสใหม่ที่ gateway อาจเพิ่มในอนาคต) ใช้ `describe()` เดิมเป็น fallback
 * (ไม่ throw ไม่ว่ารหัสจะเป็นอะไร)
 */
const FAILED_ERROR_CODE_MESSAGES: Record<string, string> = {
  DEVICE_DISCONNECTED: 'กล่องหลุดการเชื่อมต่อเกิน 1 นาที — ส่งไม่ผ่าน',
  DEVICE_NO_RESPONSE: 'กล่องไม่ตอบกลับภายในเวลาที่กำหนด',
  ROLLED_BACK: 'Firmware ใหม่ไม่ผ่านการตรวจหลังรีบูต กล่องย้อนกลับเวอร์ชันเดิม',
  NEW_FIRMWARE_FAILED_HEALTH_CHECK:
    'Firmware ใหม่ไม่ผ่านการตรวจหลังรีบูต กล่องย้อนกลับเวอร์ชันเดิม',
  DOWNLOAD_TIMEOUT: 'ดาวน์โหลด Firmware ค้าง (เน็ตช้าหรือหลุด)',
  // รหัสที่กล่องรายงานเอง — อ้างอิง `ws-gateway/src/errors.js` และ `finishCommand()` ของ firmware
  SCHEMA_NOT_SUPPORTED:
    'Firmware ในกล่องไม่รองรับ Config ชุดนี้ อัปเดต Firmware ก่อน',
  SETTINGS_MISSING: 'Config ไม่มีค่าตั้งให้กล่อง',
  HARDWARE_MISMATCH: 'Firmware นี้ไม่ใช่ของรุ่นบอร์ดในกล่อง',
  VERSION_MISMATCH: 'Server ส่ง Firmware ไม่ตรงกับเวอร์ชันที่สั่ง',
  UNSIGNED_FIRMWARE: 'Firmware ไม่มีลายเซ็น กล่องไม่ยอมติดตั้ง',
  SIGNATURE_INVALID: 'ลายเซ็น Firmware ไม่ถูกต้อง กล่องไม่ยอมติดตั้ง',
  NO_OTA_PARTITION:
    'กล่องไม่มีพื้นที่สำหรับอัปเดต Firmware ผ่านเน็ต ต้องแฟลชผ่าน USB',
  SIZE_NOT_SUPPORTED: 'Firmware ใหญ่เกินพื้นที่ในกล่อง',
  DOWNLOAD_URL_INVALID:
    'ลิงก์ดาวน์โหลด Firmware บน Server ไม่ถูกต้อง แจ้งผู้ดูแล Server',
  UNSUPPORTED_ACTION: 'Firmware ในกล่องไม่รู้จักคำสั่งนี้',
  SHA256_MISMATCH: 'ไฟล์ Firmware เสียระหว่างดาวน์โหลด กล่องไม่ติดตั้ง',
  SIZE_MISMATCH: 'ขนาดไฟล์ Firmware ที่ดาวน์โหลดไม่ตรงกับที่ Server แจ้ง',
  UPDATE_BEGIN_FAILED: 'กล่องเตรียมพื้นที่ติดตั้ง Firmware ไม่ได้',
  FLASH_WRITE_FAILED: 'เขียน Firmware ลงกล่องไม่สำเร็จ',
  UPDATE_END_FAILED: 'ติดตั้ง Firmware ไม่สำเร็จ',
  CONFIG_INVALID_JSON: 'Config ที่กล่องได้รับเสียหาย',
  MANIFEST_INVALID_JSON: 'ข้อมูล Firmware ที่กล่องได้รับเสียหาย',
  CONFIG_VERSION_MISMATCH: 'Config บน Server เปลี่ยนระหว่างส่ง',
};

/** สิ่งที่กล่องกำลังทำตอนได้ HTTP error (`<ส่วน>_HTTP_<code>` ใน `finishCommand()` ของ firmware) */
const HTTP_ERROR_STEPS: Record<string, string> = {
  CONFIG: 'ดึง Config',
  MANIFEST: 'ขอข้อมูล Firmware',
  DOWNLOAD: 'ดาวน์โหลด Firmware',
};

/** รหัสที่กล่องสร้างขึ้นเองพร้อมค่าต่อท้าย (ชื่อ field หรือ HTTP status) — null = ไม่ใช่รหัสแบบนี้ */
function describePatternedCode(
  code: string,
  errorMessage: string | null | undefined,
): string | null {
  let m = /^UNSUPPORTED_PARAMETER:(.+)$/.exec(code);
  if (m) {
    return `Firmware ในกล่องไม่รองรับค่า "${m[1]}" อัปเดต Firmware ก่อน หรือเอาค่านี้ออก`;
  }
  m = /^INVALID_VALUE:(.+)$/.exec(code);
  if (m) return `ค่า "${m[1]}" ไม่ถูกต้อง (ชนิดข้อมูลหรือช่วงค่าไม่ผ่าน)`;
  m = /^INVALID_GROUP:(.+)$/.exec(code);
  if (m) return `กลุ่มค่าตั้ง "${m[1]}" มีรูปแบบไม่ถูกต้อง`;
  m = /^(CONFIG|MANIFEST|DOWNLOAD)_HTTP_(-?\d+)$/.exec(code);
  if (m) {
    // กล่องใส่ body ที่ Server ตอบไว้ใน error_message — 409 ของ manifest คือห้ามลดเวอร์ชัน
    if (/DOWNGRADE_NOT_ALLOWED/.test(errorMessage ?? '')) {
      return 'Server ไม่อนุญาตให้ลดเวอร์ชัน Firmware';
    }
    const step = HTTP_ERROR_STEPS[m[1]];
    return Number(m[2]) < 0
      ? `${step} ไม่สำเร็จ เพราะกล่องต่อ Server ไม่ได้`
      : `${step} จาก Server ไม่สำเร็จ (HTTP ${m[2]})`;
  }
  return null;
}

export function describeCentralFailure(command: RawCentralCommand): string {
  const code = command.error_code ?? '';
  return (
    FAILED_ERROR_CODE_MESSAGES[code] ??
    describePatternedCode(code, command.error_message) ??
    describe(command)
  );
}

/**
 * แปลงสถานะคำสั่งของ Server กลางเป็นผลของ Rollout
 * - SUCCESS = สำเร็จ (Server กลางยืนยันจากเวอร์ชันที่กล่องรายงานแล้ว)
 * - ดู `error_code` ก่อนสถานะ เพราะ gateway ตั้งสถานะต่างกันตามรหัส (ตรวจจากโค้ด
 *   `expireSweep` และ `create`): DEVICE_OFFLINE ตั้งเป็น **FAILED** (ไม่ใช่ EXPIRED),
 *   SUPERSEDED/CANCELLED/TTL_EXPIRED ตั้งเป็น EXPIRED
 *   - DEVICE_OFFLINE, TTL_EXPIRED = กล่องไม่ได้รับ (ข้าม ไม่นับล้มเหลว)
 *   - SUPERSEDED, CANCELLED = ถูกแทนที่หรือยกเลิก (ข้าม ไม่นับล้มเหลว)
 * - FAILED / ROLLED_BACK / DEVICE_NO_RESPONSE / รหัสอื่นที่ไม่รู้จัก = ล้มเหลว —
 *   ข้อความอ่านง่ายตาม `error_code` ที่รู้จัก (docs/27 §7.2, ดู
 *   `FAILED_ERROR_CODE_MESSAGES`) รหัสอื่นที่ไม่รู้จัก fallback เป็น `describe()`
 * - สถานะระหว่างทาง (PENDING ... REBOOTING) = ยังรอ
 */
export function classifyCentralCommand(
  command: RawCentralCommand,
): CentralCommandOutcome {
  if (!TERMINAL_STATUSES.has(command.status)) return { kind: 'pending' };
  if (command.status === 'SUCCESS') return { kind: 'success' };

  const code = command.error_code ?? '';
  if (['DEVICE_OFFLINE', 'TTL_EXPIRED'].includes(code)) {
    // ข้อความทั่วไปไม่เจาะจง Config/Firmware (docs/27 §7.2 — ใช้กับ payload
    // ทั้งสองชนิด ฟังก์ชันนี้ไม่รู้ payloadType ของ Rollout)
    return {
      kind: 'skipped',
      detail: `กล่องออฟไลน์ คำสั่งไปไม่ถึง (${describe(command)})`,
      errorCode: code,
    };
  }
  if (['SUPERSEDED', 'CANCELLED'].includes(code)) {
    return {
      kind: 'skipped',
      detail: `คำสั่งถูกแทนที่หรือยกเลิกที่ Server กลาง (${describe(command)})`,
      errorCode: code,
    };
  }
  return {
    kind: 'failed',
    detail: describeCentralFailure(command),
    errorCode: command.error_code ?? null,
  };
}

/**
 * รหัสที่ส่งซ้ำแล้วไม่มีทางผ่าน (docs/31 §3.1 + §6.3 ข้อ 4 / R1.1) — ตรวจจาก `ws-gateway/src/errors.js`
 * และ `finishCommand()` ของ firmware: กล่องรายงานว่ารับของชุดนี้ไม่ได้เลย ไม่ได้ล้มเพราะเน็ตหรือจังหวะ
 * · รหัสที่ล้มเพราะข้อมูลเสียระหว่างทาง (`SHA256_MISMATCH`, `SIZE_MISMATCH`, `*_INVALID_JSON`),
 * Server เปลี่ยนระหว่างส่ง (`CONFIG_VERSION_MISMATCH`), เขียน flash ไม่ผ่าน, HTTP ของกล่อง (`*_HTTP_n`)
 * และ rollback **ยังลองใหม่**
 */
const NON_RETRYABLE_ERROR_CODES = new Set([
  // มีคนสั่งทับหรือยกเลิกคำสั่งนี้ที่ Server กลาง
  'SUPERSEDED',
  'CANCELLED',
  // Config ที่ firmware ในกล่องรับไม่ได้
  'SCHEMA_NOT_SUPPORTED',
  'SETTINGS_MISSING',
  // Firmware ที่กล่องนี้ติดตั้งไม่ได้ (รุ่นบอร์ด / เวอร์ชันที่ Server ส่ง / ลายเซ็น / พื้นที่ OTA)
  'HARDWARE_MISMATCH',
  'VERSION_MISMATCH',
  'UNSIGNED_FIRMWARE',
  'SIGNATURE_INVALID', // ตรวจหลัง SHA-256 ผ่านแล้ว ไฟล์ไม่เสีย ลายเซ็นผิดจริง
  'NO_OTA_PARTITION',
  'SIZE_NOT_SUPPORTED',
  'DOWNLOAD_URL_INVALID', // PUBLIC_BASE_URL ของ delivery-server ผิด ต้องแก้ที่ Server
  // firmware ในกล่องไม่รู้จักคำสั่ง
  'UNSUPPORTED_ACTION',
]);

/** รหัสที่กล่องต่อท้ายด้วยชื่อ field (`device_config.h`) — ค่า Config ที่ firmware ไม่รองรับหรือไม่ผ่าน */
const NON_RETRYABLE_ERROR_CODE_PREFIXES = [
  'UNSUPPORTED_PARAMETER:',
  'INVALID_VALUE:',
  'INVALID_GROUP:',
];

function isNonRetryableErrorCode(code: string): boolean {
  return (
    NON_RETRYABLE_ERROR_CODES.has(code) ||
    NON_RETRYABLE_ERROR_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))
  );
}

/**
 * ผลจบของคำสั่งที่ลองส่งใหม่ได้ (docs/31 §3.1) — เขียนเป็น **denylist ของ "ไม่ลอง"**
 * (รีวิว A #436): ล้มเหลว / ข้ามทุกแบบลองใหม่ ยกเว้นรหัสใน {@link NON_RETRYABLE_ERROR_CODES} · รหัสใหม่ที่
 * gateway เพิ่มในอนาคตจึงได้ลองใหม่โดยไม่ต้องแก้โค้ด (ครบ 3 ครั้งก็จบเหมือนกัน) · Server กลาง
 * ปฏิเสธตอนส่ง (`rejected`) ไม่ผ่านฟังก์ชันนี้ ผู้เรียกจบทันที · ไม่แก้ `classifyCentralCommand()`
 * เพราะ Campaign ปกติใช้ความหมายเดิมอยู่
 */
export function isRetryableCentralOutcome(
  outcome: CentralCommandOutcome,
): boolean {
  if (outcome.kind !== 'failed' && outcome.kind !== 'skipped') return false;
  return !isNonRetryableErrorCode(outcome.errorCode ?? '');
}
