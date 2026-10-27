import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseSha256Hex,
  TELEMETRY_SETTINGS,
  type TelemetrySettings,
} from './telemetry-settings';

/** ข้อความเดียวทุกกรณีที่ไม่ผ่าน กัน enumeration ว่า deviceId ไหนมีในระบบ (docs/23 §7.3) */
export const TELEMETRY_UNAUTHORIZED_MESSAGE = 'deviceId หรือ key ไม่ถูกต้อง';

/**
 * Guard ของ `POST /device-sync/:deviceId/telemetry/:key` (docs/23 §7.3) — กล่อง
 * ส่งไป Data Server โดยไม่มี header ยืนยันตัวตน key จึงฝังอยู่ใน path ที่ตั้งผ่าน
 * Config ของกล่อง · คนละตัวกับ `DeviceApiKeyGuard` (header `X-Device-Api-Key`,
 * bcrypt) ซึ่งไม่แตะ
 *
 * - เทียบ SHA-256 ของ key แบบ constant-time **ทุกครั้ง** แม้ไม่พบเครื่อง (ไม่ return
 *   ก่อนเทียบ) — ไม่ให้แยกจากเวลาตอบได้ว่า deviceId มีอยู่จริงไหม
 * - `Device.telemetryKeyHash` มีค่า → ใช้ของเครื่องนั้น (key กลางใช้ไม่ได้) · null →
 *   key กลางจาก env · ไม่ได้ตั้ง key กลาง → dummy hash ที่ไม่มีใครรู้ = ปฏิเสธ
 * - ปฏิเสธเฉพาะ `decommissioned` — `registered` รับได้ (Q5) · ไม่เปลี่ยนสถานะเครื่อง
 *   และไม่เขียน `lastSeenAt` ในรอบแรก (§10.2 ข้อ 4)
 * - ไม่ log ค่า key หรือ URL เต็ม
 */
@Injectable()
export class TelemetryKeyGuard implements CanActivate {
  /** สุ่มใหม่ทุกครั้งที่เริ่มแอป — ไม่มี key ไหน hash ได้ค่านี้ */
  private readonly dummyHash = randomBytes(32);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEMETRY_SETTINGS) private readonly settings: TelemetrySettings,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const deviceId = request.params?.deviceId;
    const key = request.params?.key;
    if (typeof deviceId !== 'string' || typeof key !== 'string') {
      throw new UnauthorizedException(TELEMETRY_UNAUTHORIZED_MESSAGE);
    }

    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      select: { status: true, telemetryKeyHash: true },
    });
    const expected =
      (device?.telemetryKeyHash != null
        ? // ค่าในฐานข้อมูลผิดรูปแบบ = ไม่ถอยไปใช้ key กลาง (เครื่องนี้ตั้ง key ของตัวเองแล้ว)
          (parseSha256Hex(device.telemetryKeyHash) ?? this.dummyHash)
        : this.settings.centralKeyHash) ?? this.dummyHash;
    const actual = createHash('sha256').update(key).digest();
    const match = timingSafeEqual(actual, expected);

    if (!match || !device || device.status === 'decommissioned') {
      throw new UnauthorizedException(TELEMETRY_UNAUTHORIZED_MESSAGE);
    }
    return true;
  }
}
