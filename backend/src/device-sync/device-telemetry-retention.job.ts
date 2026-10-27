import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeviceTelemetryService } from './device-telemetry.service';
import {
  TELEMETRY_SETTINGS,
  type TelemetrySettings,
} from './telemetry-settings';

/**
 * ลบ telemetry/event ที่เก่ากว่า `TELEMETRY_RETENTION_DAYS` วัน (docs/23 §3.3) —
 * แยกจาก service เพื่อให้ `purgeExpired()` เทสได้ตรงๆ (รูปแบบเดียวกับ
 * `RolloutTimeoutJob`) · ทุกชั่วโมงพอ เพราะอายุข้อมูลเป็นหลักวัน
 */
@Injectable()
export class DeviceTelemetryRetentionJob {
  private readonly logger = new Logger(DeviceTelemetryRetentionJob.name);

  constructor(
    private readonly service: DeviceTelemetryService,
    @Inject(TELEMETRY_SETTINGS) private readonly settings: TelemetrySettings,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'device-telemetry-retention' })
  async run(): Promise<void> {
    try {
      const deleted = await this.service.purgeExpired(
        this.settings.retentionDays,
      );
      if (deleted > 0) {
        this.logger.log(`ลบ telemetry/event เก่า ${deleted} แถว`);
      }
    } catch (err) {
      // job ไม่ควรทำให้ process ล้ม — log ไว้ให้รอบถัดไปลองใหม่
      this.logger.error(
        `device telemetry retention ล้มเหลว: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
