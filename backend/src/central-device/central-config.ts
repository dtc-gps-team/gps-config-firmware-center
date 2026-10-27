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
  /** นับเป็นความล้มเหลวของ Rollout (เข้า Auto Pause) */
  | { kind: 'failed'; detail: string }
  /** ไม่ใช่ความผิดของ Config: กล่องออฟไลน์ หรือคำสั่งถูกแทนที่/ยกเลิก ไม่นับล้มเหลว */
  | { kind: 'skipped'; detail: string }
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
};

function describeFailure(command: RawCentralCommand): string {
  const code = command.error_code ?? '';
  return FAILED_ERROR_CODE_MESSAGES[code] ?? describe(command);
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
    };
  }
  if (['SUPERSEDED', 'CANCELLED'].includes(code)) {
    return {
      kind: 'skipped',
      detail: `คำสั่งถูกแทนที่หรือยกเลิกที่ Server กลาง (${describe(command)})`,
    };
  }
  return { kind: 'failed', detail: describeFailure(command) };
}
