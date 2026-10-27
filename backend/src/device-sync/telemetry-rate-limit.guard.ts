import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import {
  TELEMETRY_SETTINGS,
  type TelemetrySettings,
} from './telemetry-settings';

export const TELEMETRY_RATE_WINDOW_MS = 60_000;

interface Window {
  startedAt: number;
  count: number;
}

/**
 * จำกัดจำนวนคำขอของ endpoint telemetry (docs/23 §7.4) — ต่อ `deviceId` ใน path
 * และต่อ IP ต้นทาง ช่วงละ 1 นาที (fixed window) · ใส่ก่อน `TelemetryKeyGuard`
 * จึงกันการเดา key ด้วย · ตอบ 429
 *
 * backend ยังรัน instance เดียว จึงเก็บตัวนับในหน่วยความจำ ถ้าขยายเป็นหลาย
 * instance ต้องย้ายไปที่เก็บกลาง · IP มาจาก `req.ip` (หลัง reverse proxy ต้องตั้ง
 * `TRUST_PROXY`) · ไม่ใช้ `@nestjs/throttler` เพราะต้องการแค่ endpoint เดียวกับ
 * 2 ขอบเขต ไม่เปิด limiter ทั้งแอป
 */
@Injectable()
export class TelemetryRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private lastSweepAt = 0;

  constructor(
    @Inject(TELEMETRY_SETTINGS) private readonly settings: TelemetrySettings,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    this.sweep(now);

    const deviceId = String(request.params?.deviceId ?? '');
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    // นับทั้งสองขอบเขตทุกคำขอ (ไม่หยุดที่ตัวแรก) ให้ตัวนับตรงกับคำขอที่เข้ามาจริง
    const deviceOk = this.hit(
      `device:${deviceId}`,
      this.settings.perDeviceLimit,
      now,
    );
    const ipOk = this.hit(`ip:${ip}`, this.settings.perIpLimit, now);
    if (!deviceOk || !ipOk) {
      throw new HttpException(
        'ส่งข้อมูลถี่เกินกำหนด กรุณารอสักครู่',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private hit(key: string, limit: number, now: number): boolean {
    const window = this.windows.get(key);
    if (!window || now - window.startedAt >= TELEMETRY_RATE_WINDOW_MS) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= limit;
  }

  /** ลบช่วงที่หมดอายุแล้ว นาทีละครั้ง — กัน Map โตไม่หยุดจาก deviceId สุ่ม */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < TELEMETRY_RATE_WINDOW_MS) return;
    this.lastSweepAt = now;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= TELEMETRY_RATE_WINDOW_MS) {
        this.windows.delete(key);
      }
    }
  }
}
