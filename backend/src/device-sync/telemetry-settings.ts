import { Logger } from '@nestjs/common';

/** DI token ของ {@link TelemetrySettings} (docs/23 §7) */
export const TELEMETRY_SETTINGS = Symbol('TELEMETRY_SETTINGS');

export const DEFAULT_TELEMETRY_RETENTION_DAYS = 30;
export const DEFAULT_TELEMETRY_RATE_LIMIT_PER_DEVICE = 60;
export const DEFAULT_TELEMETRY_RATE_LIMIT_PER_IP = 300;

/** ค่าตั้งของ endpoint telemetry ที่อ่านจาก env ครั้งเดียวตอนเริ่มแอป */
export interface TelemetrySettings {
  /** SHA-256 (32 byte) ของ key กลาง `TELEMETRY_INGEST_KEY_SHA256` · null =
   * ไม่ได้ตั้ง/รูปแบบผิด → เครื่องที่ไม่มี key ของตัวเองถูกปฏิเสธทั้งหมด (fail closed — §7.2) */
  centralKeyHash: Buffer | null;
  retentionDays: number;
  /** คำขอต่อนาที ต่อ `deviceId` ใน path (§7.4) */
  perDeviceLimit: number;
  /** คำขอต่อนาที ต่อ IP ต้นทาง (§7.4) */
  perIpLimit: number;
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** แปลง SHA-256 hex เป็น Buffer 32 byte · รูปแบบผิด = null (ใช้กับ
 * `Device.telemetryKeyHash` ด้วย) */
export function parseSha256Hex(
  value: string | null | undefined,
): Buffer | null {
  const trimmed = value?.trim();
  if (!trimmed || !SHA256_HEX.test(trimmed)) return null;
  return Buffer.from(trimmed, 'hex');
}

/**
 * อ่านค่าตั้งจาก env — ไม่ hardcode · ค่าที่ไม่ใช่จำนวนเต็มบวกถอยไปใช้ค่าเริ่มต้น
 * และ log เตือน (docs/23 §3.3/§7.4) · ไม่ log ค่า key
 */
export function resolveTelemetrySettings(
  get: (key: string) => string | undefined,
  logger: Pick<Logger, 'warn'> = new Logger('TelemetrySettings'),
): TelemetrySettings {
  const rawKey = get('TELEMETRY_INGEST_KEY_SHA256');
  const centralKeyHash = parseSha256Hex(rawKey);
  if (!rawKey?.trim()) {
    logger.warn(
      'ไม่ได้ตั้ง TELEMETRY_INGEST_KEY_SHA256 — telemetry จากกล่องที่ไม่มี key ของตัวเองจะถูกปฏิเสธทั้งหมด',
    );
  } else if (!centralKeyHash) {
    logger.warn(
      'TELEMETRY_INGEST_KEY_SHA256 ต้องเป็น SHA-256 hex 64 ตัวอักษร — ไม่ใช้ key กลาง (ปฏิเสธทั้งหมด)',
    );
  }

  const positiveInt = (key: string, fallback: number): number => {
    const raw = get(key);
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
    logger.warn(
      `${key}="${raw}" ไม่ใช่จำนวนเต็มบวก — ใช้ค่าเริ่มต้น ${fallback}`,
    );
    return fallback;
  };

  return {
    centralKeyHash,
    retentionDays: positiveInt(
      'TELEMETRY_RETENTION_DAYS',
      DEFAULT_TELEMETRY_RETENTION_DAYS,
    ),
    perDeviceLimit: positiveInt(
      'TELEMETRY_RATE_LIMIT_PER_DEVICE',
      DEFAULT_TELEMETRY_RATE_LIMIT_PER_DEVICE,
    ),
    perIpLimit: positiveInt(
      'TELEMETRY_RATE_LIMIT_PER_IP',
      DEFAULT_TELEMETRY_RATE_LIMIT_PER_IP,
    ),
  };
}
