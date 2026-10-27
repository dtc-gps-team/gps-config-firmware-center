import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceDataReportDto } from './dto/device-data-report.dto';

/** เลื่อน `Device.reportedFirmwareAt` เมื่อค่าเดิมเก่ากว่านี้เท่านั้น — กล่องส่งทุก
 * 10 วินาที ไม่เขียน Device ทุกรอบ (docs/23 §6 — เหมือน `lastSeenAt` ของ
 * `DeviceApiKeyGuard`) */
export const REPORTED_FIRMWARE_WRITE_INTERVAL_MS = 60_000;

/** ลบข้อมูลเก่าทีละชุด กันล็อกตารางนาน (docs/23 §3.3) */
export const RETENTION_BATCH_SIZE = 1000;
/** จำนวนชุดสูงสุดต่อตารางต่อรอบ — ที่เหลือรอรอบถัดไป */
export const RETENTION_MAX_BATCHES = 50;

export interface DeviceDataReportResponse {
  accepted: true;
}

/** `timestamp` ของกล่อง (ISO 8601 UTC หรือ `""`) — ว่าง/อ่านไม่ได้ = null (Q7) */
export function parseDeviceTimestamp(value: string): Date | null {
  if (!value.trim()) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

/**
 * รับ GPS telemetry และเหตุการณ์จากกล่อง (docs/23) — `deviceId` มาจาก path ที่
 * `TelemetryKeyGuard` ผ่านแล้ว ทุก query scope ด้วยค่านี้ · ไม่ลง AuditLog และยังไม่
 * สร้าง Incident/Notification (Q2)
 */
@Injectable()
export class DeviceTelemetryService {
  private readonly logger = new Logger(DeviceTelemetryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async report(
    deviceId: string,
    dto: DeviceDataReportDto,
  ): Promise<DeviceDataReportResponse> {
    if (dto.device_id !== undefined && dto.device_id !== deviceId) {
      throw new BadRequestException(
        'device_id ใน body ไม่ตรงกับ deviceId ใน path',
      );
    }

    const receivedAt = new Date();
    const at = parseDeviceTimestamp(dto.timestamp) ?? receivedAt;
    const simulated = dto.simulated ?? false;

    if (dto.event_type) {
      await this.prisma.deviceEvent.create({
        data: {
          deviceId,
          eventType: dto.event_type,
          latitude: dto.latitude,
          longitude: dto.longitude,
          speedKmh: dto.speed_kmh ?? null,
          speedLimitKmh: dto.speed_limit_kmh ?? null,
          distanceM: dto.distance_m ?? null,
          radiusM: dto.radius_m ?? null,
          simulated,
          occurredAt: at,
          receivedAt,
        },
      });
    } else {
      await this.prisma.deviceTelemetry.create({
        data: {
          deviceId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          speedKmh: dto.speed_kmh ?? null,
          // DTO บังคับ 2 field นี้เมื่อไม่มี event_type
          fix: dto.fix!,
          locationSource: dto.location_source!,
          satellites: dto.satellites ?? null,
          simulated,
          recordedAt: at,
          receivedAt,
        },
      });
    }

    if (dto.firmware_version?.trim()) {
      await this.recordReportedFirmware(
        deviceId,
        dto.firmware_version.trim(),
        receivedAt,
      );
    }
    return { accepted: true };
  }

  /**
   * §6 — ค่าเปลี่ยน → เขียนเวอร์ชัน + เวลา · ค่าเดิม → เลื่อนเวลาแบบ throttle
   * **never-throw**: เป็นข้อมูลประกอบ เขียนไม่สำเร็จต้องไม่ทำให้ telemetry ที่บันทึก
   * แล้วตอบ error (กล่องไม่ส่งซ้ำ) · `updateMany` เช็คและเขียนในคำสั่งเดียว
   */
  private async recordReportedFirmware(
    deviceId: string,
    version: string,
    now: Date,
  ): Promise<void> {
    try {
      const changed = await this.prisma.device.updateMany({
        where: {
          deviceId,
          OR: [
            { reportedFirmwareVersion: null },
            { reportedFirmwareVersion: { not: version } },
          ],
        },
        data: { reportedFirmwareVersion: version, reportedFirmwareAt: now },
      });
      if (changed.count > 0) return;
      await this.prisma.device.updateMany({
        where: {
          deviceId,
          reportedFirmwareVersion: version,
          OR: [
            { reportedFirmwareAt: null },
            {
              reportedFirmwareAt: {
                lt: new Date(
                  now.getTime() - REPORTED_FIRMWARE_WRITE_INTERVAL_MS,
                ),
              },
            },
          ],
        },
        data: { reportedFirmwareAt: now },
      });
    } catch (err) {
      this.logger.warn(
        `บันทึก firmware_version ของ ${deviceId} ไม่สำเร็จ: ${(err as Error).message}`,
      );
    }
  }

  /**
   * ลบ telemetry/event ที่ `receivedAt` เก่ากว่า `retentionDays` วัน (§3.3) — ใช้
   * `receivedAt` ไม่ใช่เวลาของกล่องเพราะเพี้ยนได้ · ลบทีละ
   * {@link RETENTION_BATCH_SIZE} แถว ไม่ `deleteMany` ก้อนเดียว
   * @returns จำนวนแถวที่ลบรวมทั้งสองตาราง
   */
  async purgeExpired(retentionDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
    );
    const where = { receivedAt: { lt: cutoff } };
    const telemetry = await purgeInBatches(
      (take) =>
        this.prisma.deviceTelemetry.findMany({
          where,
          select: { id: true },
          take,
        }),
      (ids) =>
        this.prisma.deviceTelemetry.deleteMany({ where: { id: { in: ids } } }),
    );
    const events = await purgeInBatches(
      (take) =>
        this.prisma.deviceEvent.findMany({ where, select: { id: true }, take }),
      (ids) =>
        this.prisma.deviceEvent.deleteMany({ where: { id: { in: ids } } }),
    );
    return telemetry + events;
  }
}

async function purgeInBatches(
  findIds: (take: number) => Promise<{ id: string }[]>,
  deleteIds: (ids: string[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < RETENTION_MAX_BATCHES; i++) {
    const rows = await findIds(RETENTION_BATCH_SIZE);
    if (rows.length === 0) break;
    const { count } = await deleteIds(rows.map((r) => r.id));
    total += count;
    if (rows.length < RETENTION_BATCH_SIZE) break;
  }
  return total;
}
